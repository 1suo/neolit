import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AugmentServer, type JsonRpcResponse } from "../augmentd/server.js";
import { pathIsLocked, planTree } from "../augment/state.js";
import { applyPlannedDiffs, commitAppliedPaths } from "./apply.js";
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
  pendingMarks: string[];
  pendingMode: "lock" | "allow";
  appliedDiffIds: string[];
  active?: { nodeId?: string; operation?: string };
  failed?: { nodeId?: string; operation?: string; error?: string };
}

export interface AugmentTuiControllerOptions {
  directory: string;
  runtime?: ModelRuntime;
  defaultLod?: LOD;
  /** Persist the active task to disk and resume the newest one on start. */
  persistTasks?: boolean;
}

const MAX_REPOSITORY_ENTRIES = 5_000;

export interface StoredTask {
  task: PlanTask;
  appliedDiffIds: string[];
  savedAt: number;
}

const MAX_STORED_TASKS = 8;

function tasksStorePath(): string {
  const base = process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.trim()
    ? process.env.XDG_STATE_HOME
    : path.join(os.homedir(), ".local", "state");
  return path.join(base, "neolit", "augment-tasks.json");
}

function loadStoredTasks(): StoredTask[] {
  try {
    const raw = JSON.parse(fs.readFileSync(tasksStorePath(), "utf8")) as StoredTask[];
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry) => entry && typeof entry === "object" && entry.task?.version === 1 && typeof entry.task.revision === "number");
  } catch {
    return [];
  }
}

function saveStoredTasks(entries: StoredTask[]): void {
  try {
    fs.mkdirSync(path.dirname(tasksStorePath()), { recursive: true });
    fs.writeFileSync(tasksStorePath(), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  } catch {
    // Persistence is best-effort; the in-memory task keeps working.
  }
}

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
  private readonly challengeRounds: number | undefined;
  private readonly persistTasks: boolean;
  private repository: PlanTreeEntry;
  private task?: PlanTask;
  private pendingMarks: string[] = [];
  private pendingMode: "lock" | "allow" = "lock";
  private readonly appliedDiffIds = new Set<string>();
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
    const rounds = Number(process.env.AUGMENT_CHALLENGE_ROUNDS);
    this.challengeRounds = Number.isInteger(rounds) && rounds >= 0 && rounds <= 2 ? rounds : undefined;
    this.persistTasks = options.persistTasks === true;
    this.repository = repositoryTree(options.directory);
    if (this.persistTasks) {
      const stored = loadStoredTasks().sort((left, right) => right.savedAt - left.savedAt)[0];
      if (stored) {
        this.task = stored.task;
        this.appliedDiffIds = new Set(stored.appliedDiffIds);
        void this.server.handle({ jsonrpc: "2.0", id: 0, method: "task/restore", params: { task: stored.task } }).catch(() => {
          // If the payload is somehow rejected the first operation will surface
          // the server's own error; the local copy keeps the tree visible.
        });
        this.message = `Resumed task: ${stored.task.objective}`;
      }
    }
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
      pendingMarks: [...this.pendingMarks],
      pendingMode: this.pendingMode,
      appliedDiffIds: [...this.appliedDiffIds],
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
      if (this.pendingMode !== "lock" || this.pendingMarks.length) {
        const restricted = await this.server.handle({
          jsonrpc: "2.0",
          id: 15,
          method: "path/restrict",
          params: { taskId: this.task.id, expectedRevision: this.task.revision, mode: this.pendingMode },
        });
        this.task = expectResult(restricted, PlanTaskLike.is) as PlanTask;
        for (const markPath of this.pendingMarks) {
          const marked = await this.server.handle({
            jsonrpc: "2.0",
            id: 19,
            method: "path/restrict",
            params: { taskId: this.task.id, expectedRevision: this.task.revision, path: markPath, mode: this.pendingMode, marked: true },
          });
          this.task = expectResult(marked, PlanTaskLike.is) as PlanTask;
        }
      }
      this.pendingMarks = [];
      this.pendingMode = "lock";
      this.refresh();
      this.message = this.runtime ? "Generating approaches..." : `Plan started at ${this.task.basisRevision}. No model is configured.`;
    });
  }

  /**
   * Explains from the cursor: with an active task the selected node is the
   * focus (its path leads the packet's node), otherwise a fresh
   * explanation-mode task explains the repository as a whole.
   */
  async explain(topic: string, basisRevision = currentRevision(this.directory)): Promise<void> {
    if (!topic.trim()) {
      this.error = "Explanation topic is required.";
      return;
    }
    if (this.task) {
      const task = this.task;
      const nodeId = this.selectedNodeId() ?? task.rootNodeId;
      await this.dispatch("Explaining selected path", async () => {
        const explained = await this.server.handle({
          jsonrpc: "2.0",
          id: 21,
          method: "explain",
          params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature: "low" },
        });
        this.task = expectResult(explained, PlanTaskLike.is) as PlanTask;
        this.refresh();
        const explanationCount = Object.keys(this.task.explanations).length;
        this.message = `Explained ${explanationCount} paths around ${this.task.nodes[nodeId]?.path ?? "the task"}. ? marks show them.`;
      }, nodeId);
      return;
    }
    await this.startExplanation(topic, basisRevision);
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
      const response = await this.server.handle({ jsonrpc: "2.0", id: 2, method: "crystallize", params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature, lod, challengeRounds: this.challengeRounds } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      await this.adoptSingletonIfViable(nodeId);
      const generatedNode = this.task.nodes[nodeId]!;
      if (generatedNode.status === "collapsed") {
        this.message = "Single viable approach adopted. Press D to develop it into files.";
      }
      else if (generatedNode.challengeExhausted) {
        this.message = "Approaches ready after bounded challenge. Choose 1-7, or press Enter to rethink.";
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
      this.message = `Using: ${candidate.label}. Press D to develop it into files.`;
    });
  }

  async refine(temperature: Temperature = "normal", lod: LOD = this.defaultLod): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    const node = task.nodes[nodeId];
    if (node && node.status !== "collapsed") {
      const possible = node.candidateIds.map((id) => task.candidates[id]).filter((candidate) => candidate?.status === "possible");
      if (node.status === "domain" && possible.length) {
        this.error = `This path has ${possible.length} approach${possible.length === 1 ? "" : "es"} — choose one with keys 1-7, then press D to develop it.`;
      }
      else if (node.status === "unresolved") {
        this.error = "Approaches are not generated for this path yet. Press Enter (empty submit) to generate them, choose 1-7, then press D.";
      }
      else {
        this.error = `This path is ${node.status}; only a path with a chosen approach can be expanded with F.`;
      }
      return;
    }
    await this.dispatch("Expanding approach into files", async () => {
      const response = await this.server.handle({ jsonrpc: "2.0", id: 4, method: "refine", params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature, lod } });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      this.message = "Planned files ready. Select a file and press D again to draft it.";
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
      for (const diff of diffs) if (diff.patch.trim().length > 0) this.appliedDiffIds.add(diff.id);
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
          params: { taskId: current.id, expectedRevision: current.revision, nodeId, temperature: "normal", lod: this.defaultLod, replace: true, challengeRounds: this.challengeRounds },
        });
        this.task = expectResult(regenerated, PlanTaskLike.is) as PlanTask;
        await this.adoptSingletonIfViable(nodeId);
        this.refresh();
        this.selectNodeEntry(nodeId);
        this.message = this.task.nodes[nodeId]?.status === "collapsed"
          ? "Approaches updated from your message; single viable approach adopted. Press D to develop it."
          : "Approaches updated from your message. Choose one with keys 1-7.";
      } else {
        this.selectNodeEntry(nodeId);
        this.message = `Message saved for ${targetPath}. No model is configured to regenerate it.`;
      }
    }, nodeId);
  }

  /**
   * Develops the selected path one step: a collapsed node expands into files,
   * a refined folder or root advances to its next undrafted file and drafts
   * it, and a planned file drafts its patch. The distinctions the TUI used
   * to expose as separate keys are just the node's lifecycle state.
   */
  async develop(): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    const node = task.nodes[nodeId];
    if (!node) {
      this.error = "Select a path to develop.";
      return;
    }
    if (node.status === "collapsed") return this.refine();
    const isFileTarget = ["file", "hunk", "virtual"].includes(node.kind);
    if (isFileTarget && node.diffIds.length === 0 && !["stale", "blocked"].includes(node.status)) return this.draftPatch();
    if (node.diffIds.length > 0) {
      this.error = "This path already has a drafted patch. Press [A] to apply it, or [O] to reopen it.";
      return;
    }
    if (!isFileTarget && ["refined", "ready"].includes(node.status)) {
      const target = Object.values(task.nodes).find((candidate) => {
        if (!["file", "hunk", "virtual"].includes(candidate.kind) || candidate.diffIds.length > 0) return false;
        let ancestor = candidate.parent;
        while (ancestor) {
          if (ancestor === nodeId) return true;
          ancestor = task.nodes[ancestor]?.parent;
        }
        return false;
      });
      if (!target?.path) {
        this.error = "Every file under this path is drafted. [A] applies them; [O] reopens this path.";
        return;
      }
      this.select(`entry:${target.path}`);
      return this.draftPatch();
    }
    if (node.status === "domain") {
      const possible = node.candidateIds.map((id) => task.candidates[id]).filter((candidate) => candidate?.status === "possible");
      this.error = possible.length
        ? `Choose one of ${possible.length} approaches with keys 1-${possible.length} first, or press Enter to rethink.`
        : "Press Enter (empty submit) to generate approaches for this path.";
      return;
    }
    if (node.status === "unresolved") {
      this.error = "Press Enter (empty submit) to generate approaches for this path.";
      return;
    }
    this.error = `Nothing to develop here: this path is ${node.status}.`;
  }

  async rethink(message?: string): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    const node = task.nodes[nodeId];
    if (!node) return;
    const text = message?.trim();
    if (!this.runtime) {
      if (!text) {
        this.error = "No model is configured; there is nothing to rethink.";
        return;
      }
      const row = this.selectedRow();
      await this.dispatch("Saving message", async () => {
        const constrained = await this.server.handle({
          jsonrpc: "2.0",
          id: 18,
          method: "node/constrain",
          params: { taskId: task.id, expectedRevision: task.revision, nodeId, path: row?.entry.path && row.entry.path !== "." ? row.entry.path : undefined, text },
        });
        this.task = expectResult(constrained, PlanTaskLike.is) as PlanTask;
        this.refresh();
        this.message = `Message saved for ${row?.entry.path ?? "the task"}. No model is configured to regenerate it.`;
      }, nodeId);
      return;
    }
    await this.dispatch("Rethinking selected path", async () => {
      let current = task;
      if (text) {
        const row = this.selectedRow();
        const constrained = await this.server.handle({
          jsonrpc: "2.0",
          id: 16,
          method: "node/constrain",
          params: { taskId: current.id, expectedRevision: current.revision, nodeId, path: row?.entry.path && row.entry.path !== "." ? row.entry.path : undefined, text },
        });
        current = expectResult(constrained, PlanTaskLike.is) as PlanTask;
      }
      if (current.nodes[nodeId]?.selectedCandidateId || Object.values(current.nodes).some((child) => child.parent === nodeId)) {
        const reopened = await this.server.handle({ jsonrpc: "2.0", id: 10, method: "node/reopen", params: { taskId: current.id, expectedRevision: current.revision, nodeId, reason: text ? `Rethink: ${text}` : "Operator requested a rethink" } });
        current = expectResult(reopened, PlanTaskLike.is) as PlanTask;
      }
      const regenerated = await this.server.handle({ jsonrpc: "2.0", id: 11, method: "crystallize", params: { taskId: current.id, expectedRevision: current.revision, nodeId, temperature: "normal", lod: this.defaultLod, replace: true, challengeRounds: this.challengeRounds } });
      this.task = expectResult(regenerated, PlanTaskLike.is) as PlanTask;
      await this.adoptSingletonIfViable(nodeId);
      this.refresh();
      this.selectNodeEntry(nodeId);
      const adopted = this.task.nodes[nodeId]?.status === "collapsed";
      if (text) this.message = adopted ? "Approaches regenerated from your note; single viable approach adopted. Press D to develop it." : "Approaches regenerated from your note. Choose one with keys 1-7.";
      else this.message = adopted ? "Approaches regenerated; single viable approach adopted. Press D to develop it." : "Approaches regenerated. Choose one with keys 1-7.";
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

  /**
   * The single restriction control. Pressing the other polarity inverts the
   * plain (the marked set stays, its meaning flips); pressing the current
   * polarity toggles the selected path's mark. On the repository root only
   * the polarity flips — that is the invert action.
   */
  async toggleRestriction(mode: "lock" | "allow"): Promise<void> {
    const row = this.selectedRow();
    const targetPath = row?.entry.path && row.entry.path !== "." ? row.entry.path : undefined;
    if (!this.task) {
      const inverts = this.pendingMode !== mode && this.pendingMarks.length > 0;
      this.pendingMode = mode;
      if (!inverts && targetPath) {
        this.pendingMarks = this.pendingMarks.includes(targetPath)
          ? this.pendingMarks.filter((mark) => mark !== targetPath)
          : [...this.pendingMarks, targetPath];
      }
      const noun = this.pendingMode === "lock" ? "Locked" : "Allowed";
      this.message = this.pendingMarks.length
        ? `${noun}: ${this.pendingMarks.join(", ")}`
        : this.pendingMode === "lock" ? "No marks; everything may change." : "Allow mode with no marks; nothing may change.";
      return;
    }
    const modeChanged = this.task.restrictionMode !== mode;
    const inverts = modeChanged && this.task.lockedPaths.length > 0;
    const marked = targetPath ? this.task.lockedPaths.includes(targetPath) : false;
    await this.dispatch(inverts ? `Inverting to ${mode} mode` : marked ? "Unmarking path" : "Marking path", async () => {
      const response = await this.server.handle({
        jsonrpc: "2.0",
        id: 22,
        method: "path/restrict",
        params: { taskId: this.task!.id, expectedRevision: this.task!.revision, path: inverts ? undefined : targetPath, mode, marked: targetPath !== undefined && !inverts ? !marked : undefined },
      });
      this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
      this.refresh();
      const polarity = this.task.restrictionMode === "lock" ? "locked" : "allowed";
      this.message = this.task.lockedPaths.length
        ? `${polarity[0]!.toUpperCase()}${polarity.slice(1)}: ${this.task.lockedPaths.join(", ")}`
        : "No marked paths; everything may change.";
    });
  }

  /**
   * Commits only the paths this session applied — never unrelated dirty or
   * staged work — on explicit request.
   */
  async commitApplied(): Promise<void> {
    const task = this.requireTask();
    const applied = [...this.appliedDiffIds].flatMap((id) => (task.diffs[id] ? [task.diffs[id]!] : []));
    if (!applied.length) {
      this.error = "Nothing applied this session. Press [A] to apply a drafted patch first.";
      return;
    }
    const paths = [...new Set(applied.map((diff) => diff.path).filter((path) => path && path !== "."))];
    await this.dispatch("Committing applied changes", async () => {
      const sha = commitAppliedPaths(this.directory, paths, `augment: ${task.objective}`);
      this.repository = repositoryTree(this.directory);
      this.refresh();
      this.message = `Committed ${paths.length} applied ${paths.length === 1 ? "path" : "paths"} as ${sha}. The repository basis moved; press [S] on paths whose drafts need refresh.`;
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

  /**
   * A domain with exactly one possible candidate and no unproven omissions is
   * adopted automatically: the model already decided only one approach is
   * viable, so asking the user to press 1 over 1 is ceremony. The kernel still
   * records the selection through node/select.
   */
  private async adoptSingletonIfViable(nodeId: string): Promise<void> {
    const task = this.task;
    if (!task) return;
    const node = task.nodes[nodeId];
    if (!node || node.status !== "domain" || node.challengeExhausted) return;
    const possible = node.candidateIds.map((id) => task.candidates[id]).filter((candidate) => candidate?.status === "possible");
    if (possible.length !== 1) return;
    const response = await this.server.handle({
      jsonrpc: "2.0",
      id: 17,
      method: "node/select",
      params: { taskId: task.id, expectedRevision: task.revision, nodeId, candidateId: possible[0]!.id },
    });
    this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
    this.refresh();
  }

  private selectNodeEntry(nodeId: string): void {
    const path = this.task?.nodes[nodeId]?.path;
    if (path && this.rows.some((row) => row.id === `entry:${path}`)) this.selectedRowId = `entry:${path}`;
  }

  private refresh(): void {
    this.rows = this.task ? plannedTreeRows(this.task, this.repository) : plannedTreeRowsFromRepository(this.repository);
    if (this.rows.length && !this.rows.some((row) => row.id === this.selectedRowId)) this.selectedRowId = this.rows[0]!.id;
    if (this.persistTasks && this.task) {
      const others = loadStoredTasks().filter((entry) => entry.task.id !== this.task!.id);
      const entries = [...others, { task: this.task, appliedDiffIds: [...this.appliedDiffIds], savedAt: Date.now() }]
        .sort((left, right) => right.savedAt - left.savedAt)
        .slice(0, MAX_STORED_TASKS);
      saveStoredTasks(entries);
    }
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
