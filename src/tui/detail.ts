import type { PlanNode, PlanTask, PlannedDiff } from "../augment/types.js";
import { candidatesForEntry, entryHasPlan, type FilePreview, type PlannedTreeRow } from "./controller.js";

/** Node kinds that develop by drafting their own patch. */
const FILE_TARGET_KINDS = ["file", "hunk", "virtual"];

/**
 * Pure view model for the TUI: theme, per-entry state derivation, the
 * two-section detail content, and the frame layout budget. No Ink, no
 * React, no I/O — everything here is directly testable.
 */

export const theme = {
  primary: "#7aa2f7",
  secondary: "#bb9af7",
  accent: "#2ac3de",
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  muted: "#838aa0",
  border: "#414868",
  borderActive: "#7aa2f7",
  selected: "#24283b",
  text: "#c0caf5",
};


export type InputMode = "idle" | "objective" | "message" | "reopen" | "stale";


export interface LiveStatus {
  spinner: string;
  active?: { nodeId?: string; operation?: string };
  failed?: { nodeId?: string; operation?: string; error?: string };
}

export interface RowLiveFlags {
  active?: boolean;
  failed?: boolean;
  spinner?: string;
  operation?: string;
}

/** Per-row view context: pending restrictions, applied marks, live flags. */
export interface RowView {
  pendingMarks?: string[];
  pendingMode?: "lock" | "allow";
  appliedDiffIds?: string[];
  live?: RowLiveFlags;
}

/** Pane-level view context: the same inputs with pane-wide live status. */
export interface PaneView {
  pendingMarks?: string[];
  pendingMode?: "lock" | "allow";
  appliedDiffIds?: string[];
  live?: LiveStatus;
  /** Content of a repository-only file selection (no plan state to show). */
  filePreview?: FilePreview;
}


export function entryTouchesNode(entry: PlannedTreeRow["entry"], nodeId?: string): boolean {
  return nodeId !== undefined && entry.nodeIds.includes(nodeId);
}

function crop(value: string, width: number): string {
  const chars = [...value];
  return chars.length <= width ? value : `${chars.slice(0, Math.max(1, width - 1)).join("")}…`;
}

function statusColor(status: string): string {
  if (["ready", "selected", "possible"].includes(status)) return theme.success;
  if (["domain", "collapsed", "refined"].includes(status)) return theme.secondary;
  if (status === "unresolved") return theme.warning;
  if (["stale", "eliminated"].includes(status)) return theme.error;
  return theme.muted;
}

export function entryName(entry: PlannedTreeRow["entry"]): string {
  if (entry.path === ".") return "repo/";
  return entry.kind === "dir" ? `${entry.name}/` : entry.name;
}

/**
 * Compact header forms of the session and task ids: enough to recognize at a
 * glance and correlate across panels, short enough to fit a narrow frame.
 * Task ids are millisecond timestamps, so the tail carries the distinction.
 */
export function shortSessionId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

export function shortTaskId(id: string): string {
  return id.startsWith("task:") ? `task:${id.slice(-6)}` : id;
}

function diffLabel(kind: PlannedDiff["kind"]): string {
  if (kind === "new") return "added";
  if (kind === "delete") return "removed";
  if (kind === "modify") return "changed";
  return "unknown";
}

function diffIndicator(kind: PlannedDiff["kind"]): string {
  if (kind === "new") return "+";
  if (kind === "delete") return "-";
  if (kind === "modify") return "~";
  return "▤";
}

/**
 * Added and removed line counts for a set of patches — the `+12 −3` shown
 * next to drafted paths in the tree. Header lines (`+++`/`---`) and git
 * metadata never count; only hunk content does.
 */
export function diffChangeCounts(diffs: PlannedDiff[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const diff of diffs) {
    for (const line of diff.patch.split(/\r?\n/)) {
      if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("diff --git")) continue;
      if (line.startsWith("+")) added += 1;
      else if (line.startsWith("-")) removed += 1;
    }
  }
  return { added, removed };
}

export interface SubtreeProgress {
  /** Every approach stage under the entry has generated its candidates. */
  crystallized: boolean;
  /** Everything under the entry is drafted — the reducers' own `ready` propagation. */
  developed: boolean;
  /** Some approaches or drafts exist under the entry. */
  landed: boolean;
  drafted: number;
  total: number;
}

/**
 * Aggregated lifecycle of a directory or root row: `crystallized` reads the
 * approach nodes' statuses, `developed` trusts the state machine's upward
 * `ready` propagation (a node is ready only when everything below it is
 * drafted), and `drafted`/`total` count the file-target nodes the suffix
 * shows. Entries carry descendant node ids (controller aggregation), so this
 * stays a pure read over the task.
 */
export function subtreeProgress(task: PlanTask | undefined, entry: PlannedTreeRow["entry"]): SubtreeProgress | undefined {
  const nodes = entry.nodeIds.map((id) => task?.nodes[id]).filter(Boolean) as PlanNode[];
  if (!nodes.length) return undefined;
  const approachNodes = nodes.filter((node) => node.kind === "root" || node.kind === "dir");
  const fileTargets = nodes.filter((node) => FILE_TARGET_KINDS.includes(node.kind));
  return {
    crystallized: approachNodes.every((node) => node.status !== "unresolved"),
    developed: nodes.every((node) => node.status === "ready"),
    landed: nodes.some((node) => node.candidateIds.length > 0 || node.diffIds.length > 0),
    drafted: fileTargets.filter((node) => node.diffIds.length > 0).length,
    total: fileTargets.length,
  };
}

export function entryState(task: PlanTask | undefined, row: PlannedTreeRow, view: RowView = {}): { indicator: string; suffix: string; color: string } {
  const { pendingMarks = [], pendingMode = "lock", appliedDiffIds = [], live } = view;
  const entry = row.entry;
  const candidates = candidatesForEntry(task, entry);
  const selected = candidates.find((candidate) => candidate.status === "selected");
  const possible = candidates.filter((candidate) => candidate.status === "possible");
  const diffs = entry.diffIds.map((id) => task?.diffs[id]).filter(Boolean) as PlannedDiff[];
  const changes = diffChangeCounts(diffs);
  const changeSuffix = changes.added || changes.removed ? `+${changes.added} −${changes.removed}` : "";
  const explanations = entry.explanationIds.map((id) => task?.explanations[id]).filter(Boolean);
  const blocked = entry.nodeIds.some((id) => task?.nodes[id]?.status === "stale");
  const ready = entry.nodeIds.some((id) => task?.nodes[id]?.status === "ready");
  const mode = task?.restrictionMode ?? pendingMode;
  const marked = entry.path !== "." && (task
    ? task.lockedPaths.some((mark) => entry.path === mark || entry.path.startsWith(`${mark}/`))
    : pendingMarks.includes(entry.path));
  const applied = diffs.filter((diff) => appliedDiffIds.includes(diff.id));

  if (live?.active) return { indicator: live.spinner ?? "⠋", suffix: "", color: theme.warning };
  if (live?.failed) return { indicator: "×", suffix: "", color: theme.error };
  if (marked) return { indicator: "#", suffix: changeSuffix || (diffs.length ? `${diffs.length}` : ""), color: mode === "lock" ? theme.error : theme.accent };
  if (explanations.length) {
    const primary = explanations.some((explanation) => explanation!.role === "primary");
    return { indicator: "?", suffix: explanations.length > 1 ? `${explanations.length}` : "", color: primary ? theme.warning : theme.accent };
  }
  if (blocked) return { indicator: "!", suffix: "", color: theme.error };
  if (applied.length) return { indicator: "✓", suffix: applied.length < diffs.length ? `${applied.length}/${diffs.length}` : changeSuffix, color: theme.success };
  // Directory and root rows answer "is everything below crystallized and
  // developed?" — strictly additively: an open choice, drafted patches, and
  // their line counts keep their original rich rendering, and the
  // drafted/total progress joins the suffix instead of replacing anything.
  // The bare aggregate glyphs (○ ◐ ●) appear only where nothing richer
  // exists.
  if ((entry.kind === "dir" || entry.kind === "root") && entry.nodeIds.length) {
    if (possible.length) {
      const best = Math.max(...possible.map((candidate) => candidate.confidence));
      return { indicator: "◇", suffix: `${possible.length}·${best}%`, color: theme.warning };
    }
    if (diffs.length) {
      const progress = subtreeProgress(task, entry);
      const partial = progress && !progress.developed && progress.total > 0 ? `${progress.drafted}/${progress.total}` : "";
      const suffix = [changeSuffix, partial].filter(Boolean).join(" · ");
      return { indicator: diffs.length === 1 ? diffIndicator(diffs[0]!.kind) : "Δ", suffix, color: diffs.some((diff) => diff.kind === "delete") ? theme.error : theme.success };
    }
    if (entry.kind === "root" && selected) return { indicator: "◆", suffix: `${selected.confidence}%`, color: theme.secondary };
    const progress = subtreeProgress(task, entry);
    if (progress) {
      if (progress.developed) return { indicator: "●", suffix: "", color: theme.success };
      if (progress.landed) return { indicator: "◐", suffix: progress.total ? `${progress.drafted}/${progress.total}` : "", color: theme.secondary };
      return { indicator: "○", suffix: "", color: theme.warning };
    }
  }
  if (diffs.length) {
    const single = diffs.length === 1;
    return { indicator: single ? diffIndicator(diffs[0]!.kind) : "Δ", suffix: changeSuffix || (single ? "" : `${diffs.length}`), color: diffs.some((diff) => diff.kind === "delete") ? theme.error : theme.success };
  }
  if (entry.nodeIds.length && entry.kind !== "root") return { indicator: "~", suffix: "", color: theme.text };
  if (ready) return { indicator: "●", suffix: "", color: theme.success };
  if (selected) return { indicator: entry.kind !== "root" ? "◇" : "◆", suffix: `${selected.confidence}%`, color: theme.secondary };
  if (possible.length) {
    const best = Math.max(...possible.map((candidate) => candidate.confidence));
    return { indicator: "◇", suffix: `${possible.length}·${best}%`, color: theme.warning };
  }
  if (row.repositoryOnly) return { indicator: "", suffix: "", color: theme.muted };
  return { indicator: "·", suffix: "", color: theme.muted };
}


function changeSummary(diffs: PlannedDiff[]): string {
  const counts = diffs.reduce((accumulator, diff) => {
    accumulator[diff.kind] = (accumulator[diff.kind] ?? 0) + 1;
    return accumulator;
  }, {} as Record<PlannedDiff["kind"], number>);
  const parts: string[] = [];
  if (counts.new) parts.push(`${counts.new} added`);
  if (counts.modify) parts.push(`${counts.modify} changed`);
  if (counts.delete) parts.push(`${counts.delete} removed`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown`);
  return parts.join(" · ") || "no drafted changes";
}

function constraintsForEntry(task: PlanTask | undefined, entry: PlannedTreeRow["entry"] | undefined) {
  if (!task || !entry) return [];
  const ids = new Set(entry.nodeIds);
  for (const constraintId of task.nodes[task.rootNodeId]?.constraintIds ?? []) ids.add(constraintId);
  for (const nodeId of entry.nodeIds) {
    let parent = task.nodes[nodeId]?.parent;
    while (parent) {
      for (const constraintId of task.nodes[parent]?.constraintIds ?? []) ids.add(constraintId);
      parent = task.nodes[parent]?.parent;
    }
  }
  return [...ids].map((id) => task.constraints[id]).filter(Boolean);
}

function explanationsForEntry(task: PlanTask | undefined, entry: PlannedTreeRow["entry"] | undefined) {
  if (!task || !entry || entry.path === ".") return [];
  return Object.values(task.explanations)
    .filter((explanation) => explanation.path === entry.path || explanation.path.startsWith(`${entry.path}/`))
    .sort((left, right) => {
      const rank = (role: string) => role === "primary" ? 0 : role === "supporting" ? 1 : 2;
      return rank(left.role) - rank(right.role) || left.path.localeCompare(right.path);
    });
}

function diffColor(line: string): string {
  if (line.startsWith("+++")) return theme.success;
  if (line.startsWith("---")) return theme.error;
  if (line.startsWith("@@")) return theme.accent;
  if (line.startsWith("+")) return theme.success;
  if (line.startsWith("-")) return theme.error;
  return theme.text;
}

export type DetailLine = { text: string; color: string; bold?: boolean };

const FOLDER_CONTENT_PREVIEW = 8;
const FOLDER_PATCH_PREVIEW = 4;

/**
 * Builds the right-pane content for the selected tree row as one flat list of
 * colored lines the pane scrolls and wraps natively. The pane carries exactly
 * two content sections — DESCRIPTION (why this path changes) and CHANGES (the
 * exact drafted patches) — plus keypress suggestions only when neither has
 * anything to show. Approaches appear only while a choice is still open on
 * this node; after selection they are history, not hover content.
 */
export function detailLines(task: PlanTask | undefined, row: PlannedTreeRow | undefined, view: PaneView = {}): DetailLine[] {
  const { pendingMarks = [], pendingMode = "lock", appliedDiffIds = [], live } = view;
  const lines: DetailLine[] = [];
  const add = (text: string, color: string, bold = false) => lines.push({ text: text.length ? text : " ", color, bold });
  const label = (text: string) => add(text, theme.muted);

  if (live?.active) {
    const target = task?.nodes[live.active.nodeId ?? ""]?.path;
    add(`${live.spinner} ${live.active.operation ?? "Working"}…${target && target !== "." ? ` · ${target}` : ""}`, theme.warning, true);
  }
  if (live?.failed) {
    add(`× ${live.failed.operation ?? "Last operation"} failed — press the same key again to retry`, theme.error, true);
    if (live.failed.error) add(`  ${live.failed.error.split(/\r?\n/)[0] ?? ""}`, theme.error);
  }
  if (!row) {
    add("  [N] describe a change or ask about the repository", theme.muted);
    return lines;
  }
  const entry = row.entry;
  const nodes = entry.nodeIds.map((id) => task?.nodes[id]).filter(Boolean) as PlanNode[];
  const candidates = candidatesForEntry(task, entry);
  const possible = candidates.filter((candidate) => candidate.status === "possible");
  const diffs = entry.diffIds.flatMap((id) => {
    const diff = task?.diffs[id];
    return diff ? [diff] : [];
  });
  const notes = constraintsForEntry(task, entry);
  const explanations = explanationsForEntry(task, entry);
  const state = entryState(task, row, { pendingMarks, pendingMode, appliedDiffIds });
  const isDirectory = entry.kind === "dir" || entry.kind === "root";
  const descriptionFor = (diff: PlannedDiff) => task?.nodes[diff.nodeId]?.reason;

  const plannedChildren = isDirectory ? entry.children.filter((child) => entryHasPlan(child)) : [];
  if (nodes.length || plannedChildren.length || possible.length || explanations.length || notes.length) {
    label("DESCRIPTION");
    for (const node of nodes) {
      add(`  ${node.reason}`, theme.text);
    }
  }

  if (plannedChildren.length) {
    for (const child of plannedChildren.slice(0, FOLDER_CONTENT_PREVIEW)) {
        const childLive: RowLiveFlags | undefined = live
          ? {
              active: entryTouchesNode(child, live.active?.nodeId),
              failed: entryTouchesNode(child, live.failed?.nodeId),
              spinner: live.spinner,
              operation: live.active?.operation,
            }
          : undefined;
        const childState = entryState(task, {
          kind: "entry",
          id: `entry:${child.path}`,
          depth: row.depth + 1,
          branch: "",
          entry: child,
          repositoryOnly: false,
        }, { pendingMarks, pendingMode, appliedDiffIds, live: childLive });
        const reason = child.nodeIds.map((id) => task?.nodes[id]?.reason).find((value) => value?.length);
        add(`  ${childState.indicator} ${entryName(child)}${childState.suffix ? ` ${childState.suffix}` : ""}${reason ? ` — ${reason}` : ""}`, childState.color);
    }
    if (plannedChildren.length > FOLDER_CONTENT_PREVIEW) {
      add(`  + ${plannedChildren.length - FOLDER_CONTENT_PREVIEW} more entries`, theme.muted);
    }
  }

  if (possible.length) {
    // The choice hint travels with the options themselves, not the legend.
    add(`  choose 1-${possible.length} · [Enter] rethink`, theme.muted);
    possible.forEach((candidate, index) => {
      add(`  ${index + 1} ◇ ${candidate.label} · ${candidate.confidence}%`, statusColor(candidate.status));
      add(`  ${candidate.rationale}`, theme.muted);
      add(`  ${candidate.touchedPaths.join(", ")}`, theme.accent);
    });
  }

  for (const explanation of explanations.slice(0, 8)) {
    add(`? ${explanation.path} · ${explanation.role} · ${explanation.confidence}%`, explanation.role === "primary" ? theme.warning : theme.accent);
    add(`  ${explanation.summary}`, theme.text);
    add(`  ${explanation.detail}`, theme.muted);
  }
  if (explanations.length > 8) add(`  + ${explanations.length - 8} more related paths`, theme.muted);

  for (const note of notes) add(`  ${note.text}`, theme.warning);

  if (diffs.length) {
    const appliedCount = diffs.filter((diff) => appliedDiffIds.includes(diff.id)).length;
    const appliedSuffix = appliedCount === diffs.length ? " ✓" : appliedCount ? ` · ${appliedCount}/${diffs.length} ✓` : "";
    if (isDirectory) {
      label("CHANGES");
      add(changeSummary(diffs) + appliedSuffix, state.color, true);
      for (const diff of diffs.slice(0, 3)) {
        add(`  ${diffIndicator(diff.kind)} ${diff.path || diff.id} · ${diffLabel(diff.kind)}${appliedDiffIds.includes(diff.id) ? " ✓" : ""}`, diff.kind === "delete" ? theme.error : theme.success);
        if (descriptionFor(diff)) add(`  ${descriptionFor(diff)}`, theme.text);
        const patchLines = diff.patch.split(/\r?\n/);
        for (const line of patchLines.slice(0, FOLDER_PATCH_PREVIEW)) add(`  ${line}`, diffColor(line));
        if (patchLines.length > FOLDER_PATCH_PREVIEW) add(`  … ${patchLines.length - FOLDER_PATCH_PREVIEW} more diff lines`, theme.muted);
      }
      if (diffs.length > 3) add(`  + ${diffs.length - 3} more patches`, theme.muted);
    }
    else {
      const totalLines = diffs.reduce((count, diff) => count + diff.patch.split(/\r?\n/).length, 0);
      label("CHANGES");
      add(`${changeSummary(diffs)}${appliedSuffix} · ${totalLines} lines · basis ${diffs[0]!.basisRevision.slice(0, 12)}`, state.color, true);
      for (const diff of diffs) {
        add(`${diffIndicator(diff.kind)} ${diff.path || diff.id} · ${diffLabel(diff.kind)}${appliedDiffIds.includes(diff.id) ? " ✓" : ""}`, diff.kind === "delete" ? theme.error : theme.success);
        if (descriptionFor(diff)) add(`  ${descriptionFor(diff)}`, theme.text);
        for (const line of diff.patch.split(/\r?\n/)) add(line, diffColor(line));
      }
    }
  }
  else {
    if (!task) add("  [N] describe a change or ask about the repository", theme.muted);
    if (!isDirectory && !nodes.length) {
      // A repository-only file: show what it holds instead of plan hints.
      if (view.filePreview) {
        label("PREVIEW");
        for (const line of view.filePreview.lines) add(line.length ? line : " ", theme.text);
        if (view.filePreview.truncated) add(`… ${view.filePreview.totalLines - view.filePreview.lines.length} more lines`, theme.muted);
      }
      else if (task) add("  [Enter] message/regenerate · [D] develop selected path · [H] related only", theme.muted);
    }
    else if (task) {
      if (possible.length) {
        // Nothing extra here: the option list and its 1-N hint render in DESCRIPTION.
      }
      else if (nodes.some((node) => (node.kind === "root" || node.kind === "dir") && node.status === "unresolved" && !node.candidateIds.length)) add("  [D] generate approaches for this path · [Enter] add a guiding message first", theme.muted);
      else if (!isDirectory && nodes.length) add("  [D] develop — drafts this file's exact patch · [A] apply after", theme.muted);
      else if (isDirectory) add("  [D] develop — drafts every undrafted file below · [F] fold · [H] related only", theme.muted);
    }
  }

  if (nodes.some((node) => node.challengeExhausted)) {
    add("⚠ coverage unproven", theme.warning);
  }
  return lines;
}


/**
 * The detail content split into its two panes: every line up to the CHANGES
 * label is `description`; the CHANGES label and every line after it is
 * `diff`. A selection without a drafted patch yields an empty `diff`, so
 * where no diff exists the same space falls back to the description —
 * diff where it exists, description everywhere else.
 */
export interface DetailSections {
  description: DetailLine[];
  diff: DetailLine[];
}

export function detailSections(task: PlanTask | undefined, row: PlannedTreeRow | undefined, view: PaneView = {}): DetailSections {
  const lines = detailLines(task, row, view);
  const changes = lines.findIndex((line) => line.text === "CHANGES");
  if (changes === -1) return { description: lines, diff: [] };
  return { description: lines.slice(0, changes), diff: lines.slice(changes) };
}


const FRAME_PADDING_ROWS = 2;
const HEADER_ROWS = 1;
const LEGEND_ROWS = 2;
const MESSAGE_PANEL_ROWS = 3;
const PANE_FRAME_ROWS = 3;
const MIN_PANE_ROWS = 1;
const UNKNOWN_WINDOW_ROWS = 24;


export interface FrameLayout {
  frameRows: number;
  treeRows: number;
  detailRows: number;
  /** Inner rows of the session stream pane (0 when it is not shown). */
  sessionRows: number;
}

/**
 * Rows one display line occupies when wrapped at the given width: greedy
 * word wrap with hard splits for tokens longer than the line. Used to
 * budget how many stream events fit a fixed-height pane.
 */
export function wrappedRows(text: string, width: number): number {
  if (width <= 0 || !text) return 1;
  let rows = 1;
  let column = 0;
  for (const word of text.split(/ +/)) {
    if (!word) continue;
    if (column > 0) column += 1;
    if (column + word.length <= width) {
      column += word.length;
      continue;
    }
    if (word.length <= width) {
      rows += 1;
      column = word.length;
      continue;
    }
    const usable = Math.max(0, width - column);
    const remaining = word.length - usable;
    rows += Math.ceil(remaining / width);
    column = remaining % width === 0 ? width : remaining % width;
  }
  return rows;
}

export type LayoutMode = "wide" | "medium" | "narrow";

/** Smallest terminal width that still fits all three columns. */
export const WIDE_MIN_COLUMNS = 132;
/** Smallest terminal width that fits the tree beside the stacked content column. */
export const MEDIUM_MIN_COLUMNS = 80;
/** Wide frames: the tree is a narrow fixed column, never an equal third. */
export const TREE_COLUMNS_WIDE = 44;
const TREE_COLUMNS_MIN = 36;
const UNKNOWN_WINDOW_COLUMNS = MEDIUM_MIN_COLUMNS;

/**
 * The tree column width for two- and three-column arrangements: fixed and
 * narrow (up to 40% of the terminal, clamped 36–44), so the content beside
 * it keeps at least half the terminal instead of splitting 50/50 with a
 * tree that does not need the room.
 */
export function treeColumnsFor(width: number): number {
  return Math.max(TREE_COLUMNS_MIN, Math.min(TREE_COLUMNS_WIDE, Math.floor(width * 0.4)));
}

function normalizedColumns(columns: number | undefined): number {
  return typeof columns === "number" && Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : UNKNOWN_WINDOW_COLUMNS;
}

/**
 * The pane arrangement, derived from the terminal width alone — never from
 * pane content. Wide terminals get three columns (narrow tree, full-height
 * diff, description over session); smaller ones two columns with the
 * description stacked under the diff window; the smallest a single column
 * with the content pane under the tree.
 */
export function layoutMode(columns: number | undefined): LayoutMode {
  const width = normalizedColumns(columns);
  if (width >= WIDE_MIN_COLUMNS) return "wide";
  if (width >= MEDIUM_MIN_COLUMNS) return "medium";
  return "narrow";
}

export interface AdaptiveLayout {
  /** Active arrangement. */
  mode: LayoutMode;
  frameRows: number;
  /** Tree pane: the left column in every arrangement — narrow and fixed when wide. */
  treeColumns: number;
  treeRows: number;
  /** Diff pane: full-height middle column when wide, top of the content stack otherwise. */
  diffColumns: number;
  diffRows: number;
  /** Description pane: right column when wide (session stacked under it), bottom of the stack otherwise. */
  descriptionColumns: number;
  descriptionRows: number;
  /** Bounded session slice: under the description on wide, under the tree otherwise; 0 when hidden or cramped. */
  sessionRows: number;
  /**
   * Whether diff and description are separate panes. When false both budgets
   * describe one shared pane that shows the diff when one exists and the
   * description otherwise — always in narrow, and in medium when the stack
   * is too short to split.
   */
  split: boolean;
}

/**
 * Inner rows of the one shared content pane — the pane the diff-or-description
 * rule uses when no diff exists to split around. In a split medium frame it
 * owns the whole stacked column (both halves); in narrow it owns only the
 * bottom half under the tree.
 */
export function sharedContentRows(layout: AdaptiveLayout): number {
  if (layout.mode === "narrow") return layout.descriptionRows;
  return layout.split ? layout.diffRows + layout.descriptionRows : layout.diffRows;
}

export interface LegendSegment {
  text: string;
  color: string;
  bold?: boolean;
}

/**
 * Greedy word wrap for the hotkeys legend: words keep their segment's style
 * while flowing across rows of at most `width` cells. At most `maxRows` rows
 * come back; when content remains, the last row ends in an ellipsis so the
 * legend wraps instead of truncating at one line.
 */
export function wrapLegend(segments: LegendSegment[], width: number, maxRows = 2): LegendSegment[][] {
  if (width < 1) return [[]];
  const rows: LegendSegment[][] = [];
  let row: LegendSegment[] = [];
  let used = 0;
  const newRow = () => {
    rows.push(row);
    row = [];
    used = 0;
  };
  for (const segment of segments) {
    const words = segment.text.split(" ").filter(Boolean);
    for (const word of words) {
      const space = used > 0 ? 1 : 0;
      if (used > 0 && used + space + word.length > width) newRow();
      if (used === 0 && word.length > width) {
        // A word longer than a whole row still starts its own row.
        row.push({ ...segment, text: word.slice(0, width) });
        used = width;
        continue;
      }
      const prefix = used > 0 ? " " : "";
      const previous = row[row.length - 1];
      if (previous && previous.color === segment.color && previous.bold === segment.bold) {
        previous.text += `${prefix}${word}`;
      } else {
        row.push({ ...segment, text: `${prefix}${word}` });
      }
      used += prefix.length + word.length;
    }
  }
  if (row.length || rows.length === 0) rows.push(row);
  if (rows.length <= maxRows) return rows;
  const kept = rows.slice(0, maxRows);
  const last = kept[kept.length - 1]!;
  const lastSegment = last[last.length - 1];
  if (lastSegment) lastSegment.text = `${lastSegment.text.slice(0, Math.max(0, width - 1))}…`;
  else last.push({ text: "…", color: theme.muted });
  return kept;
}

/**
 * Arrangement and pane budgets for one frame. Everything derives from the
 * terminal size alone, so a repaint after a content change never moves a
 * split: the 50/50 halves stay 50/50 no matter what the panes hold.
 * Wide frames: a narrow fixed tree, a FULL-height diff column, and a third
 * column splitting description over the session stream. `frameLayout` keeps
 * owning the vertical chrome math; this spreads its budget across the panes
 * of the active arrangement.
 */
export function adaptiveLayout(columns: number | undefined, rows: number | undefined, mode: InputMode, sessionVisible = false): AdaptiveLayout {
  const arrangement = layoutMode(columns);
  const width = normalizedColumns(columns);
  const base = frameLayout(rows, mode, false);
  const paneRows = base.treeRows;
  const sessionRows = sessionVisible && paneRows >= 10 ? Math.min(8, Math.max(2, Math.floor(paneRows * 0.3))) : 0;
  const underSession = (contentRows: number) => Math.max(MIN_PANE_ROWS, contentRows - sessionRows - (sessionRows ? PANE_FRAME_ROWS : 0));
  // Rows two stacked panes can share once their borders are paid for.
  const stackRows = Math.max(0, paneRows - PANE_FRAME_ROWS);
  const halves = { top: Math.floor(stackRows / 2), bottom: stackRows - Math.floor(stackRows / 2) };

  if (arrangement === "wide") {
    // Narrow fixed tree; the remaining width halves between the diff column
    // (full height — the session never eats its rows) and the description
    // column, which shares its height with the session stream below it.
    const tree = treeColumnsFor(width);
    const diffColumns = Math.floor((width - tree) / 2);
    return { mode: arrangement, frameRows: base.frameRows, treeColumns: tree, treeRows: paneRows, diffColumns, diffRows: paneRows, descriptionColumns: width - tree - diffColumns, descriptionRows: underSession(paneRows), sessionRows, split: true };
  }
  if (arrangement === "medium") {
    // The same narrow tree beside one content column; the description
    // stacks under the diff window at a fixed half inside it. The session
    // stream stays under the tree. Too short to stack, the content column
    // becomes one pane following the diff-where-it-exists rule.
    const tree = treeColumnsFor(width);
    if (stackRows < 2) return { mode: arrangement, frameRows: base.frameRows, treeColumns: tree, treeRows: paneRows, diffColumns: width - tree, diffRows: paneRows, descriptionColumns: 0, descriptionRows: paneRows, sessionRows, split: false };
    return { mode: arrangement, frameRows: base.frameRows, treeColumns: tree, treeRows: underSession(paneRows), diffColumns: width - tree, diffRows: halves.top, descriptionColumns: width - tree, descriptionRows: halves.bottom, sessionRows, split: true };
  }
  // Narrow: one column, tree over a single content pane, both halves fixed
  // at 50/50; below the stacking minimum the tree keeps the whole column.
  if (stackRows < 2) return { mode: "narrow", frameRows: base.frameRows, treeColumns: width, treeRows: paneRows, diffColumns: 0, diffRows: 0, descriptionColumns: 0, descriptionRows: 0, sessionRows: 0, split: false };
  return { mode: "narrow", frameRows: base.frameRows, treeColumns: width, treeRows: halves.top, diffColumns: width, diffRows: halves.bottom, descriptionColumns: 0, descriptionRows: halves.bottom, sessionRows: 0, split: false };
}

/**
 * Derives the vertical budget of one frame from the terminal height. Ink clears
 * and scrolls the terminal whenever a frame exceeds the viewport, which reads
 * as a flash on every repaint, so the fixed chrome (root padding, header,
 * legend, status or input box, pane borders and labels) is subtracted first and
 * the panes receive only what is left. The session pane shares the left column
 * under the tree: it takes a bounded slice and never squeezes the tree below
 * the minimum.
 */
export function frameLayout(rows: number | undefined, mode: InputMode, sessionVisible = false): FrameLayout {
  const frameRows = typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : UNKNOWN_WINDOW_ROWS;
  void mode;
  const chromeRows = FRAME_PADDING_ROWS + HEADER_ROWS + LEGEND_ROWS + MESSAGE_PANEL_ROWS;
  const paneRows = Math.max(MIN_PANE_ROWS, frameRows - chromeRows - PANE_FRAME_ROWS);
  // Below ten pane rows there is no room to share: the tree keeps everything.
  if (!sessionVisible || paneRows < 10) return { frameRows, treeRows: paneRows, detailRows: paneRows, sessionRows: 0 };
  const sessionRows = Math.min(8, Math.max(2, Math.floor(paneRows * 0.3)));
  return { frameRows, treeRows: Math.max(MIN_PANE_ROWS, paneRows - sessionRows - PANE_FRAME_ROWS), detailRows: paneRows, sessionRows };
}

