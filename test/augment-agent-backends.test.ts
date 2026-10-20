import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  backendById,
  claudeBackend,
  codexBackend,
  extractServerPassword,
  extractServerUrl,
  opencodeBackend,
  opencodeWarmTransport,
  WarmTransportUnavailableError,
} from "../src/tui/agent-backends.js";
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

  it("captures the password the serve child prints, after the address settles", async () => {
    const script = path.join(os.tmpdir(), `augment-serve-pass-${process.pid}-${temporaryFiles.length}.sh`);
    temporaryFiles.push(script);
    // The address settles first; the password arrives on a later line, so
    // capture must keep listening after the URL was found.
    fs.writeFileSync(script, [
      "#!/bin/sh",
      "printf '%s\\n' 'server listening on http://127.0.0.1:4568'",
      "sleep 0.1",
      "printf '%s\\n' 'server password sekret-pass_w0rd'",
      "exec sleep 5",
      "",
    ].join("\n"));
    fs.chmodSync(script, 0o755);
    const server = new PersistentAgentServer(script, opencodeBackend);
    try {
      expect(await server.start()).toBe("http://127.0.0.1:4568");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(server.password).toBe("sekret-pass_w0rd");
    } finally {
      server.dispose();
    }
  });
});

/**
 * A minimal OpenCode v2 serve stub speaking the verified dialect: basic
 * auth, POST /api/session, per-session model/agent, prompt → user message
 * id, the experimental wait, and a newest-first message list whose `idle`
 * marker ends the run. Scriptable per test.
 */
function fakeV2Server(script: {
  authorization?: string;
  reply?: string[];
  failSessionWith?: number;
  modelBodies?: unknown[];
  agentCalls?: number;
  agentTarget?: { calls: number };
  sessions?: string[];
  /** First message poll reports a still-running session (no idle marker yet). */
  runningFirst?: boolean;
}): { url: string; requests: string[]; close(): Promise<void> } {
  const requests: string[] = [];
  const replies = [...(script.reply ?? [])];
  let gets = 0;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => {
      requests.push(`${request.method} ${request.url} ${body}`.trim());
      const send = (status: number, payload: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(payload === undefined ? "" : JSON.stringify(payload));
      };
      if (script.authorization && request.headers.authorization !== script.authorization) {
        send(401, { error: "unauthorized" });
        return;
      }
      if (request.url === "/api/session" && request.method === "POST") {
        if (script.failSessionWith) {
          send(script.failSessionWith, { error: "boom" });
          return;
        }
        const id = `ses_w${(script.sessions?.length ?? 0) + 1}`;
        script.sessions?.push(id);
        send(200, { data: { id } });
        return;
      }
      const match = request.url?.match(/^\/api\/session\/(ses_[^/]+)(\/.*)?$/);
      if (!match) {
        send(404, {});
        return;
      }
      const [, session, tail = ""] = match;
      if (tail === "/model" && request.method === "POST") {
        script.modelBodies?.push(JSON.parse(body));
        send(204, undefined);
        return;
      }
      if (tail === "/agent" && request.method === "POST") {
        script.agentCalls = (script.agentCalls ?? 0) + 1;
        if (script.agentTarget) script.agentTarget.calls += 1;
        send(204, undefined);
        return;
      }
      if (tail === "/prompt" && request.method === "POST") {
        send(200, { data: { id: "msg_user1" } });
        return;
      }
      if (tail === "/wait" && request.method === "POST") {
        send(204, undefined);
        return;
      }
      if (tail === "/message" && request.method === "GET") {
        // Newest first: [idle?, assistant…, user]. A `runningFirst` script
        // hides the finished run on the first poll so the loop is exercised.
        gets += 1;
        const finished = !(script.runningFirst && gets === 1);
        const messages = [
          ...(finished ? [{ id: "msg_idle1", type: "idle", outcome: "success" }] : []),
          ...replies.map((text, index) => ({
            id: `msg_a${index + 1}`,
            type: "assistant",
            finish: "stop",
            content: [{ type: "text", text }],
          })),
          { id: "msg_user1", type: "user" },
        ];
        send(200, { data: messages, cursor: { previous: null, next: null } });
        return;
      }
      send(404, {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe("opencode warm transport (v2 dialect)", () => {
  it("parses the printed server password", () => {
    expect(extractServerUrl("server listening on http://127.0.0.1:1234\nserver password abc-def_123\n")).toBe("http://127.0.0.1:1234");
    expect(extractServerPassword("server listening on http://127.0.0.1:1234\nserver password abc-def_123\n")).toBe("abc-def_123");
    expect(extractServerPassword("no password here")).toBeUndefined();
  });

  it("runs one prompt over the v2 flow: session, agent, model, prompt, wait, message", async () => {
    const modelBodies: unknown[] = [];
    const agent = { calls: 0 };
    const sessions: string[] = [];
    const host = await fakeV2Server({ reply: ["{\"kind\":\"accept\"}"], modelBodies, agentCalls: 0, sessions, agentTarget: agent });
    try {
      const result = await opencodeWarmTransport.exchange(host.url, opencodeWarmTransport.authorization("sekret"), {
        agent: "plan",
        model: "opencode-go/glm-5.3-flash",
        text: "the prompt",
        timeoutMs: 5_000,
      });
      expect(result.text).toBe("{\"kind\":\"accept\"}");
      expect(result.sessionId).toBe("ses_w1");
      expect(result.stdout).toContain("assistant");
      expect(modelBodies).toEqual([{ model: { providerID: "opencode-go", id: "glm-5.3-flash" } }]);
      expect(agent.calls).toBe(1);
      const flow = host.requests.map((line) => line.split(" ").slice(0, 2).join(" "));
      expect(flow).toEqual([
        "POST /api/session",
        "POST /api/session/ses_w1/agent",
        "POST /api/session/ses_w1/model",
        "POST /api/session/ses_w1/prompt",
        "POST /api/experimental/session/ses_w1/wait",
        "GET /api/session/ses_w1/message",
      ]);
    } finally {
      await host.close();
    }
  });

  it("continues an existing session without re-creating or re-setting its agent", async () => {
    const modelBodies: unknown[] = [];
    const host = await fakeV2Server({ reply: ["ok"], modelBodies });
    try {
      const result = await opencodeWarmTransport.exchange(host.url, "unused", {
        session: "ses_w9",
        model: "deepseek/deepseek-flash",
        text: "again",
        timeoutMs: 5_000,
      });
      expect(result.sessionId).toBe("ses_w9");
      expect(host.requests.some((line) => line.startsWith("POST /api/session/ses_w9/agent"))).toBe(false);
      expect(modelBodies).toEqual([{ model: { providerID: "deepseek", id: "deepseek-flash" } }]);
    } finally {
      await host.close();
    }
  });

  it("polls until the idle marker ends the run", async () => {
    // The first poll reports a still-running session — the loop must keep
    // waiting, not give up or return an empty reply.
    const host = await fakeV2Server({ reply: ["late"], runningFirst: true });
    try {
      const result = await opencodeWarmTransport.exchange(host.url, "x", { text: "p", timeoutMs: 5_000 });
      expect(result.text).toBe("late");
      expect(host.requests.filter((line) => line.startsWith("GET /api/session")).length).toBeGreaterThanOrEqual(2);
    } finally {
      await host.close();
    }
  });

  it("surfaces a failed model run instead of falling back", async () => {
    const server = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      request.on("end", () => {
        const send = (status: number, payload: unknown): void => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(payload === undefined ? "" : JSON.stringify(payload));
        };
        if (request.url === "/api/session" && request.method === "POST") return send(200, { data: { id: "ses_e1" } });
        if (request.url === "/api/session/ses_e1/prompt" && request.method === "POST") return send(200, { data: { id: "msg_ue" } });
        if (request.url === "/api/experimental/session/ses_e1/wait" && request.method === "POST") return send(204, undefined);
        if (request.url === "/api/session/ses_e1/message" && request.method === "GET") {
          return send(200, { data: [
            { id: "msg_i", type: "idle", outcome: "failed" },
            { id: "msg_a", type: "assistant", finish: "error", error: { message: "This API key has expired." }, content: [] },
            { id: "msg_ue", type: "user" },
          ] });
        }
        send(404, {});
      });
    });
    const host = await new Promise<{ url: string; close(): Promise<void> }>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        resolve({ url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((done) => server.close(() => done())) });
      });
    });
    try {
      await expect(opencodeWarmTransport.exchange(host.url, "x", { text: "p", timeoutMs: 5_000 }))
        .rejects.toThrow("This API key has expired.");
    } finally {
      await host.close();
    }
  });

  it("classifies auth and HTTP failures as transport-level fallbacks", async () => {
    const host = await fakeV2Server({ reply: [], failSessionWith: 500 });
    try {
      await expect(opencodeWarmTransport.exchange(host.url, "unused", { text: "p", timeoutMs: 5_000 }))
        .rejects.toBeInstanceOf(WarmTransportUnavailableError);
    } finally {
      await host.close();
    }
    // A dead port is the chronic real-world case: connection refused.
    await expect(opencodeWarmTransport.exchange("http://127.0.0.1:1", "unused", { text: "p", timeoutMs: 500 }))
      .rejects.toBeInstanceOf(WarmTransportUnavailableError);
  });

  it("routes runtime calls through the warm server and never spawns the CLI", async () => {
    const host = await fakeV2Server({ reply: ["{\"kind\":\"accept\"}"] });
    // The fake CLI answers the serve probe with the warm server's address
    // and password, then sleeps; any `run` invocation is appended to a log
    // that must stay empty — the warm path must carry the whole call.
    const log = path.join(os.tmpdir(), `augment-warm-cli-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(log);
    fs.writeFileSync(log, "");
    const script = path.join(os.tmpdir(), `augment-warm-serve-${process.pid}-${temporaryFiles.length}.sh`);
    temporaryFiles.push(script);
    fs.writeFileSync(script, [
      "#!/bin/sh",
      `if [ "$1" = "serve" ]; then printf '%s\\n' 'server listening on ${host.url}'; printf '%s\\n' 'server password sekret'; exec sleep 30; fi`,
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      "exit 9",
      "",
    ].join("\n"));
    fs.chmodSync(script, 0o755);
    const runtime = new CliAgentRuntime({ directory: process.cwd(), command: script, timeoutMs: 10_000, retries: 0 });
    try {
      const result = await runtime.call(challengeRequest());
      expect(result.value).toEqual({ kind: "accept" });
      expect(fs.readFileSync(log, "utf8")).toBe("");
    } finally {
      runtime.cancel();
      await host.close();
    }
  });

  it("falls back to the CLI spawn when the warm transport is unreachable", async () => {
    const cliOutput = JSON.stringify({ type: "message", sessionID: "ses_fb1", parts: [{ type: "text", text: "{\"kind\":\"accept\"}" }] });
    const log = path.join(os.tmpdir(), `augment-warm-fb-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(log);
    fs.writeFileSync(log, "");
    const script = path.join(os.tmpdir(), `augment-warm-fb-serve-${process.pid}-${temporaryFiles.length}.sh`);
    temporaryFiles.push(script);
    // The serve child stays alive but points at a dead port: every warm
    // attempt fails at connect, and the call must still succeed through the
    // one-shot CLI spawn.
    fs.writeFileSync(script, [
      "#!/bin/sh",
      "if [ \"$1\" = \"serve\" ]; then printf '%s\\n' 'server listening on http://127.0.0.1:1'; printf '%s\\n' 'server password sekret'; exec sleep 30; fi",
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      `printf '%s' ${JSON.stringify(cliOutput)}`,
      "",
    ].join("\n"));
    fs.chmodSync(script, 0o755);
    const reasons: string[] = [];
    const runtime = new CliAgentRuntime({
      directory: process.cwd(),
      command: script,
      timeoutMs: 10_000,
      retries: 0,
      onWarmFallback: (reason) => reasons.push(reason),
    });
    try {
      const result = await runtime.call(challengeRequest());
      expect(result.value).toEqual({ kind: "accept" });
      expect(fs.readFileSync(log, "utf8")).toContain("run --format json");
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain("could not reach");
    } finally {
      runtime.cancel();
    }
  });
});
