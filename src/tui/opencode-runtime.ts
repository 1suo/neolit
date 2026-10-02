import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelCallRequest, ModelContextPacket, ModelRuntime } from "../augment/types.js";
import { parseRawDraftReply } from "../augment/raw-diff.js";
import { preflightPatches } from "./apply.js";
import { backendById, opencodeBackend, type AgentInvocationParts, type CliAgentBackend } from "./agent-backends.js";

export { extractAssistantText } from "./agent-backends.js";

const TRANSIENT_ERROR = /rate limit|429|overloaded|econnreset|etimedout|socket hang up|temporarily unavailable|timed out/i;

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_ERROR.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function noJsonObjectMessage(operation: string, text: string, reasoningOnly: boolean): string {
  const trimmed = text.trim();
  const hint = reasoningOnly
    ? " the model reasoned but wrote no answer text"
    : !trimmed
      ? " the reply was empty"
      : !trimmed.endsWith("}") && !trimmed.endsWith("```")
        ? " The response looks truncated before completing the JSON object; ask for terser output or press the key again to retry."
        : "";
  return `OpenCode returned no JSON object for ${operation}:${hint}\n${text.slice(0, 2000)}`;
}

function noUnifiedDiffMessage(operation: string, text: string, reasoningOnly: boolean): string {
  const trimmed = text.trim();
  const hint = reasoningOnly
    ? " the model reasoned but wrote no answer text"
    : !trimmed
      ? " the reply was empty"
      : "";
  return `OpenCode returned no unified diff for ${operation}:${hint}\n${text.slice(0, 2000)}`;
}

/**
 * Single-file drafts answer in raw unified-diff text — self-delimiting, no
 * JSON string escaping to break, nothing to truncate mid-envelope — so the
 * raw text is passed through as the reply value and the kernel's controller
 * parser extracts the diff and any trailing assumption lines. A legacy JSON
 * envelope reply is still accepted.
 */
function draftReplyValue(text: string, raw: boolean): unknown | undefined {
  if (!raw) return extractJsonOnly(text);
  if (parseRawDraftReply(text)) return text;
  return extractJsonOnly(text);
}

/** The patch text of a draft reply, from either a raw string or a JSON envelope. */
function patchOf(value: unknown): string | undefined {
  if (typeof value === "string") return parseRawDraftReply(value)?.patch;
  if (value && typeof value === "object") {
    const patch = (value as { patch?: unknown }).patch;
    if (typeof patch === "string") return patch;
  }
  return undefined;
}

function isEmptyDraft(value: unknown): boolean {
  if (value && typeof value === "object" && Array.isArray((value as { patches?: unknown }).patches)) {
    const patches = (value as { patches: Array<{ patch?: unknown }> }).patches;
    return patches.length === 0 || patches.some((entry) => !entry || typeof entry.patch !== "string" || entry.patch.trim().length === 0);
  }
  const patch = patchOf(value);
  return patch === undefined || patch.trim().length === 0;
}

/**
 * Deterministic draft gate: a patch must parse as a unified diff git would
 * accept against the current working tree AND together with every other
 * drafted patch in the task, so stored diffs are jointly applicable. git
 * itself is the parser, so the corrective retry can quote git's exact
 * diagnostic back to the model.
 */
function draftCorrection(value: unknown, directory: string, taskDiffs: Array<{ nodeId: string; patch: string }> = [], selfNodeId?: string): string | undefined {
  if (isEmptyDraft(value)) {
    return "Your previous answer is unusable: it must contain the complete diff content — the raw single-file unified diff for the target path, or every target's patch when the reply is a batch. Return the real diff(s) now.";
  }
  const patch = patchOf(value);
  if (patch === undefined) return undefined;
  const others = taskDiffs
    .filter((diff) => diff.nodeId !== selfNodeId && typeof diff.patch === "string" && diff.patch.trim().length > 0)
    .map((diff) => diff.patch);
  const failure = preflightPatches(directory, [patch, ...others]);
  if (!failure) return undefined;
  return `Your patch does not apply cleanly — ${failure} Regenerate the complete single-file unified diff so it stays coherent with the working tree and with this task's other drafted changes.`;
}

const NO_ANSWER_TEXT_CORRECTION = "Your previous reply contained no answer text — it was empty or reasoning-only. Return the JSON object now as your actual reply text; do not stop after thinking.";

const TRUNCATED_REPLY_CORRECTION = "Your previous reply was cut off before the JSON object closed. Return a much shorter answer now: only the minimal hunks the change needs (at most 3 context lines each, never whole paragraphs as context), no prose, no repetition of file content, and finish with the closing brace.";

const TRUNCATED_DIFF_CORRECTION = "Your previous reply contained no complete unified diff — it was prose, or it was cut off before the diff completed. Return only the diff now: the minimal hunks the change needs (at most 3 context lines each, never whole paragraphs as context), no prose, no repetition of file content, complete to the last hunk.";

const DRAFT_MODEL_FALLBACK_NOTE = "The faster draft model could not produce a usable answer, so you are the reliable fallback. Answer with only the requested diff: minimal hunks, no prose, complete to the end.";

function sessionsStorePath(): string {
  const base = process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.trim()
    ? process.env.XDG_STATE_HOME
    : path.join(os.homedir(), ".local", "state");
  return path.join(base, "neolit", "augment-sessions.json");
}

function loadSessions(): Map<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionsStorePath(), "utf8")) as Record<string, unknown>;
    return new Map(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].startsWith("ses_")));
  } catch {
    return new Map();
  }
}

function saveSessions(sessions: Map<string, string>): void {
  try {
    fs.mkdirSync(path.dirname(sessionsStorePath()), { recursive: true });
    fs.writeFileSync(sessionsStorePath(), `${JSON.stringify(Object.fromEntries(sessions), null, 2)}\n`, "utf8");
  } catch {
    // Persistence is best-effort; the in-memory mapping keeps working.
  }
}

const DRAFT_FILE_EMBED_LIMIT = 64_000;
const DRAFT_OPERATIONS = new Set(["draft-patch", "repair-patch", "draft-patches"]);
/** Single-file drafts reply with the raw unified diff itself, not JSON. */
const SINGLE_DRAFT_OPERATIONS = new Set(["draft-patch", "repair-patch"]);

/**
 * Drafts should behave like auto-complete, not exploration: embed the target
 * file's exact content so the model answers in one shot without tool rounds.
 * The host owns repository access, so this lives here rather than in the core.
 * Oversized files embed head and tail: changes concentrate at the top and the
 * bottom of real source files, and a blind head cut once hid the only region
 * the model needed, producing an honest refusal instead of a patch.
 * A `draft-patches` batch embeds every target under one shared size budget,
 * so one prompt stays bounded no matter how many files it carries.
 */
function embedFile(target: string, content: string | undefined, budget: number): string | undefined {
  const header = content === undefined
    ? `Target path ${target} does not exist in the repository; its patch must create it as a new file. Do not read any file or run any tool.`
    : `The exact current content of ${target} is embedded below. Do NOT read any file, run any tool, or verify anything — answer from this packet alone in one shot.`;
  if (content === undefined) return header;
  if (content.length <= budget) return [header, "```", content, "```"].join("\n");
  const head = Math.floor(budget * 0.7);
  const tail = budget - head;
  const omitted = content.length - budget;
  return [
    header,
    `This file is ${content.length} characters, so the middle ${omitted} characters are omitted: the first ${head} and the last ${tail} are shown. If the change you need falls inside the omitted middle, anchor the hunk's context lines to the nearest shown region and estimate the @@ line numbers from it.`,
    "```",
    content.slice(0, head),
    "```",
    `${omitted} characters omitted`,
    "```",
    content.slice(content.length - tail),
    "```",
  ].join("\n");
}

function readRepositoryFile(directory: string, target: string): string | undefined {
  if (!target || target.includes("..")) return undefined;
  const root = path.resolve(directory);
  const absolute = path.resolve(directory, target);
  if (!absolute.startsWith(`${root}${path.sep}`)) return undefined;
  try {
    if (!fs.statSync(absolute).isFile()) return undefined;
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return undefined;
  }
}

function draftFileSection(request: ModelCallRequest, directory: string): string | undefined {
  if (!DRAFT_OPERATIONS.has(request.operation)) return undefined;
  const targets = request.operation === "draft-patches"
    ? (request.context.draftTargets ?? []).map((target) => target.path)
    : [request.context.node?.path].filter((path): path is string => Boolean(path));
  if (!targets.length) return undefined;
  const perFileBudget = Math.max(4_096, Math.floor(DRAFT_FILE_EMBED_LIMIT / targets.length));
  const sections = targets.map((target) => embedFile(target, readRepositoryFile(directory, target), perFileBudget));
  return [
    `Target ${targets.length === 1 ? "file" : `files (${targets.length}, listed in order)`}: ${targets.join(", ")}. Each is embedded below under its own header.`,
    ...sections,
  ].join("\n\n");
}

/**
 * Draft prompts carry a slimmer packet than conversation operations: the
 * rejected-candidate ledger and the full text of already-drafted patches are
 * conversation context, not draft inputs — dropping them keeps every draft
 * call (and the batch) far from output limits. The full packet stays intact
 * for the runtime's own logic (joint preflight uses complete patch text).
 */
export function slimDraftContext(context: ModelContextPacket): ModelContextPacket {
  return {
    ...context,
    rejectedCandidates: [],
    taskDiffs: (context.taskDiffs ?? []).map((diff) => ({ ...diff, patch: "" })),
  };
}

const CONTINUATION_NOTE = "This conversation continues an earlier session for the same task. Earlier context packets in its history are stale: the packet below is the CURRENT authoritative state.";

const activeChildren = new Set<ChildProcess>();
process.on("exit", () => {
  for (const child of activeChildren) {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }
});

export interface OpenCodeCliRuntimeOptions {
  directory: string;
  /** Agent backend; defaults to OpenCode. New agents plug in via agent-backends.ts. */
  backend?: CliAgentBackend | string;
  command?: string;
  model?: string;
  draftModel?: string;
  challengeModel?: string;
  agent?: string;
  server?: string;
  timeoutMs?: number;
  autoApprove?: boolean;
  retries?: number;
  retryDelayMs?: number;
}

interface OpenCodeCliResult {
  value: unknown;
  text: string;
  stdout: string;
}

/**
 * Host adapter that routes bounded augment operations through the OpenCode CLI.
 *
 * This is intentionally a command-line adapter rather than an OpenCode plugin
 * dependency: the standalone TUI can use OpenCode's authentication and model
 * routing while the planned-diff core remains host-neutral.
 */
export class CliAgentRuntime implements ModelRuntime {
  get backendId(): string {
    return this.backend.id;
  }

  get commandName(): string {
    return this.command;
  }

  /** Live model reconfiguration for hosts that switch models mid-session. */
  setModels(update: { model?: string; draftModel?: string; challengeModel?: string }): void {
    if (update.model !== undefined) this.model = update.model;
    if (update.draftModel !== undefined) this.draftModel = update.draftModel;
    if (update.challengeModel !== undefined) this.challengeModel = update.challengeModel;
  }

  cancel(): void {
    for (const child of activeChildren) {
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    }
  }
  readonly directory: string;
  private readonly backend: CliAgentBackend;
  private readonly command: string;
  private model?: string;
  private draftModel?: string;
  private challengeModel?: string;
  private readonly agent?: string;
  private readonly timeoutMs: number;
  private readonly autoApprove: boolean;
  private readonly continueSessions: boolean;
  private readonly serverUrl?: string;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly sessions: Map<string, string> = loadSessions();

  constructor(options: OpenCodeCliRuntimeOptions) {
    this.directory = options.directory;
    this.backend = typeof options.backend === "string" ? backendById(options.backend) : options.backend ?? opencodeBackend;
    this.command = options.command ?? process.env.AUGMENT_OPENCODE_COMMAND ?? this.backend.defaultCommand;
    this.model = options.model ?? (process.env.AUGMENT_OPENCODE_MODEL || undefined);
    this.draftModel = options.draftModel ?? (process.env.AUGMENT_OPENCODE_DRAFT_MODEL || undefined);
    this.challengeModel = options.challengeModel ?? (process.env.AUGMENT_OPENCODE_CHALLENGE_MODEL || undefined);
    this.agent = options.agent ?? (process.env.AUGMENT_OPENCODE_AGENT || "plan");
    this.timeoutMs = options.timeoutMs ?? Number(process.env.AUGMENT_OPENCODE_TIMEOUT_MS ?? 600_000);
    this.autoApprove = options.autoApprove ?? process.env.AUGMENT_OPENCODE_AUTO !== "0";
    this.continueSessions = process.env.AUGMENT_OPENCODE_SESSIONS !== "0";
    this.serverUrl = options.server ?? (process.env.AUGMENT_OPENCODE_SERVER || undefined);
    this.retries = options.retries ?? Number(process.env.AUGMENT_OPENCODE_RETRIES ?? 2);
    if (!Number.isSafeInteger(this.retries) || this.retries < 0) throw new Error("OpenCode runtime retries must be a non-negative integer.");
    this.retryDelayMs = options.retryDelayMs ?? 4_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("OpenCode runtime timeout must be a positive integer.");
  }

  async call(request: ModelCallRequest): Promise<OpenCodeCliResult> {
    let completed: { text: string; value: unknown };
    try {
      completed = await this.complete(request);
    } catch (error) {
      // A flaky draft model must not fail the draft: when a different default
      // model is configured, one bounded retry runs on it. Fast models lose
      // output discipline under load (truncated JSON); the primary model is
      // the reliable path.
      if (!DRAFT_OPERATIONS.has(request.operation) || !this.model || this.modelFor(request.operation) === this.model) throw error;
      completed = await this.complete(request, [DRAFT_MODEL_FALLBACK_NOTE], this.model);
    }
    const correction = DRAFT_OPERATIONS.has(request.operation)
      ? draftCorrection(completed.value, this.directory, request.context.taskDiffs, request.context.node?.id)
      : undefined;
    if (correction) completed = await this.complete(request, [correction]);
    return { value: completed.value, text: completed.text, stdout: completed.text };
  }

  private modelFor(operation: ModelCallRequest["operation"]): string | undefined {
    return DRAFT_OPERATIONS.has(operation) && this.draftModel
      ? this.draftModel
      : operation === "challenge-domain" && this.challengeModel
        ? this.challengeModel
        : this.model;
  }

  /**
   * One bounded attempt loop shared by first tries and corrective retries:
   * transient provider failures (rate limits, disconnects, timeouts) and
   * unparseable output are retried up to `retries` extra times with linear
   * backoff; everything else fails fast.
   */
  private async complete(request: ModelCallRequest, corrections: string[] = [], modelOverride?: string): Promise<{ text: string; value: unknown }> {
    const attempts = 1 + this.retries;
    const raw = SINGLE_DRAFT_OPERATIONS.has(request.operation);
    let failure: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(this.retryDelayMs * attempt);
      try {
        const { text, stdout } = await this.prompt(request, corrections, modelOverride);
        const value = draftReplyValue(text, raw);
        if (value !== undefined) return { text, value };
        const reasoningOnly = !text.trim() && /"type":\s*"reasoning"/.test(stdout);
        failure = new Error(raw
          ? noUnifiedDiffMessage(request.operation, text, reasoningOnly)
          : noJsonObjectMessage(request.operation, text, reasoningOnly));
        // Corrections are symptom-specific: an empty reply needs the
        // answer-now nudge; a non-empty unparseable reply is almost always
        // output truncation, which only a shorter answer survives.
        corrections = [...corrections, text.trim() ? (raw ? TRUNCATED_DIFF_CORRECTION : TRUNCATED_REPLY_CORRECTION) : NO_ANSWER_TEXT_CORRECTION];
      } catch (error) {
        if (!isRetryable(error) || attempt === attempts - 1) throw error;
        failure = error;
      }
    }
    throw failure;
  }

  private async prompt(request: ModelCallRequest, corrections: string[] = [], modelOverride?: string): Promise<{ text: string; stdout: string }> {
    const taskId = request.context.taskId;
    // Drafts are one-shot by design: the target file is embedded in the
    // prompt, so resuming a long-lived session only piles stale history onto
    // the context and pushes the long patch reply over output limits. Only
    // conversation-style operations (domain, challenge, refine, explain)
    // continue their session.
    const previous = this.continueSessions && !DRAFT_OPERATIONS.has(request.operation) ? this.sessions.get(taskId) : undefined;
    const regenerationNote = request.operation === "generate-domain" && request.context.rejectedCandidates?.length
      ? "This is a regeneration: the operator rejected the approaches listed in rejectedCandidates. Produce materially different candidates — never repeat a rejected label or a trivial rewording of one."
      : undefined;
    const baseParts = [
      ...(regenerationNote ? [regenerationNote] : []),
      `You are executing exactly one Neolit planned-diff operation: ${request.operation}.`,
      SINGLE_DRAFT_OPERATIONS.has(request.operation)
        ? `Reply with the raw unified diff text itself — no JSON, no code fence, no prose before or after it.`
        : `Return ONE valid JSON object and no prose, Markdown, or code fence.`,
      `Reply contract:\n${operationContract(request)}`,
      `Temperature intent: ${request.temperature}. LOD: ${request.lod}.`,
      ...(draftFileSection(request, this.directory) ? [draftFileSection(request, this.directory)] : []),
      ...corrections,
      DRAFT_OPERATIONS.has(request.operation)
        ? `Context packet (JSON), slimmed for drafting: rejectedCandidates is empty by design, and taskDiffs lists already-drafted paths with their patch text omitted — do not conflict with those paths:\n${JSON.stringify(slimDraftContext(request.context))}`
        : `Context packet (JSON). lockedPaths is the restriction set and restrictionMode its polarity: in "lock" mode never touch them; in "allow" mode propose changes ONLY inside them; taskTree is the current plan shape (path, kind, status, drafted); diffs in taskDiffs are already drafted for other paths in this task — your output must not conflict with them:\n${JSON.stringify(request.context)}`,
    ];
    if (previous) {
      try {
        const stdout = await this.run(this.invocation(request, [CONTINUATION_NOTE, ...baseParts].join("\n\n"), previous, modelOverride));
        this.rememberSession(taskId, stdout);
        return { text: this.backend.parseAssistantText(stdout), stdout };
      } catch {
        this.sessions.delete(taskId);
        saveSessions(this.sessions);
      }
    }
    const stdout = await this.run(this.invocation(request, baseParts.join("\n\n"), undefined, modelOverride));
    this.rememberSession(taskId, stdout);
    return { text: this.backend.parseAssistantText(stdout), stdout };
  }

  private invocation(request: ModelCallRequest, prompt: string, session?: string, modelOverride?: string): string[] {
    const model = modelOverride ?? this.modelFor(request.operation);
    return this.backend.invocation(
      { model, session, prompt, title: `augment-${request.operation}`, autoApprove: this.autoApprove },
      { server: this.serverUrl, agent: this.agent },
    );
  }

  private rememberSession(taskId: string, stdout: string): void {
    const session = this.backend.extractSessionId(stdout);
    if (!session) return;
    this.sessions.set(taskId, session);
    if (this.sessions.size > 64) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    saveSessions(this.sessions);
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, { cwd: this.directory, stdio: ["ignore", "pipe", "pipe"] });
      activeChildren.add(child);
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`OpenCode runtime timed out after ${this.timeoutMs}ms. Set AUGMENT_OPENCODE_TIMEOUT_MS to allow slower model runs.`));
      }, this.timeoutMs);
      const finish = () => {
        clearTimeout(timer);
        activeChildren.delete(child);
      };
      child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", (error) => {
        finish();
        reject(new Error(`Could not start OpenCode runtime ${this.command}: ${error.message}`));
      });
      child.on("close", (code) => {
        finish();
        if (code === 0) return resolve(stdout);
        if (child.killed) return reject(new Error("Model call was cancelled."));
        const raw = this.backend.extractError(stdout) ?? (stderr.trim() || `${this.backend.id} runtime exited with code ${code}.`);
        const hint = /model unavailable|no route|provider\.no-route/i.test(raw) ? " (pick an available model with 'augment setup' or [M])" : "";
        reject(new Error(`${raw}${hint}`));
      });
    });
  }
}

function operationContract(request: ModelCallRequest): string {
  switch (request.operation) {
    case "generate-domain":
      return `{"candidates":[{"label":"short approach","rationale":"why materially distinct","confidence":75,"touchedPaths":["src/example.ts"]}]} (1-5 candidates; return EXACTLY ONE when only one approach is genuinely viable — a singleton accepted domain is adopted automatically without a user choice; otherwise every candidate MUST list 1-64 real repository paths it would touch in touchedPaths — an empty touchedPaths array is invalid and rejected; keep each label <= 80 characters and each rationale <= 240 characters; confidence is an integer 0-100 estimate; reserve capacity for challenge counterexamples)`;
    case "challenge-domain":
      return `Accept: {"kind":"accept"}; missing family: {"kind":"missing-candidate","candidate":{...},"reason":"..."}; omitted path: {"kind":"missing-path","path":"src/example.ts","reason":"..."} (reasons <= 240 characters; accept as soon as the domain covers the objective)`;
    case "refine-node":
      return `{"children":[{"path":"src/example.ts","kind":"file|dir|hunk|virtual","lod":"architecture|file|hunk","reason":"one sentence","obligations":[{"kind":"test|documentation|check|todo","description":"..."}]}]} (1-16 children; every child needs one reason of at most 200 characters; directory children summarize their whole subtree in that one sentence; at most 4 obligations per child, each description <= 160 characters; omit the diff field entirely — patches are drafted by a separate later operation, never here; never generate descendant candidate domains; lockedPaths are immutable)`;
    case "draft-patch":
    case "repair-patch":
      return `the raw unified diff text — a single-file unified diff touching ONLY the target path whose content is embedded in this prompt — never JSON, never a code fence, never a multi-file or diff --git series covering other paths; start directly at the --- / +++ headers and @@ hunks; include only the hunks the node reason requires; keep hunks minimal — at most 3 context lines around each change, never whole paragraphs or sentences as context; after the final hunk you may add up to 3 assumption lines, each formatted exactly as 'Assumption: one short sentence' (<=160 characters); no other prose before or after; answer in one shot without reading files or running tools)`;
    case "draft-patches":
      return `{"patches":[{"path":"exact target path","patch":"unified diff text"}]} (one entry for EVERY target listed in this prompt, in that order — never omit one, never invent an extra; each patch is a single-file unified diff for exactly its own path with the same rules as a single draft: only the hunks its node reason requires, at most 3 context lines around each change, never echo file content, no prose; keep the ENTIRE reply short and close the JSON object; answer in one shot without reading files or running tools)`;
    case "explain-project":
      return `{"topic":"short topic","entries":[{"path":"src/example.ts","role":"primary|supporting|context","summary":"one sentence","detail":"what it is and what it does","confidence":75}]} (1-64 concrete repository paths)`;
  }
}

export function extractJsonOnly(text: string): unknown | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced ?? text.trim();
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {}
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(source.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Back-compat alias: the OpenCode-flavored default of the generic runtime. */
export class OpenCodeCliRuntime extends CliAgentRuntime {}
