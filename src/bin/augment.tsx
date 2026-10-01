#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { OpenCodeCliRuntime } from "../tui/opencode-runtime.js";
import { AugmentTuiController, currentRevision } from "../tui/controller.js";
import { runAugmentTui } from "../tui/augment.js";
import { configPath, effectiveConfig, loadAugmentConfig, saveAugmentConfig, type AugmentConfig } from "../tui/config.js";

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

async function runModelsPicker(config: AugmentConfig): Promise<void> {
  const command = config.command ?? "opencode";
  if (!commandAvailable(command)) {
    process.stderr.write(`augment: '${command}' is not available; set command first with AUGMENT_OPENCODE_COMMAND or the config file.\n`);
    process.exitCode = 1;
    return;
  }
  const models = listModels(command);
  if (!models.length) {
    process.stderr.write("augment: the backend returned no models — check its auth (e.g. `opencode auth login`).\n");
    process.exitCode = 1;
    return;
  }
  const lines = models.map((entry, index) => `${String(index + 1).padStart(4)}  ${entry.modelID}${entry.name ? `  — ${entry.name}` : ""}`);
  process.stdout.write(`Available models from ${command}:\n${lines.join("\n")}\n\n`);

  const pick = async (role: string, current?: string): Promise<string | undefined> => {
    const answer = await prompt(`${role} model — number or Enter to keep ${current ?? "the backend default"}: `);
    if (!answer) return undefined;
    const numeric = Number(answer);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > models.length) {
      process.stdout.write(`  (ignored '${answer}' — not a listed number)\n`);
      return undefined;
    }
    const chosen = models[numeric - 1]!.modelID;
    process.stdout.write(`  ${role} → ${chosen}\n`);
    return chosen;
  };

  const model = await pick("default", config.model);
  const draftModel = await pick("draft    ", config.draftModel);
  const challengeModel = await pick("challenge", config.challengeModel);
  const saved = saveAugmentConfig({ ...(model ? { model } : {}), ...(draftModel ? { draftModel } : {}), ...(challengeModel ? { challengeModel } : {}) });
  process.stdout.write(`\nSaved to ${configPath()}:\n${JSON.stringify({ model: saved.model, draftModel: saved.draftModel, challengeModel: saved.challengeModel }, null, 2)}\n`);
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
if (rawArguments[0] === "models") {
  await runModelsPicker(effectiveConfig());
  process.exit(0);
}

if (!process.stdin.isTTY) {
  process.stderr.write("augment: the TUI requires an interactive terminal.\n");
  process.exit(1);
}

const config = effectiveConfig();
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
    process.stdout.write(`augment [config|models] [--model provider/model] [--no-model] [objective]\n\n  config  print effective configuration\n  models  pick models interactively and save them\n`);
    process.exit(0);
  }
  objectiveArguments.push(argument);
}
const objective = objectiveArguments.join(" ").trim();
const directory = process.cwd();
const requested = config.command ?? "opencode";
const modelAvailable = !disableModel && commandAvailable(requested);
const controller = new AugmentTuiController({
  directory,
  runtime: modelAvailable
    ? new OpenCodeCliRuntime({
      directory,
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
