#!/usr/bin/env node
import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CliAgentRuntime } from "../tui/opencode-runtime.js";
import { AugmentTuiController, currentRevision } from "../tui/controller.js";
import { runAugmentTui } from "../tui/augment.js";
import { configPath, effectiveConfig, loadAugmentConfig, saveAugmentConfig, type AugmentConfig } from "../tui/config.js";
import { agentBackends, backendById } from "../tui/agent-backends.js";

function commandAvailable(command: string): boolean {
  if (command.includes("/")) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return (process.env.PATH ?? "").split(path.delimiter).some((directory) => {
    try {
      accessSync(path.join(directory, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

interface ListedModel {
  modelID: string;
  name?: string;
  providerID?: string;
}

async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
    if (chunks.join("").includes("\n")) break;
  }
  return chunks.join("").trim();
}

function listModels(command: string): ListedModel[] {
  const stdout = execFileSync(command, ["api", "get", "/api/model"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] });
  const parsed = JSON.parse(stdout) as { data?: ListedModel[] };
  return Array.isArray(parsed.data) ? parsed.data.filter((entry) => typeof entry?.modelID === "string") : [];
}

/** Model ids a backend account actually offers; source explains where they came from. */
function availableModels(backendId: string, command: string): { models: string[]; source: string } {
  if (backendId === "opencode") {
    const listed = listModels(command).map((entry) => entry.modelID);
    return { models: listed, source: `${command} api get /api/model` };
  }
  if (backendId === "claude") {
    try {
      const stdout = execFileSync(command, ["model", "list"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] });
      const ids = stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter((token) => token && !token.startsWith("("));
      if (ids.length) return { models: [...new Set(ids)], source: `${command} model list` };
    } catch {
      // fall through to aliases
    }
    return { models: ["sonnet", "opus", "haiku"], source: "fallback aliases (log in or run `claude model list` for the full set)" };
  }
  return { models: [], source: "free-form entry (this backend has no list command)" };
}

async function runSetupWizard(config: AugmentConfig): Promise<void> {
  const ids = Object.keys(agentBackends);
  process.stdout.write("augment setup\n\nAgent:\n");
  ids.forEach((id, index) => {
    const backend = agentBackends[id]!;
    const commandForBackend = config.backend === id && config.command ? config.command : backend.defaultCommand;
    const availability = commandAvailable(commandForBackend) ? "available" : "not on PATH";
    process.stdout.write(`  ${index + 1}) ${id.padEnd(9)} ${availability}${config.backend === id ? "  (current)" : ""}\n`);
  });
  const agentAnswer = await prompt(`\nAgent [1-${ids.length}, Enter = ${config.backend ?? "opencode"}]: `);
  let backendId = config.backend ?? "opencode";
  if (agentAnswer) {
    const numeric = Number(agentAnswer);
    backendId = Number.isInteger(numeric) && numeric >= 1 && numeric <= ids.length ? ids[numeric - 1]! : ids.includes(agentAnswer) ? agentAnswer : backendId;
  }
  const backend = backendById(backendId);
  const command = config.backend === backendId && config.command ? config.command : backend.defaultCommand;
  process.stdout.write(`\nAgent: ${backendId} (command '${command}'${commandAvailable(command) ? "" : " — NOT FOUND; install it or set command in the config"})\n`);

  const { models, source } = availableModels(backendId, command);
  const listed = models;
  if (listed.length) {
    process.stdout.write(`\nModels (${source}):\n`);
    listed.forEach((id, index) => process.stdout.write(`  ${String(index + 1).padStart(4)}  ${id}\n`));
  } else {
    process.stdout.write(`\nModels: ${source}\n`);
  }

  const pick = async (role: string, current?: string): Promise<string | undefined> => {
    const hint = listed.length ? "number or an id" : "an id";
    const answer = await prompt(`\n${role} model — ${hint}${current ? `, Enter = keep ${current}` : ", Enter = backend default"}: `);
    if (!answer) return undefined;
    const numeric = Number(answer);
    const chosen = Number.isInteger(numeric) && numeric >= 1 && numeric <= listed.length ? listed[numeric - 1]! : answer;
    process.stdout.write(`  ${role} → ${chosen}\n`);
    return chosen;
  };

  const model = await pick("default", config.model);
  const draftModel = await pick("draft    ", config.draftModel);
  const challengeModel = await pick("challenge", config.challengeModel);
  const saved = saveAugmentConfig({
    backend: backendId,
    ...(model ? { model } : {}),
    ...(draftModel ? { draftModel } : {}),
    ...(challengeModel ? { challengeModel } : {}),
  });
  process.stdout.write(`\nSaved to ${configPath()}:\n${JSON.stringify({ backend: saved.backend, model: saved.model, draftModel: saved.draftModel, challengeModel: saved.challengeModel }, null, 2)}\n`);
}

async function runModelsPicker(config: AugmentConfig): Promise<void> {
  await runSetupWizard(config);
}

function printConfig(): void {
  const file = loadAugmentConfig();
  const effective = effectiveConfig(file);
  process.stdout.write(`config file: ${configPath()}\n\nfile settings:\n${JSON.stringify(file, null, 2)}\n\neffective (file + environment + flags):\n${JSON.stringify(effective, null, 2)}\n`);
}

const rawArguments = process.argv.slice(2);
if (rawArguments[0] === "config") {
  printConfig();
  process.exit(0);
}
if (rawArguments[0] === "models" || rawArguments[0] === "setup") {
  await runSetupWizard(effectiveConfig());
  process.exit(0);
}

if (!process.stdin.isTTY) {
  process.stderr.write("augment: the TUI requires an interactive terminal.\n");
  process.exit(1);
}

const config = effectiveConfig();
if (!config.model && !existsSync(configPath()) && commandAvailable(backendById(config.backend ?? "opencode").defaultCommand)) {
  process.stdout.write("No model configured yet — running setup. Press Enter to accept any default.\n\n");
  await runSetupWizard(config);
}
const objectiveArguments: string[] = [];
let model = config.model;
let disableModel = process.env.AUGMENT_TUI_NO_MODEL === "1";
for (let index = 0; index < rawArguments.length; index++) {
  const argument = rawArguments[index]!;
  if (argument === "--model" || argument === "-m") {
    model = rawArguments[++index];
    if (!model) throw new Error("--model requires a provider/model identifier.");
    continue;
  }
  if (argument === "--no-model") {
    disableModel = true;
    continue;
  }
  if (argument === "--help" || argument === "-h") {
    process.stdout.write(`augment [setup|config] [--model provider/model] [--no-model] [objective]\n\n  setup   interactive agent and model picker (also runs on first start)\n  config  print effective configuration\n`);
    process.exit(0);
  }
  objectiveArguments.push(argument);
}
const objective = objectiveArguments.join(" ").trim();
const directory = process.cwd();
const backend = backendById(config.backend ?? "opencode");
const requested = config.command ?? backend.defaultCommand;
const modelAvailable = !disableModel && commandAvailable(requested);
const controller = new AugmentTuiController({
  directory,
  runtime: modelAvailable
    ? new CliAgentRuntime({
      directory,
      backend,
      command: requested,
      model,
      draftModel: config.draftModel,
      challengeModel: config.challengeModel,
      server: config.server,
      agent: config.agent,
      timeoutMs: config.timeoutMs,
    })
    : undefined,
  challengeRounds: config.challengeRounds,
  persistTasks: process.env.AUGMENT_TUI_TASKS !== "0",
});

if (objective) {
  await controller.start(objective, currentRevision(directory));
  const snapshot = controller.snapshot();
  if (snapshot.error) {
    process.stderr.write(`${snapshot.error}\n`);
    process.exitCode = 1;
  }
}

try {
  await runAugmentTui(controller, modelAvailable, model ?? "OPENCODE DEFAULT");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
