#!/usr/bin/env node
import { runStdioAugmentServer } from "../augmentd/server.js";

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

function usage(): never {
  process.stderr.write("usage: augmentd [--mcp] [--connect SOCK] [--directory DIR]\n  --mcp        serve the planned-diff operations as MCP agent tools over stdio\n  --connect    with --mcp: attach to the augment server at SOCK (for example the running TUI)\n               instead of owning task state; mutations land in that server\n  --directory  with --mcp: repository root for git apply diagnostics (optional)\n");
  process.exit(2);
}

const args = process.argv.slice(2);
let connectPath: string | undefined;
for (let index = 0; index < args.length; index++) {
  const arg = args[index]!;
  if (arg === "--directory" || arg === "--connect") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage();
    if (arg === "--connect") connectPath = value;
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
  const { SocketAugmentPeer } = await import("../augmentd/socket.js");
  // The MCP client's agent is the model. Attached to a socket (--connect),
  // every tool call mutates the server that socket serves — for example the
  // one embedded in the running TUI, which renders each mutation as it
  // lands. Without a socket the bridge owns its own task state.
  const peer = connectPath ? await SocketAugmentPeer.connect(connectPath) : undefined;
  await runStdioMcpServer({
    ...(peer ? { peer } : {}),
    // The optional repository directory only enables git apply diagnostics.
    preflight: directory ? (patches) => preflightPatches(directory, patches) : undefined,
  });
  peer?.close();
} else {
  if (connectPath !== undefined) usage();
  await runStdioAugmentServer();
}
