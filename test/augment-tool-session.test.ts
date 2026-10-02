import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AugmentTuiController } from "../src/tui/controller.js";
import { ToolSessionDriver, claudeToolConfig, openCodeToolConfig, toolPrompts, toolSessionSupported } from "../src/tui/tool-session.js";
import { opencodeBackend } from "../src/tui/agent-backends.js";

/**
 * A fake agent host standing in for `opencode run`: it receives the exact
 * argv the driver builds for the real CLI, discovers the TUI's socket from
 * the generated OPENCODE_CONFIG wiring, and performs the operation the
 * prompt asks for over the native protocol — the same effect the model's
 * MCP tool calls would have. Prompts and every step are logged for
 * assertions.
 */
const FAKE_AGENT = `
import net from "node:net";
import fs from "node:fs";

const argv = process.argv.slice(2);
const dash = argv.lastIndexOf("--");
const prompt = dash >= 0 ? argv[dash + 1] : argv.at(-1) ?? "";
const config = JSON.parse(fs.readFileSync(process.env.OPENCODE_CONFIG, "utf8"));
const command = config.mcp.neolit.command;
const socket = command[command.indexOf("--connect") + 1];
const directory = command[command.indexOf("--directory") + 1];

const send = (socket, request) => socket.write(JSON.stringify(request) + "\\n");
function call(socket, id, method, params) {
  return new Promise((resolve) => {
    const wait = (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id === id) { socket.off("data", chunks); resolve(message); }
      } catch {}
    };
    const chunks = (buffer) => {
      for (const line of buffer.toString("utf8").split("\\n").filter(Boolean)) wait(line);
    };
    socket.on("data", chunks);
    send(socket, { jsonrpc: "2.0", id, method, params });
  });
}

function diffFor(directory, target, marker) {
  const content = fs.readFileSync(\`\${directory}/\${target}\`, "utf8").split("\\n").filter((line) => line.length > 0);
  const body = content.map((line) => \` \${line}\`).join("\\n");
  return \`--- a/\${target}\\n+++ b/\${target}\\n@@ -1,\${content.length} +1,\${content.length + 1}@@\\n\${body}\\n+\${marker}\\n\`;
}

const socketConnection = net.connect(socket);
await new Promise((resolve) => socketConnection.once("connect", resolve));
const taskId = (prompt.match(/task id (task:[^\\s)]+)/) ?? [])[1];
const log = (entry) => { if (process.env.NEOLIT_FAKE_LOG) fs.appendFileSync(process.env.NEOLIT_FAKE_LOG, entry + "\\n"); };
log(\`ARGV \${argv.join(" ")}\`);
log(\`PROMPT \${prompt.replace(/\\s+/g, " ").slice(0, 160)}\`);

let nextId = 100;
try {
  if (prompt.includes("Propose approaches")) {
    const task = (await call(socketConnection, nextId++, "task/get", { taskId })).result;
    const proposed = await call(socketConnection, nextId++, "domain/propose", {
      taskId, expectedRevision: task.revision, nodeId: task.rootNodeId,
      candidates: [{ label: "Only way", rationale: "direct edit", confidence: 80, touchedPaths: ["session.ts"] }],
      replace: task.nodes[task.rootNodeId].candidateIds.length > 0,
    });
    if (proposed.result) {
      await call(socketConnection, nextId++, "domain/challenge", {
        taskId, expectedRevision: proposed.result.revision, nodeId: task.rootNodeId, verdict: { kind: "accept" },
      });
    }
  } else if (prompt.startsWith("Refine")) {
    const task = (await call(socketConnection, nextId++, "task/get", { taskId })).result;
    await call(socketConnection, nextId++, "node/refine", {
      taskId, expectedRevision: task.revision, nodeId: task.rootNodeId,
      children: [{ path: "session.ts", kind: "file", lod: "hunk", reason: "the edit" }],
    });
  } else if (prompt.startsWith("Draft")) {
    const target = prompt.match(/^Draft (\\S+?) —/)[1];
    const task = (await call(socketConnection, nextId++, "task/get", { taskId })).result;
    const node = Object.values(task.nodes).find((candidate) => candidate.path === target);
    await call(socketConnection, nextId++, "patch/attach", {
      taskId, expectedRevision: task.revision, nodeId: node.id,
      patch: diffFor(directory, target, "drafted-by-agent"),
    });
  } else if (prompt.startsWith("Regenerate")) {
    const target = prompt.match(/^Regenerate (\\S+?) —/)[1];
    const task = (await call(socketConnection, nextId++, "task/get", { taskId })).result;
    const node = Object.values(task.nodes).find((candidate) => candidate.path === target);
    await call(socketConnection, nextId++, "patch/set", {
      taskId, expectedRevision: task.revision, diffId: node.diffIds.at(-1),
      patch: diffFor(directory, target, "regenerated-by-agent"),
    });
  }
} catch (error) {
  log(\`ERROR \${String(error && error.stack || error)}\`);
  process.stderr.write(String(error));
}
socketConnection.end();
process.stdout.write(JSON.stringify({ sessionID: "ses_toolfake1", type: "message", parts: [{ type: "text", text: "step done" }] }) + "\\n");
`;

const temporaryFiles: string[] = [];
const temporaryDirectories: string[] = [];
const drivers: ToolSessionDriver[] = [];

afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
  for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true });
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function tempGitRepo(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "augment-tools-"));
  temporaryDirectories.push(directory);
  const git = (args: string[]) => execFileSync("git", ["-C", directory, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(directory, "session.ts"), "alpha\nbeta\n");
  git(["add", "session.ts"]);
  git(["commit", "-q", "-m", "init"]);
  return directory;
}

interface Harness {
  controller: AugmentTuiController;
  socketPath: string;
  prompts: () => string;
}

async function harnessed(): Promise<Harness> {
  const directory = tempGitRepo();
  const socketPath = path.join(directory, ".neolit-test.sock");
  const fakeLog = path.join(directory, "fake-agent.log");
  const fakeAgent = path.join(directory, "fake-agent.mjs");
  fs.writeFileSync(fakeAgent, `#!/usr/bin/env node\n${FAKE_AGENT}`);
  fs.chmodSync(fakeAgent, 0o755);
  const controller = new AugmentTuiController({ directory, serveSocket: socketPath, persistTasks: false });
  process.env.NEOLIT_FAKE_LOG = fakeLog;
  const driver = new ToolSessionDriver({
    directory,
    backend: opencodeBackend,
    command: fakeAgent,
    timeoutMs: 15_000,
    server: controller.server,
    socketPath: () => controller.snapshot().socketPath,
    bridge: [process.execPath, path.resolve(import.meta.dirname, "../src/bin/augmentd.ts")],
  });
  drivers.push(driver);
  controller.useToolSession(driver);
  return { controller, socketPath, prompts: () => fs.readFileSync(fakeLog, "utf8") };
}

describe("tool session wiring", () => {
  it("generates backend MCP configs that attach the bridge to this TUI", () => {
    const bridge = ["node", "/dist/bin/augmentd.js"];
    const openCode = openCodeToolConfig(bridge, "/sock", "/repo") as { mcp: { neolit: { command: string[] } }; tools: Record<string, boolean> };
    expect(openCode.mcp.neolit.command).toEqual(["node", "/dist/bin/augmentd.js", "--mcp", "--connect", "/sock", "--directory", "/repo"]);
    expect(openCode.tools).toEqual({ write: false, edit: false, bash: false });
    const claude = claudeToolConfig(bridge, "/sock", "/repo") as { mcpServers: { neolit: { command: string; args: string[] } } };
    expect(claude.mcpServers.neolit).toEqual({ command: "node", args: ["/dist/bin/augmentd.js", "--mcp", "--connect", "/sock", "--directory", "/repo"] });
    expect(toolSessionSupported("opencode")).toBe(true);
    expect(toolSessionSupported("claude")).toBe(true);
    expect(toolSessionSupported("codex")).toBe(false);
  });

  it("keeps prompt contracts as stable step verbs that point, not embed", () => {
    expect(toolPrompts.propose("the whole task")).toMatch(/^Propose approaches for the whole task\./);
    expect(toolPrompts.draft("session.ts")).toMatch(/^Draft session\.ts — read the file/);
    expect(toolPrompts.refine("src/auth")).toMatch(/^Refine src\/auth into children:/);
    expect(toolPrompts.regenerate("session.ts", "be greener")).toContain('the operator said: "be greener"');
    expect(toolPrompts.open("task:1", "bounded retries")).toContain("task id task:1");
    expect(toolPrompts.open("task:1", "o")).not.toMatch(/```/);
  });
});

describe("tool sessions drive the plan from the TUI", () => {
  it("runs crystallize, refine, and develop through one agent session", async () => {
    const { controller, prompts } = await harnessed();
    await controller.start("edit session");
    await controller.crystallize();
    let task = controller.snapshot().task!;
    expect(task.nodes[task.rootNodeId]!.candidateIds.length).toBeGreaterThan(0);
    // The singleton was adopted through the controller, exactly like one-shot.
    expect(task.nodes[task.rootNodeId]!.status).toBe("collapsed");
    await controller.refine();
    task = controller.snapshot().task!;
    if (controller.snapshot().error) throw new Error(`refine failed: ${controller.snapshot().error}\nfake log:\n${prompts()}`);
    expect(Object.values(task.nodes).some((node) => node.path === "session.ts")).toBe(true);

    controller.select("entry:.");
    await controller.develop();
    const snapshot = controller.snapshot();
    const diffs = Object.values(snapshot.task?.diffs ?? {});
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.patch).toContain("drafted-by-agent");
    expect(snapshot.error).toBeUndefined();

    // Steps run against a private standalone server (the background service
    // never sees the generated MCP layer) and continue the same session.
    const log = prompts();
    expect(log.match(/PROMPT You drive one Neolit planned-diff task/g)?.length).toBe(1);
    expect(log).toContain("PROMPT Draft session.ts");
    expect(log).toContain("ARGV run --standalone --format json");
    expect(log).toContain("--session ses_toolfake1");
    expect(log).not.toContain("Embed");
  });

  it("rethinks a drafted file in the same session with the operator's note", async () => {
    const { controller, prompts } = await harnessed();
    await controller.start("edit session");
    await controller.crystallize();
    await controller.refine();
    controller.select("entry:session.ts");
    await controller.develop();
    const before = Object.values(controller.snapshot().task!.diffs)[0]!.patch;

    controller.select("entry:session.ts");
    await controller.rethink("make it greener");
    const after = Object.values(controller.snapshot().task!.diffs)[0]!.patch;
    expect(after).not.toBe(before);
    expect(after).toContain("regenerated-by-agent");
    expect(prompts()).toContain('the operator said: "make it greener"');
    expect(controller.snapshot().message).toContain("Patch regenerated");
  });

  it("surfaces the agent's answer when a step changes nothing", async () => {
    const directory = tempGitRepo();
    const socketPath = path.join(directory, ".neolit-test.sock");
    const noopAgent = path.join(directory, "noop-agent.mjs");
    fs.writeFileSync(noopAgent, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ sessionID: "ses_noop1", type: "message", parts: [{ type: "text", text: "I would rather ask a question first" }] }) + "\\n");
`);
    fs.chmodSync(noopAgent, 0o755);
    const controller = new AugmentTuiController({ directory, serveSocket: socketPath, persistTasks: false });
    process.env.NEOLIT_FAKE_LOG = path.join(directory, "noop.log");
    const driver = new ToolSessionDriver({
      directory,
      backend: opencodeBackend,
      command: noopAgent,
      timeoutMs: 15_000,
      server: controller.server,
      socketPath: () => controller.snapshot().socketPath,
    });
    drivers.push(driver);
    controller.useToolSession(driver);
    await controller.start("edit session");
    await controller.crystallize();
    const snapshot = controller.snapshot();
    expect(snapshot.error).toContain("changed nothing");
    expect(snapshot.error).toContain("I would rather ask a question first");
    expect(snapshot.task?.nodes[snapshot.task.rootNodeId]).toMatchObject({ status: "unresolved" });
  });
});
