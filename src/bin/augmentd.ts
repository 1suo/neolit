#!/usr/bin/env node
import { runStdioAugmentServer } from "../augmentd/server.js";

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

await runStdioAugmentServer();
