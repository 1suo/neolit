import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PlanTask } from "../src/augment/types.js";
import { AugmentServer } from "../src/augmentd/server.js";
import { opencodeBackend } from "../src/tui/agent-backends.js";
import { ToolSessionDriver, formatStreamEvent } from "../src/tui/tool-session.js";

function toolPart(status: string, title: string, input: unknown) {
  return { type: "tool", part: { type: "tool", state: { status, title, input } } };
}

describe("formatStreamEvent", () => {
  it("carries the call's key argument on completed and failed tools", () => {
    expect(formatStreamEvent(toolPart("completed", "execute", { command: "git status --short" })))
      .toEqual([{ kind: "tool", text: "✓ execute · git status --short" }]);
    expect(formatStreamEvent(toolPart("error", "execute", { command: "git push" })))
      .toEqual([{ kind: "tool", text: "✗ execute · git push" }]);
  });

  it("prefers the naming argument across common tool shapes", () => {
    expect(formatStreamEvent(toolPart("completed", "read", { path: "src/tui/controller.ts", encoding: "utf8" })))
      .toEqual([{ kind: "tool", text: "✓ read · src/tui/controller.ts" }]);
    expect(formatStreamEvent(toolPart("completed", "glob", { pattern: "src/**/*.ts", path: "." })))
      .toEqual([{ kind: "tool", text: "✓ glob · src/**/*.ts" }]);
    expect(formatStreamEvent(toolPart("completed", "grep", { query: "retryPolicy", path: "src/" })))
      .toEqual([{ kind: "tool", text: "✓ grep · retryPolicy" }]);
  });

  it("falls back to compact JSON for unknown shapes and marks truncation", () => {
    expect(formatStreamEvent(toolPart("completed", "edit", { weird: true, nested: { a: 1 } })))
      .toEqual([{ kind: "tool", text: '✓ edit · {"weird":true,"nested":{"a":1}}' }]);
    const long = formatStreamEvent(toolPart("completed", "execute", { command: "x".repeat(300) }));
    expect(long[0]!.text.endsWith("…")).toBe(true);
    expect(long[0]!.text.length).toBe("✓ execute · ".length + 200 + 1);
  });

  it("prefers the code argument over the JSON envelope", () => {
    const line = formatStreamEvent(toolPart("completed", "execute", { code: 'const x = await tools.neolit.plan_status({\n  taskId: "task:1",\n});' }));
    expect(line).toEqual([{ kind: "tool", text: "✓ execute · const x = await tools.neolit.plan_status({ taskId: \"task:1\", });" }]);
  });

  it("caps long text at 400 characters with a visible ellipsis", () => {
    const lines = formatStreamEvent({ type: "text", text: "y".repeat(500) });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text.length).toBe(401);
    expect(lines[0]!.text.endsWith("…")).toBe(true);
  });

  it("keeps reply paragraphs as separate lines instead of flattening them", () => {
    expect(formatStreamEvent({ type: "text", text: "first paragraph\n\nsecond paragraph\nmeanwhile: details" }))
      .toEqual([
        { kind: "text", text: "first paragraph" },
        { kind: "text", text: "second paragraph" },
        { kind: "text", text: "meanwhile: details" },
      ]);
  });

  it("keeps the running marker and survives missing input", () => {
    expect(formatStreamEvent(toolPart("running", "write", { path: "a.ts" })))
      .toEqual([{ kind: "tool", text: "→ write · a.ts" }]);
    expect(formatStreamEvent(toolPart("completed", "tool", undefined)))
      .toEqual([{ kind: "tool", text: "✓ tool" }]);
    expect(formatStreamEvent(toolPart("completed", "tool", { command: "   " })))
      .toEqual([{ kind: "tool", text: "✓ tool" }]);
  });

  it("maps the non-tool event shapes unchanged", () => {
    expect(formatStreamEvent({ type: "step_start" })).toEqual([{ kind: "step", text: "▸ step" }]);
    expect(formatStreamEvent({ type: "error", message: "boom" })).toEqual([{ kind: "error", text: "✗ boom" }]);
    expect(formatStreamEvent({ type: "whatever" })).toEqual([]);
    expect(formatStreamEvent(undefined)).toEqual([]);
  });
});

describe("ToolSessionDriver session revival", () => {
  it("binds the session to the task's directory and revives it in a new driver", async () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "augment-state-"));
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = state;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "augment-driver-repo-"));
    try {
      const server = new AugmentServer({});
      const started = await server.handle({ jsonrpc: "2.0", id: 1, method: "task/start", params: { taskId: "task:revive", objective: "make retries bounded", basisRevision: "commit:1" } });
      if (!started || "error" in started) throw new Error("task/start failed");
      const task = started.result as { id: string; revision: number; rootNodeId: string };

      const log = path.join(os.tmpdir(), `augment-driver-log-${process.pid}.txt`);
      fs.rmSync(log, { force: true });
      const output = JSON.stringify({ type: "message", sessionID: "ses_revive1", parts: [{ type: "text", text: "done" }] });
      const command = path.join(os.tmpdir(), `augment-driver-cli-${process.pid}.sh`);
      fs.writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nprintf '%s' ${JSON.stringify(output)}\n`);
      fs.chmodSync(command, 0o755);

      const options = {
        directory,
        backend: opencodeBackend,
        command,
        server,
        socketPath: () => "/tmp/opencode/neolit-test.sock",
        bridge: ["augmentd"],
      };
      // The fake CLI never calls the neolit tools, so the propose effect is
      // landed through the server's deterministic seam while the step waits.
      const landCandidates = (delayMs: number) => {
        void new Promise((resolve) => setTimeout(resolve, delayMs)).then(async () => {
          const current = await server.handle({ jsonrpc: "2.0", id: 2, method: "task/get", params: { taskId: task.id } });
          const revision = ((current as { result: PlanTask }).result).revision;
          await server.handle({
            jsonrpc: "2.0",
            id: 3,
            method: "domain/propose",
            params: {
              taskId: task.id,
              expectedRevision: revision,
              nodeId: task.rootNodeId,
              candidates: [{ label: "bounded retries", rationale: "because retries must be bounded", confidence: 80, touchedPaths: ["src/retry.ts"] }],
            },
          });
        });
      };

      const first = new ToolSessionDriver(options);
      landCandidates(400);
      await first.propose({ taskId: task.id, objective: "make retries bounded", nodeId: task.rootNodeId, target: "the root" });
      first.dispose();
      // The first step started a fresh session…
      const firstInvocation = fs.readFileSync(log, "utf8");
      expect(firstInvocation).not.toContain("--session");

      // …and a restarted driver revives that session for the same task in
      // the same directory instead of starting a new one.
      const second = new ToolSessionDriver(options);
      await second.propose({ taskId: task.id, objective: "make retries bounded", nodeId: task.rootNodeId, target: "the root" });
      second.dispose();
      const secondInvocation = fs.readFileSync(log, "utf8").slice(firstInvocation.length);
      expect(secondInvocation.match(/--session ses_revive1/g)?.length).toBe(1);
      expect(JSON.parse(fs.readFileSync(path.join(state, "neolit", "augment-sessions.json"), "utf8")))
        .toEqual({ [path.resolve(directory)]: { "task:revive": "ses_revive1" } });
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
    }
  });

  it("chat sends the raw message into the same session and returns the reply", async () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "augment-state-"));
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = state;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "augment-driver-repo-"));
    try {
      const server = new AugmentServer({});
      const started = await server.handle({ jsonrpc: "2.0", id: 1, method: "task/start", params: { taskId: "task:chat", objective: "make retries bounded", basisRevision: "commit:1" } });
      if (!started || "error" in started) throw new Error("task/start failed");
      const task = started.result as { id: string };

      const log = path.join(os.tmpdir(), `augment-driver-chat-log-${process.pid}.txt`);
      fs.rmSync(log, { force: true });
      const output = JSON.stringify({ type: "message", sessionID: "ses_chat1", parts: [{ type: "text", text: "here is the answer" }] });
      const command = path.join(os.tmpdir(), `augment-driver-chat-cli-${process.pid}.sh`);
      fs.writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nprintf '%s' ${JSON.stringify(output)}\n`);
      fs.chmodSync(command, 0o755);

      const driver = new ToolSessionDriver({
        directory,
        backend: opencodeBackend,
        command,
        server,
        socketPath: () => "/tmp/opencode/neolit-test.sock",
        bridge: ["augmentd"],
      });
      const reply = await driver.chat({ taskId: task.id, objective: "make retries bounded", message: "why did the draft fail?" });
      driver.dispose();

      expect(reply).toBe("here is the answer");
      const invocation = fs.readFileSync(log, "utf8");
      // The raw message rides the prompt verbatim, anchored to the task id.
      expect(invocation).toContain("why did the draft fail?");
      expect(invocation).toContain("task:chat");
      expect(invocation).not.toContain("--session", "a first chat opens a fresh session");
      expect(JSON.parse(fs.readFileSync(path.join(state, "neolit", "augment-sessions.json"), "utf8")))
        .toEqual({ [path.resolve(directory)]: { "task:chat": "ses_chat1" } });
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
    }
  });

  it("runs steps over the wiring server's warm transport without spawning the CLI", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "augment-driver-warm-"));
    try {
      const server = new AugmentServer({});
      const started = await server.handle({ jsonrpc: "2.0", id: 1, method: "task/start", params: { taskId: "task:warm", objective: "make retries bounded", basisRevision: "commit:1" } });
      if (!started || "error" in started) throw new Error("task/start failed");
      const task = started.result as { id: string; rootNodeId: string; revision: number };

      // The fake v2 serve dialect: create, prompt, wait, message — the step
      // reply arrives over HTTP, so no CLI child may ever run.
      const httpServer = http.createServer((request, response) => {
        let body = "";
        request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        request.on("end", () => {
          const send = (status: number, payload: unknown): void => {
            response.writeHead(status, { "content-type": "application/json" });
            response.end(payload === undefined ? "" : JSON.stringify(payload));
          };
          if (request.url === "/api/session" && request.method === "POST") return send(200, { data: { id: "ses_step1" } });
          if (request.url === "/api/session/ses_step1/prompt" && request.method === "POST") return send(200, { data: { id: "msg_u1" } });
          if (request.url === "/api/experimental/session/ses_step1/wait" && request.method === "POST") return send(204, undefined);
          if (request.url === "/api/session/ses_step1/message" && request.method === "GET") {
            return send(200, { data: [
              { id: "msg_idle1", type: "idle", outcome: "success" },
              { id: "msg_a1", type: "assistant", finish: "stop", content: [{ type: "text", text: "proposed two approaches" }] },
              { id: "msg_u1", type: "user" },
            ] });
          }
          send(404, {});
        });
      });
      const warmUrl = await new Promise<string>((resolve) => {
        httpServer.listen(0, "127.0.0.1", () => {
          const address = httpServer.address() as { port: number };
          resolve(`http://127.0.0.1:${address.port}`);
        });
      });

      const log = path.join(os.tmpdir(), `augment-driver-warm-log-${process.pid}.txt`);
      fs.rmSync(log, { force: true });
      const command = path.join(os.tmpdir(), `augment-driver-warm-cli-${process.pid}.sh`);
      fs.writeFileSync(command, [
        "#!/bin/sh",
        `if [ "$1" = "serve" ]; then printf '%s\\n' 'server listening on ${warmUrl}'; printf '%s\\n' 'server password sekret'; exec sleep 30; fi`,
        `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
        "exit 9",
        "",
      ].join("\n"));
      fs.chmodSync(command, 0o755);

      const lines: string[] = [];
      const driver = new ToolSessionDriver({
        directory,
        backend: opencodeBackend,
        command,
        server,
        socketPath: () => "/tmp/opencode/neolit-test.sock",
        bridge: ["augmentd"],
      });
      driver.onLine = (line) => { lines.push(line.text); };
      // The fake v2 host never calls the neolit tools, so the propose effect
      // lands through the server's deterministic seam while the step waits.
      void new Promise((resolve) => setTimeout(resolve, 200)).then(async () => {
        const current = await server.handle({ jsonrpc: "2.0", id: 2, method: "task/get", params: { taskId: task.id } });
        const revision = ((current as { result: PlanTask }).result).revision;
        await server.handle({
          jsonrpc: "2.0",
          id: 3,
          method: "domain/propose",
          params: {
            taskId: task.id,
            expectedRevision: revision,
            nodeId: task.rootNodeId,
            candidates: [{ label: "bounded retries", rationale: "because retries must be bounded", confidence: 80, touchedPaths: ["src/retry.ts"] }],
          },
        });
      });
      try {
        await driver.propose({ taskId: task.id, objective: "make retries bounded", nodeId: task.rootNodeId, target: "the root" });
        // No CLI child ever ran: the warm transport carried the whole step.
        expect(fs.existsSync(log)).toBe(false);
        expect(lines).toContain("proposed two approaches");
      } finally {
        driver.dispose();
        await new Promise<void>((done) => httpServer.close(() => done()));
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
