import { useEffect, useMemo, useRef, useState } from "react";
import path from "node:path";
import { Box, Text, render, useApp, useInput, useWindowSize, type RenderOptions } from "ink";
import type { PlanNode, PlanTask, PlannedDiff } from "../augment/types.js";
import type { SessionStreamLine } from "./tool-session.js";
import { AugmentTuiController, candidatesForEntry, type PlannedTreeRow, type TuiActionState } from "./controller.js";
import { adaptiveLayout, detailSections, entryName, entryState, entryTouchesNode, sharedContentRows, shortSessionId, shortTaskId, theme, wrappedRows, wrapLegend, type DetailLine, type InputMode, type LegendSegment, type LiveStatus, type RowLiveFlags, type RowView } from "./detail.js";
import { Picker, availableModels, toPickerItems, type PickerItem } from "./setup.js";


const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function PlannedRow(props: { row: PlannedTreeRow; task?: PlanTask; selected: boolean; width: number; view: RowView }) {
  const state = entryState(props.task, props.row, props.view);
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
        {props.row.folded ? <Text color={theme.muted}> ▸</Text> : null}
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

const SESSION_COLORS: Record<SessionStreamLine["kind"], string> = {
  step: theme.muted,
  text: theme.text,
  tool: theme.accent,
  error: theme.error,
};

function SessionPane(props: { lines: SessionStreamLine[]; limit: number; width: number }) {
  // Tail-follow under a row budget: wrapped lines span several rows, so
  // events are taken from the end until the pane fills; the newest line
  // always shows, even when it alone exceeds the budget.
  const recent: SessionStreamLine[] = [];
  let budget = props.limit;
  for (let index = props.lines.length - 1; index >= 0 && budget > 0; index--) {
    const line = props.lines[index]!;
    const rows = wrappedRows(line.text, props.width);
    if (rows > budget && recent.length > 0) break;
    recent.unshift(line);
    budget -= rows;
  }
  return (
    <Box borderStyle="round" borderColor={theme.border} flexDirection="column" overflow="hidden" paddingX={1} flexShrink={0} height={props.limit + 3}>
      <Text color={theme.muted}>SESSION</Text>
      {recent.length === 0
        ? <Text color={theme.muted}>waiting for the agent…</Text>
        : recent.map((line, index) => (
          <Text key={`${recent.length - index}:${line.text}`} wrap="wrap" color={SESSION_COLORS[line.kind]}>{line.text}</Text>
        ))}
    </Box>
  );
}

function SectionView(props: { lines: DetailLine[]; offset: number; limit: number }) {
  const clamped = Math.min(props.offset, Math.max(0, props.lines.length - props.limit));
  const visible = props.lines.slice(clamped, clamped + props.limit);
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
  if (mode === "message") return `${target} · message (task, question, or note; empty = rethink)`;
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
  const [pane, setPane] = useState<"tree" | "diff" | "description">("tree");
  const [contentView, setContentView] = useState<"diff" | "session" | "description">("diff");
  const [diffOffset, setDiffOffset] = useState(0);
  const [descOffset, setDescOffset] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [mode, setMode] = useState<InputMode>("idle");
  const [modelPicker, setModelPicker] = useState<
    | { kind: "role" }
    | { kind: "model"; role: "model" | "draftModel" | "challengeModel"; items: PickerItem[]; note?: string }
    | { kind: "model"; role: "model" | "draftModel" | "challengeModel"; loading: true }
    | undefined
  >(undefined);
  const [inputValue, setInputValue] = useState("");
  const autoGenerated = useRef(new Set<string>());
  const autoRetried = useRef(new Set<string>());
  const initialSnapshot = state;

  useEffect(() => {
    if (!state.busy) return;
    const timer = setInterval(() => setSpinnerFrame((current) => current + 1), 120);
    return () => clearInterval(timer);
  }, [state.busy]);

  const sync = () => {
    setState(props.controller.snapshot());
  };

  // External mutations (an agent driving this task over the TUI's socket)
  // repaint the app as they land; user actions sync through `run`/`sync`.
  useEffect(() => {
    const unsubscribe = props.controller.subscribe(() => setState(props.controller.snapshot()));
    return unsubscribe;
  }, [props.controller]);

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
    // The first generation is the app's front door: one transient model
    // failure must never leave a silent, empty task. Retry once and say so.
    run(props.controller.crystallize().then(() => {
      const snapshot = props.controller.snapshot();
      const stalled = snapshot.task?.nodes[snapshot.task.rootNodeId!];
      if (!snapshot.task || snapshot.busy || stalled?.status !== "unresolved" || stalled.candidateIds.length || autoRetried.current.has(snapshot.task.id)) return;
      autoRetried.current.add(snapshot.task.id);
      setState((current) => ({ ...current, message: "First generation attempt failed — retrying once… press [D] anytime to retry manually." }));
      run(props.controller.crystallize());
    }));
  }, [props.controller, props.modelAvailable, initialSnapshot]);

  useEffect(() => {
    setDiffOffset(0);
    setDescOffset(0);
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
    else if (activeMode === "message") run(props.controller.route(value));
    else if (activeMode === "reopen") run(props.controller.reopen(value));
    else if (activeMode === "stale") run(props.controller.markStale(value));
  };

  // Derived view model — computed before useInput so the key handler can
  // cycle focus through the panes that actually exist in this frame.
  const selectedIndex = state.rows.findIndex((row) => row.id === state.selectedRowId);
  const sessionVisible = Boolean(state.toolSession && state.sessionView);
  const layout = adaptiveLayout(windowSize.columns, windowSize.rows, mode, sessionVisible);
  const treeRows = visibleWindow(state.rows, selectedIndex, layout.treeRows);
  const spinner = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]!;
  const liveStatus: LiveStatus | undefined = state.active || state.failed
    ? { spinner, active: state.active, failed: state.failed }
    : undefined;
  const selectedRow = state.rows.find((row) => row.id === state.selectedRowId);
  const sections = useMemo(() => detailSections(state.task, selectedRow, {
    pendingMarks: state.pendingMarks,
    pendingMode: state.pendingMode,
    appliedDiffIds: state.appliedDiffIds,
    live: liveStatus,
    filePreview: state.filePreview,
    fileContent: state.fileContent,
    mergedView: state.mergedView,
  }), [state.task, selectedRow, state.pendingMarks, state.pendingMode, state.appliedDiffIds, liveStatus, state.filePreview, state.fileContent, state.mergedView]);
  const visibleDiff = contentView === "description" ? [] : sections.diff;
  const paneLines = visibleDiff.length ? visibleDiff : sections.description;
  const statusMessage = state.busy ? `${state.operation ?? "Working"}...` : state.error ?? state.message;
  // The diff section is its own focus target whenever it renders separately
  // (the wide middle column, or the top half of a split content column).
  const diffFocusable = visibleDiff.length > 0 && (layout.mode === "wide" || layout.split);
  const focusCycle: Array<"tree" | "diff" | "description"> = diffFocusable
    ? ["tree", "diff", "description"]
    : ["tree", "description"];

  useInput((input, key) => {
    if (modelPicker) return;
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

    if (key.escape && state.busy) {
      props.controller.cancel();
      setState((current) => ({ ...current, message: "Cancelling the running operation…" }));
      return;
    }
    // Per-pane scrolling: j/k moves the focused pane's own window, never the
    // tree selection and never both content panes at once.
    if (pane === "diff" && (key.upArrow || input === "k")) {
      setDiffOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (pane === "diff" && (key.downArrow || input === "j")) {
      setDiffOffset((current) => current + 1);
      return;
    }
    if (pane === "description" && (key.upArrow || input === "k")) {
      setDescOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (pane === "description" && (key.downArrow || input === "j")) {
      setDescOffset((current) => current + 1);
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
    // Tab/Right cycles tree → diff → description through the panes that
    // actually exist; Left steps back.
    if (key.tab || key.rightArrow) {
      setPane((current) => focusCycle[(focusCycle.indexOf(current) + 1) % focusCycle.length] ?? "tree");
      return;
    }
    if (key.leftArrow) {
      setPane((current) => focusCycle[Math.max(0, focusCycle.indexOf(current) - 1)] ?? "tree");
      return;
    }
    if (key.return || input === "\r" || input === "\n") {
      if (!state.task) {
        props.controller.report("No task is active. Press [N] to send the first message.");
        return;
      }
      beginInput("message");
      return;
    }

    // Uppercase bindings are distinct keys (the lowercase map below folds
    // case): M toggles the merged diff view.
    if (input === "M") {
      props.controller.toggleMergedView();
      sync();
      return;
    }

    const command = input.toLowerCase();
    const selectedEntry = props.controller.selectedRow()?.entry;
    const choices = candidatesForEntry(props.controller.snapshot().task, selectedEntry).filter((candidate) => candidate.status === "possible");
    const numericChoice = Number(command);
    if (state.routedOptions?.length && Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= state.routedOptions.length) {
      run(props.controller.chooseRoutedOption(state.routedOptions[numericChoice - 1]!.label));
      return;
    }
    if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= choices.length) {
      run(props.controller.selectCandidate(choices[numericChoice - 1]!.id));
      return;
    }

    if (command === "q") {
      props.controller.cancel();
      exit();
    }
    else if (command === "n") beginInput("objective");
    else if (command === "d") run(props.controller.develop());
    else if (command === "a") run(props.controller.applySelected());
    else if (command === "c") run(props.controller.commitApplied());
    else if (command === "l") run(props.controller.toggleRestriction("lock"));
    else if (command === "w") run(props.controller.toggleRestriction("allow"));
    else if (command === "f") {
      props.controller.toggleFold();
      sync();
    }
    else if (command === "h") {
      props.controller.toggleRelatedOnly();
      sync();
    }
    else if (command === "m") {
      if (props.controller.runtimeAgent()) setModelPicker({ kind: "role" });
      else setState((current) => ({ ...current, error: "No model runtime is active." }));
    }
    else if (command === "o") beginInput("reopen");
    else if (command === "s") beginInput("stale");
    else if (command === "v") {
      props.controller.toggleSessionView();
      sync();
    }
    else if (command === "p") {
      setContentView((current) => current === "diff" ? "session" : current === "session" ? "description" : "diff");
    }
  });

  const rootStatus = state.task?.nodes[state.task.rootNodeId]?.status;
  const status = state.busy
    ? "BUSY"
    : state.task?.mode === "explanation"
      ? Object.keys(state.task.explanations).length ? "EXPLAINED" : "EXPLAINING"
      : rootStatus ? rootStatus.toUpperCase() : "IDLE";

  return (
    <Box flexDirection="column" height={layout.frameRows} width={windowSize.columns} padding={1}>
      <Box gap={2} flexShrink={0}>
        <Text color={theme.primary} bold>NEOLIT</Text>
        <Text color={state.error ? theme.error : status === "IDLE" ? theme.muted : theme.success}>[{status}]</Text>
        <Text color={theme.secondary}>{path.basename(state.directory)}{state.branch ? `/${state.branch}` : ""}</Text>
        {state.task ? (
          <Text color={theme.muted}>{state.agentSession ? `${shortSessionId(state.agentSession)} (${shortTaskId(state.task.id)})` : shortTaskId(state.task.id)}</Text>
        ) : null}
        <Box flexGrow={1} />
        <Text color={props.modelAvailable ? theme.success : theme.warning}>{props.modelAvailable ? props.modelLabel ?? "OPENCODE" : "NO MODEL"}</Text>
      </Box>

      {modelPicker ? (
        <Box flexGrow={1} minHeight={0} flexDirection="column">
          {modelPicker.kind === "role" ? (
            <Picker
              title="Switch which model?"
              items={[
                { id: "model", label: "default" },
                { id: "draftModel", label: "draft" },
                { id: "challengeModel", label: "challenge" },
              ]}
              onDone={(id) => {
                if (!id) return setModelPicker(undefined);
                const role = id as "model" | "draftModel" | "challengeModel";
                setModelPicker({ kind: "model", role, loading: true });
                const agent = props.controller.runtimeAgent()!;
                void availableModels(agent.backendId, agent.command).then(({ models, source }) => {
                  setModelPicker({ kind: "model", role, items: toPickerItems(models), note: models.length ? source : `${source}` });
                });
              }}
            />
          ) : "loading" in modelPicker ? (
            <Picker title="Loading models…" items={[]} onDone={() => setModelPicker(undefined)} />
          ) : (
            <Picker
              title={`${modelPicker.role === "model" ? "default" : modelPicker.role === "draftModel" ? "draft" : "challenge"} model`}
              note={modelPicker.note}
              items={modelPicker.items}
              onDone={(id) => {
                if (id) props.controller.configureModels({ [modelPicker.role]: id });
                setModelPicker(undefined);
              }}
            />
          )}
        </Box>
      ) : (
      <Box flexGrow={1} minHeight={0} gap={1}>
        <Box flexDirection="column" width={layout.treeColumns} flexShrink={0}>
          <Box flexGrow={1} minHeight={0} borderStyle="round" borderColor={pane === "tree" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden" paddingX={1}>
            <Text color={state.relatedOnly ? theme.accent : pane === "tree" ? theme.primary : theme.muted} bold>FILES{state.relatedOnly ? " · related" : ""}</Text>
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
                  width={layout.treeColumns}
                  view={{
                    pendingMarks: state.pendingMarks,
                    pendingMode: state.pendingMode,
                    appliedDiffIds: state.appliedDiffIds,
                    live: activeRow || failedRow ? { active: activeRow, failed: failedRow, spinner, operation: state.active?.operation } : undefined,
                  }}
                />
              );
            })}
          </Box>
          {sessionVisible && layout.mode === "medium" ? <SessionPane lines={state.sessionLines} limit={layout.sessionRows} width={Math.max(20, layout.treeColumns - 4)} /> : null}
        </Box>

        {layout.mode === "wide" ? (
          <>
            {(visibleDiff.length || (contentView === "session" && state.toolSession)) ? (
              <Box flexDirection="column" flexShrink={0} minWidth={30} width={layout.diffColumns}>
                {contentView === "session" && state.toolSession ? (
                  <SessionPane lines={state.sessionLines} limit={layout.diffRows} width={Math.max(20, layout.diffColumns - 4)} />
                ) : (
                  <Box flexGrow={1} minHeight={0} borderStyle="round" borderColor={pane === "diff" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden" paddingTop={0}>
                    <SectionView lines={visibleDiff} offset={diffOffset} limit={layout.diffRows} />
                  </Box>
                )}
              </Box>
            ) : null}
            <Box flexDirection="column" flexGrow={1} minWidth={30}>
              <Box flexGrow={1} minHeight={0} borderStyle="round" borderColor={pane === "description" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden" paddingTop={0}>
                <SectionView lines={sections.description} offset={descOffset} limit={layout.descriptionRows} />
              </Box>
              {sessionVisible && contentView !== "session" ? <SessionPane lines={state.sessionLines} limit={layout.sessionRows} width={Math.max(20, layout.descriptionColumns - 4)} /> : null}
            </Box>
          </>
        ) : layout.split && visibleDiff.length ? (
          <Box flexDirection="column" flexGrow={1} minWidth={30}>
            <Box height={layout.diffRows + 3} flexShrink={0} borderStyle="round" borderColor={pane === "diff" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden" paddingTop={0}>
              <SectionView lines={visibleDiff} offset={diffOffset} limit={layout.diffRows} />
              </Box>
            <Box flexGrow={1} minHeight={0} borderStyle="round" borderColor={pane === "description" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden" paddingTop={0}>
              <SectionView lines={sections.description} offset={descOffset} limit={layout.descriptionRows} />
            </Box>
          </Box>
        ) : contentView === "session" && state.toolSession ? (
          <SessionPane lines={state.sessionLines} limit={Math.max(layout.diffRows, layout.descriptionRows)} width={Math.max(20, windowSize.columns - 2)} />
        ) : layout.diffRows > 0 ? (
          <Box flexGrow={1} minWidth={30} borderStyle="round" borderColor={pane !== "tree" ? theme.borderActive : theme.border} flexDirection="column" overflow="hidden" paddingTop={0}>
            <SectionView lines={paneLines} offset={descOffset} limit={sharedContentRows(layout)} />
          </Box>
        ) : null}
      </Box>
      )}

      <Box paddingTop={1} flexShrink={0} flexDirection="column">
        {wrapLegend(
          [
            { text: "[Enter]", color: theme.primary, bold: true },
            { text: " message ·", color: theme.primary },
            { text: "[D]", color: theme.primary, bold: true },
            { text: " develop ·", color: theme.primary },
            { text: "[A]", color: theme.primary, bold: true },
            { text: " apply ·", color: theme.primary },
            { text: "[C]", color: theme.primary, bold: true },
            { text: " commit ·", color: theme.primary },
            { text: "[L]", color: theme.primary, bold: true },
            { text: " lock ·", color: theme.primary },
            { text: "[W]", color: theme.primary, bold: true },
            { text: " allow ·", color: theme.primary },
            { text: "[m]", color: theme.primary, bold: true },
            { text: " models ·", color: theme.primary },
            { text: "[M]", color: theme.primary, bold: true },
            { text: " merged ·", color: theme.primary },
            { text: "[N]", color: theme.primary, bold: true },
            { text: " new ·", color: theme.primary },
            { text: "[F]", color: theme.muted, bold: true },
            { text: " fold ·", color: theme.muted },
            { text: "[V]", color: theme.muted, bold: true },
            { text: " session ·", color: theme.muted },
            { text: "[P]", color: theme.muted, bold: true },
            { text: " view ·", color: theme.muted },
            { text: "[H]", color: theme.muted, bold: true },
            { text: " related ·", color: theme.muted },
            { text: "[Tab]", color: theme.muted, bold: true },
            { text: " pane ·", color: theme.muted },
            { text: "[Q]", color: theme.muted, bold: true },
            { text: " quit", color: theme.muted },
          ],
          Math.max(20, windowSize.columns - 2),
          2,
        ).map((row, rowIndex) => (
          <Text key={rowIndex} wrap="truncate-end">
            {row.map((segment, segmentIndex) => (
              <Text key={segmentIndex} color={segment.color} bold={segment.bold}>{segment.text}</Text>
            ))}
          </Text>
        ))}
      </Box>

      {state.routedOptions?.length ? (
        <Box flexDirection="column" flexShrink={0} paddingX={1}>
          <Text color={theme.muted}>choose an interpretation (1-{state.routedOptions.length}):</Text>
          {state.routedOptions.map((option, index) => (
            <Text key={option.label} wrap="wrap">
              <Text color={theme.primary} bold>[{index + 1}]</Text> {option.label} — {option.description}
            </Text>
          ))}
        </Box>
      ) : null}

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
