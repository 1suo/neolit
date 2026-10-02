import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AugmentServer, type JsonRpcResponse } from "../augmentd/server.js";
import { serveAugmentSocket, type SocketService } from "../augmentd/socket.js";
import { nextDevelopmentStep, undraftedFileTargets } from "../augment/kernel.js";
import { pathIsLocked, planTree } from "../augment/state.js";
import { applyPlannedDiffs, commitAppliedPaths } from "./apply.js";
import type { LOD, ModelRuntime, PlanCandidate, PlanNode, PlanTask, PlanTreeEntry, Temperature } from "../augment/types.js";

export type PlannedTreeRow = {
  kind: "entry";
  id: string;
  depth: number;
  branch: string;
  entry: PlanTreeEntry;
  repositoryOnly: boolean;
  /** Directory rows currently folded shut. */
  folded?: boolean;
};

/** View-only tree options: folded directories and the related-only filter. */
export interface TreeViewOptions {
  foldedPaths: ReadonlySet<string>;
  relatedOnly: boolean;
  /** Plan- or plain-aware relatedness test; required when relatedOnly is set. */
  isRelated?: (entry: PlanTreeEntry) => boolean;
}

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
  relatedOnly: boolean;
  active?: { nodeId?: string; operation?: string };
  failed?: { nodeId?: string; operation?: string; error?: string };
  /** Socket address external agents attach to (`augmentd --mcp --connect …`). */
  socketPath?: string;
}

export interface AugmentTuiControllerOptions {
  directory: string;
  runtime?: ModelRuntime;
  defaultLod?: LOD;
  /** Persist the active task to disk and resume the newest one on start. */
  persistTasks?: boolean;
  /** Challenge rounds per crystallize (0-2); defaults to the environment. */
  challengeRounds?: number;
  /** Serve the embedded server on the agent socket so external MCP agents share this task store. `true`/undefined uses the default address; a string is an explicit path. */
  serveSocket?: boolean | string;
}

const MAX_REPOSITORY_ENTRIES = 5_000;

/** Deterministic bound for one [D] keypress: enough for any legal subtree. */
const MAX_DEVELOP_STEPS = 256;

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

function rowsFromTree(root: PlanTreeEntry, view: TreeViewOptions): PlannedTreeRow[] {
  const rows: PlannedTreeRow[] = [];
  // Related-only pruning keeps an entry when it is related itself or when any
  // descendant is, so kept paths stay reachable through their ancestors.
  const keepsSubtree = (entry: PlanTreeEntry): boolean => {
    if (!view.relatedOnly) return true;
    if (entry.path === ".") return true;
    if (view.isRelated?.(entry)) return true;
    return entry.children.some(keepsSubtree);
  };
  const visit = (entry: PlanTreeEntry, depth: number, branch: string, prefix: string) => {
    const folded = entry.kind === "dir" && view.foldedPaths.has(entry.path);
    rows.push({ kind: "entry", id: `entry:${entry.path}`, depth, branch, entry, repositoryOnly: !entryHasPlan(entry), folded: folded || undefined });
    if (folded) return;
    const visibleChildren = entry.children.filter((child) => keepsSubtree(child));
    visibleChildren.forEach((child, index) => {
      const last = index === visibleChildren.length - 1;
      visit(child, depth + 1, `${prefix}${last ? "└─ " : "├─ "}`, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  visit(root, 0, "", "");
  return rows;
}

export function plannedTreeRowsFromRepository(repository: PlanTreeEntry, view?: TreeViewOptions): PlannedTreeRow[] {
  return rowsFromTree(repository, view ?? { foldedPaths: new Set(), relatedOnly: false });
}

export function plannedTreeRows(task: PlanTask, repository?: PlanTreeEntry, view?: TreeViewOptions): PlannedTreeRow[] {
  const plan = planTree(task);
  const root = repository ? mergePlanTree(structuredClone(repository), plan) : plan;
  aggregateSubtree(root);
  return rowsFromTree(root, view ?? { foldedPaths: new Set(), relatedOnly: false });
}

export function candidatesForEntry(task: PlanTask | undefined, entry: PlanTreeEntry | undefined): PlanCandidate[] {
  if (!task || !entry) return [];
  return entry.candidateIds.map((id) => task.candidates[id]).filter(Boolean);
}

export class AugmentTuiController {
  readonly directory: string;
  private readonly runtime?: ModelRuntime;
  /** The embedded protocol server; hosts may serve it on additional transports. */
  readonly server: AugmentServer;
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
  private readonly foldedPaths = new Set<string>();
  private relatedOnly = false;
  private readonly listeners = new Set<() => void>();
  private socket?: SocketService;

  constructor(options: AugmentTuiControllerOptions) {
    this.directory = options.directory;
    this.runtime = options.runtime;
    this.server = new AugmentServer({ runtime: options.runtime });
    this.defaultLod = options.defaultLod ?? "file";
    const rounds = options.challengeRounds ?? Number(process.env.AUGMENT_CHALLENGE_ROUNDS);
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
    this.watchExternalMutations();
    const socketEnv = process.env.AUGMENT_TUI_SOCKET?.trim();
    const explicitSocket = typeof options.serveSocket === "string" && options.serveSocket.trim()
      ? options.serveSocket.trim()
      : socketEnv || undefined;
    if (options.serveSocket !== false && process.env.AUGMENT_TUI_NO_SOCKET !== "1") {
      // Best-effort: an unusable address just means this TUI keeps working
      // without an external agent channel.
      void serveAugmentSocket(this.server, explicitSocket).then(
        (service) => {
          this.socket = service;
          this.refresh();
        },
        () => {
          // Another instance owns the socket, or the address is unusable;
          // the TUI itself is unaffected.
        },
      );
    }
    this.refresh();
  }

  /** Re-render subscription for hosts (React) that do not poll. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Records a UI-level failure on the controller itself, so a repaint
   * triggered by an external agent mutation does not erase it.
   */
  report(error: string): void {
    this.error = error;
    this.refresh();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // a broken listener must not break refresh
      }
    }
  }

  /** Stops serving external agents; the TUI's own state is untouched. */
  async dispose(): Promise<void> {
    await this.socket?.close();
    this.socket = undefined;
    this.refresh();
  }

  /**
   * External mutations (an agent driving this task over the socket) adopt
   * the server's authoritative task and repaint. The controller's own
   * operations already carry their responses, so changes are only adopted
   * while idle; a change that lands mid-operation is adopted when that
   * operation ends — which also means the operation itself may fail the
   * optimistic-concurrency check with the typed stale-revision error.
   */
  private externalPending = false;

  private watchExternalMutations(): void {
    this.server.onChange(async (change) => {
      if (!this.task || change.taskId !== this.task.id) return;
      if (this.busy) {
        this.externalPending = true;
        return;
      }
      await this.adoptExternalTask();
    });
  }

  private async adoptExternalTask(): Promise<void> {
    const active = this.task;
    if (!active || this.busy) return;
    const response = await this.server.handle({ jsonrpc: "2.0", id: 31, method: "task/get", params: { taskId: active.id } });
    if (!response || "error" in response || !this.task || this.busy || this.task.id !== active.id) return;
    const fetched = response.result as PlanTask;
    if (fetched.revision <= this.task.revision) return;
    this.task = fetched;
    if (!this.error) this.message = `Agent update rendered (r${fetched.revision}).`;
    this.refresh();
  }

  /** The active agent backend, for hosts that offer live model switching. */
  runtimeAgent(): { backendId: string; command: string } | undefined {
    const runtime = this.runtime as { backendId?: string; commandName?: string } | undefined;
    return runtime?.backendId && runtime?.commandName ? { backendId: runtime.backendId, command: runtime.commandName } : undefined;
  }

  /** Reconfigure the live runtime's models without restarting the session. */
  configureModels(update: { model?: string; draftModel?: string; challengeModel?: string }): void {
    const runtime = this.runtime as { setModels?: (update: { model?: string; draftModel?: string; challengeModel?: string }) => void } | undefined;
    if (!runtime?.setModels) {
      this.error = "The active runtime does not support live model switching.";
      return;
    }
    runtime.setModels(update);
    const changed = Object.entries(update).filter(([, value]) => value !== undefined).map(([role, value]) => `${role}=${value}`);
    this.message = `Models updated: ${changed.join(", ")}`;
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
      relatedOnly: this.relatedOnly,
      active: this.busy ? { nodeId: this.activeNodeId, operation: this.operation } : undefined,
      failed: this.failedNodeId ? { nodeId: this.failedNodeId, operation: this.failedOperation, error: this.failedError } : undefined,
      socketPath: this.socket?.path,
    };
  }

  selectedRow(): PlannedTreeRow | undefined {
    return this.rows.find((row) => row.id === this.selectedRowId);
  }

  selectedNodeId(): string | undefined {
    const row = this.selectedRow();
    if (!row) return this.task?.rootNodeId;
    // Folder rows aggregate descendant node ids; the row's OWN node (path
    // equal to the row path) must win, or "regenerate this folder" would
    // silently target its first child file instead.
    const own = row.entry.nodeIds.find((id) => this.task?.nodes[id]?.path === row.entry.path);
    return own ?? row.entry.nodeIds[0] ?? this.task?.rootNodeId;
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

  /**
   * An entry is related when the plan touches it (nodes, candidates, diffs,
   * explanations, obligations) or when the restriction plain references it —
   * the entry itself is marked, or a marked path sits above or below it so
   * the structure stays connected.
   */
  private isRelatedEntry(entry: PlanTreeEntry): boolean {
    if (entryHasPlan(entry)) return true;
    const marked = this.task?.lockedPaths ?? this.pendingMarks;
    if (!marked.length || entry.path === ".") return false;
    return marked.some((mark) => entry.path === mark || entry.path.startsWith(`${mark}/`) || mark.startsWith(`${entry.path}/`));
  }

  private viewOptions(): TreeViewOptions {
    return { foldedPaths: this.foldedPaths, relatedOnly: this.relatedOnly, isRelated: (entry) => this.isRelatedEntry(entry) };
  }

  /** Folds or unfolds the selected directory, keeping selection on the folder. */
  toggleFold(): void {
    const row = this.selectedRow();
    if (!row || (row.entry.kind !== "dir" && row.entry.kind !== "root")) {
      this.error = "Select a directory to fold.";
      return;
    }
    this.error = undefined;
    if (row.entry.path === ".") {
      this.error = "The repository root cannot be folded.";
      return;
    }
    if (this.foldedPaths.has(row.entry.path)) {
      this.foldedPaths.delete(row.entry.path);
      this.message = `Unfolded ${row.entry.path}/.`;
    } else {
      this.foldedPaths.add(row.entry.path);
      this.message = `Folded ${row.entry.path}/.`;
    }
    this.refresh();
    if (!this.rows.some((candidate) => candidate.id === this.selectedRowId)) this.select(`entry:${row.entry.path}`);
  }

  /** Shows only planned and restriction-plain paths, or the full repository. */
  toggleRelatedOnly(): void {
    this.relatedOnly = !this.relatedOnly;
    this.error = undefined;
    this.refresh();
    this.message = this.relatedOnly
      ? "Showing only planned and marked paths. [H] shows the full repository again."
      : "Showing the full repository tree.";
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

  private async performCrystallize(nodeId: string, temperature: Temperature, lod: LOD): Promise<void> {
    const task = this.task!;
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
  }

  async crystallize(temperature: Temperature = "normal", lod: LOD = this.defaultLod): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    await this.dispatch("Generating approaches", () => this.performCrystallize(nodeId, temperature, lod), nodeId);
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

  private async performRefine(nodeId: string, temperature: Temperature, lod: LOD): Promise<void> {
    const task = this.task!;
    const response = await this.server.handle({ jsonrpc: "2.0", id: 4, method: "refine", params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature, lod } });
    this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
    this.refresh();
    this.selectFirstChild(nodeId);
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
        this.error = `This path is ${node.status}; only a path with a chosen approach can be developed with [D].`;
      }
      return;
    }
    await this.dispatch("Expanding approach into files", () => this.performRefine(nodeId, temperature, lod), nodeId);
  }

  private async performDraft(nodeId: string): Promise<void> {
    const task = this.task!;
    const response = await this.server.handle({ jsonrpc: "2.0", id: 5, method: "patch/draft", params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature: "low" } });
    this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
    this.refresh();
    this.message = "Draft change ready. It is not applied to the repository.";
  }

  async draftPatch(): Promise<void> {
    const task = this.requireTask();
    const row = this.selectedRow();
    const nodeId = row?.entry.nodeIds.find((id) => ["file", "hunk", "virtual"].includes(task.nodes[id]?.kind ?? "")) ?? this.selectedNodeId();
    if (!nodeId) {
      this.error = "Select a file, hunk, or virtual node.";
      return;
    }
    await this.dispatch("Drafting selected change", () => this.performDraft(nodeId), nodeId);
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
    // A file target rethinks its patch, never an approach domain.
    if (this.isFileTargetNode(nodeId)) return this.rethinkFileDraft(nodeId, text.trim());
    if (this.draftedSubtreeCount(nodeId) > 0) {
      this.error = `${this.draftedSubtreeCount(nodeId)} drafted ${this.draftedSubtreeCount(nodeId) === 1 ? "file" : "files"} under ${targetPath} would be discarded by regenerating here. [O] reopens explicitly; Enter on a single file rethinks just its patch.`;
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
   * One batched draft call for every undrafted file under a node: the model
   * answers all targets in a single prompt. Returns how many drafts landed.
   */
  private async performBatchDraft(nodeId: string): Promise<number> {
    const task = this.task!;
    const before = Object.keys(task.diffs).length;
    const response = await this.server.handle({
      jsonrpc: "2.0",
      id: 26,
      method: "patch/draft-batch",
      params: { taskId: task.id, expectedRevision: task.revision, nodeId, temperature: "low" },
    });
    this.task = expectResult(response, PlanTaskLike.is) as PlanTask;
    this.refresh();
    return Object.keys(this.task.diffs).length - before;
  }

  /**
   * Develops the selected path as far as deterministic policy allows: the
   * kernel's `nextDevelopmentStep` is applied repeatedly — refine, then
   * crystallize, refine, and draft every undrafted file beneath the path —
   * until the subtree is fully drafted or a step needs a human (an approach
   * choice). Files are drafted in ONE batched model call when possible; a
   * failed batch or file falls back to individual drafts, and one file's
   * failure never stops the rest — failures are marked × and summarized.
   */
  async develop(): Promise<void> {
    const task = this.requireTask();
    const row = this.selectedRow();
    if (row && ["file", "hunk"].includes(row.entry.kind) && !row.entry.nodeIds.some((id) => this.task?.nodes[id])) {
      this.error = `${row.entry.path} has no plan node of its own yet. [D] an ancestor folder to develop its subtree, or [Enter] to rethink the plan.`;
      return;
    }
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    const startPath = task.nodes[nodeId]?.path ?? "this path";
    const remaining = () => (this.task ? undraftedFileTargets(this.task, nodeId).length : 0);
    let drafted = 0;
    let failed = 0;
    let acted = false;
    let batchTried = false;
    let lastDraftedPath = startPath;
    const failedNodes = new Set<string>();
    const draftLabel = () => `Drafting (${drafted + failed + 1}/${drafted + failed + remaining()})`;
    const recordDraftFailure = (failedNodeId: string) => {
      failedNodes.add(failedNodeId);
      failed += 1;
      drafted -= 1;
      // Keep the × mark and failed panel content; only clear the halting error
      // so the run continues with the remaining files.
      this.error = undefined;
    };
    const finish = (stopped: string | undefined): void => {
      if (failed > 0) {
        this.error = drafted > 0
          ? `Drafted ${drafted} ${drafted === 1 ? "file" : "files"}; ${failed} failed (marked ×) — press [D] to retry the failures.`
          : `All ${failed} drafts failed (marked ×) — press [D] to retry.`;
        return;
      }
      if (stopped !== undefined) {
        this.error = stopped;
        return;
      }
      if (drafted > 1) this.message = `Developed ${drafted} files under ${startPath}. Nothing is applied yet; [A] applies them.`;
      else if (drafted === 1) this.message = `Draft change ready for ${lastDraftedPath}. It is not applied to the repository.`;
      else if (acted) this.message = `Developed ${startPath}. [A] applies drafted changes; [D] continues deeper.`;
      else this.error = "Every file under this path is drafted. [A] applies them; [O] reopens this path.";
    };
    for (let guard = 0; guard < MAX_DEVELOP_STEPS; guard++) {
      if (!this.task) return;
      const step = nextDevelopmentStep(this.task, nodeId);
      if (step.action === "refine") {
        acted = true;
        await this.dispatch("Expanding approach into files", () => this.performRefine(nodeId, "normal", this.defaultLod), nodeId);
      } else if (step.action === "crystallize") {
        acted = true;
        await this.dispatch("Generating approaches", () => this.performCrystallize(nodeId, "normal", this.defaultLod), nodeId);
      } else if (step.action === "draft") {
        if (failedNodes.has(nodeId)) {
          finish(undefined);
          return;
        }
        acted = true;
        drafted += 1;
        lastDraftedPath = this.task.nodes[nodeId]?.path ?? startPath;
        await this.dispatch(draftLabel(), () => this.performDraft(nodeId), nodeId);
        if (this.error) recordDraftFailure(nodeId);
      } else if (step.action === "descend") {
        this.select(`entry:${step.path}`);
        if (step.step === "draft") {
          // A file that already failed this run is not retried this run: move
          // to the next undrafted target instead of spinning on it.
          if (failedNodes.has(step.nodeId)) {
            const next = undraftedFileTargets(this.task!, nodeId).find((target) => !failedNodes.has(target.id));
            if (!next?.path) {
              finish(undefined);
              return;
            }
            this.select(`entry:${next.path}`);
            acted = true;
            drafted += 1;
            lastDraftedPath = next.path;
            await this.dispatch(draftLabel(), () => this.performDraft(next.id), next.id);
            if (this.error) recordDraftFailure(next.id);
            continue;
          }
          if (!batchTried && remaining() >= 2) {
            // One prompt for every undrafted file under the start node: the
            // model sees the whole subtree at once and one call replaces N.
            batchTried = true;
            acted = true;
            const targets = remaining();
            await this.dispatch(`Drafting ${targets} files in one prompt`, async () => {
              const landed = await this.performBatchDraft(nodeId);
              drafted += landed;
              lastDraftedPath = startPath;
            }, nodeId);
            if (this.error) this.error = undefined; // fall back to per-file drafts below
            continue;
          }
          acted = true;
          drafted += 1;
          lastDraftedPath = step.path;
          await this.dispatch(draftLabel(), () => this.performDraft(step.nodeId), step.nodeId);
          if (this.error) recordDraftFailure(step.nodeId);
        } else if (step.step === "crystallize") {
          acted = true;
          await this.dispatch("Generating approaches", () => this.performCrystallize(step.nodeId, "normal", this.defaultLod), step.nodeId);
        } else if (step.step === "refine") {
          acted = true;
          await this.dispatch("Expanding approach into files", () => this.performRefine(step.nodeId, "normal", this.defaultLod), step.nodeId);
        } else {
          finish(drafted + failed > 0
            ? `Drafted ${drafted + failed} ${drafted + failed === 1 ? "file" : "files"} under ${startPath}. Choose an approach for ${step.path} with keys 1-7 to develop deeper.`
            : `Choose an approach for ${step.path} with keys 1-7, or press Enter to rethink it.`);
          return;
        }
      } else if (step.action === "choose") {
        finish(`Choose one of ${step.count} approaches with keys 1-${step.count}, or press Enter to rethink.`);
        return;
      } else if (step.action === "done" || step.action === "already-drafted") {
        if (failed === 0 && drafted === 0 && step.action === "already-drafted") { this.error = "This path already has a drafted patch. Press [A] to apply it, or [O] to reopen it."; return; }
        finish(step.action === "already-drafted" && failed === 0 && !acted ? "This path already has a drafted patch. Press [A] to apply it, or [O] to reopen it." : undefined);
        return;
      } else {
        this.error = step.reason;
        return;
      }
      // A failure in a non-draft step (refine, crystallize) stops the run.
      if (this.error) return;
    }
    this.error = `Developing ${startPath} exceeded ${MAX_DEVELOP_STEPS} steps; press [D] to continue.`;
  }

  async rethink(message?: string): Promise<void> {
    const task = this.requireTask();
    const nodeId = this.selectedNodeId() ?? task.rootNodeId;
    const node = task.nodes[nodeId];
    if (!node) return;
    const text = message?.trim();
    // Enter on a file target rethinks its patch, never its approach domain:
    // approaches are for root and folders; files answer with a diff.
    if (this.runtime && this.isFileTargetNode(nodeId)) return this.rethinkFileDraft(nodeId, text);
    if (!this.isFileTargetNode(nodeId) && this.draftedSubtreeCount(nodeId) > 0) {
      const drafted = this.draftedSubtreeCount(nodeId);
      this.error = `${drafted} drafted ${drafted === 1 ? "file" : "files"} under ${node.path ?? "this path"} would be discarded by rethinking it. [O] reopens explicitly (it asks a reason); Enter on a single file rethinks just its patch.`;
      return;
    }
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

  /** A file, hunk, or virtual node develops and rethinks by drafting its patch. */
  private isFileTargetNode(nodeId: string | undefined): boolean {
    return ["file", "hunk", "virtual"].includes(this.task?.nodes[nodeId ?? ""]?.kind ?? "");
  }

  /** Drafts on the node and its descendants — what an auto-reopen would destroy. */
  private draftedSubtreeCount(nodeId: string): number {
    const task = this.task;
    if (!task) return 0;
    let count = 0;
    for (const node of Object.values(task.nodes)) {
      let ancestor: string | undefined = node.id === nodeId ? node.id : node.parent;
      while (ancestor && ancestor !== nodeId) ancestor = task.nodes[ancestor]?.parent;
      if (ancestor === nodeId) count += node.diffIds.length;
    }
    return count;
  }

  /**
   * Enter on a file target: the message (if any) is saved as a constraint on
   * the node, then the patch is drafted — or, when one exists, repaired with
   * the message as the grounding reason. Never generates approach domains.
   */
  private async rethinkFileDraft(nodeId: string, text?: string): Promise<void> {
    const task = this.requireTask();
    await this.dispatch(text ? "Rethinking file draft from your note" : "Rethinking file draft", async () => {
      let current = task;
      if (text) {
        const row = this.selectedRow();
        const constrained = await this.server.handle({
          jsonrpc: "2.0",
          id: 23,
          method: "node/constrain",
          params: { taskId: current.id, expectedRevision: current.revision, nodeId, path: row?.entry.path && row.entry.path !== "." ? row.entry.path : undefined, text },
        });
        current = expectResult(constrained, PlanTaskLike.is) as PlanTask;
        this.task = current;
      }
      const node = current.nodes[nodeId]!;
      const reason = text ? `Rethink: ${text}` : "Operator requested a rethink";
      if (node.diffIds.length > 0) {
        const repaired = await this.server.handle({
          jsonrpc: "2.0",
          id: 24,
          method: "patch/repair",
          params: { taskId: current.id, expectedRevision: current.revision, diffId: node.diffIds.at(-1), failedCheck: reason, temperature: "low" },
        });
        current = expectResult(repaired, PlanTaskLike.is) as PlanTask;
      } else {
        const drafted = await this.server.handle({
          jsonrpc: "2.0",
          id: 25,
          method: "patch/draft",
          params: { taskId: current.id, expectedRevision: current.revision, nodeId, temperature: "low" },
        });
        current = expectResult(drafted, PlanTaskLike.is) as PlanTask;
      }
      this.task = current;
      this.refresh();
      this.selectNodeEntry(nodeId);
      this.message = text ? "Patch regenerated from your note. It is not applied to the repository." : "Patch regenerated. It is not applied to the repository.";
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
    const view = this.viewOptions();
    this.rows = this.task ? plannedTreeRows(this.task, this.repository, view) : plannedTreeRowsFromRepository(this.repository, view);
    if (this.rows.length && !this.rows.some((row) => row.id === this.selectedRowId)) this.selectedRowId = this.rows[0]!.id;
    if (this.persistTasks && this.task) {
      const others = loadStoredTasks().filter((entry) => entry.task.id !== this.task!.id);
      const entries = [...others, { task: this.task, appliedDiffIds: [...this.appliedDiffIds], savedAt: Date.now() }]
        .sort((left, right) => right.savedAt - left.savedAt)
        .slice(0, MAX_STORED_TASKS);
      saveStoredTasks(entries);
    }
    this.notify();
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
      if (this.externalPending) {
        this.externalPending = false;
        void this.adoptExternalTask();
      }
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
