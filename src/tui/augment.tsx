import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput, useWindowSize } from "ink";
import type { PlanTask, PlannedDiff } from "../augment/types.js";
import { pathIsLocked } from "../augment/state.js";
import { AugmentTuiController, candidatesForEntry, type PlannedTreeRow, type TuiActionState } from "./controller.js";

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

type InputMode = "idle" | "objective" | "message" | "reopen" | "stale";

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

function entryState(task: PlanTask | undefined, row: PlannedTreeRow): { indicator: string; state: string; color: string } {
  const entry = row.entry;
  const candidates = candidatesForEntry(task, entry);
  const selected = candidates.find((candidate) => candidate.status === "selected");
  const possible = candidates.filter((candidate) => candidate.status === "possible");
  const firstDiff = entry.diffIds.map((id) => task?.diffs[id]).find(Boolean);
  const blocked = entry.nodeIds.some((id) => ["stale", "blocked"].includes(task?.nodes[id]?.status ?? ""));
  const ready = entry.nodeIds.some((id) => task?.nodes[id]?.status === "ready");
  const locked = task && entry.path !== "." && pathIsLocked(task, entry.path);

  if (locked) return { indicator: "#", state: "locked", color: theme.error };
  if (blocked) return { indicator: "!", state: "needs refresh", color: theme.error };
  if (firstDiff) {
    const kind = firstDiff.kind;
    return {
      indicator: kind === "new" ? "+" : kind === "delete" ? "-" : kind === "modify" ? "~" : "▤",
      state: kind,
      color: theme.success,
    };
  }
  if (entry.nodeIds.length && entry.kind !== "root") return { indicator: "~", state: "planned", color: theme.text };
  if (ready) return { indicator: "●", state: "ready", color: theme.success };
  if (selected && entry.kind !== "root") return { indicator: "◇", state: `in chosen ${selected.confidence}%`, color: theme.secondary };
  if (selected) return { indicator: "◆", state: `chosen ${selected.confidence}%`, color: theme.secondary };
  if (possible.length) {
    const best = Math.max(...possible.map((candidate) => candidate.confidence));
    return { indicator: "◇", state: `${possible.length} choices · best ${best}%`, color: theme.warning };
  }
  if (row.repositoryOnly) return { indicator: "·", state: "unchanged", color: theme.muted };
  return { indicator: "·", state: "suggested", color: theme.muted };
}

function PlannedRow(props: { row: PlannedTreeRow; task?: PlanTask; selected: boolean; width: number }) {
  const state = entryState(props.task, props.row);
  return (
    <Box backgroundColor={props.selected ? theme.selected : undefined}>
      <Text wrap="truncate-end">
        {props.row.branch}
        <Text color={state.color}>{state.indicator}</Text>{" "}
        <Text
          color={props.row.repositoryOnly ? theme.muted : props.row.entry.kind === "dir" ? theme.accent : theme.text}
          bold={!props.row.repositoryOnly}
        >
          {entryName(props.row.entry)}
        </Text>
        {" "}
        <Text color={theme.muted}>{state.state}</Text>
      </Text>
    </Box>
  );
}

function DiffDetail(props: { diff: PlannedDiff }) {
  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box gap={1}>
        <Text color={theme.success} bold>{props.diff.kind === "new" ? "+" : props.diff.kind === "delete" ? "-" : props.diff.kind === "modify" ? "~" : "▤"} {props.diff.path || props.diff.id}</Text>
        <Text color={theme.muted}>{props.diff.kind} · {props.diff.basisRevision}</Text>
      </Box>
      <Text>{props.diff.patch}</Text>
    </Box>
  );
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

function EntryDetail(props: { state: TuiActionState; row?: PlannedTreeRow }) {
  const task = props.state.task;
  const row = props.row;
  const nodes = useMemo(() => row?.entry.nodeIds.map((id) => task?.nodes[id]).filter(Boolean) ?? [], [row, task]);
  const candidates = useMemo(() => candidatesForEntry(task, row?.entry), [row, task]);
  const diffs = useMemo(() => row?.entry.diffIds.flatMap((id) => {
    const diff = task?.diffs[id];
    return diff ? [diff] : [];
  }) ?? [], [row, task]);
  const notes = useMemo(() => constraintsForEntry(task, row?.entry), [row, task]);

  if (!row) return <Text color={theme.muted}>  Describe a change to see affected files.</Text>;
  const state = entryState(task, row);

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box gap={1}>
        <Text color={state.color} bold>{state.indicator} {entryName(row.entry)}</Text>
        <Text color={theme.muted}>{state.state}</Text>
      </Box>

      {nodes.map((node) => (
        <Box key={node!.id} flexDirection="column">
          <Text color={theme.muted}>  {node!.reason}</Text>
          {node!.blockedReason ? <Text color={theme.error}>  {node!.blockedReason}</Text> : null}
        </Box>
      ))}

      {candidates.length ? <Text color={theme.muted}>APPROACHES</Text> : null}
      {candidates.map((candidate, index) => (
        <Box key={candidate.id} flexDirection="column">
          <Text color={statusColor(candidate.status)}>
            {candidate.status === "possible" ? `${index + 1}` : " "} {candidate.status === "selected" ? "◆" : candidate.status === "eliminated" ? "×" : "◇"} {candidate.label} · {candidate.confidence}%
          </Text>
          <Text color={theme.muted}>  {candidate.rationale}</Text>
          <Text color={theme.accent}>  {candidate.touchedPaths.join(", ")}</Text>
        </Box>
      ))}

      {notes.length ? <Text color={theme.muted}>MESSAGES</Text> : null}
      {notes.map((note) => (
        <Text key={note.id} color={theme.warning}>  {note.text}</Text>
      ))}

      {diffs.length ? <Text color={theme.muted}>PATCH</Text> : null}
      {diffs.map((diff) => <DiffDetail key={diff.id} diff={diff} />)}

      <Text color={theme.primary}>[Enter] message/regenerate this path · [L] lock/unlock</Text>
    </Box>
  );
}

function DetailView(props: { state: TuiActionState }) {
  const row = props.state.rows.find((item) => item.id === props.state.selectedRowId);
  return <EntryDetail state={props.state} row={row} />;
}

function inputTitle(mode: InputMode): string {
  if (mode === "objective") return "What should change?";
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
  const [mode, setMode] = useState<InputMode>("idle");
  const [inputValue, setInputValue] = useState("");
  const autoGenerated = useRef(new Set<string>());
  const initialSnapshot = state;

  const sync = () => {
    setState(props.controller.snapshot());
  };

  const run = (action: Promise<void>) => {
    // Controller dispatch marks itself busy synchronously before its first await.
    sync();
    void action.then(sync);
  };

  useEffect(() => {
    const task = initialSnapshot.task;
    const root = task?.nodes[task.rootNodeId];
    if (!props.modelAvailable || !task || !root || root.status !== "unresolved" || root.candidateIds.length || initialSnapshot.busy || autoGenerated.current.has(task.id)) return;
    autoGenerated.current.add(task.id);
    run(props.controller.crystallize());
  }, [props.controller, props.modelAvailable, initialSnapshot]);

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
    else if (command === "g") run(props.controller.rethink());
    else if (command === "f") run(props.controller.refine());
    else if (command === "d") run(props.controller.draftPatch());
    else if (command === "l") run(props.controller.toggleLock());
    else if (command === "o") beginInput("reopen");
    else if (command === "s") beginInput("stale");
  });

  const selectedIndex = state.rows.findIndex((row) => row.id === state.selectedRowId);
  const treeRows = visibleWindow(state.rows, selectedIndex, Math.max(6, windowSize.rows - 12));
  const treeWidth = Math.max(30, Math.floor(windowSize.columns * 0.42) - 6);
  const rootStatus = state.task?.nodes[state.task.rootNodeId]?.status;
  const status = state.busy ? "BUSY" : rootStatus ? rootStatus.toUpperCase() : "IDLE";
  const statusMessage = state.busy ? `${state.operation ?? "Working"}...` : state.error ?? state.message;

  return (
    <Box flexDirection="column" height={windowSize.rows} width={windowSize.columns} padding={1}>
      <Box gap={2} flexShrink={0}>
        <Text color={theme.primary} bold>NEOLIT</Text>
        <Text color={state.error ? theme.error : status === "IDLE" ? theme.muted : theme.success}>[{status}]</Text>
        <Text color={theme.secondary}>[PLANNED CHANGE]</Text>
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
          ) : treeRows.map((row) => (
            <PlannedRow
              key={row.id}
              row={row}
              task={state.task}
              selected={state.selectedRowId === row.id}
              width={treeWidth}
            />
          ))}
        </Box>

        <Box flexGrow={1} minWidth={30} borderStyle="round" borderColor={pane === "detail" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden">
          <Box paddingLeft={1}>
            <Text color={pane === "detail" ? theme.primary : theme.muted} bold>SELECTED PATH</Text>
          </Box>
          <DetailView state={state} />
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
          <Text color={theme.primary} bold>[G]</Text>
          <Text color={theme.primary}> rethink · </Text>
          <Text color={theme.primary} bold>[L]</Text>
          <Text color={theme.primary}> lock · </Text>
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
