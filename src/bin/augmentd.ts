#!/usr/bin/env node
import { runStdioAugmentServer } from "../augmentd/server.js";

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

function usage(): never {
  process.stderr.write("usage: augmentd [--mcp] [--directory DIR]\n  --mcp        serve the planned-diff operations as MCP agent tools over stdio\n  --directory  with --mcp: repository root for git apply diagnostics (optional)\n");
  process.exit(2);
}

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const arg = args[index]!;
  if (arg === "--directory") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage();
    index += 1;
  } else if (arg !== "--mcp") {
    usage();
  }
}
const directoryIndex = args.indexOf("--directory");
const directory = directoryIndex >= 0 ? args[directoryIndex + 1] : undefined;

if (args.includes("--mcp")) {
  const { runStdioMcpServer } = await import("../augmentd/mcp.js");
  const { preflightPatches } = await import("../tui/apply.js");
  await runStdioMcpServer({
    // The MCP client's agent is the model, so no runtime is injected; the
    // optional repository directory only enables git apply diagnostics.
    preflight: directory ? (patches) => preflightPatches(directory, patches) : undefined,
  });
} else {
  await runStdioAugmentServer();
}
