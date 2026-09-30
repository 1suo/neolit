import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ModelCallRequest, ModelRuntime } from "../augment/types.js";
import { preflightPatches } from "./apply.js";

const DRAFT_FILE_EMBED_LIMIT = 64_000;
const DRAFT_OPERATIONS = new Set(["draft-patch", "repair-patch"]);

/**
 * Drafts should behave like auto-complete, not exploration: embed the target
 * file's exact content so the model answers in one shot without tool rounds.
 * The host owns repository access, so this lives here rather than in the core.
 * Oversized files embed head and tail: changes concentrate at the top and the
 * bottom of real source files, and a blind head cut once hid the only region
 * the model needed, producing an honest refusal instead of a patch.
 */
function draftFileSection(request: ModelCallRequest, directory: string): string | undefined {
  if (!DRAFT_OPERATIONS.has(request.operation)) return undefined;
  const target = request.context.node?.path;
  if (!target || target.includes("..")) return undefined;
  const root = path.resolve(directory);
  const absolute = path.resolve(directory, target);
  if (!absolute.startsWith(`${root}${path.sep}`)) return undefined;
  let content: string;
  try {
    if (!fs.statSync(absolute).isFile()) return undefined;
    content = fs.readFileSync(absolute, "utf8");
  } catch {
    return `Target path ${target} does not exist in the repository; the patch must create it as a new file. Do not read any file or run any tool.`;
  }
  const header = `The exact current content of ${target} is embedded below. Do NOT read any file, run any tool, or verify anything — answer from this packet alone in one shot.`;
  if (content.length <= DRAFT_FILE_EMBED_LIMIT) {
    return [header, "```", content, "```"].join("\n");
  }
  const head = Math.floor(DRAFT_FILE_EMBED_LIMIT * 0.7);
  const tail = DRAFT_FILE_EMBED_LIMIT - head;
  const omitted = content.length - DRAFT_FILE_EMBED_LIMIT;
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

const SESSION_ID_PATTERN = /"sessionID":"(ses_[^"]+)"/;
const CONTINUATION_NOTE = "This conversation continues an earlier session for the same task. Earlier context packets in its history are stale: the packet below is the CURRENT authoritative state.";

const activeChildren = new Set<ChildProcess>();
process.on("exit", () => {
  for (const child of activeChildren) {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }
});

export interface OpenCodeCliRuntimeOptions {
  directory: string;
  command?: string;
  model?: string;
  draftModel?: string;
  agent?: string;
  timeoutMs?: number;
  autoApprove?: boolean;
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
export class OpenCodeCliRuntime implements ModelRuntime {
  cancel(): void {
    for (const child of activeChildren) {
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    }
  }
  readonly directory: string;
  private readonly command: string;
  private readonly model?: string;
  private readonly draftModel?: string;
  private readonly agent?: string;
  private readonly timeoutMs: number;
  private readonly autoApprove: boolean;
  private readonly continueSessions: boolean;
  private readonly sessions = new Map<string, string>();

  constructor(options: OpenCodeCliRuntimeOptions) {
    this.directory = options.directory;
    this.command = options.command ?? process.env.AUGMENT_OPENCODE_COMMAND ?? "opencode";
    this.model = options.model ?? (process.env.AUGMENT_OPENCODE_MODEL || undefined);
    this.draftModel = options.draftModel ?? (process.env.AUGMENT_OPENCODE_DRAFT_MODEL || undefined);
    this.agent = options.agent ?? (process.env.AUGMENT_OPENCODE_AGENT || "plan");
    this.timeoutMs = options.timeoutMs ?? Number(process.env.AUGMENT_OPENCODE_TIMEOUT_MS ?? 600_000);
    this.autoApprove = options.autoApprove ?? process.env.AUGMENT_OPENCODE_AUTO !== "0";
    this.continueSessions = process.env.AUGMENT_OPENCODE_SESSIONS !== "0";
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("OpenCode runtime timeout must be a positive integer.");
  }

  async call(request: ModelCallRequest): Promise<OpenCodeCliResult> {
    let text = await this.prompt(request);
    let value = extractJsonOnly(text);
    const correction = DRAFT_OPERATIONS.has(request.operation) ? draftCorrection(value, this.directory) : undefined;
    if (correction) {
      text = await this.prompt(request, correction);
      value = extractJsonOnly(text);
    }
    if (value === undefined) {
      const trimmed = text.trim();
      const truncated = trimmed && !trimmed.endsWith("}") && !trimmed.endsWith("```")
        ? " The response looks truncated before completing the JSON object; ask for terser output or press the key again to retry."
        : "";
      throw new Error(`OpenCode returned no JSON object for ${request.operation}:${truncated}\n${text.slice(0, 2000)}`);
    }
    return { value, text, stdout: text };
  }

  private async prompt(request: ModelCallRequest, correction?: string): Promise<string> {
    const taskId = request.context.taskId;
    const previous = this.continueSessions ? this.sessions.get(taskId) : undefined;
    const baseParts = [
      `You are executing exactly one Neolit planned-diff operation: ${request.operation}.`,
      `Return ONE valid JSON object and no prose, Markdown, or code fence.`,
      `JSON contract:\n${operationContract(request)}`,
      `Temperature intent: ${request.temperature}. LOD: ${request.lod}.`,
      ...(draftFileSection(request, this.directory) ? [draftFileSection(request, this.directory)] : []),
      ...(correction ? [correction] : []),
      `Context packet (JSON). Paths in lockedPaths and their descendants must not be changed; diffs in taskDiffs are already drafted for other paths in this task — your output must not conflict with them:\n${JSON.stringify(request.context, null, 2)}`,
    ];
    if (previous) {
      try {
        const stdout = await this.run(this.invocation(request, [CONTINUATION_NOTE, ...baseParts].join("\n\n"), previous));
        this.rememberSession(taskId, stdout);
        return extractAssistantText(stdout);
      } catch {
        this.sessions.delete(taskId);
      }
    }
    const stdout = await this.run(this.invocation(request, baseParts.join("\n\n")));
    this.rememberSession(taskId, stdout);
    return extractAssistantText(stdout);
  }

  private invocation(request: ModelCallRequest, prompt: string, session?: string): string[] {
    const model = DRAFT_OPERATIONS.has(request.operation) && this.draftModel ? this.draftModel : this.model;
    return [
      "run",
      "--format",
      "json",
      ...(session ? ["--session", session] : []),
      ...(model ? ["--model", model] : []),
      ...(this.agent ? ["--agent", this.agent] : []),
      ...(this.autoApprove ? ["--auto"] : []),
      ...(!session ? ["--title", `augment-${request.operation}`] : []),
      "--",
      prompt,
    ];
  }

  private rememberSession(taskId: string, stdout: string): void {
    const session = stdout.match(SESSION_ID_PATTERN)?.[1];
    if (session) this.sessions.set(taskId, session);
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
        if (child.killed) return reject(new Error("OpenCode model call was cancelled."));
        const message = extractOpenCodeError(stdout) ?? (stderr.trim() || `OpenCode runtime exited with code ${code}.`);
        reject(new Error(message));
      });
    });
  }
}

function isEmptyDraft(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const patch = (value as { patch?: unknown }).patch;
  return typeof patch !== "string" || patch.trim().length === 0;
}

/**
 * Deterministic draft gate: a patch must parse as a unified diff git would
 * accept against the current working tree. git itself is the parser, so the
 * corrective retry can quote git's exact diagnostic back to the model.
 */
function draftCorrection(value: unknown, directory: string): string | undefined {
  if (isEmptyDraft(value)) {
    return "Your previous answer is unusable: the patch field must be a non-empty string holding the complete single-file unified diff with JSON-escaped line breaks. Return the full JSON object again with the real patch.";
  }
  const patch = (value as { patch?: unknown }).patch;
  if (typeof patch !== "string") return undefined;
  const failure = preflightPatches(directory, [patch]);
  if (!failure) return undefined;
  return `Your patch does not pass git's unified-diff check: ${failure} Regenerate the complete single-file unified diff with exact @@ header line counts, one leading space on every context line, one leading minus on deletions, and one leading plus on additions.`;
}

function operationContract(request: ModelCallRequest): string {
  switch (request.operation) {
    case "generate-domain":
      return `{"candidates":[{"label":"short approach","rationale":"why materially distinct","confidence":75,"touchedPaths":["src/example.ts"]}]} (exactly 1-5 initial candidates; every candidate MUST list 1-64 real repository paths it would touch in touchedPaths — an empty touchedPaths array is invalid and rejected; keep each label <= 80 characters and each rationale <= 240 characters; confidence is an integer 0-100 estimate; reserve capacity for challenge counterexamples)`;
    case "challenge-domain":
      return `Accept: {"kind":"accept"}; missing family: {"kind":"missing-candidate","candidate":{...},"reason":"..."}; omitted path: {"kind":"missing-path","path":"src/example.ts","reason":"..."} (reasons <= 240 characters; accept as soon as the domain covers the objective)`;
    case "refine-node":
      return `{"children":[{"path":"src/example.ts","kind":"file|dir|hunk|virtual","lod":"architecture|file|hunk","reason":"one sentence","obligations":[{"kind":"test|documentation|check|todo","description":"..."}]}]} (1-16 children; every child needs one reason of at most 200 characters; directory children summarize their whole subtree in that one sentence; at most 4 obligations per child, each description <= 160 characters; omit the diff field entirely — patches are drafted by a separate later operation, never here; never generate descendant candidate domains; lockedPaths are immutable)`;
    case "draft-patch":
    case "repair-patch":
      return `{"patch":"unified diff text","assumptions":["explicit assumption"]} (the patch must be a single-file unified diff touching ONLY the target path whose content is embedded in this prompt — never a multi-file or diff --git series covering other paths; include only the hunks the node reason requires; keep hunks minimal — at most 3 context lines around each change, never whole paragraphs or sentences as context; at most 3 assumptions, each <= 160 characters; answer in one shot without reading files or running tools)`;
    case "explain-project":
      return `{"topic":"short topic","entries":[{"path":"src/example.ts","role":"primary|supporting|context","summary":"one sentence","detail":"what it is and what it does","confidence":75}]} (1-64 concrete repository paths)`;
  }
}

export function extractAssistantText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  const parsed = parseJsonStream(trimmed);
  const texts: string[] = [];
  const visit = (value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.type === "error") {
      const failure = record.error;
      const message = typeof record.message === "string" ? record.message
        : failure && typeof failure === "object" && typeof (failure as { message?: unknown }).message === "string" ? (failure as { message: string }).message
        : typeof failure === "string" ? failure : "OpenCode runtime error.";
      throw new Error(message);
    }

    // OpenCode run --format json emits terminal text events. Tool output also
    // contains text-shaped content; only assistant text events are model output.
    const directPart = record.part as Record<string, unknown> | undefined;
    if (record.type === "text" && typeof directPart?.text === "string") {
      texts.push(directPart.text);
      return;
    }
    if ((record.type === "text" || record.type === "message" || record.role === "assistant") && typeof record.text === "string") {
      texts.push(record.text);
      return;
    }

    const message = record.message as Record<string, unknown> | undefined;
    if (message && Array.isArray(message.parts)) visit(message.parts);
    if (Array.isArray(record.parts)) visit(record.parts);
    if (Array.isArray(record.messages)) visit(record.messages);
  };
  visit(parsed);
  if (texts.length) return texts.join("\n");
  return trimmed;
}

function parseJsonStream(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // OpenCode may emit newline-delimited JSON events. Preserve their order.
    const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return value;
    const events: unknown[] = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch { return value; }
    }
    return events;
  }
}

function extractOpenCodeError(stdout: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = parseJsonStream(stdout.trim());
  } catch {
    return undefined;
  }
  const errors: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.type === "error") {
      const failure = record.error;
      const message = typeof record.message === "string" ? record.message
        : failure && typeof failure === "object" && typeof (failure as { message?: unknown }).message === "string" ? (failure as { message: string }).message
        : typeof failure === "string" ? failure : "OpenCode runtime error.";
      errors.push(message);
      return;
    }
    visit(record.part);
    visit(record.message);
  };
  visit(parsed);
  return errors.at(-1);
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
