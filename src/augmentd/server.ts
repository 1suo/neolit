import { createPlanTask, addConstraint, markPathStale, planTree, rejectCandidate, reopenNode, setPathLock } from "../augment/state.js";
import { crystallizeNode, draftPatchWithModel, explainProjectWithModel, refineWithModel, repairPatchWithModel, selectCandidate } from "../augment/kernel.js";
import type { LOD, ModelRuntime, PlanTask, Temperature } from "../augment/types.js";

export const AUGMENT_PROTOCOL_VERSION = 1;

export class ProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number; result: unknown }
  | { jsonrpc: "2.0"; id: string | number; error: { code: number; message: string } };

export interface AugmentServerOptions {
  runtime?: ModelRuntime;
}

export class UnavailableModelRuntime implements ModelRuntime {
  async call(): Promise<never> {
    throw new ProtocolError(-32020, "No model runtime was injected by the augmentd host");
  }
}

interface TaskStartParams {
  taskId?: string;
  objective: string;
  basisRevision: string;
  mode?: "change" | "explanation";
}

interface TaskMutationParams {
  taskId: string;
  expectedRevision: number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProtocolError(-32602, "Params must be an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ProtocolError(-32602, `${field} must be a non-empty string`);
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new ProtocolError(-32602, "expectedRevision must be a positive integer");
  return value;
}

function temperature(value: unknown): Temperature {
  if (value === undefined) return "normal";
  if (value === "low" || value === "normal" || value === "high") return value;
  throw new ProtocolError(-32602, "temperature must be low, normal, or high");
}

function lod(value: unknown): LOD {
  if (value === undefined) return "file";
  if (value === "architecture" || value === "file" || value === "hunk") return value;
  throw new ProtocolError(-32602, "lod must be architecture, file, or hunk");
}

function taskMutation(value: unknown): TaskMutationParams {
  const params = object(value);
  return { taskId: string(params.taskId, "taskId"), expectedRevision: revision(params.expectedRevision) };
}

export class AugmentServer {
  private readonly tasks = new Map<string, PlanTask>();
  private readonly runtime: ModelRuntime;
  private nextTaskId = 1;

  constructor(options: AugmentServerOptions = {}) {
    this.runtime = options.runtime ?? new UnavailableModelRuntime();
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (request.jsonrpc !== "2.0") throw new ProtocolError(-32600, "Expected JSON-RPC 2.0 request");
    if (request.id === undefined || request.id === null) throw new ProtocolError(-32600, "augmentd stdio requires a request id");
    try {
      const result = await this.dispatch(request.method, request.params);
      return { jsonrpc: "2.0", id: request.id, result };
    } catch (error) {
      const code = error instanceof ProtocolError ? error.code : -32000;
      const message = error instanceof Error ? error.message : String(error);
      return { jsonrpc: "2.0", id: request.id, error: { code, message } };
    }
  }

  private requireTask(id: string): PlanTask {
    const task = this.tasks.get(id);
    if (!task) throw new ProtocolError(-32001, `Unknown task: ${id}`);
    return task;
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        return { protocolVersion: AUGMENT_PROTOCOL_VERSION, capabilities: { tasks: true, modelRuntime: !(this.runtime instanceof UnavailableModelRuntime) } };
      case "task/start": {
        const input = object(params) as unknown as TaskStartParams;
        const taskId = typeof input.taskId === "string" && input.taskId.trim() ? input.taskId.trim() : `task:${this.nextTaskId++}`;
        if (this.tasks.has(taskId)) throw new ProtocolError(-32002, `Task already exists: ${taskId}`);
        const mode = input.mode === "explanation" ? "explanation" : "change";
        const task = createPlanTask({ id: taskId, objective: string(input.objective, "objective"), basisRevision: string(input.basisRevision, "basisRevision"), mode });
        this.tasks.set(taskId, task);
        return task;
      }
      case "task/get": {
        const input = object(params);
        return this.requireTask(string(input.taskId, "taskId"));
      }
      case "tree/get": {
        const input = object(params);
        return planTree(this.requireTask(string(input.taskId, "taskId")));
      }
      case "node/get": {
        const input = object(params);
        const task = this.requireTask(string(input.taskId, "taskId"));
        const node = task.nodes[string(input.nodeId, "nodeId")];
        if (!node) throw new ProtocolError(-32003, "Unknown plan node");
        return { node, candidates: node.candidateIds.map((id) => task.candidates[id]), constraints: node.constraintIds.map((id) => task.constraints[id]), obligations: node.obligationIds.map((id) => task.obligations[id]), diffs: node.diffIds.map((id) => task.diffs[id]) };
      }
      case "node/constrain": {
        const input = object(params);
        const base = taskMutation(params);
        const task = this.requireTask(base.taskId);
        const updated = addConstraint(task, {
          taskId: base.taskId,
          expectedRevision: base.expectedRevision,
          nodeId: typeof input.nodeId === "string" ? input.nodeId : undefined,
          path: typeof input.path === "string" ? input.path : undefined,
          text: string(input.text, "text"),
        });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "node/select": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = selectCandidate(this.requireTask(base.taskId), { ...base, nodeId: string(input.nodeId, "nodeId"), candidateId: string(input.candidateId, "candidateId") });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "node/reject": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = rejectCandidate(this.requireTask(base.taskId), { ...base, candidateId: string(input.candidateId, "candidateId"), reason: string(input.reason, "reason") });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "node/reopen": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = reopenNode(this.requireTask(base.taskId), { ...base, nodeId: string(input.nodeId, "nodeId"), reason: string(input.reason, "reason") });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "node/stale": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = markPathStale(this.requireTask(base.taskId), { ...base, path: string(input.path, "path") });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "path/lock": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = setPathLock(this.requireTask(base.taskId), {
          ...base,
          path: string(input.path, "path"),
          locked: input.locked !== false,
        });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "explain": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = await explainProjectWithModel(this.runtime, this.requireTask(base.taskId), {
          taskId: base.taskId,
          temperature: temperature(input.temperature),
        });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "crystallize": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = await crystallizeNode(this.runtime, this.requireTask(base.taskId), {
          taskId: base.taskId,
          nodeId: string(input.nodeId, "nodeId"),
          temperature: temperature(input.temperature),
          lod: lod(input.lod),
          replace: input.replace === true,
          challengeRounds: input.challengeRounds === undefined ? undefined : Math.max(0, Math.min(Number(input.challengeRounds) || 0, 2)),
        });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "refine": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = await refineWithModel(this.runtime, this.requireTask(base.taskId), {
          taskId: base.taskId,
          nodeId: string(input.nodeId, "nodeId"),
          temperature: temperature(input.temperature),
          lod: lod(input.lod),
        });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "patch/draft": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = await draftPatchWithModel(this.runtime, this.requireTask(base.taskId), {
          taskId: base.taskId,
          nodeId: string(input.nodeId, "nodeId"),
          temperature: temperature(input.temperature),
        });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "patch/repair": {
        const base = taskMutation(params);
        const input = object(params);
        const updated = await repairPatchWithModel(this.runtime, this.requireTask(base.taskId), {
          taskId: base.taskId,
          diffId: string(input.diffId, "diffId"),
          failedCheck: string(input.failedCheck, "failedCheck"),
          temperature: temperature(input.temperature),
        });
        this.tasks.set(updated.id, updated);
        return updated;
      }
      case "diff/get": {
        const input = object(params);
        const task = this.requireTask(string(input.taskId, "taskId"));
        if (input.diffId !== undefined) {
          const diff = task.diffs[string(input.diffId, "diffId")];
          if (!diff) throw new ProtocolError(-32004, "Unknown planned diff");
          return diff;
        }
        return Object.values(task.diffs);
      }
      case "shutdown":
        return null;
      default:
        throw new ProtocolError(-32601, `Unknown method: ${method}`);
    }
  }
}

export async function runStdioAugmentServer(options: AugmentServerOptions = {}, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const { createInterface } = await import("node:readline");
  const server = new AugmentServer(options);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let stopped = false;
  for await (const line of lines) {
    if (stopped) break;
    if (!line.trim()) continue;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    const response = await server.handle(request as JsonRpcRequest);
    if (!response) continue;
    output.write(`${JSON.stringify(response)}\n`);
    if ((request as JsonRpcRequest).method === "shutdown") stopped = true;
  }
}
