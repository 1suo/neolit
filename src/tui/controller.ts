import { execFileSync } from "node:child_process";
import { AugmentServer, type JsonRpcResponse } from "../augmentd/server.js";
import { planTree } from "../augment/state.js";
import type { LOD, ModelRuntime, PlanCandidate, PlanTask, PlanTreeEntry, Temperature } from "../augment/types.js";

export type PlannedTreeRow = {
  kind: "entry";
  id: string;
  depth: number;
  branch: string;
  entry: PlanTreeEntry;
};

export interface TuiActionState {
  task?: PlanTask;
  rows: PlannedTreeRow[];
  selectedRowId?: string;
  busy: boolean;
  operation?: string;
  message: string;
  error?: string;
}

export interface AugmentTuiControllerOptions {
  directory: string;
  runtime?: ModelRuntime;
  defaultLod?: LOD;
}

export function plannedTreeRows(task: PlanTask): PlannedTreeRow[] {
  const rows: PlannedTreeRow[] = [];
  const visit = (entry: PlanTreeEntry, depth: number, branch: string, prefix: string) => {
    rows.push({ kind: "entry", id: `entry:${entry.path}`, depth, branch, entry });
    entry.children.forEach((child, index) => {
      const last = index === entry.children.length - 1;
      visit(child, depth + 1, `${prefix}${last ? "└─ " : "├─ "}`, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  visit(planTree(task), 0, "", "");
  return rows;
}

export function candidatesForEntry(task: PlanTask | undefined, entry: PlanTreeEntry | undefined): PlanCandidate[] {
  if (!task || !entry) return [];
  return entry.candidateIds.map((id) => task.candidates[id]).filter(Boolean);
}

export class AugmentTuiController {
  readonly directory: string;
  private readonly runtime?: ModelRuntime;
  private readonly server: AugmentServer;
  private readonly defaultLod: LOD;
  private task?: PlanTask;
  private rows: PlannedTreeRow[] = [];
  private selectedRowId?: string;
  private busy = false;
  private operation?: string;
  private message = "Press [N] to describe a change.";
  private error?: string;

  constructor(options: AugmentTuiControllerOptions) {
    this.directory = options.directory;
    this.runtime = options.runtime;
    this.server = new AugmentServer({ runtime: options.runtime });
    this.defaultLod = options.defaultLod ?? "file";
  }

  cancel(): void {
    const cancellable = this.runtime as { cancel?: () => void } | undefined;
    cancellable?.cancel?.();
  }

  snapshot(): TuiActionState {
    return { task: this.task, rows: this.rows, selectedRowId: this.selectedRowId, busy: this.busy, operation: this.operation, message: this.message, error: this.error };
  }

  selectedRow(): PlannedTreeRow | undefined {
    return this.rows.find((row) => row.id === this.selectedRowId);
  }

  selectedNodeId(): string | undefined {
    const row = this.selectedRow();
    if (!row) return this.task?.rootNodeId;
    return row.entry.nodeIds[0] ?? this.task?.rootNodeId;
  }

  move(delta: number): void {
    if (!this.rows.length) return;
    const currentIndex = this.rows.findIndex((row) => row.id === this.selectedRowId);
    const nextIndex = Math.max(0, Math.min(this.rows.length - 1, (currentIndex < 0 ? 0 : currentIndex) + delta));
    this.selectedRowId = this.rows[nextIndex]!.id;
    this.message = `Selected ${this.selectedRowId}`;
  }

  select(rowId: string): void {
    if (this.rows.some((row) => row.id === rowId)) this.selectedRowId = rowId;
  }

  async start(objective: string, basisRevision = currentRevision(this.directory)): Promise<void> {
    if (!objective.trim()) {
      this.error = "Task objective is required.";
      return;
    }
    await this.dispatch("Starting plan", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 1, method: "task/start", params: { taskId: `task:${Date.now()}`, objective: objective.trim(), basisRevision } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.message = this.runtime ? "Generating approaches..." : `Plan started at ${this.task.basisRevision}. No model is configured.`;
    });
  }

  async crystallize(temperature: Temperature = "normal", lod: LOD = this.defaultLod): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    await this.dispatch("Generating approaches", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 2, method: "crystallize", params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature, lod } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.message = "Approaches ready. Choose one with keys 1-7.";
      this.selectNodeEntry(nodeId);
    });
  }

  async selectCandidate(candidateId?: string): Promise<void> {
    const task = this.requireTask();
    const chosen = candidateId;
    if (!chosen) {
      this.error = "Choose an approach with its number.";
      return;
    }
    const candidate = task.candidates[chosen];
    if (!candidate) {
      this.error = `Unknown candidate: ${chosen}`;
      return;
    }
    await this.dispatch("Using selected approach", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 3, method: "node/select", params: { taskId: task.id, expectedRevision: task.revision, nodeId: candidate.nodeId, candidateId: chosen } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.message = `Using: ${candidate.label}. Press F to expand it into files.`;
    });
  }

  async refine(temperature: Temperature = "normal", lod: LOD = this.defaultLod): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    await this.dispatch("Expanding approach into files", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 4, method: "refine", params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature, lod } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.message = "Planned files ready. Select a file and press D to draft its change.";
      this.selectFirstChild(nodeId);
    });
  }

  async draftPatch(): Promise<void> {
    const task = this.requireTask();
    const row = this.selectedRow();
    const nodeId = row?.entry.nodeIds.find((id) => ["file", "hunk", "virtual"].includes(task.nodes[id]?.kind ?? "")) ?? this.selectedNodeId();
    if (!nodeId) {
      this.error = "Select a file, hunk, or virtual node.";
      return;
    }
    await this.dispatch("Drafting selected change", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 5, method: "patch/draft", params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature: "low" } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.message = "Draft change ready. It is not applied to the repository.";
    });
  }

  async constrain(text: string): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId();
    if (!text.trim()) {
      this.error = "Message text is required.";
      return;
    }
    if (!nodeId) {
      this.error = "Select a path first.";
      return;
    }
    await this.dispatch("Attaching message", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 6, method: "node/constrain", params: { taskId: task.id, expectedRevision: task.revision, nodeId, text: text.trim() } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      const node = nodeId ? this.task?.nodes[nodeId] : undefined;
      this.message = node && ["unresolved", "domain"].includes(node.status)
        ? "Message attached. Rethinking approaches..."
        : `Message attached to ${node?.path ?? "plan"}. It will constrain the next draft.`;
      if (nodeId) this.selectNodeEntry(nodeId);
      if (node && ["unresolved", "domain"].includes(node.status)) {
        const regenerated = await this.server.handle({ jsonrpc: "2.0", id: 9, method: "crystallize", params: { taskId: this.task!.id, expectedRevision: this.task!.revision, nodeId, temperature: "normal", lod: this.defaultLod, replace: true } });
        this.task = expectResult(regenerated, PlanTaskLike.is) as PlanTask;
        this.refresh();
        this.selectNodeEntry(nodeId);
        this.message = "Approaches updated from your message. Choose one with keys 1-7.";
      }
    });
  }

  async rethink(): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    const node = task.nodes[nodeId];
    if (!node) return;
    await this.dispatch("Rethinking selected path", async () => {
      let current = task;
      if (node.selectedCandidateId || Object.values(current.nodes).some((child) => child.parent === nodeId)) {
        const reopened = await this.server.handle({ jsonrpc: "2.0", id: 10, method: "node/reopen", params: { taskId: current.id, expectedRevision: current.revision, nodeId, reason: "Operator requested a rethink" } });
        current = expectResult(reopened, PlanTaskLike.is) as PlanTask;
      }
      const regenerated = await this.server.handle({ jsonrpc: "2.0", id: 11, method: "crystallize", params: { taskId: current.id, expectedRevision: current.revision, nodeId, temperature: "normal", lod: this.defaultLod, replace: true } });
      this.task = expectResult(regenerated, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.selectNodeEntry(nodeId);
      this.message = "Approaches regenerated. Choose one with keys 1-7.";
    });
  }

  async reopen(reason: string): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId();
    if (!nodeId || !reason.trim()) {
      this.error = "Reopen requires a selected node and a reason.";
      return;
    }
    await this.dispatch("Reworking selected plan", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 7, method: "node/reopen", params: { taskId: task.id, expectedRevision: task.revision, nodeId, reason: reason.trim() } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.message = "Selection reopened. Generating approaches again is safe.";
    });
  }

  async markStale(path: string): Promise<void> {
    const task = this.requireTask();
    if (!path.trim()) {
      this.error = "A changed repository path is required.";
      return;
    }
    await this.dispatch("Marking repository change", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 8, method: "node/stale", params: { taskId: task.id, expectedRevision: task.revision, path: path.trim() } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.message = `Planned work touching ${path.trim()} is now marked stale.`;
    });
  }

  private requireTask(): PlanTask {
    if (!this.task) throw new Error("No task is active. Press [N] first.");
    return this.task;
  }

  private selectFirstChild(nodeId: string): void {
    const task = this.task;
    const child = Object.values(task?.nodes ?? {}).find((node) => node.parent === nodeId && node.kind !== "virtual");
    if (child?.path) this.selectedRowId = `entry:${child.path}`;
    else this.selectNodeEntry(nodeId);
  }

  private selectNodeEntry(nodeId: string): void {
    const path = this.task?.nodes[nodeId]?.path;
    if (path && this.rows.some((row) => row.id === `entry:${path}`)) this.selectedRowId = `entry:${path}`;
  }

  private refresh(): void {
    if (!this.task) {
      this.rows = [];
      this.selectedRowId = undefined;
      return;
    }
    this.rows = plannedTreeRows(this.task);
    if (this.rows.length && !this.rows.some((row) => row.id === this.selectedRowId)) this.selectedRowId = this.rows[0]!.id;
  }

  private async dispatch(operation: string, action: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.error = `Another operation is already running: ${this.operation ?? "unknown"}.`;
      return;
    }
    this.busy = true;
    this.operation = operation;
    this.error = undefined;
    this.message = `${operation}...`;
    try {
      await action();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.message = `${operation} failed.`;
    } finally {
      this.busy = false;
      this.operation = undefined;
    }
  }
}

const PlanTaskLike = {
  is(value: unknown): value is PlanTask {
    return Boolean(value && typeof value === "object" && (value as { version?: unknown }).version === 1 && typeof (value as { revision?: unknown }).revision === "number");
  },
};

function expectResult(response: JsonRpcResponse | null, guard: (value: unknown) => boolean): unknown {
  if (!response) throw new Error("augmentd returned no JSON-RPC response.");
  if ("error" in response) throw new Error(response.error.message);
  if (!guard(response.result)) throw new Error("augmentd returned an invalid task response.");
  return response.result;
}

export function currentRevision(directory: string): string {
  try {
    return execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return `workspace:${new Date().toISOString()}`;
  }
}
