import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backendById, claudeBackend, codexBackend, extractServerUrl, opencodeBackend } from "../src/tui/agent-backends.js";
import { CliAgentRuntime, PersistentAgentServer } from "../src/tui/opencode-runtime.js";
import { cleanup } from "ink-testing-library";
import type { ModelCallRequest } from "../src/augment/types.js";

const temporaryFiles: string[] = [];
const isolatedStateHome = fs.mkdtempSync(path.join(os.tmpdir(), "augment-agent-state-"));
temporaryFiles.push(isolatedStateHome);
process.env.XDG_STATE_HOME = isolatedStateHome;
afterEach(() => {
  cleanup();
  for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true, recursive: true });
});

function fakeBackendCli(firstOutput: string, laterOutput: string): { command: string; log: string } {
  const log = path.join(os.tmpdir(), `augment-backend-log-${process.pid}-${temporaryFiles.length}.txt`);
  temporaryFiles.push(log);
  const marker = path.join(os.tmpdir(), `augment-backend-marker-${process.pid}-${temporaryFiles.length}.flag`);
  temporaryFiles.push(marker);
  const file = path.join(os.tmpdir(), `augment-backend-cli-${process.pid}-${temporaryFiles.length}.sh`);
  fs.writeFileSync(file, [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
    `if [ -f ${JSON.stringify(marker)} ]; then printf '%s' ${JSON.stringify(laterOutput)}; else touch ${JSON.stringify(marker)}; printf '%s' ${JSON.stringify(firstOutput)}; fi`,
    "",
  ].join("\n"));
  fs.chmodSync(file, 0o755);
  temporaryFiles.push(file);
  return { command: file, log };
}

function challengeRequest(): ModelCallRequest {
  return {
    operation: "challenge-domain",
    context: {
      taskId: "task:backend",
      taskRevision: 1,
      objective: "objective",
      basisRevision: "commit:1",
      node: {} as never,
      candidates: [],
      constraints: [],
      obligations: [],
      diffs: [],
      taskDiffs: [],
      taskTree: [],
      lockedPaths: [],
      restrictionMode: "lock",
      rejectedCandidates: [],
    },
    temperature: "normal",
    lod: "file",
  };
}

describe("agent backends", () => {
  it("builds opencode argv with session, model, and title only on fresh sessions", () => {
    expect(opencodeBackend.invocation({ model: "m", prompt: "p", title: "t", autoApprove: true }, {}))
      .toEqual(["run", "--format", "json", "--model", "m", "--auto", "--title", "t", "--", "p"]);
    expect(opencodeBackend.invocation({ session: "ses_x", prompt: "p", title: "t", autoApprove: false }, { server: "http://s", agent: "plan" }))
      .toEqual(["run", "--format", "json", "--server", "http://s", "--session", "ses_x", "--agent", "plan", "--", "p"]);
  });

  it("builds claude argv with plan permissions, model, and resume", () => {
    expect(claudeBackend.invocation({ model: "sonnet", prompt: "p", title: "t", autoApprove: true }, {}))
      .toEqual(["-p", "p", "--output-format", "json", "--permission-mode", "plan", "--model", "sonnet"]);
    expect(claudeBackend.invocation({ session: "s1", prompt: "p", title: "t", autoApprove: false }, {}))
      .toEqual(["-p", "p", "--output-format", "json", "--permission-mode", "plan", "--resume", "s1"]);
    expect(claudeBackend.parseAssistantText('{"result":"{\\"kind\\":\\"accept\\"}","session_id":"abc"}')).toBe('{"kind":"accept"}');
    expect(claudeBackend.extractSessionId('{"result":"x","session_id":"abc"}')).toBe("abc");
    expect(() => claudeBackend.parseAssistantText('{"is_error":true,"result":"quota gone"}')).toThrow(/quota gone/u);
  });

  it("builds codex argv read-only and parses agent_message events", () => {
    expect(codexBackend.invocation({ model: "gpt", prompt: "p", title: "t", autoApprove: true }, {}))
      .toEqual(["exec", "--json", "--sandbox", "read-only", "-m", "gpt", "p"]);
    const stream = '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}\n{"type":"other"}';
    expect(codexBackend.parseAssistantText(stream)).toBe("hello");
    expect(codexBackend.extractSessionId(stream)).toBeUndefined();
  });

  it("resolves backends by id and rejects unknown ids", () => {
    expect(backendById("claude").id).toBe("claude");
    expect(() => backendById("nope")).toThrow(/Unknown agent backend 'nope'/u);
  });

  it("runs a claude backend through the generic runtime with session continuation", async () => {
    const first = JSON.stringify({ result: "{\"kind\":\"accept\"}", session_id: "ses_cl1" });
    const second = JSON.stringify({ result: "{\"kind\":\"accept\"}", session_id: "ses_cl1" });
    const { command, log } = fakeBackendCli(first, second);
    const runtime = new CliAgentRuntime({ directory: process.cwd(), command, backend: "claude", timeoutMs: 5_000, retries: 0 });
    const request = challengeRequest();
    await runtime.call(request);
    await runtime.call(request);
    const logged = fs.readFileSync(log, "utf8");
    expect(logged).toContain("-p");
    expect(logged).toContain("--permission-mode plan");
    expect(logged.match(/--resume ses_cl1/g)?.length).toBe(1);
  });

  it("exposes a persistent serve seam for opencode only", () => {
    expect(opencodeBackend.serveArgs?.()).toEqual(["serve", "--port", "0"]);
    expect(claudeBackend.serveArgs).toBeUndefined();
    expect(codexBackend.serveArgs).toBeUndefined();
    expect(extractServerUrl("starting up\nServing on http://127.0.0.1:4567\nready")).toBe("http://127.0.0.1:4567");
    expect(extractServerUrl("no address here")).toBeUndefined();
  });

  it("keeps one serve process alive across starts and relaunches after dispose", async () => {
    const script = path.join(os.tmpdir(), `augment-serve-${process.pid}-${temporaryFiles.length}.sh`);
    temporaryFiles.push(script);
    fs.writeFileSync(script, ["#!/bin/sh", "printf '%s\\n' 'Serving on http://127.0.0.1:4567'", "exec sleep 5", ""].join("\n"));
    fs.chmodSync(script, 0o755);
    const server = new PersistentAgentServer(script, opencodeBackend);
    const first = await server.start();
    expect(await server.start()).toBe(first);
    expect(first).toBe("http://127.0.0.1:4567");
    server.dispose();
    expect(await server.start()).toBe("http://127.0.0.1:4567");
    server.dispose();
  });
});
