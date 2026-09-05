import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface RepositoryToolResponse {
  value: unknown;
  repositoryReadChars: number;
  duplicateReadCharsAvoided: number;
}

export type MeasurementGateStatus = "passed" | "partial" | "failed";

export interface MeasurementGateSnapshot {
  source: "fixture-baseline" | "deterministic-harness" | "measured-run";
  phase: "baseline" | "typed-packet" | "scoped-read";
  semanticOutcome: string;
  promptChars: number;
  accumulatedSessionInput: number;
  repositoryOutputChars?: number;
  otherToolOutputChars?: number;
  duplicateReadCharsAvoided?: number;
  reachedCouplingPhase?: boolean;
}

export interface MeasurementGateEvaluation {
  status: MeasurementGateStatus;
  reasons: string[];
}

export function evaluateMeasurementGate(baseline: MeasurementGateSnapshot, typedPacket?: MeasurementGateSnapshot, scopedRead?: MeasurementGateSnapshot): MeasurementGateEvaluation {
  const failures: string[] = [];
  const missing: string[] = [];
  if (baseline.source !== "fixture-baseline" || baseline.phase !== "baseline") failures.push("Baseline must be the fixture-baseline baseline phase.");
  for (const metric of ["repositoryOutputChars", "otherToolOutputChars", "duplicateReadCharsAvoided"] as const) {
    if (typeof baseline[metric] !== "number") missing.push(`baseline ${metric} is missing; the historical comparison cannot complete.`);
  }
  if (!typedPacket) missing.push("Measured typed-packet run is missing.");
  else if (typedPacket.source !== "measured-run" || typedPacket.phase !== "typed-packet") failures.push("Typed-packet input must come from a real measured-run typed-packet phase.");
  if (!scopedRead) missing.push("Measured scoped-read run is missing.");
  else if (scopedRead.source !== "measured-run" || scopedRead.phase !== "scoped-read") failures.push("Scoped-read input must come from a real measured-run scoped-read phase.");
  if (!typedPacket || !scopedRead) return { status: failures.length ? "failed" : "partial", reasons: [...failures, ...missing] };

  if (typedPacket.semanticOutcome !== baseline.semanticOutcome || scopedRead.semanticOutcome !== baseline.semanticOutcome) failures.push("Semantic outcomes are not equivalent across all phases.");
  if (typedPacket.promptChars >= baseline.promptChars) failures.push("Typed-packet prompt characters are not lower than baseline.");
  if (scopedRead.promptChars >= typedPacket.promptChars) failures.push("Scoped-read prompt characters are not lower than typed-packet.");
  for (const metric of ["repositoryOutputChars", "otherToolOutputChars", "duplicateReadCharsAvoided"] as const) {
    for (const [name, snapshot] of [["typed-packet", typedPacket], ["scoped-read", scopedRead]] as const) {
      if (typeof snapshot[metric] !== "number") missing.push(`${name} ${metric} is missing; the historical comparison cannot complete.`);
    }
  }
  if (!missing.length) {
    if (typedPacket.repositoryOutputChars! >= baseline.repositoryOutputChars! || scopedRead.repositoryOutputChars! >= typedPacket.repositoryOutputChars!) failures.push("Repository output characters are not lower in each phase.");
    if (typedPacket.otherToolOutputChars! >= baseline.otherToolOutputChars! || scopedRead.otherToolOutputChars! >= typedPacket.otherToolOutputChars!) failures.push("Other-tool output characters are not lower in each phase.");
    if (typedPacket.duplicateReadCharsAvoided! <= baseline.duplicateReadCharsAvoided! || scopedRead.duplicateReadCharsAvoided! <= typedPacket.duplicateReadCharsAvoided!) failures.push("Duplicate-read avoidance is not higher in each phase.");
  }
  if (typedPacket.accumulatedSessionInput >= baseline.accumulatedSessionInput || scopedRead.accumulatedSessionInput >= typedPacket.accumulatedSessionInput) failures.push("Accumulated session input is not strictly lower in each phase.");
  if (!typedPacket.reachedCouplingPhase || !scopedRead.reachedCouplingPhase) failures.push("Both measured runs must progress through challenge, select, and refine coupling phases.");
  return { status: failures.length ? "failed" : missing.length ? "partial" : "passed", reasons: [...failures, ...missing] };
}

export function compareMeasurementGate(baseline: MeasurementGateSnapshot, typedPacket: MeasurementGateSnapshot, scopedRead?: MeasurementGateSnapshot): MeasurementGateStatus {
  return evaluateMeasurementGate(baseline, typedPacket, scopedRead).status;
}

export function assessScopedReadReplay(
  baseline: { repositoryReadChars: number; duplicateReadCharsAvoided: number; accumulatedSessionInput: number },
  current: { repositoryReadChars: number; duplicateReadCharsAvoided: number; accumulatedSessionInput: number },
): MeasurementGateStatus {
  const localImproved = current.repositoryReadChars < baseline.repositoryReadChars || current.duplicateReadCharsAvoided > baseline.duplicateReadCharsAvoided;
  if (!localImproved) return "failed";
  return current.accumulatedSessionInput < baseline.accumulatedSessionInput ? "passed" : "partial";
}

interface Scope {
  path: string;
  absolute: string;
  directory: boolean;
}

interface FileSnapshot {
  digest: string;
  content: string;
  lines: string[];
  snapshotEpoch: number;
}

export interface SnapshotChunk {
  id: string;
  canonicalPath: string;
  range: [number, number];
  fileDigest: string;
  snapshotEpoch: number;
  content: string;
  returned: boolean;
  current: boolean;
}

const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);
const MAX_DESCRIPTORS = 200;
const MAX_SEARCH_RESULTS = 100;
const CHUNK_CONTEXT_LINES = 3;
const MAX_WORKTREE_OUTPUT = 64_000;
const MAX_GIT_BUFFER = 4 * 1024 * 1024;

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(worktree: string, args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8", timeout: 15_000, maxBuffer: MAX_GIT_BUFFER, env: { ...env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } });
}

function bounded(value: string): { text: string; truncated: boolean } {
  return value.length <= MAX_WORKTREE_OUTPUT ? { text: value, truncated: false } : { text: value.slice(0, MAX_WORKTREE_OUTPUT), truncated: true };
}

function compact(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n[truncated]`;
}

function workingPathDigest(worktree: string, changedPath: string): string {
  const absolute = path.resolve(worktree, changedPath);
  if (!inside(worktree, absolute)) throw new Error(`Changed path escapes worktree: ${changedPath}`);
  try {
    const entry = fs.lstatSync(absolute);
    if (entry.isSymbolicLink()) return `symlink:${digest(fs.readlinkSync(absolute))}`;
    if (!entry.isFile()) return "non-file";
    if (!inside(worktree, fs.realpathSync(absolute))) throw new Error(`Changed path follows a symlink outside worktree: ${changedPath}`);
    return `file:${digest(fs.readFileSync(absolute))}`;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return "missing";
    throw error;
  }
}

export function inspectLinkedWorktrees(rootInput: string): RepositoryToolResponse {
  const root = fs.realpathSync(rootInput);
  const currentHead = git(root, ["rev-parse", "HEAD"]).trim();
  const commonDirectory = fs.realpathSync(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
  const records = git(root, ["worktree", "list", "--porcelain"]).trim().split(/\n\n+/).filter(Boolean);
  let repositoryReadChars = 0;
  const worktrees = records.map((record) => {
    const fields = Object.fromEntries(record.split("\n").map((line) => { const separator = line.indexOf(" "); return separator < 0 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)]; }));
    if (typeof fields.worktree !== "string") throw new Error("Git returned a worktree record without a path.");
    if (!fs.existsSync(fields.worktree)) {
      const worktree = path.resolve(fields.worktree);
      return {
        id: digest(`${commonDirectory}\0${worktree}`).slice(0, 24),
        path: worktree,
        current: false,
        head: typeof fields.HEAD === "string" ? fields.HEAD : null,
        branch: typeof fields.branch === "string" ? fields.branch : fields.detached ? "detached" : null,
        available: false,
        unavailableReason: "registered worktree path does not exist",
        status: "",
        changedPaths: [],
        commitsRelativeToCurrent: "",
        diffStat: "",
        changeFingerprint: digest(`${commonDirectory}\0${worktree}\0unavailable`),
        diffChunks: [],
        truncated: false,
      };
    }
    const worktree = fs.realpathSync(fields.worktree);
    const candidateCommon = fs.realpathSync(git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
    if (candidateCommon !== commonDirectory) throw new Error(`Git worktree escaped the current repository: ${worktree}`);
    const worktreeId = digest(`${commonDirectory}\0${worktree}`).slice(0, 24);
    const status = bounded(git(worktree, ["status", "--short", "--untracked-files=all"]));
    const diffStat = bounded(git(worktree, ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--stat=120,80", currentHead, "--"]));
    const commits = bounded(git(worktree, ["log", "--oneline", "--max-count=100", `${currentHead}..HEAD`]));
    const tracked = git(worktree, ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", currentHead, "--"]).split("\0").filter(Boolean);
    const untracked = status.text.split("\n").filter((line) => line.startsWith("?? ")).map((line) => line.slice(3)).filter((changedPath) => {
      const entry = fs.lstatSync(path.join(worktree, changedPath), { throwIfNoEntry: false });
      return Boolean(entry && !entry.isDirectory());
    });
    const changedPaths = [...new Set([...tracked, ...untracked])].sort().slice(0, 500);
    const rawDiff = git(worktree, ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--raw", "--full-index", currentHead, "--"]);
    const untrackedDigests = untracked.slice(0, 500).map((changedPath) => `${changedPath}\0${git(worktree, ["hash-object", "--", changedPath]).trim()}`);
    const trackedDigests = tracked.map((changedPath) => [changedPath, workingPathDigest(worktree, changedPath)]);
    const changeFingerprint = digest(`${rawDiff}\0${JSON.stringify(trackedDigests)}\0${untrackedDigests.join("\n")}`);
    repositoryReadChars += status.text.length + diffStat.text.length + commits.text.length;
    return { id: worktreeId, path: worktree, current: worktree === root, head: typeof fields.HEAD === "string" ? fields.HEAD : null, branch: typeof fields.branch === "string" ? fields.branch : fields.detached ? "detached" : null, available: true, unavailableReason: null, status: status.text, changedPaths, commitsRelativeToCurrent: commits.text, diffStat: diffStat.text, changeFingerprint, diffChunks: changedPaths.map((changedPath) => ({ path: changedPath, chunkId: digest(`${worktreeId}\0${changedPath}\0${changeFingerprint}`).slice(0, 24) })), truncated: status.truncated || diffStat.truncated || commits.truncated || changedPaths.length === 500 };
  });
  const value = { currentHead, observationDigest: digest(JSON.stringify(worktrees)), worktrees };
  return { value, repositoryReadChars, duplicateReadCharsAvoided: 0 };
}

export class ScopedRepositoryService {
  readonly root: string;
  private readonly scopes: Scope[] = [];
  private readonly files = new Map<string, FileSnapshot>();
  private readonly chunks = new Map<string, SnapshotChunk>();
  private readonly scopeRequests: Array<{ paths: string[]; reason: string; evidenceRefs: string[] }> = [];
  private epoch = 0;

  constructor(worktree: string) {
    this.root = fs.realpathSync(worktree);
    if (!fs.statSync(this.root).isDirectory()) throw new Error(`Repository worktree is not a directory: ${worktree}`);
  }

  discover(query: string): RepositoryToolResponse {
    const needle = query.toLowerCase();
    const descriptors = this.walk(this.root)
      .filter((item) => !needle || item.path.toLowerCase().includes(needle))
      .slice(0, MAX_DESCRIPTORS)
      .map((item) => ({ path: item.path, kind: item.directory ? "directory" : "file" }));
    return { value: { descriptors, truncated: descriptors.length === MAX_DESCRIPTORS }, repositoryReadChars: 0, duplicateReadCharsAvoided: 0 };
  }

  requestScope(paths: string[], reason: string, evidenceRefs: string[]): RepositoryToolResponse {
    if (!reason.trim()) throw new Error("Scope expansion requires a reason.");
    const admitted = paths.map((requested) => {
      const resolved = this.resolveExisting(requested);
      const stat = fs.statSync(resolved.absolute);
      const scope = { ...resolved, directory: stat.isDirectory() };
      if (!this.scopes.some((item) => item.absolute === scope.absolute)) this.scopes.push(scope);
      return { path: scope.path, kind: scope.directory ? "directory" : "file" };
    });
    this.scopes.sort((left, right) => left.path.localeCompare(right.path));
    this.scopeRequests.push({ paths: admitted.map((item) => item.path), reason, evidenceRefs: [...evidenceRefs].sort() });
    return { value: { admitted, request: this.scopeRequests.at(-1) }, repositoryReadChars: 0, duplicateReadCharsAvoided: 0 };
  }

  search(query: string, repositoryScopes: string[]): RepositoryToolResponse {
    if (!query) throw new Error("Repository search requires a non-empty literal query.");
    if (!repositoryScopes.length) throw new Error("Repository search requires at least one admitted scope.");
    const scopes = repositoryScopes.map((requested) => this.requireAdmitted(requested));
    const results: Array<{ chunkId: string; canonicalPath: string; range: [number, number]; fileDigest: string; snapshotEpoch: number; matchLine: number }> = [];
    const seen = new Set<string>();
    for (const scope of scopes) {
      const entries = scope.directory ? this.walk(scope.absolute).filter((item) => !item.directory) : [{ path: scope.path, absolute: scope.absolute, directory: false }];
      for (const entry of entries) {
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        const snapshot = this.snapshot(entry.path, entry.absolute);
        if (!snapshot) continue;
        for (let index = 0; index < snapshot.lines.length; index++) {
          if (!snapshot.lines[index]!.includes(query)) continue;
          const start = Math.max(1, index + 1 - CHUNK_CONTEXT_LINES);
          const end = Math.min(snapshot.lines.length, index + 1 + CHUNK_CONTEXT_LINES);
          const chunk = this.chunk(entry.path, snapshot, start, end);
          results.push({ chunkId: chunk.id, canonicalPath: chunk.canonicalPath, range: chunk.range, fileDigest: chunk.fileDigest, snapshotEpoch: chunk.snapshotEpoch, matchLine: index + 1 });
          if (results.length >= MAX_SEARCH_RESULTS) return { value: { descriptors: results, truncated: true }, repositoryReadChars: 0, duplicateReadCharsAvoided: 0 };
        }
      }
    }
    return { value: { descriptors: results, truncated: false }, repositoryReadChars: 0, duplicateReadCharsAvoided: 0 };
  }

  read(chunkId: string): RepositoryToolResponse {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) throw new Error(`Unknown repository chunk: ${chunkId}. Use graph_search to obtain a current chunk ID.`);
    const admitted = this.requireAdmitted(chunk.canonicalPath);
    const current = this.snapshot(admitted.path, admitted.absolute);
    if (!chunk.current || !current || current.digest !== chunk.fileDigest) throw new Error(`Repository chunk ${chunkId} is stale. Search the admitted scope again for a current path/range/digest/epoch descriptor.`);
    const descriptor = { chunkId: chunk.id, canonicalPath: chunk.canonicalPath, range: chunk.range, fileDigest: chunk.fileDigest, snapshotEpoch: chunk.snapshotEpoch };
    if (chunk.returned) return { value: { reference: descriptor, bodyReturned: false }, repositoryReadChars: 0, duplicateReadCharsAvoided: chunk.content.length };
    chunk.returned = true;
    return { value: { ...descriptor, content: chunk.content, bodyReturned: true }, repositoryReadChars: chunk.content.length, duplicateReadCharsAvoided: 0 };
  }

  inspectWorktrees(query = ""): RepositoryToolResponse {
    const result = inspectLinkedWorktrees(this.root);
    const value = result.value as { currentHead: string; observationDigest: string; worktrees: Array<{ changedPaths: string[]; diffChunks: Array<{ path: string; chunkId: string }>; status: string; diffStat: string; [key: string]: unknown }> };
    const needle = query.trim().toLowerCase();
    const worktrees = value.worktrees.flatMap((worktree) => {
      const matches = needle ? worktree.changedPaths.filter((changedPath) => changedPath.toLowerCase().includes(needle)) : worktree.changedPaths;
      if (needle && !matches.length) return [];
      const selected = new Set(matches);
      return [{ ...worktree, status: compact(needle ? worktree.status.split("\n").filter((line) => line.toLowerCase().includes(needle)).join("\n") : worktree.status, 1_000), diffStat: compact(needle ? worktree.diffStat.split("\n").filter((line) => line.toLowerCase().includes(needle)).join("\n") : worktree.diffStat, 2_000), changedPathCount: worktree.changedPaths.length, changedPaths: matches, diffChunks: worktree.diffChunks.filter((item) => selected.has(item.path)) }];
    });
    return { ...result, value: { currentHead: value.currentHead, observationDigest: value.observationDigest, query: needle || null, worktreeCount: value.worktrees.length, worktrees } };
  }

  readWorktreeDiff(chunkId: string): RepositoryToolResponse {
    const inventory = inspectLinkedWorktrees(this.root);
    const value = inventory.value as { observationDigest: string; worktrees: Array<{ path: string; diffChunks: Array<{ path: string; chunkId: string }> }> };
    for (const worktree of value.worktrees) {
      const descriptor = worktree.diffChunks.find((item) => item.chunkId === chunkId);
      if (!descriptor) continue;
      let diff: { text: string; truncated: boolean };
      try { diff = bounded(git(worktree.path, ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--unified=3", (inventory.value as { currentHead: string }).currentHead, "--", descriptor.path])); }
      catch { diff = { text: git(worktree.path, ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--stat", (inventory.value as { currentHead: string }).currentHead, "--", descriptor.path]), truncated: true }; }
      if (!diff.text) {
        const absolute = path.resolve(worktree.path, descriptor.path);
        const relative = path.relative(worktree.path, absolute);
        const entry = fs.lstatSync(absolute, { throwIfNoEntry: false });
        if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative) && entry?.isFile()) {
          const untracked = git(worktree.path, ["ls-files", "--others", "--exclude-standard", "--", descriptor.path]).split("\n").includes(descriptor.path);
          if (untracked) diff = bounded(`[untracked file: ${descriptor.path}]\n${fs.readFileSync(absolute, "utf8")}`);
        }
      }
      return { value: { chunkId, observationDigest: value.observationDigest, worktree: worktree.path, path: descriptor.path, diff: diff.text, truncated: diff.truncated }, repositoryReadChars: diff.text.length, duplicateReadCharsAvoided: 0 };
    }
    throw new Error(`Unknown or stale worktree diff chunk: ${chunkId}. Run graph_inspect_worktrees again.`);
  }

  reconcileChangedPaths(paths: string[]): number {
    const changed = [...new Set(paths.map((requested) => this.resolveForReconcile(requested).path))].sort();
    if (!changed.length) return this.epoch;
    this.epoch++;
    for (const canonicalPath of changed) this.invalidate(canonicalPath);
    return this.epoch;
  }

  private resolveExisting(requested: string): { path: string; absolute: string } {
    if (!requested || path.isAbsolute(requested) || requested.includes("\0") || requested.split(/[\\/]/).includes("..")) throw new Error(`Repository path must be relative and traversal-free: ${requested}`);
    const lexical = path.resolve(this.root, requested);
    if (!inside(this.root, lexical)) throw new Error(`Repository path escapes the worktree: ${requested}`);
    let absolute: string;
    try { absolute = fs.realpathSync(lexical); } catch { throw new Error(`Repository path does not exist: ${requested}`); }
    if (!inside(this.root, absolute)) throw new Error(`Repository path escapes the worktree through a symlink: ${requested}`);
    return { path: path.relative(this.root, absolute).replaceAll(path.sep, "/") || ".", absolute };
  }

  private resolveForReconcile(requested: string): { path: string; absolute: string } {
    if (!requested || requested.includes("\0") || (!path.isAbsolute(requested) && requested.split(/[\\/]/).includes(".."))) throw new Error(`Repository path must be traversal-free: ${requested}`);
    const lexical = path.resolve(this.root, requested);
    if (!inside(this.root, lexical)) throw new Error(`Repository path escapes the worktree: ${requested}`);
    if (fs.existsSync(lexical)) {
      const absolute = fs.realpathSync(lexical);
      if (!inside(this.root, absolute)) throw new Error(`Repository path escapes the worktree through a symlink: ${requested}`);
      return { path: path.relative(this.root, absolute).replaceAll(path.sep, "/") || ".", absolute };
    }
    return { path: path.relative(this.root, lexical).replaceAll(path.sep, "/"), absolute: lexical };
  }

  private requireAdmitted(requested: string): Scope {
    const resolved = this.resolveExisting(requested);
    const admitted = this.scopes.find((scope) => scope.directory ? inside(scope.absolute, resolved.absolute) : scope.absolute === resolved.absolute);
    if (!admitted) throw new Error(`Repository path is outside admitted scopes: ${requested}`);
    const stat = fs.statSync(resolved.absolute);
    return { ...resolved, directory: stat.isDirectory() };
  }

  private walk(absolute: string): Array<{ path: string; absolute: string; directory: boolean }> {
    const output: Array<{ path: string; absolute: string; directory: boolean }> = [];
    const visit = (directory: string) => {
      const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink() || SKIP_DIRECTORIES.has(entry.name)) continue;
        if (!entry.isDirectory() && !entry.isFile()) continue;
        const candidate = path.join(directory, entry.name);
        const resolved = fs.realpathSync(candidate);
        if (!inside(this.root, resolved)) continue;
        const item = { path: path.relative(this.root, resolved).replaceAll(path.sep, "/"), absolute: resolved, directory: entry.isDirectory() };
        output.push(item);
        if (entry.isDirectory()) visit(resolved);
      }
    };
    visit(absolute);
    return output;
  }

  private snapshot(canonicalPath: string, absolute: string): FileSnapshot | undefined {
    const bytes = fs.readFileSync(absolute);
    const fileDigest = digest(bytes);
    const existing = this.files.get(canonicalPath);
    if (existing?.digest === fileDigest) return existing;
    if (existing) {
      this.epoch++;
      this.invalidate(canonicalPath);
    }
    if (bytes.includes(0)) return;
    const content = bytes.toString("utf8");
    const value = { digest: fileDigest, content, lines: content.split("\n"), snapshotEpoch: this.epoch };
    this.files.set(canonicalPath, value);
    return value;
  }

  private invalidate(canonicalPath: string): void {
    this.files.delete(canonicalPath);
    for (const chunk of this.chunks.values()) if (chunk.canonicalPath === canonicalPath) chunk.current = false;
  }

  private chunk(canonicalPath: string, snapshot: FileSnapshot, start: number, end: number): SnapshotChunk {
    const id = digest(`${snapshot.snapshotEpoch}\0${canonicalPath}\0${start}:${end}\0${snapshot.digest}`).slice(0, 24);
    const existing = this.chunks.get(id);
    if (existing?.current) return existing;
    const value: SnapshotChunk = { id, canonicalPath, range: [start, end], fileDigest: snapshot.digest, snapshotEpoch: snapshot.snapshotEpoch, content: snapshot.lines.slice(start - 1, end).join("\n"), returned: false, current: true };
    this.chunks.set(id, value);
    return value;
  }
}

export class RepositoryServiceRegistry {
  private readonly sessions = new Map<string, ScopedRepositoryService>();

  get(sessionId: string, worktree: string): ScopedRepositoryService {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.root !== fs.realpathSync(worktree)) throw new Error(`Repository session ${sessionId} changed worktrees.`);
      return existing;
    }
    const service = new ScopedRepositoryService(worktree);
    this.sessions.set(sessionId, service);
    return service;
  }

  delete(sessionId: string): void { this.sessions.delete(sessionId); }
  reconcileChangedPaths(sessionId: string, paths: string[]): number | undefined { return this.sessions.get(sessionId)?.reconcileChangedPaths(paths); }
  clear(): void { this.sessions.clear(); }
  get size(): number { return this.sessions.size; }
}
