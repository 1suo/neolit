import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AugmentServer, type JsonRpcResponse } from "../augmentd/server.js";
import { pathIsLocked, planTree } from "../augment/state.js";
import { applyPlannedDiffs } from "./apply.js";
import type { LOD, ModelRuntime, PlanCandidate, PlanTask, PlanTreeEntry, Temperature } from "../augment/types.js";

export type PlannedTreeRow = {
  kind: "entry";
  id: string;
  depth: number;
  branch: string;
  entry: PlanTreeEntry;
  repositoryOnly: boolean;
};

export interface TuiActionState {
  task?: PlanTask;
  rows: PlannedTreeRow[];
  selectedRowId?: string;
  busy: boolean;
  operation?: string;
  message: string;
  error?: string;
  pendingLocks: string[];
  active?: { nodeId?: string; operation?: string };
  failed?: { nodeId?: string; operation?: string; error?: string };
}

export interface AugmentTuiControllerOptions {
  directory: string;
  runtime?: ModelRuntime;
  defaultLod?: LOD;
}

const MAX_REPOSITORY_ENTRIES = 5_000;

function repositoryPaths(directory: string): string[] {
  try {
    const output = execFileSync("git", ["-C", directory, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split("\0").filter(Boolean).sort();
  } catch {
    const paths: string[] = [];
    const visit = (directoryPath: string) => {
      if (paths.length > MAX_REPOSITORY_ENTRIES) return;
      for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const absolute = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else paths.push(path.relative(directory, absolute).split(path.sep).join("/"));
      }
    };
    visit(directory);
    return paths.sort();
  }
}

function emptyTreeEntry(entryPath: string, kind: PlanTreeEntry["kind"]): PlanTreeEntry {
  return {
    path: entryPath,
    name: entryPath === "." ? "/" : entryPath.slice(entryPath.lastIndexOf("/") + 1),
    kind,
    status: "unresolved",
    nodeIds: [],
    candidateIds: [],
    diffIds: [],
    explanationIds: [],
    obligationIds: [],
    children: [],
  };
}

function ensureTreeEntry(root: PlanTreeEntry, entryPath: string, kind: PlanTreeEntry["kind"]): PlanTreeEntry {
  if (entryPath === ".") return root;
  const parentPath = entryPath.includes("/") ? entryPath.slice(0, entryPath.lastIndexOf("/")) : ".";
  const parent = ensureTreeEntry(root, parentPath, "dir");
  let child = parent.children.find((candidate) => candidate.path === entryPath);
  if (!child) {
    child = emptyTreeEntry(entryPath, kind);
    parent.children.push(child);
    parent.children.sort((left, right) => left.path.localeCompare(right.path));
  }
  return child;
}

export function repositoryTree(directory: string): PlanTreeEntry {
  const root = emptyTreeEntry(".", "root");
  for (const filePath of repositoryPaths(directory).slice(0, MAX_REPOSITORY_ENTRIES)) {
    ensureTreeEntry(root, filePath, filePath.endsWith("/") ? "dir" : "file");
  }
  return root;
}

function aggregateSubtree(entry: PlanTreeEntry): void {
  for (const child of entry.children) aggregateSubtree(child);
  for (const child of entry.children) {
    const append = <T>(target: T[], values: readonly T[]) => {
      for (const value of values) if (!target.includes(value)) target.push(value);
    };
    append(entry.nodeIds, child.nodeIds);
    append(entry.candidateIds, child.candidateIds);
    append(entry.diffIds, child.diffIds);
    append(entry.explanationIds, child.explanationIds);
    append(entry.obligationIds, child.obligationIds);
    entry.selectedCandidateId ??= child.selectedCandidateId;
    if (child.status === "stale") entry.status = "stale";
    else if (child.status === "blocked" && entry.status !== "stale") entry.status = "blocked";
  }
}

function mergePlanTree(repository: PlanTreeEntry, plan: PlanTreeEntry): PlanTreeEntry {
  const merge = (source: PlanTreeEntry) => {
    const target = source.path === "." ? repository : ensureTreeEntry(repository, source.path, source.kind);
    target.kind = source.path === "." ? "root" : source.kind === "dir" ? "dir" : source.kind;
    target.nodeIds = [...new Set([...target.nodeIds, ...source.nodeIds])];
    target.candidateIds = [...new Set([...target.candidateIds, ...source.candidateIds])];
    target.diffIds = [...new Set([...target.diffIds, ...source.diffIds])];
    target.explanationIds = [...new Set([...target.explanationIds, ...source.explanationIds])];
    target.obligationIds = [...new Set([...target.obligationIds, ...source.obligationIds])];
    target.selectedCandidateId ??= source.selectedCandidateId;
    target.status = source.status;
    for (const child of source.children) merge(child);
  };
  merge(plan);
  const sortChildren = (entry: PlanTreeEntry) => {
    entry.children.sort((left, right) => left.path.localeCompare(right.path));
    entry.children.forEach(sortChildren);
  };
  sortChildren(repository);
  aggregateSubtree(repository);
  return repository;
}

export function entryHasPlan(entry: PlanTreeEntry): boolean {
  return entry.nodeIds.length > 0 || entry.candidateIds.length > 0 || entry.diffIds.length > 0 || entry.explanationIds.length > 0 || entry.obligationIds.length > 0;
}

function rowsFromTree(root: PlanTreeEntry): PlannedTreeRow[] {
  const rows: PlannedTreeRow[] = [];
  const visit = (entry: PlanTreeEntry, depth: number, branch: string, prefix: string) => {
    rows.push({ kind: "entry", id: `entry:${entry.path}`, depth, branch, entry, repositoryOnly: !entryHasPlan(entry) });
    entry.children.forEach((child, index) => {
      const last = index === entry.children.length - 1;
      visit(child, depth + 1, `${prefix}${last ? "└─ " : "├─ "}`, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  visit(root, 0, "", "");
  return rows;
}

export function plannedTreeRowsFromRepository(repository: PlanTreeEntry): PlannedTreeRow[] {
  return rowsFromTree(repository);
}

export function plannedTreeRows(task: PlanTask, repository?: PlanTreeEntry): PlannedTreeRow[] {
  const plan = planTree(task);
  const root = repository ? mergePlanTree(structuredClone(repository), plan) : plan;
  aggregateSubtree(root);
  return rowsFromTree(root);
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
  private repository: PlanTreeEntry;
  private task?: PlanTask;
  private pendingLocks: string[] = [];
  private activeNodeId?: string;
  private failedNodeId?: string;
  private failedOperation?: string;
  private failedError?: string;
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
    this.repository = repositoryTree(options.directory);
    this.refresh();
  }

  cancel(): void {
    const cancellable = this.runtime as { cancel?: () => void } | undefined;
    cancellable?.cancel?.();
  }

  snapshot(): TuiActionState {
    return {
      task: this.task,
      rows: this.rows,
      selectedRowId: this.selectedRowId,
      busy: this.busy,
      operation: this.operation,
      message: this.message,
      error: this.error,
      pendingLocks: [...this.pendingLocks],
      active: this.busy ? { nodeId: this.activeNodeId, operation: this.operation } : undefined,
      failed: this.failedNodeId ? { nodeId: this.failedNodeId, operation: this.failedOperation, error: this.failedError } : undefined,
    };
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
      const response = await this.server.handle({ jsonrpc: "2.0", id: 1, method: "task/start", params: { taskId: `task:${Date.now()}`, objective: objective.trim(), basisRevision, mode: "change" } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      for (const lockPath of this.pendingLocks) {
        const locked = await this.server.handle({
          jsonrpc: "2.0",
          id: 15,
          method: "path/lock",
          params: { taskId: this.task.id, expectedRevision: this.task.revision, path: lockPath, locked: true },
        });
        this.task = expectResult(locked, PlanTaskLike.is) as PlanTask;
      }
      this.pendingLocks = [];
      this.refresh();
      this.message = this.runtime ? "Generating approaches..." : `Plan started at ${this.task.basisRevision}. No model is configured.`;
    });
  }

  async startExplanation(objective: string, basisRevision = currentRevision(this.directory)): Promise<void> {
    if (!objective.trim()) {
      this.error = "Explanation topic is required.";
      return;
    }
    await this.dispatch("Explaining repository topic", async () => {
      const started = await this.server.handle({
        jsonrpc: "2.0",
        id: 13,
        method: "task/start",
        params: { taskId: `task:${Date.now()}`, objective: objective.trim(), basisRevision, mode: "explanation" },
      });
      let task = expectResult(started, PlanTaskLike.is) as PlanTask;
      this.task = task;
      this.refresh();
      const explained = await this.server.handle({
        jsonrpc: "2.0",
        id: 14,
        method: "explain",
        params: { taskId: task.id, expectedRevision: task.revision, temperature: "low" },
      });
      task = expectResult(explained, PlanTaskLike.is) as PlanTask;
      this.task = task;
      this.refresh();
      const explanationCount = Object.keys(task.explanations).length;
      const firstExplanation = Object.values(task.explanations)[0];
      if (firstExplanation) this.select(`entry:${firstExplanation.path}`);
      this.message = `Explained ${explanationCount} related paths. Select ? paths for details.`;
    });
  }

  async crystallize(temperature: Temperature = "normal", lod: LOD = this.defaultLod): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    await this.dispatch("Generating approaches", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 2, method: "crystallize", params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature, lod } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      const generatedNode = this.task.nodes[nodeId]!;
      if (generatedNode.challengeExhausted) {
        this.message = "Approaches ready after bounded challenge. Choose 1-7, or press [G] to rethink.";
      } else {
        this.message = "Approaches ready. Choose one with keys 1-7.";
      }
      this.selectNodeEntry(nodeId);
    }, nodeId);
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
    }, nodeId);
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
    }, nodeId);
  }

  async applySelected(): Promise<void> {
    const task = this.requireTask();
    const row = this.selectedRow();
    const diffs = (row?.entry.diffIds ?? []).flatMap((id) => {
      const diff = task.diffs[id];
      return diff ? [diff] : [];
    });
    if (!diffs.length) {
      this.error = "Select a drafted path to apply.";
      return;
    }
    await this.dispatch("Applying drafted changes", async () => {
      const applied = applyPlannedDiffs(this.directory, diffs);
      this.repository = repositoryTree(this.directory);
      this.refresh();
      this.message = `Applied ${applied.length} drafted ${applied.length === 1 ? "change" : "changes"} to the working tree. Nothing is committed.`;
    });
  }

  async constrain(text: string): Promise<void> {
    const task = this.requireTask();
    const row = this.selectedRow();
    const targetPath = row?.entry.path ?? ".";
    const nodeId = this.selectedNodeId();
    if (!text.trim()) {
      this.error = "Message text is required.";
      return;
    }
    if (!nodeId) {
      this.error = "Select a path first.";
      return;
    }
    await this.dispatch("Applying message to subtree", async () => {
      const constrained = await this.server.handle({
        jsonrpc: "2.0",
        id: 6,
        method: "node/constrain",
        params: { taskId: task.id, expectedRevision: task.revision, nodeId, path: targetPath === "." ? undefined : targetPath, text: text.trim() },
      });
      let current = expectResult(constrained, PlanTaskLike.is) as PlanTask;
      this.task = current;
      this.refresh();

      const node = current.nodes[nodeId]!;
      if (node.selectedCandidateId || Object.values(current.nodes).some((child) => child.parent === nodeId)) {
        const reopened = await this.server.handle({
          jsonrpc: "2.0",
          id: 9,
          method: "node/reopen",
          params: { taskId: current.id, expectedRevision: current.revision, nodeId, reason: `Path message: ${text.trim()}` },
        });
        current = expectResult(reopened, PlanTaskLike.is) as PlanTask;
        this.task = current;
        this.refresh();
      }

      if (this.runtime) {
        const regenerated = await this.server.handle({
          jsonrpc: "2.0",
          id: 10,
          method: "crystallize",
          params: { taskId: current.id, expectedRevision: current.revision, nodeId, temperature: "normal", lod: this.defaultLod, replace: true },
        });
        this.task = expectResult(regenerated, PlanTaskLike.is) as PlanTask;
        this.refresh();
        this.selectNodeEntry(nodeId);
        this.message = "Approaches updated from your message. Choose one with keys 1-7.";
      } else {
        this.selectNodeEntry(nodeId);
        this.message = `Message saved for ${targetPath}. No model is configured to regenerate it.`;
      }
    }, nodeId);
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
    }, nodeId);
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

  async toggleLock(): Promise<void> {
    const row = this.selectedRow();
    const targetPath = row?.entry.path;
    if (!targetPath || targetPath === ".") {
      this.error = "Select a file or directory to lock.";
      return;
    }
    if (!this.task) {
      const locked = this.pendingLocks.includes(targetPath);
      this.pendingLocks = locked ? this.pendingLocks.filter((lockedPath) => lockedPath !== targetPath) : [...this.pendingLocks, targetPath];
      this.message = `${targetPath} is ${locked ? "unlocked" : "locked"} for the next task; the model will be told not to change it.`;
      return;
    }
    const locked = pathIsLocked(this.task, targetPath);
    await this.dispatch(locked ? "Unlocking path" : "Locking path", async () => {
      const response = await this.server.handle({
        jsonrpc: "2.0",
        id: 12,
        method: "path/lock",
        params: { taskId: this.task!.id, expectedRevision: this.task!.revision, path: targetPath, locked: !locked },
      });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.message = `${targetPath} is ${locked ? "unlocked" : "locked"} for this run.`;
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
    this.rows = this.task ? plannedTreeRows(this.task, this.repository) : plannedTreeRowsFromRepository(this.repository);
    if (this.rows.length && !this.rows.some((row) => row.id === this.selectedRowId)) this.selectedRowId = this.rows[0]!.id;
  }

  private async dispatch(operation: string, action: () => Promise<void>, nodeId?: string): Promise<void> {
    if (this.busy) {
      this.error = `Another operation is already running: ${this.operation ?? "unknown"}.`;
      return;
    }
    this.busy = true;
    this.operation = operation;
    this.activeNodeId = nodeId;
    this.error = undefined;
    this.message = `${operation}...`;
    try {
      await action();
      if (this.failedNodeId && nodeId && this.failedNodeId === nodeId) {
        this.failedNodeId = undefined;
        this.failedOperation = undefined;
        this.failedError = undefined;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.message = `${operation} failed.`;
      this.failedNodeId = nodeId;
      this.failedOperation = operation;
      this.failedError = this.error;
    } finally {
      this.busy = false;
      this.operation = undefined;
      this.activeNodeId = undefined;
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
