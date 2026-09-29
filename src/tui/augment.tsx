import { useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useWindowSize } from "ink";
import TextInput from "ink-text-input";
import type { PlanCandidate, PlanTask, PlannedDiff } from "../augment/types.js";
import { AugmentTuiController, type PlannedTreeRow, type TuiActionState } from "./controller.js";

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

type InputMode = "idle" | "objective" | "constraint" | "reopen" | "stale";

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

function rowGlyph(row: PlannedTreeRow): string {
  if (row.kind === "candidate") {
    if (row.candidate.status === "selected") return "◆";
    if (row.candidate.status === "eliminated") return "×";
    return "◇";
  }
  if (row.kind === "diff") return "▤";
  if (row.entry.status === "ready") return "●";
  if (row.entry.status === "collapsed") return "◆";
  if (row.entry.status === "domain") return "◇";
  if (["stale", "blocked"].includes(row.entry.status)) return "!";
  return "·";
}

function rowLabel(row: PlannedTreeRow): string {
  if (row.kind === "entry") return row.entry.path;
  if (row.kind === "candidate") return row.candidate.label;
  return row.diff.path || row.diff.id;
}

function rowDetail(row: PlannedTreeRow): string {
  if (row.kind === "entry") return row.entry.status;
  if (row.kind === "candidate") return `${row.candidate.status} · ${row.candidate.touchedPaths.join(", ")}`;
  return `patch · ${row.diff.basisRevision}`;
}

function PlannedRow(props: { row: PlannedTreeRow; selected: boolean; width: number }) {
  const indent = "  ".repeat(props.row.depth);
  const label = rowLabel(props.row);
  const detail = rowDetail(props.row);
  const color = props.row.kind === "entry" ? theme.text : theme.accent;
  return (
    <Box flexDirection="column" backgroundColor={props.selected ? theme.selected : undefined}>
      <Text wrap="truncate-end" color={color}>
        {indent}
        {rowGlyph(props.row)} <Text bold>{crop(label, props.width - indent.length - 4)}</Text>
      </Text>
      <Text wrap="truncate-end" color={theme.muted}>
        {crop(`${indent}  ${detail}`, props.width)}
      </Text>
    </Box>
  );
}

function CandidateDetail(props: { candidate: PlanCandidate }) {
  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box gap={1}>
        <Text color={statusColor(props.candidate.status)} bold>
          {rowGlyph({ kind: "candidate", id: props.candidate.id, depth: 0, entry: { path: "", name: "", kind: "root", status: "domain", nodeIds: [], candidateIds: [], diffIds: [], obligationIds: [], children: [] }, candidate: props.candidate })} {props.candidate.label}
        </Text>
        <Text color={theme.secondary}>[{props.candidate.status.toUpperCase()}]</Text>
      </Box>
      <Text>{props.candidate.rationale}</Text>
      <Text color={theme.muted}>TOUCHED PATHS</Text>
      {props.candidate.touchedPaths.map((path) => (
        <Text key={path} color={theme.accent}>  {path}</Text>
      ))}
      {props.candidate.eliminationReason ? (
        <Text color={theme.error}>REJECTION  {props.candidate.eliminationReason}</Text>
      ) : null}
      <Text color={theme.primary}>[Enter] collapse this candidate</Text>
    </Box>
  );
}

function DiffDetail(props: { diff: PlannedDiff }) {
  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box gap={1}>
        <Text color={theme.accent} bold>▤ {props.diff.path || props.diff.id}</Text>
        <Text color={theme.muted}>[{props.diff.basisRevision}]</Text>
      </Box>
      <Text color={theme.muted}>PATCH</Text>
      <Text>{props.diff.patch}</Text>
    </Box>
  );
}

function EntryDetail(props: { state: TuiActionState; row?: PlannedTreeRow }) {
  const task = props.state.task;
  const nodes = useMemo(() => {
    if (!task || !props.row || props.row.kind === "candidate") return [];
    return props.row.entry.nodeIds.map((id) => task.nodes[id]).filter(Boolean);
  }, [props.row, task]);

  if (!props.row) return <Text color={theme.muted}>  Create a task to inspect its planned diff tree.</Text>;

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box gap={1}>
        <Text color={statusColor(props.row.entry.status)} bold>{props.row.entry.path}</Text>
        <Text color={theme.secondary}>[{props.row.entry.status.toUpperCase()}]</Text>
      </Box>
      {nodes.map((node) => (
        <Box key={node.id} flexDirection="column">
          <Text><Text bold>{node.id}</Text> · {node.kind} · {node.lod}</Text>
          <Text color={theme.muted}>  {node.reason}</Text>
        </Box>
      ))}
      {nodes.some((node) => node.blockedReason) ? (
        <Text color={theme.error}>BLOCKED  {nodes.map((node) => node.blockedReason).filter(Boolean).join("; ")}</Text>
      ) : null}
      <Text color={theme.muted}>CONSTRAINTS</Text>
      {nodes.flatMap((node) => node.constraintIds.map((id) => task?.constraints[id])).filter(Boolean).map((constraint) => (
        <Text key={constraint!.id} color={theme.warning}>  [{constraint!.source}] {constraint!.text}</Text>
      ))}
    </Box>
  );
}

function DetailView(props: { state: TuiActionState }) {
  const row = props.state.rows.find((item) => item.id === props.state.selectedRowId);
  if (row?.kind === "candidate") return <CandidateDetail candidate={row.candidate} />;
  if (row?.kind === "diff") return <DiffDetail diff={row.diff} />;
  return <EntryDetail state={props.state} row={row} />;
}

function inputTitle(mode: InputMode): string {
  if (mode === "objective") return "Task objective";
  if (mode === "constraint") return "Constraint for selected node";
  if (mode === "reopen") return "Reason for reopening selected node";
  if (mode === "stale") return "Changed repository path";
  return "Message";
}

function visibleWindow<T>(items: T[], selected: number, limit: number): T[] {
  if (items.length <= limit) return items;
  const start = Math.max(0, Math.min(items.length - limit, selected - Math.floor(limit / 2)));
  return items.slice(start, start + limit);
}

export function AugmentTui(props: { controller: AugmentTuiController; modelAvailable: boolean }) {
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const [state, setState] = useState<TuiActionState>(() => props.controller.snapshot());
  const [pane, setPane] = useState<"tree" | "detail">("tree");
  const [mode, setMode] = useState<InputMode>("idle");
  const [inputValue, setInputValue] = useState("");

  const sync = () => {
    setState(props.controller.snapshot());
  };

  const run = (action: Promise<void>) => {
    // Controller dispatch marks itself busy synchronously before its first await.
    sync();
    void action.then(sync);
  };

  const beginInput = (next: InputMode) => {
    setMode(next);
    setInputValue("");
  };

  const cancelInput = () => {
    setMode("idle");
    setInputValue("");
  };

  const submit = () => {
    const value = inputValue;
    const activeMode = mode;
    cancelInput();
    if (activeMode === "objective") run(props.controller.start(value));
    else if (activeMode === "constraint") run(props.controller.constrain(value));
    else if (activeMode === "reopen") run(props.controller.reopen(value));
    else if (activeMode === "stale") run(props.controller.markStale(value));
  };

  useInput((input, key) => {
    if (mode !== "idle") {
      if (key.escape) cancelInput();
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
    if (key.return) {
      const row = props.controller.selectedRow();
      if (row?.kind === "candidate") run(props.controller.selectCandidate(row.candidate.id));
      else setPane("detail");
      return;
    }

    const command = input.toLowerCase();
    if (command === "q") exit();
    else if (command === "n") beginInput("objective");
    else if (command === "c") run(props.controller.crystallize());
    else if (command === "r") run(props.controller.refine());
    else if (command === "p") run(props.controller.draftPatch());
    else if (command === "a") beginInput("constraint");
    else if (command === "o") beginInput("reopen");
    else if (command === "s") beginInput("stale");
  }, { isActive: mode === "idle" });

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
        <Text color={theme.secondary}>[PLANNED DIFF]</Text>
        {state.task ? (
          <Text color={theme.muted}>r{state.task.revision} · {state.task.basisRevision.slice(0, 12)}</Text>
        ) : null}
        <Box flexGrow={1} />
        <Text color={props.modelAvailable ? theme.success : theme.warning}>{props.modelAvailable ? "OPENCODE" : "NO MODEL"}</Text>
      </Box>

      <Box flexGrow={1} minHeight={0} gap={1}>
        <Box width="42%" flexShrink={0} borderStyle="round" borderColor={pane === "tree" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden" paddingX={1}>
          <Text color={pane === "tree" ? theme.primary : theme.muted} bold>PLANNED TREE</Text>
          {treeRows.length === 0 ? (
            <Text color={theme.muted}>No task yet. Press [N].</Text>
          ) : treeRows.map((row) => (
            <PlannedRow
              key={row.id}
              row={row}
              selected={state.selectedRowId === row.id}
              width={treeWidth}
            />
          ))}
        </Box>

        <Box flexGrow={1} minWidth={30} borderStyle="round" borderColor={pane === "detail" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden">
          <Box paddingLeft={1}>
            <Text color={pane === "detail" ? theme.primary : theme.muted} bold>DETAILS</Text>
          </Box>
          <DetailView state={state} />
        </Box>
      </Box>

      <Box paddingTop={1} flexShrink={0}>
        <Text wrap="truncate-end">
          <Text color={theme.primary} bold>[N]</Text>
          <Text color={theme.primary}> task </Text>
          <Text color={theme.primary} bold>[C]</Text>
          <Text color={theme.primary}> crystallize </Text>
          <Text color={theme.primary} bold>[R]</Text>
          <Text color={theme.primary}> refine </Text>
          <Text color={theme.primary} bold>[P]</Text>
          <Text color={theme.primary}> patch </Text>
          <Text color={theme.primary} bold>[A]</Text>
          <Text color={theme.primary}> constrain </Text>
          <Text color={theme.primary} bold>[O]</Text>
          <Text color={theme.primary}> reopen </Text>
          <Text color={theme.primary} bold>[S]</Text>
          <Text color={theme.primary}> stale </Text>
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
          <TextInput value={inputValue} focus placeholder={inputTitle(mode)} onChange={setInputValue} onSubmit={submit} />
        </Box>
      )}
    </Box>
  );
}

export async function runAugmentTui(controller: AugmentTuiController, modelAvailable: boolean): Promise<void> {
  const instance = render(<AugmentTui controller={controller} modelAvailable={modelAvailable} />, { alternateScreen: true });
  await instance.waitUntilExit();
}

export type { PlanTask };
