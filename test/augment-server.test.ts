import { describe, expect, it } from "vitest";
import { AugmentServer, type JsonRpcRequest } from "../src/augmentd/server.js";
import type { ModelCallRequest, ModelRuntime } from "../src/augment/types.js";

function request(id: number, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

function model(): ModelRuntime {
  return {
    async call(request: ModelCallRequest) {
      if (request.operation === "generate-domain") {
        return { value: { candidates: [{ label: "Fixed count", rationale: "smallest change", confidence: 78, touchedPaths: ["src/auth/session.ts"] }] } };
      }
      if (request.operation === "challenge-domain") return { value: { kind: "accept" } };
      throw new Error(`unexpected operation ${request.operation}`);
    },
  };
}

async function started() {
  const server = new AugmentServer({ runtime: model() });
  const response = await server.handle(request(1, "task/start", { taskId: "task:1", objective: "make retries bounded", basisRevision: "commit:1" }));
  if (!response || "error" in response) throw new Error("task/start failed");
  return { server, task: response.result as { id: string; revision: number; rootNodeId: string } };
}

describe("augmentd protocol", () => {
  it("negotiates capabilities", async () => {
    const response = await new AugmentServer({ runtime: model() }).handle(request(1, "initialize"));
    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1, capabilities: { tasks: true, modelRuntime: true } } });
  });

  it("starts a task and returns a filesystem-shaped tree", async () => {
    const { server, task } = await started();
    const crystallized = await server.handle(request(2, "crystallize", { taskId: task.id, expectedRevision: task.revision, nodeId: task.rootNodeId, temperature: "normal", lod: "file" }));
    expect(crystallized && "result" in crystallized).toBe(true);
    const updated = (crystallized as { result: { revision: number; rootNodeId: string; nodes: Record<string, { candidateIds: string[] }> } }).result;
    const beforeChoice = await server.handle(request(3, "tree/get", { taskId: task.id }));
    expect(((beforeChoice as { result: { children: unknown[] } }).result).children).toHaveLength(0);
    const candidateId = updated.nodes[updated.rootNodeId]!.candidateIds[0]!;
    const selected = await server.handle(request(4, "node/select", { taskId: updated.id, expectedRevision: updated.revision, nodeId: updated.rootNodeId, candidateId }));
    expect(selected && "result" in selected).toBe(true);
    const tree = await server.handle(request(5, "tree/get", { taskId: updated.id }));
    const root = (tree as { result: { children: unknown[] } }).result;
    expect(root.children).toHaveLength(1);
    expect(updated.revision).toBeGreaterThan(task.revision);
  });

  it("rejects stale mutations before touching task state", async () => {
    const { server, task } = await started();
    const response = await server.handle(request(2, "node/constrain", { taskId: task.id, expectedRevision: 99, text: "Preserve the public API." }));
    expect(response).toMatchObject({ jsonrpc: "2.0", id: 2, error: { code: -32010, message: expect.stringMatching(/Stale task revision/u) } });
    const unchanged = await server.handle(request(3, "task/get", { taskId: task.id }));
    expect((unchanged as { result: { revision: number } }).result.revision).toBe(task.revision);
  });

  it("lets the host replace a drafted patch with its own edit", async () => {
    const runtime: ModelRuntime = {
      call: async (call) => {
        if (call.operation === "refine-node") {
          return { value: { children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "retry cutoff" }] } };
        }
        if (call.operation === "draft-patch") {
          return { value: { patch: "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,1 +1,2 @@\n alpha\n+model line\n", assumptions: [] } };
        }
        return model().call(call);
      },
    };
    const server = new AugmentServer({ runtime });
    const started = await server.handle(request(1, "task/start", { taskId: "task:1", objective: "make retries bounded", basisRevision: "commit:1" }));
    const task = (started as { result: { id: string; revision: number; rootNodeId: string } }).result;
    const crystallized = await server.handle(request(2, "crystallize", { taskId: task.id, expectedRevision: task.revision, nodeId: task.rootNodeId, temperature: "normal", lod: "file" }));
    const domain = (crystallized as { result: { id: string; revision: number; rootNodeId: string; nodes: Record<string, { candidateIds: string[] }> } }).result;
    const candidateId = domain.nodes[domain.rootNodeId]!.candidateIds[0]!;
    const selected = await server.handle(request(3, "node/select", { taskId: domain.id, expectedRevision: domain.revision, nodeId: domain.rootNodeId, candidateId }));
    const collapsed = (selected as { result: { id: string; revision: number; rootNodeId: string } }).result;
    const refined = await server.handle(request(4, "refine", { taskId: collapsed.id, expectedRevision: collapsed.revision, nodeId: collapsed.rootNodeId, temperature: "normal", lod: "hunk" }));
    const expanded = (refined as { result: { id: string; revision: number; nodes: Record<string, { kind: string; id: string }> } }).result;
    const fileNode = Object.values(expanded.nodes).find((node) => node.kind === "file")!;
    const drafted = await server.handle(request(5, "patch/draft", { taskId: expanded.id, expectedRevision: expanded.revision, nodeId: fileNode.id, temperature: "low" }));
    const withPatch = (drafted as { result: { id: string; revision: number; diffs: Record<string, { id: string; patch: string }> } }).result;
    const diff = Object.values(withPatch.diffs)[0]!;

    const edited = "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,1 +1,2 @@\n alpha\n+host-edited line\n";
    const replaced = await server.handle(request(6, "patch/set", { taskId: withPatch.id, expectedRevision: withPatch.revision, diffId: diff.id, patch: edited }));
    const hostEdited = (replaced as { result: { revision: number; diffs: Record<string, { patch: string; kind: string }> } }).result;
    expect(hostEdited.diffs[diff.id]!.patch).toBe(edited);
    expect(hostEdited.diffs[diff.id]!.kind).toBe("modify");
    expect(hostEdited.revision).toBeGreaterThan(withPatch.revision);

    const stale = await server.handle(request(7, "patch/set", { taskId: hostEdited.id, expectedRevision: withPatch.revision, diffId: diff.id, patch: edited }));
    expect(stale).toMatchObject({ id: 7, error: { code: -32010, message: expect.stringMatching(/Stale task revision/u) } });
    const unknown = await server.handle(request(8, "patch/set", { taskId: hostEdited.id, expectedRevision: hostEdited.revision, diffId: "diff:missing", patch: edited }));
    expect(unknown).toMatchObject({ id: 8, error: { message: expect.stringMatching(/Unknown planned diff/u) } });
  });

  it("notifies subscribers after every task mutation", async () => {
    const server = new AugmentServer({ runtime: model() });
    const changes: Array<{ taskId: string; revision: number }> = [];
    const unsubscribe = server.onChange((change) => changes.push(change));
    const started = await server.handle(request(1, "task/start", { taskId: "task:notify", objective: "make retries bounded", basisRevision: "commit:1" }));
    const task = (started as { result: { id: string; revision: number; rootNodeId: string } }).result;
    await server.handle(request(2, "crystallize", { taskId: task.id, expectedRevision: task.revision, nodeId: task.rootNodeId, temperature: "normal", lod: "file" }));
    unsubscribe();
    const crystallize = await server.handle(request(3, "task/get", { taskId: task.id }));
    expect((crystallize as { result: { revision: number } }).result.revision).toBeGreaterThan(task.revision);
    expect(changes.map((change) => change.taskId)).toEqual([task.id, task.id]);
    expect(changes[1]!.revision).toBeGreaterThan(changes[0]!.revision);
    expect(changes.length).toBe(2);
  });

  it("restores a task persisted by a host into a fresh server", async () => {
    const server = new AugmentServer({ runtime: model() });
    const started = await server.handle(request(1, "task/start", { taskId: "task:r", objective: "resume me", basisRevision: "commit:1" }));
    const task = (started as { result: unknown }).result;
    const fresh = new AugmentServer({ runtime: model() });
    const restored = await fresh.handle(request(1, "task/restore", { task }));
    expect(restored).toMatchObject({ id: 1, result: { id: "task:r", objective: "resume me" } });
    const fetched = await fresh.handle(request(2, "task/get", { taskId: "task:r" }));
    expect(fetched && "result" in fetched).toBe(true);
    const bad = await fresh.handle(request(3, "task/restore", { task: { version: 2 } }));
    expect(bad).toMatchObject({ id: 3, error: { code: -32002, message: expect.stringMatching(/valid task payload/u) } });
    const again = await fresh.handle(request(4, "task/restore", { task }));
    expect(again).toMatchObject({ id: 4, error: { code: -32002, message: expect.stringMatching(/already exists/u) } });
  });

  it("rejects restored tasks with broken internal references", async () => {
    const server = new AugmentServer({ runtime: model() });
    const started = await server.handle(request(1, "task/start", { taskId: "task:1", objective: "make retries bounded", basisRevision: "commit:1" }));
    const crystallized = await server.handle(request(2, "crystallize", { taskId: "task:1", expectedRevision: 1, nodeId: "node:root", temperature: "normal", lod: "file" }));
    const task = JSON.parse(JSON.stringify((crystallized as { result: unknown }).result)) as { candidates: Record<string, { nodeId: string }> };
    const candidateId = Object.keys(task.candidates)[0]!;
    task.candidates[candidateId]!.nodeId = "node:missing";
    const fresh = new AugmentServer({ runtime: model() });
    const restored = await fresh.handle(request(1, "task/restore", { task }));
    expect(restored).toMatchObject({ id: 1, error: { code: -32002, message: expect.stringMatching(/does not belong/u) } });
  });

  it("refreshes a stale subtree over the protocol", async () => {
    const runtime: ModelRuntime = {
      call: async (call) => {
        if (call.operation === "refine-node") {
          return { value: { children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "retry cutoff" }] } };
        }
        return model().call(call);
      },
    };
    const server = new AugmentServer({ runtime });
    const started = await server.handle(request(1, "task/start", { taskId: "task:f", objective: "make retries bounded", basisRevision: "commit:1" }));
    const task = (started as { result: { id: string; revision: number; rootNodeId: string } }).result;
    const crystallized = await server.handle(request(2, "crystallize", { taskId: task.id, expectedRevision: task.revision, nodeId: task.rootNodeId, temperature: "normal", lod: "file" }));
    const domain = (crystallized as { result: { id: string; revision: number; rootNodeId: string; nodes: Record<string, { candidateIds: string[] }> } }).result;
    const selected = await server.handle(request(3, "node/select", { taskId: domain.id, expectedRevision: domain.revision, nodeId: domain.rootNodeId, candidateId: domain.nodes[domain.rootNodeId]!.candidateIds[0]! }));
    const collapsed = (selected as { result: { id: string; revision: number; rootNodeId: string } }).result;
    const refined = await server.handle(request(4, "refine", { taskId: collapsed.id, expectedRevision: collapsed.revision, nodeId: collapsed.rootNodeId, temperature: "normal", lod: "hunk" }));
    const expanded = (refined as { result: { id: string; revision: number; nodes: Record<string, { id: string; path?: string; status: string }> } }).result;
    const fileNode = Object.values(expanded.nodes).find((node) => node.path === "src/auth/session.ts")!;

    const staled = await server.handle(request(5, "node/stale", { taskId: expanded.id, expectedRevision: expanded.revision, path: "src/auth/session.ts" }));
    const staleTask = (staled as { result: { id: string; revision: number } }).result;
    expect(staleTask.revision).toBeGreaterThan(expanded.revision);

    const refreshed = await server.handle(request(6, "node/refresh", { taskId: staleTask.id, expectedRevision: staleTask.revision, nodeId: fileNode.id, basisRevision: "commit:2" }));
    expect(refreshed).toMatchObject({ id: 6, result: { basisRevision: "commit:2" } });
    const after = await server.handle(request(7, "task/get", { taskId: "task:f" }));
    const file = Object.values(((after as { result: { nodes: Record<string, { id: string; status: string }> } }).result).nodes).find((node) => node.id === fileNode.id)!;
    expect(file.status).not.toBe("stale");
  });

  it("maps controller failures to typed protocol codes", async () => {
    const runtime: ModelRuntime = {
      call: async (call) => {
        if (call.operation === "refine-node") {
          return { value: { children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "retry cutoff" }] } };
        }
        if (call.operation === "draft-patch") {
          return { value: { patch: "--- a/src/other.ts\n+++ b/src/other.ts\n@@ -1 +1 @@\n-x\n+y", assumptions: [] } };
        }
        return model().call(call);
      },
    };
    const server = new AugmentServer({ runtime });
    const started = await server.handle(request(1, "task/start", { taskId: "task:c", objective: "make retries bounded", basisRevision: "commit:1" }));
    const task = (started as { result: { id: string; revision: number; rootNodeId: string } }).result;
    const crystallized = await server.handle(request(2, "crystallize", { taskId: task.id, expectedRevision: task.revision, nodeId: task.rootNodeId, temperature: "normal", lod: "file" }));
    const domain = (crystallized as { result: { id: string; revision: number; rootNodeId: string; nodes: Record<string, { candidateIds: string[] }> } }).result;
    const selected = await server.handle(request(3, "node/select", { taskId: domain.id, expectedRevision: domain.revision, nodeId: domain.rootNodeId, candidateId: domain.nodes[domain.rootNodeId]!.candidateIds[0]! }));
    const collapsed = (selected as { result: { id: string; revision: number; rootNodeId: string } }).result;
    const refined = await server.handle(request(4, "refine", { taskId: collapsed.id, expectedRevision: collapsed.revision, nodeId: collapsed.rootNodeId, temperature: "normal", lod: "hunk" }));
    const expanded = (refined as { result: { id: string; revision: number; nodes: Record<string, { id: string; path?: string }> } }).result;
    const fileNode = Object.values(expanded.nodes).find((node) => node.path === "src/auth/session.ts")!;

    const smuggled = await server.handle(request(5, "patch/draft", { taskId: expanded.id, expectedRevision: expanded.revision, nodeId: fileNode.id, temperature: "low" }));
    expect(smuggled).toMatchObject({ id: 5, error: { code: -32012, message: expect.stringMatching(/touches src\/other\.ts/u) } });

    const locked = await server.handle(request(6, "path/restrict", { taskId: expanded.id, expectedRevision: expanded.revision, path: "src/auth", mode: "lock", marked: true }));
    const lockedTask = (locked as { result: { id: string; revision: number } }).result;
    const forbidden = await server.handle(request(7, "patch/draft", { taskId: lockedTask.id, expectedRevision: lockedTask.revision, nodeId: fileNode.id, temperature: "low" }));
    expect(forbidden).toMatchObject({ id: 7, error: { code: -32011, message: expect.stringMatching(/locked/u) } });
  });

  it("reports unknown methods and tasks", async () => {
    const server = new AugmentServer({ runtime: model() });
    expect(await server.handle(request(1, "not-a-method"))).toMatchObject({ id: 1, error: { code: -32601 } });
    expect(await server.handle(request(2, "task/get", { taskId: "missing" }))).toMatchObject({ id: 2, error: { code: -32001 } });
  });

  it("reports host model-runtime availability", async () => {
    const server = new AugmentServer();
    const initialized = await server.handle(request(1, "initialize"));
    expect(initialized).toMatchObject({ result: { capabilities: { modelRuntime: false } } });
    const response = await server.handle(request(2, "task/start", { objective: "objective", basisRevision: "commit" }));
    const task = (response as { result: { id: string; revision: number; rootNodeId: string } }).result;
    const crystallize = await server.handle(request(3, "crystallize", { taskId: task.id, expectedRevision: task.revision, nodeId: task.rootNodeId }));
    expect(crystallize).toMatchObject({ id: 3, error: { code: -32020 } });
  });

  it("routes a node-linked message without mutating task state", async () => {
    const runtime: ModelRuntime = {
      call: async (call) => {
        if (call.operation === "route-message") {
          return { value: { intent: "explain", topic: "how routing classifies messages", options: [], focusPath: "src/augment" } };
        }
        return model().call(call);
      },
    };
    const server = new AugmentServer({ runtime });
    const started = await server.handle(request(1, "task/start", { taskId: "task:route", objective: "make retries bounded", basisRevision: "commit:1" }));
    const task = (started as { result: { id: string; revision: number } }).result;
    const routed = await server.handle(request(2, "message/route", { taskId: task.id, expectedRevision: task.revision, message: "how does routing work?", temperature: "normal" }));
    expect(routed).toMatchObject({ id: 2, result: { intent: "explain", topic: "how routing classifies messages", options: [], focusPath: "src/augment" } });
    const unchanged = await server.handle(request(3, "task/get", { taskId: task.id }));
    expect((unchanged as { result: { revision: number } }).result.revision).toBe(task.revision);
  });
});
