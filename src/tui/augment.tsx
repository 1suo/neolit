import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput, useWindowSize, type RenderOptions } from "ink";
import type { PlanNode, PlanTask, PlannedDiff } from "../augment/types.js";
import { AugmentTuiController, candidatesForEntry, entryHasPlan, type PlannedTreeRow, type TuiActionState } from "./controller.js";

const theme = {
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

type InputMode = "idle" | "objective" | "explanation" | "message" | "reopen" | "stale";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface LiveStatus {
  spinner: string;
  active?: { nodeId?: string; operation?: string };
  failed?: { nodeId?: string; operation?: string; error?: string };
}

interface RowLiveFlags {
  active?: boolean;
  failed?: boolean;
  spinner?: string;
  operation?: string;
}

function entryTouchesNode(entry: PlannedTreeRow["entry"], nodeId?: string): boolean {
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
  if (["stale", "blocked", "eliminated"].includes(status)) return theme.error;
  return theme.muted;
}

function entryName(entry: PlannedTreeRow["entry"]): string {
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

function entryState(task: PlanTask | undefined, row: PlannedTreeRow, pendingMarks: string[] = [], live?: RowLiveFlags, appliedDiffIds: string[] = [], pendingMode: "lock" | "allow" = "lock"): { indicator: string; suffix: string; color: string } {
  const entry = row.entry;
  const candidates = candidatesForEntry(task, entry);
  const selected = candidates.find((candidate) => candidate.status === "selected");
  const possible = candidates.filter((candidate) => candidate.status === "possible");
  const diffs = entry.diffIds.map((id) => task?.diffs[id]).filter(Boolean) as PlannedDiff[];
  const explanations = entry.explanationIds.map((id) => task?.explanations[id]).filter(Boolean);
  const blocked = entry.nodeIds.some((id) => ["stale", "blocked"].includes(task?.nodes[id]?.status ?? ""));
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

function PlannedRow(props: { row: PlannedTreeRow; task?: PlanTask; selected: boolean; width: number; pendingMarks?: string[]; live?: RowLiveFlags; appliedDiffIds?: string[]; pendingMode?: "lock" | "allow" }) {
  const state = entryState(props.task, props.row, props.pendingMarks, props.live, props.appliedDiffIds, props.pendingMode);
  return (
    <Box backgroundColor={props.selected ? theme.selected : undefined}>
      <Text wrap="truncate-end">
        {props.row.branch}
        {state.indicator ? <Text color={state.color}>{state.indicator}</Text> : null}
        {state.indicator ? " " : null}
        <Text
          color={props.row.repositoryOnly ? theme.muted : props.row.entry.kind === "dir" ? theme.accent : theme.text}
          bold={!props.row.repositoryOnly}
        >
          {entryName(props.row.entry)}
        </Text>
        {state.suffix ? (
          <>
            {" "}
            <Text color={theme.muted}>{state.suffix}</Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
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
export function detailLines(task: PlanTask | undefined, row: PlannedTreeRow | undefined, pendingMarks: string[] = [], live?: LiveStatus, appliedDiffIds: string[] = [], pendingMode: "lock" | "allow" = "lock"): DetailLine[] {
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
  const state = entryState(task, row, pendingMarks, undefined, appliedDiffIds, pendingMode);
  const isDirectory = entry.kind === "dir" || entry.kind === "root";
  const descriptionFor = (diff: PlannedDiff) => task?.nodes[diff.nodeId]?.reason;

  const plannedChildren = isDirectory ? entry.children.filter((child) => entryHasPlan(child)) : [];
  if (nodes.length || plannedChildren.length || possible.length || explanations.length || notes.length) {
    label("DESCRIPTION");
    for (const node of nodes) {
      add(`  ${node.reason}`, theme.text);
      if (node.blockedReason) add(`  ${node.blockedReason}`, theme.error);
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
        }, pendingMarks, childLive, appliedDiffIds, pendingMode);
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
    else add("  [Enter] message/regenerate · [D] develop selected path", theme.muted);
  }

  if (nodes.some((node) => node.challengeExhausted)) {
    add("⚠ coverage unproven", theme.warning);
  }
  return lines;
}

function DetailView(props: { state: TuiActionState; row?: PlannedTreeRow; offset: number; limit: number; live?: LiveStatus }) {
  const lines = useMemo(() => detailLines(props.state.task, props.row, props.state.pendingMarks, props.live, props.state.appliedDiffIds, props.state.pendingMode), [props.state.task, props.row, props.state.pendingMarks, props.live, props.state.appliedDiffIds, props.state.pendingMode]);
  const clamped = Math.min(props.offset, Math.max(0, lines.length - props.limit));
  const visible = lines.slice(clamped, clamped + props.limit);
  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((line, index) => (
        <Text key={`${clamped + index}:${line.text}`} wrap="wrap" color={line.color} bold={line.bold}>{line.text}</Text>
      ))}
    </Box>
  );
}

function inputTitle(mode: InputMode, target = "repo"): string {
  if (mode === "objective") return "What should change?";
  if (mode === "explanation") return "Explain what repository topic?";
  if (mode === "message") return `${target} · message (empty = rethink)`;
  if (mode === "reopen") return "Reason for reopening selected node";
  if (mode === "stale") return "Changed repository path";
  return "Message";
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

function visibleWindow<T>(items: T[], selected: number, limit: number): T[] {
  if (items.length <= limit) return items;
  const start = Math.max(0, Math.min(items.length - limit, selected - Math.floor(limit / 2)));
  return items.slice(start, start + limit);
}

export function AugmentTui(props: { controller: AugmentTuiController; modelAvailable: boolean; modelLabel?: string }) {
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const [state, setState] = useState<TuiActionState>(() => props.controller.snapshot());
  const [pane, setPane] = useState<"tree" | "detail">("tree");
  const [detailOffset, setDetailOffset] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [mode, setMode] = useState<InputMode>("idle");
  const [inputValue, setInputValue] = useState("");
  const autoGenerated = useRef(new Set<string>());
  const initialSnapshot = state;

  useEffect(() => {
    if (!state.busy) return;
    const timer = setInterval(() => setSpinnerFrame((current) => current + 1), 120);
    return () => clearInterval(timer);
  }, [state.busy]);

  const sync = () => {
    setState(props.controller.snapshot());
  };

  const run = (action: Promise<void>) => {
    // Controller dispatch marks itself busy synchronously before its first await.
    sync();
    void action.then(sync, (error: unknown) => {
      setState((current) => ({
        ...current,
        busy: false,
        operation: undefined,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  };

  useEffect(() => {
    const task = initialSnapshot.task;
    const root = task?.nodes[task.rootNodeId];
    if (!props.modelAvailable || !task || task.mode !== "change" || !root || root.status !== "unresolved" || root.candidateIds.length || initialSnapshot.busy || autoGenerated.current.has(task.id)) return;
    autoGenerated.current.add(task.id);
    run(props.controller.crystallize());
  }, [props.controller, props.modelAvailable, initialSnapshot]);

  useEffect(() => {
    setDetailOffset(0);
  }, [state.selectedRowId]);

  const beginInput = (next: InputMode) => {
    setMode(next);
    setInputValue("");
  };

  const cancelInput = () => {
    setMode("idle");
    setInputValue("");
  };

  const submit = (submittedValue = inputValue) => {
    const value = submittedValue;
    const activeMode = mode;
    cancelInput();
    if (activeMode === "objective") run(props.controller.start(value));
    else if (activeMode === "explanation") run(props.controller.explain(value));
    else if (activeMode === "message") run(props.controller.rethink(value));
    else if (activeMode === "reopen") run(props.controller.reopen(value));
    else if (activeMode === "stale") run(props.controller.markStale(value));
  };

  useInput((input, key) => {
    if (mode !== "idle") {
      const submitMarker = key.return || key.tab || input.includes("\r") || input.includes("\n") || input.includes("\t");
      if (submitMarker) {
        const pastedPrefix = input.split(/[\r\n\t]/)[0] ?? "";
        const value = inputValue + pastedPrefix;
        setInputValue(value);
        submit(value);
      }
      else if (key.escape) cancelInput();
      else if (key.backspace) setInputValue((current) => current.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setInputValue((current) => current + input);
      return;
    }

    if (pane === "detail" && (key.upArrow || input === "k")) {
      setDetailOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (pane === "detail" && (key.downArrow || input === "j")) {
      setDetailOffset((current) => current + 1);
      return;
    }
    if (key.upArrow || input === "k") {
      props.controller.move(-1);
      sync();
      return;
    }
    if (key.downArrow || input === "j") {
      props.controller.move(1);
      sync();
      return;
    }
    if (key.tab || key.rightArrow) {
      setPane((current) => (current === "tree" ? "detail" : "tree"));
      return;
    }
    if (key.leftArrow) {
      setPane("tree");
      return;
    }
    if (key.return || input === "\r" || input === "\n") {
      if (!state.task) {
        setState((current) => ({ ...current, error: "No task is active. Press [N] for a change or [E] for an explanation." }));
        return;
      }
      beginInput("message");
      return;
    }

    const command = input.toLowerCase();
    const selectedEntry = props.controller.selectedRow()?.entry;
    const choices = candidatesForEntry(props.controller.snapshot().task, selectedEntry).filter((candidate) => candidate.status === "possible");
    const numericChoice = Number(command);
    if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= choices.length) {
      run(props.controller.selectCandidate(choices[numericChoice - 1]!.id));
      return;
    }

    if (command === "q") {
      props.controller.cancel();
      exit();
    }
    else if (command === "n") beginInput("objective");
    else if (command === "e") beginInput("explanation");
    else if (command === "d") run(props.controller.develop());
    else if (command === "a") run(props.controller.applySelected());
    else if (command === "l") run(props.controller.toggleRestriction("lock"));
    else if (command === "w") run(props.controller.toggleRestriction("allow"));
    else if (command === "o") beginInput("reopen");
    else if (command === "s") beginInput("stale");
  });

  const selectedIndex = state.rows.findIndex((row) => row.id === state.selectedRowId);
  const layout = frameLayout(windowSize.rows, mode);
  const treeRows = visibleWindow(state.rows, selectedIndex, layout.treeRows);
  const treeWidth = Math.max(30, Math.floor(windowSize.columns * 0.42) - 6);
  const detailLimit = layout.detailRows;
  const spinner = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]!;
  const liveStatus: LiveStatus | undefined = state.active || state.failed
    ? { spinner, active: state.active, failed: state.failed }
    : undefined;
  const rootStatus = state.task?.nodes[state.task.rootNodeId]?.status;
  const status = state.busy
    ? "BUSY"
    : state.task?.mode === "explanation"
      ? Object.keys(state.task.explanations).length ? "EXPLAINED" : "EXPLAINING"
      : rootStatus ? rootStatus.toUpperCase() : "IDLE";
  const selectedRow = state.rows.find((row) => row.id === state.selectedRowId);
  const statusMessage = state.busy ? `${state.operation ?? "Working"}...` : state.error ?? state.message;

  return (
    <Box flexDirection="column" height={layout.frameRows} width={windowSize.columns} padding={1}>
      <Box gap={2} flexShrink={0}>
        <Text color={theme.primary} bold>NEOLIT</Text>
        <Text color={state.error ? theme.error : status === "IDLE" ? theme.muted : theme.success}>[{status}]</Text>
        <Text color={theme.secondary}>[{state.task?.mode === "explanation" ? "EXPLANATION" : "PLANNED CHANGE"}]</Text>
        {(state.task?.lockedPaths.length ?? 0) > 0 || state.pendingMarks.length > 0 ? (
          <Text color={(state.task?.restrictionMode ?? state.pendingMode) === "lock" ? theme.error : theme.accent}>
            [{(state.task?.restrictionMode ?? state.pendingMode) === "lock" ? "LOCK" : "ALLOW"} {state.task?.lockedPaths.length ?? state.pendingMarks.length}]
          </Text>
        ) : null}
        {state.task ? (
          <Text color={theme.muted}>r{state.task.revision} · {state.task.basisRevision.slice(0, 12)}</Text>
        ) : null}
        <Box flexGrow={1} />
        <Text color={props.modelAvailable ? theme.success : theme.warning}>{props.modelAvailable ? props.modelLabel ?? "OPENCODE" : "NO MODEL"}</Text>
      </Box>

      <Box flexGrow={1} minHeight={0} gap={1}>
        <Box width="42%" flexShrink={0} borderStyle="round" borderColor={pane === "tree" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden" paddingX={1}>
          <Text color={pane === "tree" ? theme.primary : theme.muted} bold>FILES</Text>
          {treeRows.length === 0 ? (
            <Text color={theme.muted}>No plan yet. Press [N].</Text>
          ) : treeRows.map((row) => {
            const activeRow = entryTouchesNode(row.entry, state.active?.nodeId);
            const failedRow = entryTouchesNode(row.entry, state.failed?.nodeId);
            return (
              <PlannedRow
                key={row.id}
                row={row}
                task={state.task}
                selected={state.selectedRowId === row.id}
                width={treeWidth}
                pendingMarks={state.pendingMarks}
                live={activeRow || failedRow ? { active: activeRow, failed: failedRow, spinner, operation: state.active?.operation } : undefined}
                appliedDiffIds={state.appliedDiffIds}
                pendingMode={state.pendingMode}
              />
            );
          })}
        </Box>

        <Box flexGrow={1} minWidth={30} borderStyle="round" borderColor={pane === "detail" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden" paddingTop={0}>
          <DetailView state={state} row={selectedRow} offset={detailOffset} limit={detailLimit} live={liveStatus} />
        </Box>
      </Box>

      <Box paddingTop={1} flexShrink={0}>
        <Text wrap="truncate-end">
          <Text color={theme.primary} bold>[Enter]</Text>
          <Text color={theme.primary}> prompt/regenerate · </Text>
          <Text color={theme.primary} bold>[1-7]</Text>
          <Text color={theme.primary}> choose approach · </Text>
          <Text color={theme.primary} bold>[D]</Text>
          <Text color={theme.primary}> develop · </Text>
          <Text color={theme.primary} bold>[A]</Text>
          <Text color={theme.primary}> apply · </Text>
          <Text color={theme.primary} bold>[L]</Text>
          <Text color={theme.primary}> lock · </Text>
          <Text color={theme.primary} bold>[W]</Text>
          <Text color={theme.primary}> allow · </Text>
          <Text color={theme.primary} bold>[E]</Text>
          <Text color={theme.primary}> explain · </Text>
          <Text color={theme.primary} bold>[N]</Text>
          <Text color={theme.primary}> new · </Text>
          <Text color={theme.muted} bold>[Tab]</Text>
          <Text color={theme.muted}> pane · </Text>
          <Text color={theme.muted} bold>[Q]</Text>
          <Text color={theme.muted}> quit</Text>
        </Text>
      </Box>

      {mode === "idle" ? (
        <Box borderStyle="round" borderColor={state.error ? theme.error : state.busy ? theme.warning : theme.border} flexShrink={0} paddingX={1}>
          <Text wrap="wrap" color={state.error ? theme.error : state.busy ? theme.warning : theme.muted}>
            {state.busy ? `${spinner} ${state.operation ?? "Working"}…` : state.error ? state.error.split(/\r?\n/)[0] : statusMessage}
          </Text>
        </Box>
      ) : (
        <Box borderStyle="round" borderColor={theme.borderActive} paddingX={1} flexShrink={0}>
          <Text color={theme.primary} bold>{inputTitle(mode, selectedRow?.entry.path && selectedRow.entry.path !== "." ? selectedRow.entry.path : "repo")} › </Text>
          <Text>{inputValue}<Text inverse> </Text>{inputValue ? "" : inputTitle(mode, selectedRow?.entry.path && selectedRow.entry.path !== "." ? selectedRow.entry.path : "repo")}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Renderer options for the plan TUI. `incrementalRendering` makes Ink rewrite
 * only the lines whose content changed instead of erasing the previous frame
 * and rewriting it whole, so a keypress repaint no longer flashes.
 * `alternateScreen` keeps the plan in a dedicated terminal buffer.
 */
export function tuiRenderOptions(): RenderOptions {
  return {
    alternateScreen: true,
    incrementalRendering: true,
  };
}

export async function runAugmentTui(controller: AugmentTuiController, modelAvailable: boolean, modelLabel?: string): Promise<void> {
  const instance = render(<AugmentTui controller={controller} modelAvailable={modelAvailable} modelLabel={modelLabel} />, tuiRenderOptions());
  await instance.waitUntilExit();
}

export type { PlanTask };
