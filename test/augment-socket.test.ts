import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnection } from "node:net";
import { AugmentServer, type JsonRpcRequest } from "../src/augmentd/server.js";
import { serveAugmentSocket, SocketAugmentPeer } from "../src/augmentd/socket.js";
import { McpAugmentServer } from "../src/augmentd/mcp.js";
import { AugmentTuiController } from "../src/tui/controller.js";
import type { ModelRuntime } from "../src/augment/types.js";

function socketPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "augment-sock-")), "augment.sock");
}

function request(id: number, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

/** Collects every line the server sends back until the stream settles. */
function rawLines(address: string, send: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(address);
    const lines: string[] = [];
    let index = 0;
    let settle: NodeJS.Timeout | undefined;
    const fail = (error: Error): void => reject(error);
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.off("error", fail);
      socket.on("error", () => undefined);
      const pump = (): void => {
        if (index < send.length) socket.write(`${send[index++]!}\n`);
      };
      pump();
      socket.on("data", (chunk: Buffer) => {
        lines.push(...chunk.toString("utf8").split("\n").filter(Boolean));
        pump();
        clearTimeout(settle);
        settle = setTimeout(() => {
          socket.destroy();
          resolve(lines);
        }, 150);
      });
    });
  });
}

describe("augmentd socket transport", () => {
  it("answers the native protocol over the socket and closes cleanly", async () => {
    const address = socketPath();
    const service = await serveAugmentSocket(new AugmentServer(), address);
    const peer = await SocketAugmentPeer.connect(address);
    const started = await peer.handle(request(1, "task/start", { taskId: "task:s", objective: "bounded retries", basisRevision: "commit:1" }));
    expect(started && "result" in started && (started.result as { id: string }).id).toBe("task:s");
    const fetched = await peer.handle(request(2, "task/get", { taskId: "task:s" }));
    expect(fetched && "result" in fetched && (fetched.result as { revision: number }).revision).toBe(1);
    peer.close();
    await service.close();
    await expect(SocketAugmentPeer.connect(address)).rejects.toThrow(/Could not attach/u);
    // The path is free again: a fresh server can take the same address.
    const again = await serveAugmentSocket(new AugmentServer(), address);
    await again.close();
  });

  it("forwards task-change notifications to attached clients", async () => {
    const address = socketPath();
    const service = await serveAugmentSocket(new AugmentServer(), address);
    const lines = await rawLines(address, [
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "task/start", params: { taskId: "task:n", objective: "o", basisRevision: "commit:1" } }),
    ]);
    const decoded = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(decoded.some((message) => message.method === "augment/taskChanged" && (message.params as { taskId: string }).taskId === "task:n")).toBe(true);
    expect(decoded.some((message) => message.id === 5 && "result" in message)).toBe(true);
    await service.close();
  });

  it("refuses to steal a live server's address", async () => {
    const address = socketPath();
    const service = await serveAugmentSocket(new AugmentServer(), address);
    await expect(serveAugmentSocket(new AugmentServer(), address)).rejects.toThrow(/already listens/u);
    await service.close();
  });

  it("bridges MCP tool calls onto the served task store", async () => {
    const address = socketPath();
    const service = await serveAugmentSocket(new AugmentServer(), address);
    const bridge = new McpAugmentServer({ peer: await SocketAugmentPeer.connect(address) });

    const call = async (name: string, args: unknown): Promise<{ text: string; structured?: Record<string, unknown>; isError?: boolean }> => {
      const response = await bridge.handle(request(41, "tools/call", { name, arguments: args }));
      if (!response || "error" in response) throw new Error(`${name} failed: ${JSON.stringify(response)}`);
      const result = (response as { result: { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean } }).result;
      return { text: result.content[0]!.text, structured: result.structuredContent, isError: result.isError };
    };

    const started = await call("plan_start", { objective: "bounded retries", basisRevision: "commit:1" });
    const taskId = started.structured!.taskId as string;
    let revision = started.structured!.revision as number;
    const rootNodeId = started.structured!.rootNodeId as string;
    const proposed = await call("propose_approaches", {
      taskId,
      expectedRevision: revision,
      nodeId: rootNodeId,
      candidates: [{ label: "Fixed count", rationale: "smallest", confidence: 80, touchedPaths: ["src/auth/session.ts"] }],
    });
    revision = proposed.structured!.revision as number;
    const challenged = await call("challenge_approaches", { taskId, expectedRevision: revision, nodeId: rootNodeId, verdict: { kind: "accept" } });
    revision = challenged.structured!.revision as number;
    const selected = await call("select_approach", { taskId, expectedRevision: revision, nodeId: rootNodeId, candidateId: (proposed.structured!.candidates as Array<{ id: string }>)[0]!.id });
    revision = selected.structured!.revision as number;
    await call("refine_plan", {
      taskId,
      expectedRevision: revision,
      nodeId: rootNodeId,
      children: [{ path: "src/auth/session.ts", kind: "file", lod: "hunk", reason: "cutoff" }],
    });
    const status = await call("plan_status", { taskId });
    revision = status.structured!.revision as number;
    const patch = "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,2 +1,3 @@\n alpha\n+beta\n";
    const drafted = await call("draft_file", { taskId, expectedRevision: revision, path: "src/auth/session.ts", patch });
    expect(drafted.isError).toBeUndefined();

    // The mutation landed in the SERVED store — verify through a second,
    // independent peer, proving the bridge holds no task state of its own.
    const witness = await SocketAugmentPeer.connect(address);
    const fetched = await witness.handle(request(50, "task/get", { taskId }));
    const task = (fetched as { result: { diffs: Record<string, { patch: string }> } }).result;
    expect(Object.values(task.diffs).map((diff) => diff.patch)).toEqual([patch]);
    witness.close();
    await service.close();
  });

  it("renders external socket mutations in the TUI controller as they land", async () => {
    const address = socketPath();
    const controller = new AugmentTuiController({ directory: process.cwd(), serveSocket: false });
    await controller.start("bounded retries", "commit:1");
    const service = await serveAugmentSocket(controller.server, address);
    const rendered: number[] = [];
    controller.subscribe(() => rendered.push(controller.snapshot().task?.revision ?? 0));

    const peer = await SocketAugmentPeer.connect(address);
    const task = controller.snapshot().task!;
    const constrained = await peer.handle(request(60, "node/constrain", { taskId: task.id, expectedRevision: task.revision, text: "Keep the public API." }));
    expect(constrained && "result" in constrained).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const after = controller.snapshot();
    expect(after.task?.revision).toBeGreaterThan(task.revision);
    expect(Object.values(after.task?.constraints ?? {}).some((constraint) => constraint.text === "Keep the public API.")).toBe(true);
    expect(rendered.filter((revision) => revision > task.revision)).toHaveLength(1);
    expect(after.socketPath).toBeUndefined(); // this controller serves nothing itself

    peer.close();
    await service.close();
  });

  it("serializes concurrent writers and rejects the stale one with the typed error", async () => {
    let releaseModel: (() => void) | undefined;
    const pendingModel = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const runtime: ModelRuntime = {
      async call(request) {
        if (request.operation === "generate-domain") {
          await pendingModel;
          return { value: { candidates: [{ label: "Only", rationale: "one family", confidence: 75, touchedPaths: ["src/a.ts"] }] } };
        }
        if (request.operation === "challenge-domain") return { value: { kind: "accept" } };
        throw new Error(`unexpected operation ${request.operation}`);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime, serveSocket: false });
    await controller.start("bounded retries", "commit:1");
    const service = await serveAugmentSocket(controller.server, socketPath());
    const peer = await SocketAugmentPeer.connect(service.path);
    const task = controller.snapshot().task!;
    const running = controller.crystallize();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // An external write racing a running operation queues behind it and
    // then fails the optimistic-concurrency check — it can never be
    // silently lost by a result merged from the older snapshot.
    const constrained = peer.handle(request(70, "node/constrain", { taskId: task.id, expectedRevision: task.revision, text: "External note." }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(controller.snapshot().busy).toBe(true);
    releaseModel!();
    await running;
    const response = await constrained;
    expect(response && "error" in response && response.error.code).toBe(-32010);
    const done = controller.snapshot();
    expect(done.busy).toBe(false);
    expect(done.error).toBeUndefined();
    expect(done.task?.revision).toBeGreaterThan(task.revision);
    expect(Object.values(done.task?.constraints ?? {}).some((constraint) => constraint.text === "External note.")).toBe(false);

    // Retried with the fresh revision, the same write lands and renders.
    const fresh = controller.snapshot().task!;
    const rendered: number[] = [];
    controller.subscribe(() => rendered.push(controller.snapshot().task?.revision ?? 0));
    const retried = await peer.handle(request(71, "node/constrain", { taskId: fresh.id, expectedRevision: fresh.revision, text: "External note." }));
    expect(retried && "result" in retried).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const adopted = controller.snapshot();
    expect(Object.values(adopted.task?.constraints ?? {}).some((constraint) => constraint.text === "External note.")).toBe(true);
    expect(rendered.filter((revision) => revision > fresh.revision)).toHaveLength(1);
    peer.close();
    await service.close();
  });
});
