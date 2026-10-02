/**
 * One CLI agent backend (OpenCode, Codex, Claude Code, …): the argv shape
 * and the output parsing that differ per vendor. Everything else — prompt
 * construction, retries, corrections, session persistence, timeouts, model
 * routing per operation — lives in the generic CliAgentRuntime, so adding an
 * agent is one object in this file.
 *
 * Flags below are maintained against each CLI's documented non-interactive
 * mode. Vendor flags drift; when one does, fix it here and only here.
 */
export interface AgentInvocationParts {
  model?: string;
  session?: string;
  prompt: string;
  title: string;
  autoApprove: boolean;
}

export interface CliAgentBackend {
  readonly id: string;
  readonly defaultCommand: string;
  /** Whether `augment models` can list this backend's account models. */
  readonly supportsModelsCommand: boolean;
  /** argv that starts this backend's kept-alive server, when it has one. */
  readonly serveArgs?: () => string[];
  invocation(parts: AgentInvocationParts, options: { server?: string; agent?: string }): string[];
  parseAssistantText(stdout: string): string;
  extractSessionId(stdout: string): string | undefined;
  extractError(stdout: string): string | undefined;
}

const SESSION_ID_PATTERN = /"sessionID":"(ses_[^"]+)"/;

const SERVER_URL_PATTERN = /https?:\/\/[^\s"']+/;

/** The listening address a backend's persistent server prints on startup. */
export function extractServerUrl(stdout: string): string | undefined {
  return stdout.match(SERVER_URL_PATTERN)?.[0];
}

function parseJsonStream(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return value;
    const events: unknown[] = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch { return value; }
    }
    return events;
  }
}

/** OpenCode: `opencode run --format json` newline-delimited event stream. */
export const opencodeBackend: CliAgentBackend = {
  id: "opencode",
  defaultCommand: "opencode",
  supportsModelsCommand: true,
  serveArgs: () => ["serve", "--port", "0"],
  invocation(parts, options) {
    return [
      "run",
      "--format",
      "json",
      ...(options.server ? ["--server", options.server] : []),
      ...(parts.session ? ["--session", parts.session] : []),
      ...(parts.model ? ["--model", parts.model] : []),
      ...(options.agent ? ["--agent", options.agent] : []),
      ...(parts.autoApprove ? ["--auto"] : []),
      ...(!parts.session ? ["--title", parts.title] : []),
      "--",
      parts.prompt,
    ];
  },
  parseAssistantText: extractAssistantText,
  extractSessionId(stdout) {
    return stdout.match(SESSION_ID_PATTERN)?.[1];
  },
  extractError(stdout) {
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
  },
};

/** OpenCode run --format json emits terminal text events; only assistant text is model output. */
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
  // An event stream without a text part is not an answer: the model reasoned
  // or erred without replying. Returning the raw envelope here would let the
  // JSON extractor mistake the event itself for the model's answer.
  if (typeof parsed === "string") return trimmed;
  return "";
}

/** Claude Code: `claude -p --output-format json` returns one result object. */
export const claudeBackend: CliAgentBackend = {
  id: "claude",
  defaultCommand: "claude",
  supportsModelsCommand: false,
  invocation(parts) {
    return [
      "-p",
      parts.prompt,
      "--output-format",
      "json",
      "--permission-mode",
      "plan",
      ...(parts.model ? ["--model", parts.model] : []),
      ...(parts.session ? ["--resume", parts.session] : []),
    ];
  },
  parseAssistantText(stdout) {
    let parsed: { result?: unknown; is_error?: boolean };
    try {
      parsed = JSON.parse(stdout.trim()) as { result?: unknown; is_error?: boolean };
    } catch {
      return stdout;
    }
    if (parsed.is_error) throw new Error(typeof parsed.result === "string" ? parsed.result : "Claude runtime error.");
    return typeof parsed.result === "string" ? parsed.result : "";
  },
  extractSessionId(stdout) {
    try {
      const parsed = JSON.parse(stdout.trim()) as { session_id?: unknown };
      return typeof parsed.session_id === "string" ? parsed.session_id : undefined;
    } catch {
      return undefined;
    }
  },
  extractError(stdout) {
    try {
      const parsed = JSON.parse(stdout.trim()) as { is_error?: boolean; result?: unknown };
      if (parsed.is_error && typeof parsed.result === "string") return parsed.result;
      return undefined;
    } catch {
      return undefined;
    }
  },
};

/** Codex: `codex exec --json` emits a JSONL event stream. Sessions are not continued yet. */
export const codexBackend: CliAgentBackend = {
  id: "codex",
  defaultCommand: "codex",
  supportsModelsCommand: false,
  invocation(parts) {
    return [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      ...(parts.model ? ["-m", parts.model] : []),
      parts.prompt,
    ];
  },
  parseAssistantText(stdout) {
    const texts: string[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        const item = event.item as Record<string, unknown> | undefined;
        if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
          texts.push(item.text);
          continue;
        }
        if (event.type === "agent_message" && typeof event.text === "string") texts.push(event.text);
      } catch {
        if (!stdout.trim().startsWith("{")) texts.push(trimmed);
      }
    }
    return texts.join("\n");
  },
  extractSessionId() {
    return undefined;
  },
  extractError(stdout) {
    for (const line of stdout.split(/\r?\n/)) {
      try {
        const event = JSON.parse(line.trim()) as Record<string, unknown>;
        if (event.type === "error" && typeof event.message === "string") return event.message;
      } catch {
        continue;
      }
    }
    return undefined;
  },
};

export const agentBackends: Record<string, CliAgentBackend> = {
  opencode: opencodeBackend,
  claude: claudeBackend,
  codex: codexBackend,
};

export function backendById(id: string | undefined): CliAgentBackend {
  const backend = id ? agentBackends[id] : undefined;
  if (!backend) throw new Error(`Unknown agent backend '${id ?? ""}'. Available: ${Object.keys(agentBackends).join(", ")}.`);
  return backend;
}

