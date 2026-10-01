import React, { useState } from "react";
import { Box, Text, render, useInput } from "ink";
import { execFile, execFileSync } from "node:child_process";
import { agentBackends, backendById } from "./agent-backends.js";
import { saveAugmentConfig, type AugmentConfig } from "./config.js";

export interface PickerItem {
  id: string;
  label: string;
  hint?: string;
}

const PICKER_HEIGHT = 16;

export function filterItems(items: PickerItem[], query: string): PickerItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => `${item.id} ${item.label} ${item.hint ?? ""}`.toLowerCase().includes(needle));
}

export function pickerWindow(length: number, cursor: number, height: number = PICKER_HEIGHT): { start: number; end: number } {
  if (length <= height) return { start: 0, end: length };
  let start = Math.max(0, Math.min(length - height, cursor - Math.floor(height / 2)));
  return { start, end: start + height };
}

export function Picker(props: {
  title: string;
  items: PickerItem[];
  currentId?: string;
  note?: string;
  onDone: (id: string | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const filtered = filterItems(props.items, query);
  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));
  const { start, end } = pickerWindow(filtered.length, safeCursor);
  const visible = filtered.slice(start, end);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor(Math.max(0, safeCursor - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(Math.min(filtered.length - 1, safeCursor + 1));
      return;
    }
    if (key.return) {
      const chosen = filtered[safeCursor];
      props.onDone(chosen ? chosen.id : undefined);
      return;
    }
    if (key.escape) {
      if (query) {
        setQuery("");
        setCursor(0);
        return;
      }
      props.onDone(undefined);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((current) => current.slice(0, -1));
      setCursor(0);
      return;
    }
    if (input && !key.ctrl && !key.meta && input.trim()) {
      setQuery((current) => current + input);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="#7aa2f7" bold>{props.title}</Text>
      {props.note ? <Text color="#838aa0">{props.note}</Text> : null}
      {visible.map((item, windowIndex) => {
        const index = start + windowIndex;
        const selected = index === safeCursor;
        return (
          <Box key={`${start + windowIndex}:${item.id}`} backgroundColor={selected ? "#24283b" : undefined}>
            <Text wrap="truncate-end">
              <Text color={selected ? "#7aa2f7" : "#838aa0"}>{selected ? "❯ " : "  "}</Text>
              <Text color={item.id === props.currentId ? "#9ece6a" : "#c0caf5"} bold={selected}>{item.label}</Text>
              {item.hint ? <Text color="#838aa0">  {item.hint}</Text> : null}
              {item.id === props.currentId ? <Text color="#9ece6a">  · current</Text> : null}
            </Text>
          </Box>
        );
      })}
      {filtered.length > end ? <Text color="#838aa0">  … {filtered.length - end} more</Text> : null}
      <Box paddingTop={1}>
        <Text color="#838aa0">filter: </Text>
        <Text color="#c0caf5">{query || "—"}</Text>
      </Box>
      <Text color="#838aa0">↑↓ move · type to filter · Enter select · Esc clears filter, then keeps current</Text>
    </Box>
  );
}

/** Arrow-key list selection; non-TTY streams fall back to a numbered prompt. */
export function selectFromList(options: {
  title: string;
  items: PickerItem[];
  currentId?: string;
  note?: string;
  input?: NodeJS.ReadableStream;
}): Promise<string | undefined> {
  const interactive = options.input ? Boolean((options.input as { isTTY?: boolean }).isTTY) : Boolean(process.stdin.isTTY);
  if (interactive) {
    return new Promise((resolve) => {
      const instance = render(
        <Picker title={options.title} items={options.items} currentId={options.currentId} note={options.note} onDone={(id) => {
          instance.unmount();
          resolve(id);
        }} />,
      );
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(`${options.title}\n${options.note ?? ""}\n`);
    options.items.forEach((item, index) => process.stdout.write(`  ${index + 1}) ${item.label}${item.hint ? `  ${item.hint}` : ""}\n`));
    process.stdout.write("Number (Enter = keep current): ");
    let buffer = "";
    const input = options.input ?? process.stdin;
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (!buffer.includes("\n")) return;
      input.off("data", onData);
      const answer = buffer.trim();
      if (!answer) return resolve(undefined);
      const numeric = Number(answer);
      const chosen = Number.isInteger(numeric) && numeric >= 1 && numeric <= options.items.length ? options.items[numeric - 1]!.id : answer;
      resolve(chosen);
    };
    input.on("data", onData);
  });
}

/**
 * Intersects the catalog's provider list with `opencode auth list` output so
 * pickers offer only providers the account can actually run. Provider names
 * contain spaces ("Z.AI Coding Plan"), so matching is prefix-based per line.
 */
export function parseAuthProviderIds(providerJson: string, authListOutput: string): string[] {
  let providers: Array<{ id?: string; name?: string }> = [];
  try {
    const parsed = JSON.parse(providerJson) as { data?: Array<{ id?: string; name?: string }> } | Array<{ id?: string; name?: string }>;
    const raw = Array.isArray(parsed) ? parsed : parsed.data ?? [];
    providers = raw.filter((entry) => typeof entry?.id === "string" && typeof entry?.name === "string");
  } catch {
    return [];
  }
  const lines = authListOutput.split(/\r?\n/);
  const nameColumn = (line: string) => line.split(/\s{2,}/)[0] ?? "";
  const authenticated = providers
    .filter((provider) => lines.some((line) => nameColumn(line) === provider.name! && /(stored|logged|authenticated)/i.test(line)))
    .map((provider) => provider.id!);
  return authenticated.length ? authenticated : providers.map((provider) => provider.id!);
}

/** Collapses duplicate catalog ids (providers repeat model ids) into picker items. */
export function toPickerItems(models: string[]): PickerItem[] {
  const seen = new Set<string>();
  const items: PickerItem[] = [];
  for (const id of models) {
    if (seen.has(id)) continue;
    seen.add(id);
    const slash = id.indexOf("/");
    items.push(slash > 0 ? { id, label: id.slice(slash + 1), hint: id.slice(0, slash) } : { id, label: id });
  }
  return items;
}

/** Model ids a backend account actually offers; source explains where they came from. */
export async function availableModels(backendId: string, command: string): Promise<{ models: string[]; source: string }> {
  const run = (args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(command, args, { timeout: 30_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
  if (backendId === "opencode") {
    try {
      const stdout = await run(["api", "get", "/api/model"]);
      const parsed = JSON.parse(stdout) as { data?: Array<{ modelID?: string; name?: string; providerID?: string }> };
      const listed = (parsed.data ?? []).filter((entry) => typeof entry.modelID === "string" && typeof entry.providerID === "string");
      let usable = listed;
      let source = `${command} catalog, authenticated providers only`;
      try {
        const providerJson = await run(["api", "get", "/api/provider"]);
        const authList = await run(["auth", "list"]);
        const authenticated = new Set(parseAuthProviderIds(providerJson, authList));
        const filtered = listed.filter((entry) => authenticated.has(entry.providerID!));
        if (filtered.length) usable = filtered;
        else source = `${command} catalog (auth list unreadable — all providers shown)`;
      } catch {
        source = `${command} catalog (all providers — auth list unreadable)`;
      }
      // --model takes provider/model; openrouter ids themselves contain slashes.
      return { models: usable.map((entry) => `${entry.providerID}/${entry.modelID}`), source };
    } catch {
      return { models: [], source: `could not reach ${command} — check its auth` };
    }
  }
  if (backendId === "claude") {
    try {
      const stdout = await run(["model", "list"]);
      const ids = stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter((token) => token && !token.startsWith("("));
      if (ids.length) return { models: [...new Set(ids)], source: `${command} model list` };
    } catch {
      // fall through to aliases
    }
    return { models: ["sonnet", "opus", "haiku"], source: "fallback aliases (log in or run `claude model list` for the full set)" };
  }
  return { models: [], source: "no list command for this backend — Esc keeps the current, or type a free id" };
}

function commandOnPath(command: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${JSON.stringify(command)}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The interactive setup: pick the agent, then default/draft/challenge models. */
export async function runSetupUi(config: AugmentConfig): Promise<AugmentConfig> {
  const backendIds = Object.keys(agentBackends);
  const chosenBackend = await selectFromList({
    title: "Agent",
    note: "arrows to move, Enter to choose",
    items: backendIds.map((id) => ({
      id,
      label: id,
      hint: commandOnPath(agentBackends[id]!.defaultCommand) ? undefined : "not on PATH",
    })),
    currentId: config.backend,
  });
  const backendId = chosenBackend ?? config.backend ?? "opencode";
  const backend = backendById(backendId);
  process.stdout.write(`agent → ${backendId}\n`);

  const { models, source } = await availableModels(backendId, backend.defaultCommand);
  const items: PickerItem[] = toPickerItems(models);
  const pickModel = async (role: string, current?: string): Promise<string | undefined> => {
    if (!items.length) return undefined;
    const chosen = await selectFromList({
      title: `${role} model`,
      note: source,
      items,
      currentId: current,
    });
    process.stdout.write(`${role} → ${chosen ?? "(kept)"}\n`);
    return chosen;
  };

  const model = await pickModel("default", config.model);
  const draftModel = await pickModel("draft", config.draftModel);
  const challengeModel = await pickModel("challenge", config.challengeModel);
  const saved = saveAugmentConfig({
    backend: backendId,
    ...(model ? { model } : {}),
    ...(draftModel ? { draftModel } : {}),
    ...(challengeModel ? { challengeModel } : {}),
  });
  process.stdout.write(`saved to config: ${JSON.stringify({ backend: saved.backend, model: saved.model, draftModel: saved.draftModel, challengeModel: saved.challengeModel })}\n`);
  return saved;
}
