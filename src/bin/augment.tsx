#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { OpenCodeCliRuntime } from "../tui/opencode-runtime.js";
import { AugmentTuiController, currentRevision } from "../tui/controller.js";
import { runAugmentTui } from "../tui/augment.js";

function commandAvailable(command: string): boolean {
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

const objective = process.argv.slice(2).join(" ").trim();
const directory = process.cwd();
const requested = process.env.AUGMENT_OPENCODE_COMMAND ?? "opencode";
const modelAvailable = process.env.AUGMENT_TUI_NO_MODEL !== "1" && commandAvailable(requested);
const controller = new AugmentTuiController({
  directory,
  runtime: modelAvailable ? new OpenCodeCliRuntime({ directory, command: requested }) : undefined,
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
  await runAugmentTui(controller, modelAvailable);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
