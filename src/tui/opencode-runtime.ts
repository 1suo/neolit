import { spawn } from "node:child_process";
import type { ModelCallRequest, ModelRuntime } from "../augment/types.js";

export interface OpenCodeCliRuntimeOptions {
  directory: string;
  command?: string;
  model?: string;
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
  readonly directory: string;
  private readonly command: string;
  private readonly model?: string;
  private readonly agent?: string;
  private readonly timeoutMs: number;
  private readonly autoApprove: boolean;

  constructor(options: OpenCodeCliRuntimeOptions) {
    this.directory = options.directory;
    this.command = options.command ?? process.env.AUGMENT_OPENCODE_COMMAND ?? "opencode";
    this.model = options.model ?? (process.env.AUGMENT_OPENCODE_MODEL || undefined);
    this.agent = options.agent ?? (process.env.AUGMENT_OPENCODE_AGENT || undefined);
    this.timeoutMs = options.timeoutMs ?? Number(process.env.AUGMENT_OPENCODE_TIMEOUT_MS ?? 600_000);
    this.autoApprove = options.autoApprove ?? process.env.AUGMENT_OPENCODE_AUTO !== "0";
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("OpenCode runtime timeout must be a positive integer.");
  }

  async call(request: ModelCallRequest): Promise<OpenCodeCliResult> {
    const text = await this.prompt(request);
    const value = extractJsonOnly(text);
    if (value === undefined) throw new Error(`OpenCode returned no JSON object for ${request.operation}:\n${text.slice(0, 2000)}`);
    return { value, text, stdout: text };
  }

  private async prompt(request: ModelCallRequest): Promise<string> {
    const operation = operationContract(request);
    const prompt = [
      `You are executing exactly one Neolit planned-diff operation: ${request.operation}.`,
      `Return ONE valid JSON object and no prose, Markdown, or code fence.`,
      `JSON contract:\n${operation}`,
      `Temperature intent: ${request.temperature}. LOD: ${request.lod}.`,
      `Context packet (JSON):\n${JSON.stringify(request.context, null, 2)}`,
    ].join("\n\n");
    const args = ["run", "--format", "json", ...(this.model ? ["--model", this.model] : []), ...(this.agent ? ["--agent", this.agent] : []), ...(this.autoApprove ? ["--auto"] : []), "--title", `augment ${request.operation}`, "--", prompt];
    const stdout = await this.run(args);
    return extractAssistantText(stdout);
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, { cwd: this.directory });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`OpenCode runtime timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Could not start OpenCode runtime ${this.command}: ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve(stdout);
        const message = extractOpenCodeError(stdout) ?? (stderr.trim() || `OpenCode runtime exited with code ${code}.`);
        reject(new Error(message));
      });
    });
  }
}

function operationContract(request: ModelCallRequest): string {
  switch (request.operation) {
    case "generate-domain":
      return `{"candidates":[{"label":"short approach","rationale":"why materially distinct","touchedPaths":["src/example.ts"]}]} (1-7 candidates)`;
    case "challenge-domain":
      return `Accept: {"kind":"accept"}; missing family: {"kind":"missing-candidate","candidate":{...},"reason":"..."}; omitted path: {"kind":"missing-path","path":"src/example.ts","reason":"..."}`;
    case "refine-node":
      return `{"children":[{"path":"src/example.ts","kind":"file|dir|hunk|virtual","lod":"architecture|file|hunk","reason":"...","obligations":[{"kind":"test|documentation|check|todo","description":"..."}],"diff":{"patch":"..."}}]} (1-16 children)`;
    case "draft-patch":
    case "repair-patch":
      return `{"patch":"unified diff text","assumptions":["explicit assumption"]}`;
  }
}

export function extractAssistantText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  const parsed = parseJsonStream(trimmed);
  const texts: string[] = [];
  const visit = (value: unknown): void => {
    if (value === undefined || value === null) return;
    if (typeof value === "string") {
      texts.push(value);
      return;
    }
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
    if ((record.type === "text" || record.role === "assistant") && typeof record.text === "string") texts.push(record.text);
    const nested = ["parts", "message", "messages", "data", "output", "response", "content", "choices"];
    for (const key of nested) visit(record[key]);
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
  try {
    const parsed = JSON.parse(stdout) as { type?: string; error?: { message?: string }; message?: string };
    if (parsed.type === "error") return parsed.error?.message ?? parsed.message;
    return undefined;
  } catch {
    return undefined;
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
