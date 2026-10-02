import { describe, expect, it } from "vitest";
import { McpAugmentServer } from "../src/augmentd/mcp.js";
import { AugmentServer, type JsonRpcRequest, type JsonRpcResponse } from "../src/augmentd/server.js";

function request(id: number | string, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

interface ToolResult {
  text: string;
  structured?: Record<string, unknown>;
  isError?: boolean;
}

async function callTool(server: McpAugmentServer, name: string, args: unknown, id: number | string = 1): Promise<ToolResult> {
  const response = await server.handle(request(id, "tools/call", { name, arguments: args }));
  if (!response || "error" in response) throw new Error(`tools/call ${name} failed: ${JSON.stringify(response)}`);
  const result = (response as { result: { content: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean } }).result;
  return { text: result.content[0]!.text, structured: result.structuredContent, isError: result.isError };
}

const sessionPatch = "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,3 +1,4 @@\n alpha\n+beta\n";
const testPatch = "--- a/test/auth/retry.test.ts\n+++ b/test/auth/retry.test.ts\n@@ -1,2 +1,3 @@\n test(\"retries\", () => {});\n+test(\"cutoff\", () => {});\n";

interface Session {
  server: McpAugmentServer;
  native: AugmentServer;
  taskId: string;
  revision: number;
  rootNodeId: string;
}

/** A task driven to the refined state through the tools themselves. */
async function refinedSession(options: { preflight?: (patches: string[]) => string | undefined; caps?: Record<string, number> } = {}): Promise<Session> {
  const native = new AugmentServer();
  const server = new McpAugmentServer({ server: native, preflight: options.preflight, caps: options.caps });
  const started = await callTool(server, "plan_start", { objective: "make retries bounded", basisRevision: "commit:1" });
  const taskId = started.structured!.taskId as string;
  let revision = started.structured!.revision as number;
  const rootNodeId = started.structured!.rootNodeId as string;
  const proposed = await callTool(server, "propose_approaches", {
    taskId,
    expectedRevision: revision,
    nodeId: rootNodeId,
    candidates: [{ label: "Fixed count", rationale: "smallest change", confidence: 80, touchedPaths: ["src/auth/session.ts", "test/auth/retry.test.ts"] }],
  });
  revision = proposed.structured!.revision as number;
  const challenged = await callTool(server, "challenge_approaches", {
    taskId,
    expectedRevision: revision,
    nodeId: rootNodeId,
    verdict: { kind: "accept" },
  });
  expect(challenged.structured!.outcome).toBe("accepted");
  revision = challenged.structured!.revision as number;
  const selected = await callTool(server, "select_approach", {
    taskId,
    expectedRevision: revision,
    nodeId: rootNodeId,
    candidateId: (proposed.structured!.candidates as Array<{ id: string; status: string }>)[0]!.id,
  });
  revision = selected.structured!.revision as number;
  await callTool(server, "refine_plan", {
    taskId,
    expectedRevision: revision,
    nodeId: rootNodeId,
    children: [
      { path: "src/auth/session.ts", kind: "file", lod: "hunk", reason: "retry cutoff" },
      { path: "test/auth/retry.test.ts", kind: "file", lod: "hunk", reason: "cover the cutoff" },
    ],
  });
  const status = await callTool(server, "plan_status", { taskId });
  return { server, native, taskId, revision: status.structured!.revision as number, rootNodeId };
}

describe("augmentd MCP tool provider", () => {
  it("completes the MCP handshake and lists the planned-diff tools", async () => {
    const server = new McpAugmentServer();
    const init = await server.handle(request(1, "initialize"));
    expect(init && "result" in init && init.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "augmentd" },
    });
    const ping = await server.handle(request(2, "ping"));
    expect(ping && "result" in ping && init.result).toBeTruthy();
    const list = await server.handle(request(3, "tools/list")) as { result: { tools: Array<{ name: string; inputSchema: { required: string[] } }> } };
    expect(list.result.tools.map((tool) => tool.name)).toEqual(["plan_start", "plan_status", "read_diff", "propose_approaches", "challenge_approaches", "select_approach", "refine_plan", "draft_file", "repair_patch"]);
    for (const tool of list.result.tools) expect(Array.isArray(tool.inputSchema.required)).toBe(true);
  });

  it("never answers notifications and rejects unknown tools", async () => {
    const server = new McpAugmentServer();
    expect(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const unknown = await server.handle(request(1, "tools/call", { name: "does_not_exist", arguments: {} }));
    expect(unknown).toMatchObject({ id: 1, error: { code: -32602, message: expect.stringMatching(/Unknown tool/u) } });
    expect(await server.handle(request(2, "no/such/method"))).toMatchObject({ error: { code: -32601 } });
  });

  it("drives a whole plan through tool calls with compact confirmations", async () => {
    const session = await refinedSession();
    const drafted = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: session.revision,
      path: "src/auth/session.ts",
      patch: sessionPatch,
      assumptions: ["the cutoff is configurable"],
    });
    expect(drafted.isError).toBeUndefined();
    expect(drafted.structured).toMatchObject({ nodeId: expect.stringMatching(/^node:/u), path: "src/auth/session.ts", kind: "modify" });
    expect(drafted.text).toContain("not applied to the repository");
    const status = await callTool(session.server, "plan_status", { taskId: session.taskId });
    const rows = status.structured!.rows as Array<{ path: string; drafted: boolean; diffIds: string[] }>;
    const draftedRow = rows.find((row) => row.path === "src/auth/session.ts")!;
    expect(draftedRow.drafted).toBe(true);
    expect(draftedRow.diffIds).toEqual([drafted.structured!.diffId]);
    expect(status.structured!.draftTargets).toEqual(["test/auth/retry.test.ts"]);
    const task = (await session.native.handle(request(9, "task/get", { taskId: session.taskId }))) as { result: { constraints: Record<string, { text: string; source: string }> } };
    expect(Object.values(task.result.constraints).map((constraint) => constraint.text)).toEqual(["Draft assumption: the cutoff is configurable"]);
  });

  it("reads the exact proposed diff back by task, by id, and fails on unknown ids", async () => {
    const session = await refinedSession();
    const drafted = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: session.revision,
      path: "src/auth/session.ts",
      patch: sessionPatch,
    });
    const revision = drafted.structured!.revision as number;
    await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: revision,
      path: "test/auth/retry.test.ts",
      patch: testPatch,
    });
    const all = await callTool(session.server, "read_diff", { taskId: session.taskId });
    const diffs = all.structured!.diffs as Array<{ id: string; path: string; patch: string }>;
    expect(diffs.map((diff) => diff.path).sort()).toEqual(["src/auth/session.ts", "test/auth/retry.test.ts"]);
    expect(diffs.find((diff) => diff.path === "src/auth/session.ts")?.patch).toBe(sessionPatch);
    const one = await callTool(session.server, "read_diff", { taskId: session.taskId, diffId: drafted.structured!.diffId as string });
    expect(one.structured!.diffs).toEqual([expect.objectContaining({ id: drafted.structured!.diffId, patch: sessionPatch })]);
    const unknown = await callTool(session.server, "read_diff", { taskId: session.taskId, diffId: "diff:missing" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("Unknown planned diff");
    const empty = await refinedSession();
    const none = await callTool(empty.server, "read_diff", { taskId: empty.taskId });
    expect(none.isError).toBeUndefined();
    expect(none.structured!.diffs).toEqual([]);
    expect(none.text).toContain("no drafted diffs");
  });

  it("answers scope violations as tool errors with the exact reason and no state change", async () => {
    const session = await refinedSession();
    const foreign = "--- a/src/elsewhere.ts\n+++ b/src/elsewhere.ts\n@@ -1 +1 @@\n-x\n+y\n";
    const rejected = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: session.revision,
      path: "src/auth/session.ts",
      patch: foreign,
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.text).toContain("src/elsewhere.ts");
    expect(rejected.text).toContain("one patch stays inside one file node");
    const status = await callTool(session.server, "plan_status", { taskId: session.taskId });
    expect(status.structured!.revision).toBe(session.revision);
    expect((status.structured!.rows as Array<{ path: string; drafted: boolean }>).every((row) => !row.drafted)).toBe(true);
  });

  it("reports stale revisions with a refetch hint and locked paths as controller authority", async () => {
    const session = await refinedSession();
    const stale = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: 1,
      path: "src/auth/session.ts",
      patch: sessionPatch,
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("Stale task revision");
    expect(stale.text).toContain("call plan_status");

    await session.native.handle(request(8, "path/restrict", { taskId: session.taskId, expectedRevision: session.revision, path: "src/auth/session.ts", mode: "lock", marked: true }));
    const status = await callTool(session.server, "plan_status", { taskId: session.taskId });
    const locked = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: status.structured!.revision,
      path: "src/auth/session.ts",
      patch: sessionPatch,
    });
    expect(locked.isError).toBe(true);
    expect(locked.text).toContain("locked");
  });

  it("routes already-drafted files to repair_patch and replaces the diff", async () => {
    const session = await refinedSession();
    const drafted = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: session.revision,
      path: "src/auth/session.ts",
      patch: sessionPatch,
    });
    const again = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: drafted.structured!.revision as number,
      path: "src/auth/session.ts",
      patch: sessionPatch,
    });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("repair_patch");
    const repaired = await callTool(session.server, "repair_patch", {
      taskId: session.taskId,
      expectedRevision: drafted.structured!.revision as number,
      diffId: drafted.structured!.diffId as string,
      patch: sessionPatch,
      failedCheck: "cutoff too low",
    });
    expect(repaired.isError).toBeUndefined();
    expect(repaired.structured).toMatchObject({ diffId: drafted.structured!.diffId, path: "src/auth/session.ts" });
  });

  it("returns the host preflight diagnostic verbatim so the agent retries that file", async () => {
    const seen: string[][] = [];
    const preflight = (patches: string[]): string | undefined => {
      seen.push(patches);
      return patches[0] === sessionPatch || patches[0] === testPatch ? undefined : "git apply: patch does not apply";
    };
    const session = await refinedSession({ preflight });
    const bad = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: session.revision,
      path: "src/auth/session.ts",
      patch: "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -99,1 +99,2 @@\n not-there\n+nope\n",
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("git apply: patch does not apply");
    const status = await callTool(session.server, "plan_status", { taskId: session.taskId });
    expect(status.structured!.revision).toBe(session.revision);

    const good = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: session.revision,
      path: "src/auth/session.ts",
      patch: sessionPatch,
    });
    expect(good.isError).toBeUndefined();
    // The second draft was checked jointly: it must compose with the first.
    const second = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: good.structured!.revision as number,
      path: "test/auth/retry.test.ts",
      patch: testPatch,
    });
    expect(second.isError).toBeUndefined();
    expect(seen.at(-1)).toEqual([testPatch, sessionPatch]);
  });

  it("bounds agent loops with deterministic per-operation call caps", async () => {
    const session = await refinedSession({ caps: { draft_file: 1 } });
    const first = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: session.revision,
      path: "src/auth/session.ts",
      patch: sessionPatch,
    });
    expect(first.isError).toBeUndefined();
    const capped = await callTool(session.server, "draft_file", {
      taskId: session.taskId,
      expectedRevision: first.structured!.revision as number,
      path: "test/auth/retry.test.ts",
      patch: testPatch,
    });
    expect(capped.isError).toBe(true);
    expect(capped.text).toContain("Call cap reached for draft_file");
  });

  it("records scope-escaping candidates as notes instead of losing them", async () => {
    const session = await refinedSession();
    const status = await callTool(session.server, "plan_status", { taskId: session.taskId });
    const rows = status.structured!.rows as Array<{ path: string; nodeIds: string[] }>;
    const fileNode = rows.find((row) => row.path === "src/auth/session.ts")!;
    const proposed = await callTool(session.server, "propose_approaches", {
      taskId: session.taskId,
      expectedRevision: status.structured!.revision as number,
      nodeId: fileNode.nodeIds[0]!,
      candidates: [
        { label: "In scope", rationale: "touches the session", confidence: 70, touchedPaths: ["src/auth/session.ts"] },
        { label: "Elsewhere", rationale: "touches another tree", confidence: 60, touchedPaths: ["docs/other.md"] },
      ],
    });
    expect(proposed.structured!.candidates).toEqual([
      { id: expect.stringMatching(/^candidate:/u), label: "In scope", status: "possible" },
    ]);
    expect((proposed.structured!.notes as string[])[0]).toContain("Out-of-scope dependency noted by domain: Elsewhere (docs/other.md)");
  });
});
