import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput, useWindowSize } from "ink";
import type { PlanNode, PlanTask, PlannedDiff } from "../augment/types.js";
import { pathIsLocked } from "../augment/state.js";
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

function diffState(diffs: PlannedDiff[]): { indicator: string; state: string; color: string } | undefined {
  if (!diffs.length) return undefined;
  const counts = diffs.reduce((accumulator, diff) => {
    accumulator[diff.kind] = (accumulator[diff.kind] ?? 0) + 1;
    return accumulator;
  }, {} as Record<PlannedDiff["kind"], number>);
  if (diffs.length === 1) {
    const diff = diffs[0]!;
    return { indicator: diffIndicator(diff.kind), state: diffLabel(diff.kind), color: diff.kind === "delete" ? theme.error : theme.success };
  }
  const parts: string[] = [];
  if (counts.new) parts.push(`+${counts.new}`);
  if (counts.modify) parts.push(`~${counts.modify}`);
  if (counts.delete) parts.push(`-${counts.delete}`);
  if (counts.unknown) parts.push(`▤${counts.unknown}`);
  return { indicator: "Δ", state: parts.join(" "), color: counts.delete ? theme.warning : theme.success };
}

function entryState(task: PlanTask | undefined, row: PlannedTreeRow, pendingLocks: string[] = [], live?: RowLiveFlags, appliedDiffIds: string[] = []): { indicator: string; state: string; color: string } {
  const entry = row.entry;
  const candidates = candidatesForEntry(task, entry);
  const selected = candidates.find((candidate) => candidate.status === "selected");
  const possible = candidates.filter((candidate) => candidate.status === "possible");
  const diffs = entry.diffIds.map((id) => task?.diffs[id]).filter(Boolean) as PlannedDiff[];
  const explanations = entry.explanationIds.map((id) => task?.explanations[id]).filter(Boolean);
  const blocked = entry.nodeIds.some((id) => ["stale", "blocked"].includes(task?.nodes[id]?.status ?? ""));
  const ready = entry.nodeIds.some((id) => task?.nodes[id]?.status === "ready");
  const locked = entry.path !== "." && ((task && pathIsLocked(task, entry.path)) || pendingLocks.includes(entry.path));
  const applied = diffs.filter((diff) => appliedDiffIds.includes(diff.id));
  const drafted = diffState(diffs);

  if (live?.active) return { indicator: live.spinner ?? "⠋", state: `${(live.operation ?? "working").toLowerCase()}…`, color: theme.warning };
  if (live?.failed) return { indicator: "×", state: "failed · see preview", color: theme.error };
  if (locked) return { indicator: "#", state: "locked", color: theme.error };
  if (explanations.length) {
    const primary = explanations.some((explanation) => explanation!.role === "primary");
    return { indicator: "?", state: `${primary ? "primary" : "related"} ${explanations.length}`, color: primary ? theme.warning : theme.accent };
  }
  if (blocked) return { indicator: "!", state: "needs refresh", color: theme.error };
  if (applied.length) return { indicator: "✓", state: applied.length === diffs.length ? "applied" : `applied ${applied.length}/${diffs.length}`, color: theme.success };
  if (drafted) return drafted;
  if (entry.nodeIds.length && entry.kind !== "root") return { indicator: "~", state: "planned", color: theme.text };
  if (ready) return { indicator: "●", state: "ready", color: theme.success };
  if (selected && entry.kind !== "root") return { indicator: "◇", state: `chosen · ${selected.confidence}%`, color: theme.secondary };
  if (selected) return { indicator: "◆", state: `chosen · ${selected.confidence}%`, color: theme.secondary };
  if (possible.length) {
    const best = Math.max(...possible.map((candidate) => candidate.confidence));
    return { indicator: "◇", state: `${possible.length} choices · best ${best}%`, color: theme.warning };
  }
  if (row.repositoryOnly) return { indicator: "", state: "", color: theme.muted };
  return { indicator: "·", state: "suggested", color: theme.muted };
}

const STATE_COLUMN = 22;

function PlannedRow(props: { row: PlannedTreeRow; task?: PlanTask; selected: boolean; width: number; pendingLocks?: string[]; live?: RowLiveFlags; appliedDiffIds?: string[] }) {
  const state = entryState(props.task, props.row, props.pendingLocks, props.live, props.appliedDiffIds);
  const leftWidth = Math.max(20, props.width - STATE_COLUMN);
  const prefix = `${props.row.branch}${state.indicator ? `${state.indicator} ` : ""}`;
  const name = entryName(props.row.entry);
  const prefixWidth = [...prefix].length;
  const nameBudget = leftWidth - prefixWidth;
  const shown = [...name].length >= nameBudget ? crop(name, Math.max(3, nameBudget - 1)) : name;
  const pad = nameBudget - [...shown].length > 0 ? " ".repeat(nameBudget - [...shown].length) : " ";
  return (
    <Box backgroundColor={props.selected ? theme.selected : undefined}>
      <Text wrap="truncate-end">
        {prefix}
        <Text
          color={props.row.repositoryOnly ? theme.muted : props.row.entry.kind === "dir" ? theme.accent : theme.text}
          bold={!props.row.repositoryOnly}
        >
          {shown}
        </Text>
        {pad}
        <Text color={state.color}>{state.state}</Text>
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
 * colored lines the pane can scroll. File rows render their full exact patch;
 * directory rows render a summary derived from their immediate contents plus
 * aggregated descendant changes.
 */
export function detailLines(task: PlanTask | undefined, row: PlannedTreeRow | undefined, pendingLocks: string[] = [], live?: LiveStatus, appliedDiffIds: string[] = []): DetailLine[] {
  const lines: DetailLine[] = [];
  const add = (text: string, color: string, bold = false) => lines.push({ text: text.length ? text : " ", color, bold });
  const label = (text: string) => add(text, theme.muted);

  if (live?.active) {
    const target = task?.nodes[live.active.nodeId ?? ""]?.path;
    add(`${live.spinner} ${live.active.operation ?? "Working"}…${target && target !== "." ? ` · ${target}` : ""}`, theme.warning, true);
  }
  if (live?.failed) {
    add(`× ${live.failed.operation ?? "Last operation"} failed — press the same key again to retry`, theme.error, true);
    if (live.failed.error) add(`  ${crop(live.failed.error.split(/\r?\n/)[0] ?? "", 180)}`, theme.error);
  }
  if (!row) {
    lines.push({ text: "  Describe a change to see affected files.", color: theme.muted });
    return lines;
  }
  const entry = row.entry;
  const nodes = entry.nodeIds.map((id) => task?.nodes[id]).filter(Boolean) as PlanNode[];
  const candidates = candidatesForEntry(task, entry);
  const diffs = entry.diffIds.flatMap((id) => {
    const diff = task?.diffs[id];
    return diff ? [diff] : [];
  });
  const notes = constraintsForEntry(task, entry);
  const explanations = explanationsForEntry(task, entry);
  const state = entryState(task, row, pendingLocks, undefined, appliedDiffIds);
  const isDirectory = entry.kind === "dir" || entry.kind === "root";
  const descriptionFor = (diff: PlannedDiff) => task?.nodes[diff.nodeId]?.reason;

  add(state.indicator ? `${state.indicator} ${entryName(entry)}` : entryName(entry), state.color, true);
  if (state.state) label(state.state);

  if (isDirectory) {
    const plannedChildren = entry.children.filter((child) => entryHasPlan(child));
    if (plannedChildren.length) {
      label(`CONTENTS · ${plannedChildren.length} ${plannedChildren.length === 1 ? "entry" : "entries"}`);
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
        }, pendingLocks, childLive, appliedDiffIds);
        const reason = child.nodeIds.map((id) => task?.nodes[id]?.reason).find((value) => value?.length);
        add(`  ${childState.indicator} ${entryName(child)} · ${childState.state}${reason ? ` — ${crop(reason, 56)}` : ""}`, childState.color);
      }
      if (plannedChildren.length > FOLDER_CONTENT_PREVIEW) {
        add(`  + ${plannedChildren.length - FOLDER_CONTENT_PREVIEW} more entries`, theme.muted);
      }
    }
  }

  if (diffs.length) {
    const appliedCount = diffs.filter((diff) => appliedDiffIds.includes(diff.id)).length;
    const appliedSuffix = appliedCount === diffs.length ? " · applied, not committed" : appliedCount ? ` · ${appliedCount}/${diffs.length} applied` : "";
    label(isDirectory ? "FOLDER CHANGE SUMMARY" : "FILE CHANGE");
    add(changeSummary(diffs) + appliedSuffix, state.color, true);
    if (isDirectory) {
      label("EXACT DIFF");
      for (const diff of diffs.slice(0, 3)) {
        add(`  ${diffIndicator(diff.kind)} ${diff.path || diff.id} · ${diffLabel(diff.kind)}${appliedDiffIds.includes(diff.id) ? " · applied" : ""}`, diff.kind === "delete" ? theme.error : theme.success);
        if (descriptionFor(diff)) add(`  ${descriptionFor(diff)}`, theme.text);
        const patchLines = diff.patch.split(/\r?\n/);
        for (const line of patchLines.slice(0, FOLDER_PATCH_PREVIEW)) add(`  ${line}`, diffColor(line));
        if (patchLines.length > FOLDER_PATCH_PREVIEW) add(`  … ${patchLines.length - FOLDER_PATCH_PREVIEW} more diff lines`, theme.muted);
      }
      if (diffs.length > 3) add(`  + ${diffs.length - 3} more patches`, theme.muted);
    }
    else {
      const totalLines = diffs.reduce((count, diff) => count + diff.patch.split(/\r?\n/).length, 0);
      label(`EXACT DIFF · ${totalLines} lines · basis ${diffs[0]!.basisRevision.slice(0, 12)}`);
      for (const diff of diffs) {
        add(`${diffIndicator(diff.kind)} ${diff.path || diff.id} · ${diffLabel(diff.kind)}${appliedDiffIds.includes(diff.id) ? " · applied" : ""}`, diff.kind === "delete" ? theme.error : theme.success);
        if (descriptionFor(diff)) add(`  ${descriptionFor(diff)}`, theme.text);
        for (const line of diff.patch.split(/\r?\n/)) add(line, diffColor(line));
      }
    }
  }
  else if (nodes.length) {
    label(isDirectory ? "FOLDER PLAN" : "FILE PLAN");
    for (const node of nodes) {
      add(`  ${node.reason}`, theme.text);
      if (node.blockedReason) add(`  ${node.blockedReason}`, theme.error);
    }
    if (!isDirectory) add("[D] draft this file's exact patch · [A] apply it after drafting", theme.primary);
  }

  if (nodes.some((node) => node.challengeExhausted)) {
    add("BOUNDED CHALLENGE · omissions were found; coverage is not proven", theme.warning);
  }

  if (candidates.length) label("APPROACHES");
  candidates.forEach((candidate, index) => {
    add(
      `${candidate.status === "possible" ? `${index + 1}` : " "} ${candidate.status === "selected" ? "◆" : candidate.status === "eliminated" ? "×" : "◇"} ${candidate.label} · ${candidate.confidence}%`,
      statusColor(candidate.status),
    );
    add(`  ${candidate.rationale}`, theme.muted);
    add(`  ${candidate.touchedPaths.join(", ")}`, theme.accent);
  });

  if (explanations.length) label("EXPLANATION");
  for (const explanation of explanations.slice(0, 8)) {
    add(`? ${explanation.path} · ${explanation.role} · ${explanation.confidence}%`, explanation.role === "primary" ? theme.warning : theme.accent);
    add(`  ${explanation.summary}`, theme.text);
    add(`  ${explanation.detail}`, theme.muted);
  }
  if (explanations.length > 8) add(`  + ${explanations.length - 8} more related paths`, theme.muted);

  if (notes.length) label("MESSAGES");
  for (const note of notes) add(`  ${note.text}`, theme.warning);

  add("[Enter] message/regenerate · [L] lock", theme.primary);
  return lines;
}

function DetailView(props: { state: TuiActionState; row?: PlannedTreeRow; offset: number; limit: number; live?: LiveStatus }) {
  const lines = useMemo(() => detailLines(props.state.task, props.row, props.state.pendingLocks, props.live, props.state.appliedDiffIds), [props.state.task, props.row, props.state.pendingLocks, props.live, props.state.appliedDiffIds]);
  const clamped = Math.min(props.offset, Math.max(0, lines.length - props.limit));
  const visible = lines.slice(clamped, clamped + props.limit);
  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((line, index) => (
        <Text key={`${clamped + index}:${line.text}`} wrap="truncate-end" color={line.color} bold={line.bold}>{line.text}</Text>
      ))}
    </Box>
  );
}

function inputTitle(mode: InputMode): string {
  if (mode === "objective") return "What should change?";
  if (mode === "explanation") return "Explain what repository topic?";
  if (mode === "message") return "Message about selected path";
  if (mode === "reopen") return "Reason for reopening selected node";
  if (mode === "stale") return "Changed repository path";
  return "Message";
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
    else if (activeMode === "explanation") run(props.controller.startExplanation(value));
    else if (activeMode === "message") run(props.controller.constrain(value));
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
    else if (command === "g") run(props.controller.rethink());
    else if (command === "f") run(props.controller.refine());
    else if (command === "d") run(props.controller.draftPatch());
    else if (command === "a") run(props.controller.applySelected());
    else if (command === "l") run(props.controller.toggleLock());
    else if (command === "o") beginInput("reopen");
    else if (command === "s") beginInput("stale");
  });

  const selectedIndex = state.rows.findIndex((row) => row.id === state.selectedRowId);
  const treeRows = visibleWindow(state.rows, selectedIndex, Math.max(6, windowSize.rows - 12));
  const treeWidth = Math.max(30, Math.floor(windowSize.columns * 0.42) - 6);
  const detailLimit = Math.max(6, (windowSize.rows || 0) - 9);
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
    <Box flexDirection="column" height={windowSize.rows} width={windowSize.columns} padding={1}>
      <Box gap={2} flexShrink={0}>
        <Text color={theme.primary} bold>NEOLIT</Text>
        <Text color={state.error ? theme.error : status === "IDLE" ? theme.muted : theme.success}>[{status}]</Text>
        <Text color={theme.secondary}>[{state.task?.mode === "explanation" ? "EXPLANATION" : "PLANNED CHANGE"}]</Text>
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
                pendingLocks={state.pendingLocks}
                live={activeRow || failedRow ? { active: activeRow, failed: failedRow, spinner, operation: state.active?.operation } : undefined}
                appliedDiffIds={state.appliedDiffIds}
              />
            );
          })}
        </Box>

        <Box flexGrow={1} minWidth={30} borderStyle="round" borderColor={pane === "detail" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden">
          <Box paddingLeft={1}>
            <Text color={pane === "detail" ? theme.primary : theme.muted} bold>SELECTED PATH</Text>
          </Box>
          <DetailView state={state} row={selectedRow} offset={detailOffset} limit={detailLimit} live={liveStatus} />
        </Box>
      </Box>

      <Box paddingTop={1} flexShrink={0}>
        <Text wrap="truncate-end">
          <Text color={theme.primary} bold>[Enter]</Text>
          <Text color={theme.primary}> message · </Text>
          <Text color={theme.primary} bold>[1-7]</Text>
          <Text color={theme.primary}> choose approach · </Text>
          <Text color={theme.primary} bold>[F]</Text>
          <Text color={theme.primary}> files · </Text>
          <Text color={theme.primary} bold>[D]</Text>
          <Text color={theme.primary}> draft · </Text>
          <Text color={theme.primary} bold>[A]</Text>
          <Text color={theme.primary}> apply · </Text>
          <Text color={theme.primary} bold>[G]</Text>
          <Text color={theme.primary}> rethink · </Text>
          <Text color={theme.primary} bold>[L]</Text>
          <Text color={theme.primary}> lock · </Text>
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
        state.error ? (
          <Text color={theme.error}>{state.error}</Text>
        ) : (
          <Text color={state.busy ? theme.warning : theme.muted}>{statusMessage}</Text>
        )
      ) : (
        <Box borderStyle="round" borderColor={theme.borderActive} paddingX={1} flexShrink={0}>
          <Text color={theme.primary} bold>{inputTitle(mode)} › </Text>
          <Text>{inputValue}<Text inverse> </Text>{inputValue ? "" : inputTitle(mode)}</Text>
        </Box>
      )}
    </Box>
  );
}

export async function runAugmentTui(controller: AugmentTuiController, modelAvailable: boolean, modelLabel?: string): Promise<void> {
  const instance = render(<AugmentTui controller={controller} modelAvailable={modelAvailable} modelLabel={modelLabel} />, { alternateScreen: true });
  await instance.waitUntilExit();
}

export type { PlanTask };
