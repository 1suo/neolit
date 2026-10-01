import type { PlanNode, PlanTask, PlannedDiff } from "../augment/types.js";
import { candidatesForEntry, entryHasPlan, type PlannedTreeRow } from "./controller.js";

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


export type InputMode = "idle" | "objective" | "explanation" | "message" | "reopen" | "stale";


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

export function entryState(task: PlanTask | undefined, row: PlannedTreeRow, view: RowView = {}): { indicator: string; suffix: string; color: string } {
  const { pendingMarks = [], pendingMode = "lock", appliedDiffIds = [], live } = view;
  const entry = row.entry;
  const candidates = candidatesForEntry(task, entry);
  const selected = candidates.find((candidate) => candidate.status === "selected");
  const possible = candidates.filter((candidate) => candidate.status === "possible");
  const diffs = entry.diffIds.map((id) => task?.diffs[id]).filter(Boolean) as PlannedDiff[];
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
  if (marked) return { indicator: "#", suffix: diffs.length ? `+${diffs.length}` : "", color: mode === "lock" ? theme.error : theme.accent };
  if (explanations.length) {
    const primary = explanations.some((explanation) => explanation!.role === "primary");
    return { indicator: "?", suffix: explanations.length > 1 ? `${explanations.length}` : "", color: primary ? theme.warning : theme.accent };
  }
  if (blocked) return { indicator: "!", suffix: "", color: theme.error };
  if (applied.length) return { indicator: "✓", suffix: applied.length < diffs.length ? `${applied.length}/${diffs.length}` : "", color: theme.success };
  if (diffs.length) {
    const single = diffs.length === 1;
    return { indicator: single ? diffIndicator(diffs[0]!.kind) : "Δ", suffix: single ? "" : `${diffs.length}`, color: diffs.some((diff) => diff.kind === "delete") ? theme.error : theme.success };
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
    add("  [N] describe a change · [E] explain the repository", theme.muted);
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
    if (!task) add("  [N] describe a change · [E] explain the repository", theme.muted);
    else if (possible.length) add(`  1-${possible.length} choose approach · [Enter] rethink (empty submit)`, theme.muted);
    else if (!isDirectory && nodes.length) add("  [D] develop — drafts this file's exact patch · [A] apply after", theme.muted);
    else if (isDirectory) add("  [D] develop — drafts every undrafted file below · [F] fold · [H] related only", theme.muted);
    else add("  [Enter] message/regenerate · [D] develop selected path · [H] related only", theme.muted);
  }

  if (nodes.some((node) => node.challengeExhausted)) {
    add("⚠ coverage unproven", theme.warning);
  }
  return lines;
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
}

/**
 * Derives the vertical budget of one frame from the terminal height. Ink clears
 * and scrolls the terminal whenever a frame exceeds the viewport, which reads
 * as a flash on every repaint, so the fixed chrome (root padding, header,
 * legend, status or input box, pane borders and labels) is subtracted first and
 * the panes receive only what is left.
 */
export function frameLayout(rows: number | undefined, mode: InputMode): FrameLayout {
  const frameRows = typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : UNKNOWN_WINDOW_ROWS;
  void mode;
  const chromeRows = FRAME_PADDING_ROWS + HEADER_ROWS + LEGEND_ROWS + MESSAGE_PANEL_ROWS;
  const paneRows = Math.max(MIN_PANE_ROWS, frameRows - chromeRows - PANE_FRAME_ROWS);
  return { frameRows, treeRows: paneRows, detailRows: paneRows };
}

