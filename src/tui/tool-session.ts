import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AugmentServer } from "../augmentd/server.js";
import type { PlanTask } from "../augment/types.js";
import { WarmTransportUnavailableError, type CliAgentBackend } from "./agent-backends.js";
import { PersistentAgentServer } from "./opencode-runtime.js";
import { rememberSessionBinding, sessionBindingFor } from "./session-store.js";

/**
 * ToolSessionDriver: the TUI's model operations become short prompts in
 * ONE agent session bound to the task id, and the model writes into the plan
 * exclusively through the neolit MCP tools — which the wiring loads into a
 * kept-alive serve child (OPENCODE_CONFIG for OpenCode, --mcp-config for
 * Claude) pointing at this TUI's socket. Steps run over that server's warm
 * HTTP transport when it is up, falling back to a one-shot `--standalone`
 * CLI spawn per step when it is not. Every tool call lands in the embedded
 * server, renders live, and is validated by the controller; the driver never
 * parses model replies, it waits for the effect to appear in the task store.
 * Prompts point instead of embed: the session already holds the objective,
 * and the agent reads files and state fresh through its own tools
 * (plan_status, read_diff, read), which also removes the stale-embed class
 * of draft failures. The human gates stay in the TUI: the agent proposes
 * and challenges, people choose. The task→session binding lives in the
 * directory-scoped session store, so a restarted TUI revives the session —
 * and a session created in another directory is never reused.
 */

/** Backends whose non-interactive runs accept generated MCP wiring today. */
const SUPPORTED_BACKENDS = new Set(["opencode", "claude"]);

/** One display line of the live agent-session stream (view-only). */
export interface SessionStreamLine {
  kind: "step" | "text" | "tool" | "error";
  text: string;
}

/**
 * Maps one CLI JSON event onto a display line for the session pane. Only
 * presentation: unknown shapes are ignored, and nothing here touches task
 * state — the plan still only changes when a complete tool call lands.
 */
/**
 * Compact one-line detail for a tool call's input: the argument that names
 * the work (command, pattern, query, path, code, …) rather than the whole
 * JSON envelope, so completed calls read like "✓ execute · git status".
 * Truncation is always visible: the cap ends with an ellipsis, and hosts
 * that wrap (the nvim pane) still get most of the argument.
 */
const TOOL_DETAIL_CAP = 200;
const TEXT_LINE_CAP = 400;

function capped(value: string, cap: number): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  return flattened.length > cap ? `${flattened.slice(0, cap)}…` : flattened;
}

function toolDetail(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of ["command", "cmd", "pattern", "query", "glob", "path", "file", "url", "script", "code", "text"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const flattened = value.replace(/\s+/g, " ").trim();
    if (flattened) return capped(flattened, TOOL_DETAIL_CAP);
    return ""; // a known key that is blank carries nothing worth showing
  }
  return capped(JSON.stringify(input), TOOL_DETAIL_CAP);
}

export function formatStreamEvent(message: unknown): SessionStreamLine[] {
  if (!message || typeof message !== "object") return [];
  const record = message as Record<string, unknown>;
  if (record.type === "error") {
    const failure = record.error as { message?: unknown } | undefined;
    const text = typeof record.message === "string" ? record.message : typeof failure?.message === "string" ? failure.message : undefined;
    return text ? [{ kind: "error", text: `✗ ${text}` }] : [];
  }
  if (record.type === "step_start") return [{ kind: "step", text: "▸ step" }];
  const part = record.part as Record<string, unknown> | undefined;
  const partText = part && typeof part.text === "string" ? part.text : typeof record.text === "string" ? record.text : undefined;
  if ((record.type === "text" || part?.type === "text") && partText) {
    // Reply text keeps its shape: newlines are the model's paragraphing,
    // so each line streams as its own display line (capped individually)
    // instead of one flattened, truncated run.
    return partText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => ({ kind: "text" as const, text: capped(line, TEXT_LINE_CAP) }));
  }
  if (part?.type === "tool" && part.state && typeof part.state === "object") {
    const state = part.state as { status?: unknown; title?: unknown; input?: unknown };
    const title = typeof state.title === "string" && state.title ? state.title : "tool";
    const detail = toolDetail(state.input);
    const suffix = detail ? ` · ${detail}` : "";
    if (state.status === "completed") return [{ kind: "tool", text: `✓ ${title}${suffix}` }];
    if (state.status === "error") return [{ kind: "tool", text: `✗ ${title}${suffix}` }];
    return [{ kind: "tool", text: `→ ${title}${suffix}` }];
  }
  return [];
}

export function toolSessionSupported(backendId: string): boolean {
  return SUPPORTED_BACKENDS.has(backendId);
}

/** The augmentd bridge this process serves its own socket through. */
export function defaultBridgeCommand(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, "../bin/augmentd.js");
  try {
    if (candidate.endsWith(".js") && fs.statSync(candidate).isFile()) return [process.execPath, candidate];
  } catch {
    // not built from dist
  }
  return ["augmentd"];
}

/**
 * OpenCode wiring: OPENCODE_CONFIG layers between the user's global and
 * project config, so this adds the bridge and disarms direct mutation
 * without touching anything the user configured. The default build agent is
 * used (the plan agent's toolset may exclude MCP tools); write/edit/bash are
 * off, so the plan store is the only mutation channel.
 */
export function openCodeToolConfig(bridge: string[], socketPath: string, directory: string): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      neolit: {
        type: "local",
        command: [...bridge, "--mcp", "--connect", socketPath, "--directory", directory],
        enabled: true,
      },
    },
    tools: { write: false, edit: false, bash: false },
  };
}

/** Claude wiring: --mcp-config file plus tool scoping to the neolit server. */
export function claudeToolConfig(bridge: string[], socketPath: string, directory: string): Record<string, unknown> {
  return {
    mcpServers: {
      neolit: {
        command: bridge[0] ?? "augmentd",
        args: [...bridge.slice(1), "--mcp", "--connect", socketPath, "--directory", directory],
      },
    },
  };
}

/**
 * The prompt contract. The step verbs are stable prefixes — hosts and tests
 * match on them, so renames are protocol changes. Session opener carries the
 * task anchor (id); everything else is pulled fresh through the tools.
 */
export const toolPrompts = {
  open: (taskId: string, objective: string) =>
    `You drive one Neolit planned-diff task (task id ${taskId}). Objective: "${objective}". The neolit tools are the ONLY way to change the plan or the repository: plan_status (with the task id) for current state and node ids, propose_approaches and challenge_approaches for domains, select_approach only when explicitly told, refine_plan, draft_file (one file per call; read the file first), repair_patch after a diagnostic (read_diff first), read_diff to see a drafted patch. Never edit, write, or run shell commands. Reply in one short line when a step is done.`,
  propose: (target: string, note?: string, rejected?: string[]) =>
    `Propose approaches for ${target}.${note ? ` This is a regeneration: ${note}` : ""}${rejected?.length ? ` Previously rejected approaches must not return: ${rejected.join("; ")}.` : ""} Call plan_status first, then propose_approaches (1-5 materially distinct candidates) and challenge_approaches (accept once the domain covers the objective). Do NOT call select_approach — a human chooses. Reply in one short line when done.`,
  refine: (target: string) =>
    `Refine ${target} into children: call refine_plan with the files and directories this work needs. Do not draft yet. Reply in one short line when done.`,
  draft: (target: string) =>
    `Draft ${target} — read the file, then call draft_file with a minimal single-file unified diff (at most 3 context lines around each change); pass assumptions in the tool call. If the git diagnostic rejects it, re-read the file and call repair_patch with the diagnostic. Reply in one short line when done.`,
  regenerate: (target: string, note?: string) =>
    `Regenerate ${target} —${note ? ` the operator said: "${note}".` : ""} Call read_diff first, then repair_patch with ${note ? "that note" : "the operator's request"} as failedCheck. Reply in one short line when done.`,
};

export interface ToolSessionOptions {
  directory: string;
  backend: CliAgentBackend;
  command: string;
  model?: string;
  timeoutMs?: number;
  /** The controller's embedded server — the store tool calls land in. */
  server: AugmentServer;
  /** The agent socket address; may be undefined until the server has bound. */
  socketPath: () => string | undefined;
  /** Override the augmentd bridge command (tests). */
  bridge?: string[];
}

interface ToolStep {
  prompt: string;
  effected: (task: PlanTask) => boolean;
  failure: string;
}

export class ToolSessionDriver {
  private readonly options: ToolSessionOptions;
  private readonly bridge: string[];
  private readonly opened = new Set<string>();
  private wiring?: { env: Record<string, string>; extraArgs: string[]; file: string; socketPath: string };

  /** Kept-alive serve child carrying the tool wiring; every step runs against it. */
  private server?: PersistentAgentServer;

  /** Live session-stream tap: every parsed CLI event becomes a display line as it arrives. */
  onLine?: (line: SessionStreamLine) => void;

  constructor(options: ToolSessionOptions) {
    this.options = options;
    this.bridge = options.bridge ?? defaultBridgeCommand();
  }

  /** The address agents attach through (shown in headers and diagnostics). */
  socketAddress(): string | undefined {
    return this.wiring?.socketPath ?? this.options.socketPath();
  }

  async propose(input: { taskId: string; objective: string; nodeId: string; target: string; note?: string; rejected?: string[] }): Promise<void> {
    await this.step(input.taskId, input.objective, {
      prompt: toolPrompts.propose(input.target, input.note, input.rejected),
      effected: (task) => (task.nodes[input.nodeId]?.candidateIds.length ?? 0) > 0,
      failure: `Proposing approaches for ${input.target} changed nothing`,
    });
  }

  async refine(input: { taskId: string; objective: string; nodeId: string; target: string }): Promise<void> {
    await this.step(input.taskId, input.objective, {
      prompt: toolPrompts.refine(input.target),
      effected: (task) => Object.values(task.nodes).some((node) => node.parent === input.nodeId),
      failure: `Refining ${input.target} changed nothing`,
    });
  }

  async draft(input: { taskId: string; objective: string; nodeId: string; target: string }): Promise<void> {
    await this.step(input.taskId, input.objective, {
      prompt: toolPrompts.draft(input.target),
      effected: (task) => (task.nodes[input.nodeId]?.diffIds.length ?? 0) > 0,
      failure: `Drafting ${input.target} changed nothing`,
    });
  }

  async regenerate(input: { taskId: string; objective: string; nodeId: string; target: string; note?: string }): Promise<void> {
    const before = await this.fetchTask(input.taskId);
    const previous = input.nodeId ? before?.nodes[input.nodeId]?.diffIds.at(-1) : undefined;
    const previousPatch = previous ? before?.diffs[previous]?.patch : undefined;
    await this.step(input.taskId, input.objective, {
      prompt: toolPrompts.regenerate(input.target, input.note),
      effected: (task) => {
        const current = task.nodes[input.nodeId]?.diffIds.at(-1);
        if (!current) return false;
        const patch = task.diffs[current]?.patch;
        return patch !== undefined && patch !== previousPatch;
      },
      failure: `Regenerating ${input.target} changed nothing`,
    });
  }

  /**
   * One raw operator message into the same agent session: no operation, no
   * effect-waiting — the reply streams through onLine like every turn, and
   * the resolved value is the assistant's text (empty when it replied with
   * tool calls only).
   */
  async chat(input: { taskId: string; objective: string; message: string }): Promise<string> {
    const completed = await this.exchange(input.taskId, input.objective, input.message);
    if (completed.code !== 0) {
      const raw = this.backendValue().extractError(completed.stdout) ?? (firstLine(completed.stdout) || `exit code ${completed.code}`);
      throw new Error(`The agent session failed (${raw}).`);
    }
    if (completed.text !== undefined) return completed.text;
    try {
      return this.backendValue().parseAssistantText(completed.stdout);
    } catch {
      return "";
    }
  }

  dispose(): void {
    this.server?.dispose();
    if (this.wiring) {
      try {
        fs.rmSync(this.wiring.file, { force: true });
      } catch {
        // best-effort
      }
      this.wiring = undefined;
    }
  }

  /**
   * Stops the in-flight agent run (the operator's cancel): the child is
   * killed and the pending exchange or effect-wait rejects promptly instead
   * of polling its way to the effect deadline. A cancel that arrives while
   * no CLI child exists (the wiring server is still starting) interrupts
   * that server instead, so startup waits end immediately too.
   */
  cancel(): void {
    this.cancelRequested = true;
    const child = this.currentChild;
    if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
    else this.server?.interrupt();
  }

  private async step(taskId: string, objective: string, step: ToolStep): Promise<void> {
    const completed = await this.exchange(taskId, objective, step.prompt);
    if (completed.code !== 0) {
      const raw = this.backendValue().extractError(completed.stdout) ?? (firstLine(completed.stdout) || `exit code ${completed.code}`);
      throw new Error(`${step.failure}: the agent session failed (${raw}).`);
    }
    const task = await this.waitEffect(taskId, step.effected);
    if (!task) {
      const reply = firstLine(completed.text ?? this.backendValue().parseAssistantText(completed.stdout));
      throw new Error(`${step.failure}. The agent replied: ${reply || "(no answer text)"}`);
    }
  }

  /**
   * Runs one prompt in the task's session over the warm HTTP transport of
   * the kept-alive wiring server — the server owns the MCP connections, so
   * the model sees the neolit tools and no CLI child boots per step. A
   * transport-level failure falls back to the one-shot `--standalone` CLI
   * spawn; a model-run failure fails the step, exactly as a non-zero CLI
   * exit would. The opener anchors a fresh conversation, the task id rides
   * every message (sessions compact and forget), and the session binding is
   * remembered for the next step.
   */
  private async exchange(taskId: string, objective: string, prompt: string): Promise<{ stdout: string; code: number; text?: string }> {
    const wiring = await this.ensureWiring();
    // A cancel that arrived during wiring or server startup must stop the
    // step here — checking only after the relaunch below would sit through
    // another full startup wait.
    if (this.cancelRequested) throw new Error("Agent session was cancelled.");
    const anchor = `(task id ${taskId}) — call plan_status with it for the current state and ids.`;
    const message = this.opened.has(taskId)
      ? `${prompt}\n\n${anchor}`
      : `${toolPrompts.open(taskId, objective)}\n\n${prompt}\n\n${anchor}`;
    // Relaunch the kept-alive wiring server when it died, so a step never
    // targets a stale address.
    await this.server?.start();
    if (this.cancelRequested) throw new Error("Agent session was cancelled.");
    const warm = this.options.backend.warmTransport;
    const url = this.server?.url;
    const password = this.server?.password;
    if (warm && url && password) {
      try {
        const reply = await warm.exchange(url, warm.authorization(password), {
          model: this.options.model,
          text: message,
          session: sessionBindingFor(this.options.directory, taskId),
          timeoutMs: this.options.timeoutMs ?? 600_000,
        });
        rememberSessionBinding(this.options.directory, taskId, reply.sessionId);
        this.opened.add(taskId);
        if (this.onLine) {
          for (const line of reply.text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) this.onLine({ kind: "text", text: capped(trimmed, TEXT_LINE_CAP) });
          }
        }
        return { stdout: reply.stdout, code: 0, text: reply.text };
      } catch (error) {
        if (!(error instanceof WarmTransportUnavailableError)) throw error;
        // Transport-only: the standalone CLI step below still works.
      }
    }
    const completed = await this.run(this.argv(message, sessionBindingFor(this.options.directory, taskId), wiring), wiring.env);
    const sessionId = this.backendValue().extractSessionId(completed.stdout);
    if (sessionId) rememberSessionBinding(this.options.directory, taskId, sessionId);
    this.opened.add(taskId);
    return completed;
  }

  private backendValue(): CliAgentBackend {
    return this.options.backend;
  }

  private argv(prompt: string, session: string | undefined, wiring: { extraArgs: string[] }): string[] {
    if (this.options.backend.id === "claude") {
      return [
        "-p", prompt,
        "--output-format", "json",
        "--permission-mode", "default",
        ...wiring.extraArgs,
        ...(this.options.model ? ["--model", this.options.model] : []),
        ...(session ? ["--resume", session] : []),
      ];
    }
    // `opencode run` hands its work to a background service that owns MCP
    // connections, and that service's protocol differs from a plain serve
    // child's (`--server` fails its health probe), so the fallback step is
    // always `--standalone`: a private server inheriting this process's
    // environment, where the generated layer (with the neolit bridge) is
    // visible. The fast path is the warm HTTP exchange above, not this.
    if (this.options.backend.id === "opencode") {
      const base = this.options.backend.invocation(
        { model: this.options.model, session, prompt, title: "neolit step", autoApprove: true },
        { agent: undefined },
      );
      return base[0] === "run" ? ["run", "--standalone", ...base.slice(1)] : base;
    }
    return this.options.backend.invocation(
      { model: this.options.model, session, prompt, title: "neolit step", autoApprove: true },
      { agent: undefined },
    );
  }

  private async ensureWiring(): Promise<{ env: Record<string, string>; extraArgs: string[]; file: string; socketPath: string }> {
    if (this.wiring) return this.wiring;
    const socketPath = await this.waitForSocket();
    const file = path.join(os.tmpdir(), `neolit-tools-${process.pid}.json`);
    const config = this.options.backend.id === "opencode"
      ? openCodeToolConfig(this.bridge, socketPath, this.options.directory)
      : claudeToolConfig(this.bridge, socketPath, this.options.directory);
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    // An OpenCode serve child started with this env owns the MCP layer, so
    // warm steps through it see the neolit tools; without it, steps fall
    // back to --standalone CLI spawns. Claude takes the config file per
    // invocation.
    this.wiring = this.options.backend.id === "opencode"
      ? { env: { OPENCODE_CONFIG: file }, extraArgs: [], file, socketPath }
      : { env: {}, extraArgs: ["--mcp-config", file, "--allowedTools", "mcp__neolit__*"], file, socketPath };
    if (this.options.backend.id === "opencode") {
      // One kept-alive serve child started with the wiring env owns the MCP
      // connections (the neolit bridge): every step runs against it over
      // the warm HTTP transport, and consecutive steps reuse one session.
      this.server = new PersistentAgentServer(this.options.command, this.options.backend, this.wiring.env);
      await this.server.start();
    }
    return this.wiring;
  }

  private async waitForSocket(): Promise<string> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const socketPath = this.options.socketPath();
      if (socketPath) return socketPath;
      if (Date.now() > deadline) {
        throw new Error("The agent socket is not available; tool sessions need it (another TUI in this directory may own the address, or AUGMENT_TUI_NO_SOCKET is set).");
      }
      await sleep(100);
    }
  }

  private async fetchTask(taskId: string): Promise<PlanTask | undefined> {
    const response = await this.options.server.handle({ jsonrpc: "2.0", id: "tool-session", method: "task/get", params: { taskId } });
    return response && "result" in response ? (response.result as PlanTask) : undefined;
  }

  private async waitEffect(taskId: string, effected: (task: PlanTask) => boolean): Promise<PlanTask | undefined> {
    const deadline = Date.now() + 1_500;
    for (;;) {
      if (this.cancelRequested) throw new Error("Agent session was cancelled.");
      const task = await this.fetchTask(taskId);
      if (task && effected(task)) return task;
      if (Date.now() > deadline) return undefined;
      await sleep(150);
    }
  }

  private stream = "";

  /** Set while an agent CLI run is alive; cancel() kills it. */
  private currentChild?: ChildProcess;
  private cancelRequested = false;

  /** Emits one display line per complete JSON event as the CLI prints it. */
  private streamChunk(chunk: string): void {
    if (!this.onLine) return;
    this.stream += chunk;
    const lines = this.stream.split("\n");
    this.stream = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      for (const display of formatStreamEvent(message)) this.onLine(display);
    }
  }

  private run(argv: string[], env: Record<string, string>): Promise<{ stdout: string; code: number; stderr: string }> {
    return new Promise((resolve, reject) => {
      this.cancelRequested = false;
      const child = spawn(this.options.command, argv, { cwd: this.options.directory, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
      this.currentChild = child;
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`The agent session timed out after ${this.options.timeoutMs ?? 600_000}ms (AUGMENT_OPENCODE_TIMEOUT_MS adjusts this).`));
      }, this.options.timeoutMs ?? 600_000);
      const finish = () => {
        clearTimeout(timer);
        if (this.currentChild === child) this.currentChild = undefined;
      };
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
        this.streamChunk(chunk);
      });
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", (error) => {
        finish();
        reject(new Error(`Could not start the agent session ${this.options.command}: ${error.message}`));
      });
      // A killed CLI may leave grandchildren (agent servers) holding the
      // stdio pipes open, so `close` can lag forever: settle on `exit`.
      child.on("exit", (code) => {
        if (child.killed && code === null) reject(new Error("Agent session was cancelled."));
      });
      child.on("close", (code) => {
        finish();
        if (child.killed && code === null) return; // settled by the exit handler
        resolve({ stdout, code: code ?? 0, stderr });
      });
    });
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
