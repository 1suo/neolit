#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { OpenCodeCliRuntime } from "../tui/opencode-runtime.js";
import { AugmentTuiController, currentRevision } from "../tui/controller.js";
import { runAugmentTui } from "../tui/augment.js";

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

if (!process.stdin.isTTY) {
  process.stderr.write("augment: the TUI requires an interactive terminal.\n");
  process.exit(1);
}

const rawArguments = process.argv.slice(2);
const objectiveArguments: string[] = [];
let model = process.env.AUGMENT_OPENCODE_MODEL;
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
    process.stdout.write(`augment [--model provider/model] [--no-model] [objective]\n`);
    process.exit(0);
  }
  objectiveArguments.push(argument);
}
const objective = objectiveArguments.join(" ").trim();
const directory = process.cwd();
const requested = process.env.AUGMENT_OPENCODE_COMMAND ?? "opencode";
const modelAvailable = !disableModel && commandAvailable(requested);
const controller = new AugmentTuiController({
  directory,
  runtime: modelAvailable ? new OpenCodeCliRuntime({ directory, command: requested, model }) : undefined,
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
