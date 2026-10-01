#!/usr/bin/env node
import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CliAgentRuntime } from "../tui/opencode-runtime.js";
import { AugmentTuiController, currentRevision } from "../tui/controller.js";
import { runAugmentTui } from "../tui/augment.js";
import { configPath, effectiveConfig, loadAugmentConfig, saveAugmentConfig, type AugmentConfig } from "../tui/config.js";
import { backendById } from "../tui/agent-backends.js";
import { runSetupUi } from "../tui/setup.js";

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
  await runSetupUi(effectiveConfig());
  process.exit(0);
}

if (!process.stdin.isTTY) {
  process.stderr.write("augment: the TUI requires an interactive terminal.\n");
  process.exit(1);
}

const config = effectiveConfig();
if (!config.model && !existsSync(configPath()) && commandAvailable(backendById(config.backend ?? "opencode").defaultCommand)) {
  process.stdout.write("No model configured yet — running setup. Press Enter to accept any default.\n\n");
  await runSetupUi(config);
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
    process.stdout.write(`augment [setup|config] [--model provider/model] [--no-model] [objective]\n\n  setup   arrow-key agent and model picker (also runs on first start)\n  config  print effective configuration\n`);
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
