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

type InputMode = "idle" | "objective" | "explanation" | "message" | "reopen" | "stale";
type ViewMode = "plan" | "diff";

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

function entryState(task: PlanTask | undefined, row: PlannedTreeRow): { indicator: string; state: string; color: string } {
  const entry = row.entry;
  const candidates = candidatesForEntry(task, entry);
  const selected = candidates.find((candidate) => candidate.status === "selected");
  const possible = candidates.filter((candidate) => candidate.status === "possible");
  const diffs = entry.diffIds.map((id) => task?.diffs[id]).filter(Boolean) as PlannedDiff[];
  const explanations = entry.explanationIds.map((id) => task?.explanations[id]).filter(Boolean);
  const blocked = entry.nodeIds.some((id) => ["stale", "blocked"].includes(task?.nodes[id]?.status ?? ""));
  const ready = entry.nodeIds.some((id) => task?.nodes[id]?.status === "ready");
  const locked = task && entry.path !== "." && pathIsLocked(task, entry.path);
  const drafted = diffState(diffs);

  if (locked) return { indicator: "#", state: "locked", color: theme.error };
  if (explanations.length) {
    const primary = explanations.some((explanation) => explanation!.role === "primary");
    return { indicator: "?", state: `${primary ? "primary" : "related"} ${explanations.length}`, color: primary ? theme.warning : theme.accent };
  }
  if (blocked) return { indicator: "!", state: "needs refresh", color: theme.error };
  if (drafted) return drafted;
  if (entry.nodeIds.length && entry.kind !== "root") return { indicator: "~", state: "planned change", color: theme.text };
  if (ready) return { indicator: "●", state: "ready", color: theme.success };
  if (selected && entry.kind !== "root") return { indicator: "◇", state: `proposed · ${selected.confidence}%`, color: theme.secondary };
  if (selected) return { indicator: "◆", state: `approach · ${selected.confidence}%`, color: theme.secondary };
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

function DiffDetail(props: { diff: PlannedDiff; description?: string }) {
  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box gap={1}>
        <Text color={props.diff.kind === "delete" ? theme.error : theme.success} bold>{diffIndicator(props.diff.kind)} {props.diff.path || props.diff.id}</Text>
        <Text color={theme.muted}>{diffLabel(props.diff.kind)} · {props.diff.basisRevision}</Text>
      </Box>
      {props.description ? <Text color={theme.text}>  {props.description}</Text> : null}
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

function explanationsForEntry(task: PlanTask | undefined, entry: PlannedTreeRow["entry"] | undefined) {
  if (!task || !entry || entry.path === ".") return [];
  return Object.values(task.explanations)
    .filter((explanation) => explanation.path === entry.path || explanation.path.startsWith(`${entry.path}/`))
    .sort((left, right) => {
      const rank = (role: string) => role === "primary" ? 0 : role === "supporting" ? 1 : 2;
      return rank(left.role) - rank(right.role) || left.path.localeCompare(right.path);
    });
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
  const explanations = useMemo(() => explanationsForEntry(task, row?.entry), [row, task]);

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

      {explanations.length ? <Text color={theme.muted}>EXPLANATION</Text> : null}
      {explanations.slice(0, 8).map((explanation) => (
        <Box key={explanation.id} flexDirection="column">
          <Text color={explanation.role === "primary" ? theme.warning : theme.accent}>
            ? {explanation.path} · {explanation.role} · {explanation.confidence}%
          </Text>
          <Text color={theme.text}>  {explanation.summary}</Text>
          <Text color={theme.muted}>  {explanation.detail}</Text>
        </Box>
      ))}
      {explanations.length > 8 ? <Text color={theme.muted}>  + {explanations.length - 8} more related paths</Text> : null}

      {notes.length ? <Text color={theme.muted}>MESSAGES</Text> : null}
      {notes.map((note) => (
        <Text key={note.id} color={theme.warning}>  {note.text}</Text>
      ))}

      {diffs.length ? (
        <>
          <Text color={theme.muted}>CHANGES IN THIS PATH</Text>
          <Text color={state.color} bold>{state.indicator} {state.state}</Text>
          {diffs.map((diff) => (
            <Text key={diff.id} color={diff.kind === "delete" ? theme.error : theme.success}>
              {diffIndicator(diff.kind)} {diff.path} · {diffLabel(diff.kind)}
            </Text>
          ))}
        </>
      ) : null}

      {diffs.length ? <Text color={theme.muted}>EXACT PATCHES</Text> : null}
      {diffs.map((diff) => <DiffDetail key={diff.id} diff={diff} description={task?.nodes[diff.nodeId]?.reason} />)}

      <Text color={theme.primary}>[Enter] message/regenerate · [L] lock · [V] exact diff</Text>
    </Box>
  );
}

function DetailView(props: { state: TuiActionState }) {
  const row = props.state.rows.find((item) => item.id === props.state.selectedRowId);
  return <EntryDetail state={props.state} row={row} />;
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

function diffColor(line: string): string {
  if (line.startsWith("+++")) return theme.success;
  if (line.startsWith("---")) return theme.error;
  if (line.startsWith("@@")) return theme.accent;
  if (line.startsWith("+")) return theme.success;
  if (line.startsWith("-")) return theme.error;
  return theme.text;
}

function DiffView(props: { task: PlanTask | undefined; row?: PlannedTreeRow; offset: number; height: number }) {
  const diffs = props.row?.entry.diffIds.flatMap((id) => {
    const diff = props.task?.diffs[id];
    return diff ? [diff] : [];
  }) ?? [];
  if (!diffs.length) return <Box flexGrow={1} padding={1}><Text color={theme.muted}>Select a drafted path and press V to view its exact diff.</Text></Box>;

  const lines = diffs.flatMap((diff) => [
    `${diff.kind.toUpperCase()} ${diff.path}`,
    ...diff.patch.split(/\r?\n/),
    "",
  ]);
  const limit = Math.max(4, props.height - 6);
  const visible = lines.slice(props.offset, props.offset + limit);
  return (
    <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor={theme.borderActive} paddingX={1} overflow="hidden">
      <Box gap={1} flexShrink={0}>
        <Text color={theme.primary} bold>EXACT DIFF</Text>
        <Text color={theme.muted}>{diffs[0]!.basisRevision}</Text>
        <Box flexGrow={1} />
        <Text color={theme.muted}>{props.offset + 1}-{Math.min(lines.length, props.offset + visible.length)} / {lines.length}</Text>
      </Box>
      {visible.map((line, index) => (
        <Text key={`${props.offset + index}:${line}`} wrap="truncate-end" color={diffColor(line)}>{line || " "}</Text>
      ))}
      <Box flexShrink={0}>
        <Text color={theme.muted}>j/k scroll · V or Esc back</Text>
      </Box>
    </Box>
  );
}

export function AugmentTui(props: { controller: AugmentTuiController; modelAvailable: boolean; modelLabel?: string }) {
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const [state, setState] = useState<TuiActionState>(() => props.controller.snapshot());
  const [pane, setPane] = useState<"tree" | "detail">("tree");
  const [view, setView] = useState<ViewMode>("plan");
  const [diffOffset, setDiffOffset] = useState(0);
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

    if (view === "diff") {
      if (key.escape || input === "v") {
        setView("plan");
        return;
      }
      if (key.upArrow || input === "k") {
        setDiffOffset((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setDiffOffset((current) => current + 1);
        return;
      }
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
    else if (command === "v") {
      setDiffOffset(0);
      setView("diff");
    }
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

      {view === "diff" ? (
        <DiffView task={state.task} row={selectedRow} offset={diffOffset} height={windowSize.rows} />
      ) : (
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
      )}

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
          <Text color={theme.primary} bold>[V]</Text>
          <Text color={theme.primary}> diff · </Text>
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
