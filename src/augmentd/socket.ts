import { createConnection, createServer, type Socket } from "node:net";
import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { AugmentServer, ProtocolError, type JsonRpcRequest, type JsonRpcResponse } from "./server.js";
import type { NativePeer } from "./mcp.js";

/**
 * Stable Unix-socket transport for the native augmentd protocol. The TUI
 * serves its embedded `AugmentServer` on the socket while it runs, so an
 * external agent (through the MCP bridge) drives the SAME task store and
 * every mutation it lands renders live in the TUI. The socket is
 * user-local: `$XDG_RUNTIME_DIR/neolit/augment.sock`, falling back to the
 * temp directory keyed by uid.
 */

export function defaultSocketPath(): string {
  const runtime = process.env.XDG_RUNTIME_DIR?.trim();
  if (runtime) return path.join(runtime, "neolit", "augment.sock");
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return path.join(process.env.TMPDIR ?? "/tmp", `neolit-augment-${uid}.sock`);
}

function linesFrom(socket: Socket, onLine: (line: string) => void): void {
  const lines = createInterface({ input: socket, crlfDelay: Infinity });
  lines.on("line", onLine);
}

/** Probe whether a live server already owns the socket path. */
function socketAlive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createConnection(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}

export interface SocketService {
  path: string;
  close(): Promise<void>;
}

export async function serveAugmentSocket(server: AugmentServer, socketPath = defaultSocketPath()): Promise<SocketService> {
  if (await socketAlive(socketPath)) {
    throw new Error(`Another augment server already listens at ${socketPath}; only one TUI can serve external agents.`);
  }
  mkdirSync(path.dirname(socketPath), { recursive: true });
  try {
    unlinkSync(socketPath);
  } catch {
    // no stale file to remove
  }
  const connections = new Set<Socket>();
  const netServer = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    linesFrom(socket, (line) => {
      if (!line.trim()) return;
      let request: unknown;
      try {
        request = JSON.parse(line);
      } catch {
        return;
      }
      void server.handle(request as JsonRpcRequest).then((response) => {
        if (response) socket.write(`${JSON.stringify(response)}\n`);
      });
    });
  });
  // Push channel: every mutation is forwarded to every attached client, so
  // editors and bridges invalidate instead of polling.
  const notify = (change: unknown): void => {
    const line = `${JSON.stringify({ jsonrpc: "2.0", method: "augment/taskChanged", params: change })}\n`;
    for (const socket of connections) socket.write(line);
  };
  const unsubscribe = server.onChange(notify);
  await new Promise<void>((resolve, reject) => {
    netServer.once("error", reject);
    netServer.listen(socketPath, () => resolve());
  });
  return {
    path: socketPath,
    close: async () => {
      unsubscribe();
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve) => netServer.close(() => resolve()));
      try {
        unlinkSync(socketPath);
      } catch {
        // already gone
      }
    },
  };
}

/**
 * Client side of the socket: answers the native protocol from whichever
 * process owns the socket. Used by the MCP bridge (`augmentd --mcp
 * --connect`) so tool calls mutate the server the TUI renders.
 */
export class SocketAugmentPeer implements NativePeer {
  private readonly socket: Socket;
  private readonly pending = new Map<string | number, { resolve: (response: JsonRpcResponse | null) => void; reject: (error: Error) => void }>();
  private closed = false;

  private constructor(socket: Socket) {
    this.socket = socket;
    linesFrom(socket, (line) => {
      if (!line.trim()) return;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const record = message as { id?: string | number; jsonrpc?: string };
      if (record.id === undefined || record.id === null) return; // notification
      const waiter = this.pending.get(record.id);
      if (waiter) {
        this.pending.delete(record.id);
        waiter.resolve(message as JsonRpcResponse);
      }
    });
    socket.on("close", () => {
      this.closed = true;
      for (const entry of this.pending.values()) entry.reject(new ProtocolError(-32000, `The augment socket at ${socket.remoteAddress ?? "unknown"} closed before answering.`));
      this.pending.clear();
    });
    socket.on("error", () => {
      // close always follows; nothing else to do
    });
  }

  static connect(socketPath: string): Promise<SocketAugmentPeer> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath);
      const fail = (error: Error): void => reject(new Error(`Could not attach to the augment server at ${socketPath}: ${error.message}. Is the TUI running?`));
      socket.once("error", fail);
      socket.once("connect", () => {
        socket.off("error", fail);
        resolve(new SocketAugmentPeer(socket));
      });
    });
  }

  handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (this.closed) return Promise.reject(new ProtocolError(-32000, "The augment socket connection is closed."));
    const id = request.id;
    if (id === undefined || id === null) return Promise.resolve(null);
    return new Promise<JsonRpcResponse | null>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(`${JSON.stringify(request)}\n`);
    });
  }

  close(): void {
    this.socket.destroy();
  }
}
