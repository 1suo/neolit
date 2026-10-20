/**
 * One CLI agent backend (OpenCode, Codex, Claude Code, …): the argv shape,
 * the output parsing, and the warm HTTP dialect that differ per vendor.
 * Everything else — prompt construction, retries, corrections, session
 * persistence, timeouts, model routing per operation — lives in the generic
 * CliAgentRuntime, so adding an agent is one object in this file.
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

/**
 * Transport-level warm failure — the server could not be reached, rejected
 * the request, or broke the reply contract. The universal one-shot CLI
 * spawn can still serve the call, so callers fall back on this class only;
 * any other error (a model-run failure read from a healthy reply) must fail
 * the call because the CLI would only repeat it.
 */
export class WarmTransportUnavailableError extends Error {}

export interface WarmExchangeInput {
  /** Backend agent for a fresh session (OpenCode v2: `POST …/agent`). */
  agent?: string;
  /** `provider/model` identifier routed per call; omitted keeps the session default. */
  model?: string;
  text: string;
  session?: string;
  timeoutMs: number;
}

export interface WarmExchangeResult {
  text: string;
  stdout: string;
  sessionId: string;
}

/**
 * Warm HTTP transport against this backend's kept-alive server: one prompt
 * as HTTP round-trips against the already-running process, so a model call
 * boots no CLI child. Endpoints and payload shapes are relative to the
 * server's printed address; vendor drift is fixed here, only here.
 */
export interface WarmTransport {
  /** Authorization header value for the password the server printed. */
  authorization(password: string): string;
  exchange(base: string, authorization: string, input: WarmExchangeInput): Promise<WarmExchangeResult>;
}

export interface CliAgentBackend {
  readonly id: string;
  readonly defaultCommand: string;
  /** Whether `augment models` can list this backend's account models. */
  readonly supportsModelsCommand: boolean;
  /** argv that starts this backend's kept-alive server, when it has one. */
  readonly serveArgs?: () => string[];
  /** Warm HTTP dialect for the kept-alive server, when it has one. */
  readonly warmTransport?: WarmTransport;
  invocation(parts: AgentInvocationParts, options: { server?: string; agent?: string }): string[];
  parseAssistantText(stdout: string): string;
  extractSessionId(stdout: string): string | undefined;
  extractError(stdout: string): string | undefined;
}

const SESSION_ID_PATTERN = /"sessionID":"(ses_[^"]+)"/;

const SERVER_URL_PATTERN = /https?:\/\/[^\s"']+/;

const SERVER_PASSWORD_PATTERN = /^server password (\S+)/m;

/** The listening address a backend's persistent server prints on startup. */
export function extractServerUrl(stdout: string): string | undefined {
  return stdout.match(SERVER_URL_PATTERN)?.[0];
}

/**
 * The password a backend's persistent server prints after its address
 * (OpenCode v2 `serve` guards every route with HTTP basic auth using it).
 */
export function extractServerPassword(stdout: string): string | undefined {
  return stdout.match(SERVER_PASSWORD_PATTERN)?.[1];
}

/** Splits `provider/model` into the v2 Model.Ref shape; bare names stay unset. */
function modelRef(model: string | undefined): { providerID: string; id: string } | undefined {
  if (!model) return undefined;
  const slash = model.indexOf("/");
  return slash === -1 ? undefined : { providerID: model.slice(0, slash), id: model.slice(slash + 1) };
}

interface WarmMessage {
  id?: string;
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
}

/** Assistant text parts of one warm reply, in message order, ignoring reasoning. */
function warmAssistantText(messages: WarmMessage[]): string {
  const texts: string[] = [];
  for (const message of [...messages].reverse()) {
    if (message.type !== "assistant") continue;
    for (const part of message.content ?? []) {
      if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
    }
  }
  return texts.join("\n");
}

/**
 * OpenCode v2 serve dialect, verified against a live v2 host: every route
 * takes HTTP basic auth (username `opencode`, the printed server password);
 * `POST /api/session` creates, per-session `model`/`agent` posts route the
 * call, `POST …/prompt` queues the text and returns the user message id, the
 * experimental `…/wait` long-polls the idle gate, and `GET …/message` lists
 * messages newest-first — an `idle` marker newer than our prompt means the
 * run ended and the assistant messages before it carry the reply.
 */
export const opencodeWarmTransport: WarmTransport = {
  authorization(password) {
    return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  },
  async exchange(base, authorization, input) {
    const root = base.replace(/\/+$/, "");
    const request = async (path: string, init: { method: string; body?: unknown }, timeoutMs: number): Promise<unknown> => {
      let response: Response;
      try {
        response = await fetch(`${root}${path}`, {
          method: init.method,
          headers: { ...(init.body === undefined ? {} : { "content-type": "application/json" }), authorization },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new WarmTransportUnavailableError(`warm transport could not reach ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!response.ok) throw new WarmTransportUnavailableError(`warm transport HTTP ${response.status} for ${init.method} ${path}.`);
      const body = await response.text();
      if (!body) return undefined;
      try {
        return JSON.parse(body) as unknown;
      } catch {
        return undefined;
      }
    };
    let sessionId = input.session;
    if (!sessionId) {
      const created = await request("/api/session", { method: "POST", body: {} }, 10_000) as { data?: { id?: string } } | undefined;
      sessionId = created?.data?.id;
      if (!sessionId) throw new WarmTransportUnavailableError("warm transport created no session.");
      if (input.agent) await request(`/api/session/${sessionId}/agent`, { method: "POST", body: { agent: input.agent } }, 10_000);
    }
    const ref = modelRef(input.model);
    if (ref) await request(`/api/session/${sessionId}/model`, { method: "POST", body: { model: ref } }, 10_000);
    const queued = await request(`/api/session/${sessionId}/prompt`, { method: "POST", body: { text: input.text } }, 30_000) as { data?: { id?: string } } | undefined;
    const userMessageId = queued?.data?.id;
    if (!userMessageId) throw new WarmTransportUnavailableError("warm transport queued no prompt message.");
    const deadline = Date.now() + input.timeoutMs;
    for (;;) {
      // The idle gate long-polls when the host offers it; absence is fine,
      // the message list below is the authoritative completion check.
      await request(`/api/experimental/session/${sessionId}/wait`, { method: "POST" }, 10_000).catch(() => undefined);
      const listed = await request(`/api/session/${sessionId}/message`, { method: "GET" }, 10_000) as { data?: WarmMessage[] } | undefined;
      const messages = Array.isArray(listed?.data) ? listed.data : [];
      const position = messages.findIndex((message) => message.id === userMessageId);
      const after = position === -1 ? [] : messages.slice(0, position);
      if (after.some((message) => message.type === "idle")) {
        const text = warmAssistantText(after);
        const failed = after.find((message) => message.type === "assistant" && message.error);
        if (failed && !text.trim()) throw new Error(failed.error?.message ?? "The warm model run failed.");
        return { text, stdout: JSON.stringify(after), sessionId };
      }
      if (Date.now() > deadline) throw new Error(`Warm transport timed out after ${input.timeoutMs}ms waiting for the assistant reply.`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  },
};

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
  warmTransport: opencodeWarmTransport,
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

