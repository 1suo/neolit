import type { ActivationContextTelemetry, AgentPromptAttemptTrace, AgentRetryTrace, AgentToolTrace, AgentUsage } from "./types.js";

export type OpenCodeRuntimeFailureKind = "startup" | "transport" | "inactivity" | "schema" | "semantic";

/**
 * Harness error protocol: despite the historical name this is the portable
 * contract between any host runtime and the kernel. A runtime throws it to
 * carry everything the kernel needs to classify, recover, or fork a failed
 * activation. The kernel duck-types on `name === "OpenCodeRuntimeError"`.
 */
export class OpenCodeRuntimeError extends Error {
  readonly name = "OpenCodeRuntimeError";

  constructor(
    readonly kind: OpenCodeRuntimeFailureKind,
    message: string,
    readonly diagnostics: {
      sessionId?: string;
      usage?: AgentUsage;
      tools?: AgentToolTrace[];
      progressText?: string;
      retryTrace?: AgentRetryTrace[];
      contextTelemetry?: ActivationContextTelemetry;
      promptAttempts?: AgentPromptAttemptTrace[];
      schemaRetries?: number;
      schemaRepairs?: number;
      retryable: boolean;
    },
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }

  get sessionId(): string | undefined { return this.diagnostics.sessionId; }
  get usage(): AgentUsage | undefined { return this.diagnostics.usage; }
  get tools(): AgentToolTrace[] | undefined { return this.diagnostics.tools; }
  get progressText(): string | undefined { return this.diagnostics.progressText; }
  get retryTrace(): AgentRetryTrace[] | undefined { return this.diagnostics.retryTrace; }
  get contextTelemetry(): ActivationContextTelemetry | undefined { return this.diagnostics.contextTelemetry; }
  get promptAttempts(): AgentPromptAttemptTrace[] | undefined { return this.diagnostics.promptAttempts; }
  get schemaRetries(): number | undefined { return this.diagnostics.schemaRetries; }
  get schemaRepairs(): number | undefined { return this.diagnostics.schemaRepairs; }
  get retryable(): boolean { return this.diagnostics.retryable; }
}
