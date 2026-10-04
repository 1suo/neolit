import fs from "node:fs";
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
      .toEqual({ kind: "tool", text: "✓ execute · git status --short" });
    expect(formatStreamEvent(toolPart("error", "execute", { command: "git push" })))
      .toEqual({ kind: "tool", text: "✗ execute · git push" });
  });

  it("prefers the naming argument across common tool shapes", () => {
    expect(formatStreamEvent(toolPart("completed", "read", { path: "src/tui/controller.ts", encoding: "utf8" })))
      .toEqual({ kind: "tool", text: "✓ read · src/tui/controller.ts" });
    expect(formatStreamEvent(toolPart("completed", "glob", { pattern: "src/**/*.ts", path: "." })))
      .toEqual({ kind: "tool", text: "✓ glob · src/**/*.ts" });
    expect(formatStreamEvent(toolPart("completed", "grep", { query: "retryPolicy", path: "src/" })))
      .toEqual({ kind: "tool", text: "✓ grep · retryPolicy" });
  });

  it("falls back to compact JSON for unknown shapes and marks truncation", () => {
    expect(formatStreamEvent(toolPart("completed", "edit", { weird: true, nested: { a: 1 } })))
      .toEqual({ kind: "tool", text: '✓ edit · {"weird":true,"nested":{"a":1}}' });
    const long = formatStreamEvent(toolPart("completed", "execute", { command: "x".repeat(300) }));
    expect(long!.text.endsWith("…")).toBe(true);
    expect(long!.text.length).toBe("✓ execute · ".length + 200 + 1);
  });

  it("prefers the code argument over the JSON envelope", () => {
    const line = formatStreamEvent(toolPart("completed", "execute", { code: 'const x = await tools.neolit.plan_status({\n  taskId: "task:1",\n});' }));
    expect(line).toEqual({ kind: "tool", text: "✓ execute · const x = await tools.neolit.plan_status({ taskId: \"task:1\", });" });
  });

  it("caps long text at 400 characters with a visible ellipsis", () => {
    const line = formatStreamEvent({ type: "text", text: "y".repeat(500) });
    expect(line!.text.length).toBe(401);
    expect(line!.text.endsWith("…")).toBe(true);
  });

  it("keeps the running marker and survives missing input", () => {
    expect(formatStreamEvent(toolPart("running", "write", { path: "a.ts" })))
      .toEqual({ kind: "tool", text: "→ write · a.ts" });
    expect(formatStreamEvent(toolPart("completed", "tool", undefined)))
      .toEqual({ kind: "tool", text: "✓ tool" });
    expect(formatStreamEvent(toolPart("completed", "tool", { command: "   " })))
      .toEqual({ kind: "tool", text: "✓ tool" });
  });

  it("maps the non-tool event shapes unchanged", () => {
    expect(formatStreamEvent({ type: "step_start" })).toEqual({ kind: "step", text: "▸ step" });
    expect(formatStreamEvent({ type: "error", message: "boom" })).toEqual({ kind: "error", text: "✗ boom" });
    expect(formatStreamEvent({ type: "text", text: "hello\nworld" })).toEqual({ kind: "text", text: "hello world" });
    expect(formatStreamEvent({ type: "whatever" })).toBeUndefined();
    expect(formatStreamEvent(undefined)).toBeUndefined();
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
});
