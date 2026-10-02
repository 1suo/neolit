import { nextDevelopmentStep, undraftedFileTargets } from "../augment/kernel.js";
import { planTree } from "../augment/state.js";
import type { PlanNode, PlanTask, PlanTreeEntry } from "../augment/types.js";
import { AUGMENT_PROTOCOL_VERSION, AugmentServer, ProtocolError, type JsonRpcRequest, type JsonRpcResponse } from "./server.js";

/**
 * MCP tool provider over the planned-diff controller. Agents write into the
 * plan through small typed tool calls instead of one JSON reply: each call
 * carries one operation (a single file's diff, one approach selection, one
 * refinement), flows through the same reducers as every other mutation, and
 * is answered immediately with either a compact confirmation or the exact
 * controller/git diagnostic, so the agent retries that operation with the
 * precise reason. Deterministic per-operation call caps bound agent loops.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Host-injected `git apply` diagnostic: returns undefined when the patches compose. */
export type PreflightPatches = (patches: string[]) => string | undefined;

export type McpToolName =
  | "plan_start"
  | "plan_status"
  | "propose_approaches"
  | "challenge_approaches"
  | "select_approach"
  | "refine_plan"
  | "draft_file"
  | "repair_patch";

/** Deterministic per-operation call caps; reads (`plan_status`) are uncapped. */
export const MCP_TOOL_CAPS: Record<McpToolName, number> = {
  plan_start: 8,
  propose_approaches: 32,
  challenge_approaches: 32,
  select_approach: 32,
  refine_plan: 48,
  draft_file: 96,
  repair_patch: 96,
  plan_status: Number.POSITIVE_INFINITY,
};

const MAX_STATUS_ROWS = 512;

interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
}

interface ToolSpec {
  name: McpToolName;
  description: string;
  inputSchema: JsonSchema;
}

const pathSchema: JsonSchema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
const revisionField = { type: "integer", minimum: 1, description: "The task revision your last result reported; stale revisions are rejected — refetch with plan_status." };

function required(...names: string[]): string[] {
  return names;
}

const TOOLS: ToolSpec[] = [
  {
    name: "plan_start",
    description: "Start one change task from an objective. Returns taskId, the starting revision, and the root node id. Everything else operates on that task.",
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string", description: "What the planned change must accomplish." },
        basisRevision: { type: "string", description: "Repository revision the plan is drafted against (for example a commit sha or 'worktree')." },
      },
      required: required("objective", "basisRevision"),
    },
  },
  {
    name: "plan_status",
    description: "Refetch the compact plan state: revision, per-path rows with node ids and statuses, pending approach choices with candidate ids, the next deterministic step, and the undrafted file targets to call draft_file on. Read-only.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: required("taskId"),
    },
  },
  {
    name: "propose_approaches",
    description: "Propose the candidate domain for one node: 1-5 materially distinct approaches, each with label, rationale, 0-100 confidence, and the repository paths it would touch. Candidates touching paths outside the node's scope are recorded as out-of-scope notes, not candidates.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        expectedRevision: revisionField,
        nodeId: { type: "string" },
        replace: { type: "boolean", description: "Replace an existing domain instead of failing on it." },
        candidates: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              rationale: { type: "string" },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
              touchedPaths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 64 },
            },
            required: required("label", "rationale", "confidence", "touchedPaths"),
          },
        },
      },
      required: required("taskId", "expectedRevision", "nodeId", "candidates"),
    },
  },
  {
    name: "challenge_approaches",
    description: "Challenge a live domain before selecting: either accept it ({kind:'accept'}) when it covers the objective, or report one concrete omission — a missing approach family ({kind:'missing-candidate'}) or a missing touched path ({kind:'missing-path'}). At most two counterexample rounds are budgeted; exhausting them records bounded, unproven coverage and still permits selection. A domain must be accepted or exhausted before select_approach works.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        expectedRevision: revisionField,
        nodeId: { type: "string" },
        verdict: {
          type: "object",
          oneOf: [
            { type: "object", properties: { kind: { type: "string", const: "accept" } }, required: required("kind") },
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "missing-candidate" },
                reason: { type: "string" },
                candidate: { type: "object", properties: { label: { type: "string" }, rationale: { type: "string" }, confidence: { type: "integer", minimum: 0, maximum: 100 }, touchedPaths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 64 } }, required: required("label", "rationale", "confidence", "touchedPaths") },
              },
              required: required("kind", "reason", "candidate"),
            },
            {
              type: "object",
              properties: { kind: { type: "string", const: "missing-path" }, path: { type: "string" }, reason: { type: "string" } },
              required: required("kind", "path", "reason"),
            },
          ],
        },
      },
      required: required("taskId", "expectedRevision", "nodeId", "verdict"),
    },
  },
  {
    name: "select_approach",
    description: "Commit to one candidate approach. Siblings are eliminated with a recorded witness, so rejected approaches cannot silently return. Next step after selection is refine_plan.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        expectedRevision: revisionField,
        nodeId: { type: "string" },
        candidateId: { type: "string", description: "A candidate id from plan_status." },
      },
      required: required("taskId", "expectedRevision", "nodeId", "candidateId"),
    },
  },
  {
    name: "refine_plan",
    description: "Expand one collapsed node into its children: directories, files, hunks, or virtual scopes (1-16), each inside the parent's path scope. Children receive approaches only when explicitly proposed later; file targets are drafted with draft_file.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        expectedRevision: revisionField,
        nodeId: { type: "string" },
        children: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Repository path; required for dir/file/hunk children." },
              kind: { type: "string", enum: ["dir", "file", "hunk", "virtual"] },
              lod: { type: "string", enum: ["architecture", "file", "hunk"] },
              reason: { type: "string", description: "One sentence: what this child's planned work is." },
              obligations: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["test", "documentation", "check", "todo"] }, description: { type: "string" } }, required: required("kind", "description") } },
            },
            required: required("kind", "lod", "reason"),
          },
        },
      },
      required: required("taskId", "expectedRevision", "nodeId", "children"),
    },
  },
  {
    name: "draft_file",
    description: "Draft the patch for exactly one undrafted file/hunk node: a single-file unified diff (raw text, `--- a/…`/`+++ b/…`/`@@` hunks) touching only that node's path. Scope, locks, and — when the host enabled it — joint `git apply` applicability with the task's other drafts are checked before anything is stored; on failure the exact diagnostic is returned and the task is unchanged, so regenerate that one file's diff and call again.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        expectedRevision: revisionField,
        nodeId: { type: "string", description: "From plan_status; alternatively pass path for a file/hunk/virtual node." },
        ...pathSchema.properties,
        patch: { type: "string", description: "The complete single-file unified diff for this node's path." },
        assumptions: { type: "array", items: { type: "string" }, maxItems: 32, description: "Explicit assumptions worth inspecting later." },
      },
      required: required("taskId", "expectedRevision", "patch"),
    },
  },
  {
    name: "repair_patch",
    description: "Replace one drafted patch with a corrected diff after a failed check. Same scope, lock, and applicability contract as draft_file; pass the diagnostic you are fixing in failedCheck so the record stays grounded.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        expectedRevision: revisionField,
        diffId: { type: "string", description: "The diff id returned by draft_file or plan_status." },
        patch: { type: "string" },
        failedCheck: { type: "string", description: "The exact reason this patch is being replaced." },
      },
      required: required("taskId", "expectedRevision", "diffId", "patch"),
    },
  },
];

interface ToolOutcome {
  text: string;
  structured?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpAugmentOptions {
  /** Shared controller state; defaults to a fresh server with no model runtime — the agent is the model. */
  server?: AugmentServer;
  /** Optional host-injected `git apply` preflight for draft/repair diagnostics. */
  preflight?: PreflightPatches;
  /** Tighter per-operation call caps for tests and embedded hosts. */
  caps?: Partial<Record<McpToolName, number>>;
}

interface StatusRow {
  path: string;
  kind: PlanTreeEntry["kind"];
  status: PlanTreeEntry["status"];
  nodeIds: string[];
  drafted: boolean;
  candidates?: Array<{ id: string; label: string }>;
}

export class McpAugmentServer {
  readonly server: AugmentServer;
  private readonly preflight?: PreflightPatches;
  private readonly caps: Record<McpToolName, number>;
  private readonly calls = new Map<string, number>();
  private nextRequestId = 1;

  constructor(options: McpAugmentOptions = {}) {
    this.server = options.server ?? new AugmentServer();
    this.preflight = options.preflight;
    this.caps = { ...MCP_TOOL_CAPS, ...options.caps };
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (request.jsonrpc !== "2.0") {
      if (request.id === undefined || request.id === null) return null;
      return { jsonrpc: "2.0", id: request.id, error: { code: -32600, message: "Expected JSON-RPC 2.0 request" } };
    }
    // MCP notifications (no id) never get a response, even when unknown.
    if (request.id === undefined || request.id === null) return null;
    try {
      const result = await this.dispatch(request.method, request.params);
      return { jsonrpc: "2.0", id: request.id, result };
    } catch (error) {
      const code = error instanceof ProtocolError ? error.code : -32603;
      const message = error instanceof Error ? error.message : String(error);
      return { jsonrpc: "2.0", id: request.id, error: { code, message } };
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "augmentd", version: String(AUGMENT_PROTOCOL_VERSION) },
          instructions: "Drive the planned diff one small step at a time: plan_start, then plan_status; propose_approaches, challenge_approaches (accept or one concrete omission — a domain must be accepted or budget-exhausted before selection), select_approach, refine_plan, and draft_file for each undrafted target. Every mutation is validated by the controller — on an error, fix exactly that operation and call it again with the diagnostic in mind. Every tool has a deterministic call cap.",
        };
      case "ping":
        return {};
      case "tools/list":
        return { tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) };
      case "tools/call": {
        const input = object(params);
        const name = string(input.name, "name");
        const spec = TOOLS.find((tool) => tool.name === name);
        if (!spec) throw new ProtocolError(-32602, `Unknown tool: ${name}`);
        const outcome = await this.callTool(spec, input.arguments);
        const result: Record<string, unknown> = { content: [{ type: "text", text: outcome.text }] };
        if (outcome.structured !== undefined) result.structuredContent = outcome.structured;
        if (outcome.isError) result.isError = true;
        return result;
      }
      default:
        throw new ProtocolError(-32601, `Unknown method: ${method}`);
    }
  }

  private async callTool(spec: ToolSpec, args: unknown): Promise<ToolOutcome> {
    const input = object(args);
    const taskId = typeof input.taskId === "string" ? input.taskId : spec.name === "plan_start" ? undefined : requiredString(input, "taskId");
    try {
      this.chargeCap(spec, taskId);
      return await this.runTool(spec.name, input);
    } catch (error) {
      if (error instanceof ToolError) return { text: error.message, isError: true };
      if (error instanceof ProtocolError) return { text: this.toolErrorText(error), isError: true };
      throw error;
    }
  }

  private chargeCap(spec: ToolSpec, taskId?: string): void {
    const cap = this.caps[spec.name];
    if (!Number.isFinite(cap)) return;
    const key = `${spec.name} ${taskId ?? ""}`;
    const used = (this.calls.get(key) ?? 0) + 1;
    this.calls.set(key, used);
    if (used > cap) {
      throw new ToolError(`Call cap reached for ${spec.name} (${cap} calls${taskId ? ` on ${taskId}` : ""}). Stop calling it; finish the plan with what has landed.`);
    }
  }

  private toolErrorText(error: ProtocolError): string {
    const hint = error.code === -32010
      ? " The plan moved on: call plan_status, then retry with its revision."
      : error.code === -32011
        ? " This path is locked by controller authority; do not change it."
        : error.code === -32012
          ? " Stay inside the named scope: one patch touches exactly its own file node."
          : "";
    return `${error.message} (controller code ${error.code}).${hint}`;
  }

  private async runTool(name: McpToolName, input: Record<string, unknown>): Promise<ToolOutcome> {
    switch (name) {
      case "plan_start":
        return this.planStart(input);
      case "plan_status":
        return this.planStatus(requiredString(input, "taskId"));
      case "propose_approaches":
        return this.proposeApproaches(input);
      case "challenge_approaches":
        return this.challengeApproaches(input);
      case "select_approach":
        return this.selectApproach(input);
      case "refine_plan":
        return this.refinePlan(input);
      case "draft_file":
        return this.draftFile(input);
      case "repair_patch":
        return this.repairPatch(input);
    }
  }

  private async planStart(input: Record<string, unknown>): Promise<ToolOutcome> {
    const task = (await this.native("task/start", {
      objective: requiredString(input, "objective"),
      basisRevision: requiredString(input, "basisRevision"),
    })) as PlanTask;
    return {
      text: `Task ${task.id} started at revision ${task.revision}; root node ${task.rootNodeId}. Call plan_status next.`,
      structured: { taskId: task.id, revision: task.revision, rootNodeId: task.rootNodeId, objective: task.objective, basisRevision: task.basisRevision },
    };
  }

  private async planStatus(taskId: string): Promise<ToolOutcome> {
    const task = (await this.native("task/get", { taskId })) as PlanTask;
    const rows = statusRows(task);
    const structured = {
      taskId: task.id,
      revision: task.revision,
      objective: task.objective,
      lockedPaths: task.lockedPaths,
      restrictionMode: task.restrictionMode,
      nextStep: nextDevelopmentStep(task, task.rootNodeId),
      draftTargets: undraftedFileTargets(task, task.rootNodeId).map((node) => node.path),
      rows,
    };
    return { text: JSON.stringify(structured), structured };
  }

  private async proposeApproaches(input: Record<string, unknown>): Promise<ToolOutcome> {
    const base = taskMutation(input);
    const nodeId = requiredString(input, "nodeId");
    const task = (await this.native("domain/propose", {
      ...base,
      nodeId,
      candidates: input.candidates,
      replace: input.replace === true,
    })) as PlanTask;
    const node = task.nodes[nodeId]!;
    const notes = constraintNotes(task, base.expectedRevision, nodeId);
    const candidates = node.candidateIds.map((id) => ({ id, label: task.candidates[id]!.label, status: task.candidates[id]!.status }));
    return {
      text: `${candidates.length} approach${candidates.length === 1 ? "" : "es"} on ${nodeId} (revision ${task.revision}).${notes.length ? ` Notes: ${notes.join("; ")}.` : ""} Challenge the domain with challenge_approaches — accept it when it covers the objective, or report one concrete omission.`,
      structured: { taskId: task.id, revision: task.revision, nodeId, candidates, notes },
    };
  }

  private async challengeApproaches(input: Record<string, unknown>): Promise<ToolOutcome> {
    const base = taskMutation(input);
    const nodeId = requiredString(input, "nodeId");
    const task = (await this.native("domain/challenge", {
      ...base,
      nodeId,
      verdict: input.verdict,
    })) as PlanTask;
    const node = task.nodes[nodeId]!;
    const outcome = node.acceptedDomain ? "accepted" : node.challengeExhausted ? "exhausted" : "counterexample";
    const candidates = node.candidateIds.map((id) => ({ id, label: task.candidates[id]!.label, status: task.candidates[id]!.status }));
    const guidance = outcome === "accepted"
      ? "Domain accepted. Select one approach with select_approach."
      : outcome === "exhausted"
        ? "Challenge budget exhausted: coverage is bounded and unproven, but selection is permitted. Call select_approach."
        : `Counterexample recorded (round ${node.challengeRound} of 2). Challenge again or accept with challenge_approaches.`;
    return {
      text: `${guidance} Revision ${task.revision}.`,
      structured: { taskId: task.id, revision: task.revision, nodeId, outcome, challengeRound: node.challengeRound, candidates },
    };
  }

  private async selectApproach(input: Record<string, unknown>): Promise<ToolOutcome> {
    const base = taskMutation(input);
    const nodeId = requiredString(input, "nodeId");
    const task = (await this.native("node/select", { ...base, nodeId, candidateId: requiredString(input, "candidateId") })) as PlanTask;
    const selectedId = task.nodes[nodeId]!.selectedCandidateId!;
    const label = task.candidates[selectedId]!.label;
    return {
      text: `Selected "${label}" on ${nodeId} (revision ${task.revision}). Next: refine_plan.`,
      structured: { taskId: task.id, revision: task.revision, nodeId, selectedCandidateId: selectedId, selectedLabel: label, nextStep: nextDevelopmentStep(task, task.rootNodeId) },
    };
  }

  private async refinePlan(input: Record<string, unknown>): Promise<ToolOutcome> {
    const base = taskMutation(input);
    const nodeId = requiredString(input, "nodeId");
    const task = (await this.native("node/refine", { ...base, nodeId, children: input.children })) as PlanTask;
    const notes = constraintNotes(task, base.expectedRevision, nodeId);
    const children = Object.values(task.nodes)
      .filter((node) => node.parent === nodeId)
      .sort((left, right) => (left.path ?? "").localeCompare(right.path ?? ""))
      .map((node) => ({ nodeId: node.id, path: node.path, kind: node.kind }));
    return {
      text: `${children.length} children under ${task.nodes[nodeId]!.path ?? nodeId} (revision ${task.revision}).${notes.length ? ` Notes: ${notes.join("; ")}.` : ""} Draft file targets with draft_file.`,
      structured: { taskId: task.id, revision: task.revision, nodeId, children, notes, nextStep: nextDevelopmentStep(task, task.rootNodeId) },
    };
  }

  private async draftFile(input: Record<string, unknown>): Promise<ToolOutcome> {
    const base = taskMutation(input);
    const patch = requiredText(input, "patch");
    const task = (await this.native("task/get", { taskId: base.taskId })) as PlanTask;
    const node = resolveDraftNode(task, input);
    if (node.diffIds.length > 0) {
      throw new ToolError(`${node.path ?? node.id} is already drafted (${node.diffIds.join(", ")}). Call repair_patch with the diff id instead.`);
    }
    this.requireApplicable(task, patch, node.id);
    const updated = (await this.native("patch/attach", {
      ...base,
      nodeId: node.id,
      patch,
      assumptions: input.assumptions,
    })) as PlanTask;
    const diff = updated.diffs[updated.nodes[node.id]!.diffIds.at(-1)!]!;
    const notes = constraintNotes(updated, base.expectedRevision, node.id);
    return {
      text: `Drafted ${diff.path || node.path || node.id} as ${diff.id} (revision ${updated.revision}). It is not applied to the repository.${notes.length ? ` Assumptions: ${notes.join("; ")}.` : ""}`,
      structured: { taskId: updated.id, revision: updated.revision, nodeId: node.id, diffId: diff.id, path: diff.path, kind: diff.kind, notes, nextStep: nextDevelopmentStep(updated, updated.rootNodeId) },
    };
  }

  private async repairPatch(input: Record<string, unknown>): Promise<ToolOutcome> {
    const base = taskMutation(input);
    const diffId = requiredText(input, "diffId");
    const patch = requiredText(input, "patch");
    const task = (await this.native("task/get", { taskId: base.taskId })) as PlanTask;
    const diff = task.diffs[diffId];
    if (!diff) throw new ToolError(`Unknown diff: ${diffId}. Get current diff ids from plan_status.`);
    this.requireApplicable(task, patch, diff.nodeId);
    const updated = (await this.native("patch/set", {
      ...base,
      diffId,
      patch,
      failedCheck: typeof input.failedCheck === "string" && input.failedCheck.trim() ? input.failedCheck : undefined,
    })) as PlanTask;
    return {
      text: `Replaced ${diffId} for ${updated.diffs[diffId]!.path} (revision ${updated.revision}).`,
      structured: { taskId: updated.id, revision: updated.revision, diffId, nodeId: diff.nodeId, path: updated.diffs[diffId]!.path, nextStep: nextDevelopmentStep(updated, updated.rootNodeId) },
    };
  }

  /**
   * Joint applicability gate: when the host injected a preflight, the new
   * patch must compose with every other drafted patch in the task, exactly
   * like the eventual host-side apply. Git's own diagnostic is returned to
   * the agent verbatim so it can retry that one file with the exact reason.
   * Without a preflight the controller's scope and lock validation still
   * guards every draft.
   */
  private requireApplicable(task: PlanTask, patch: string, nodeId: string): void {
    if (!this.preflight) return;
    const others = Object.values(task.diffs)
      .filter((diff) => diff.nodeId !== nodeId)
      .map((diff) => diff.patch)
      .filter((text) => text.trim().length > 0);
    const failure = this.preflight([patch, ...others]);
    if (failure) {
      throw new ToolError(`The patch does not apply cleanly — ${failure} Regenerate this file's diff so it stays coherent with the working tree and the task's other drafted changes.`);
    }
  }

  private async native(method: string, params: unknown): Promise<unknown> {
    const response = await this.server.handle({ jsonrpc: "2.0", id: `mcp:${this.nextRequestId++}`, method, params });
    if (!response) throw new ProtocolError(-32000, `${method} returned no response`);
    if ("error" in response) throw new ProtocolError(response.error.code, response.error.message);
    return response.result;
  }
}

/** Tool-level failure: the call is answered, not raised — the agent reads the reason and retries. */
class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProtocolError(-32602, "Arguments must be an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ProtocolError(-32602, `${field} must be a non-empty string`);
  return value.trim();
}

function requiredString(input: Record<string, unknown>, field: string): string {
  return string(input[field], field);
}

/** Like `requiredString` but preserves the exact text (patches are verbatim). */
function requiredText(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) throw new ProtocolError(-32602, `${field} must be a non-empty string`);
  return value;
}

function taskMutation(input: Record<string, unknown>): { taskId: string; expectedRevision: number } {
  const expectedRevision = input.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new ProtocolError(-32602, "expectedRevision must be a positive integer");
  }
  return { taskId: requiredString(input, "taskId"), expectedRevision };
}

/** Constraints the just-finished call recorded (escape notes, draft assumptions). */
function constraintNotes(task: PlanTask, baseRevision: number, nodeId: string): string[] {
  return Object.values(task.constraints)
    .filter((constraint) => constraint.createdRevision > baseRevision && constraint.nodeId === nodeId)
    .map((constraint) => constraint.text);
}

function resolveDraftNode(task: PlanTask, input: Record<string, unknown>): PlanNode {
  const byId = typeof input.nodeId === "string" ? task.nodes[input.nodeId] : undefined;
  if (byId) {
    if (!["file", "hunk", "virtual"].includes(byId.kind)) {
      throw new ToolError(`${byId.id} is a ${byId.kind} node; draft_file targets a file, hunk, or virtual node.`);
    }
    return byId;
  }
  const path = typeof input.path === "string" ? input.path : undefined;
  if (path) {
    const matches = Object.values(task.nodes).filter((node) => node.path === path && ["file", "hunk", "virtual"].includes(node.kind));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new ToolError(`Multiple draftable nodes share ${path}: ${matches.map((node) => node.id).join(", ")}. Pass nodeId explicitly.`);
    throw new ToolError(`No file, hunk, or virtual node at ${path}. plan_status lists draftable targets.`);
  }
  throw new ProtocolError(-32602, "draft_file requires nodeId or path");
}

function statusRows(task: PlanTask): StatusRow[] {
  const rows: StatusRow[] = [];
  const visit = (entry: PlanTreeEntry) => {
    if (rows.length >= MAX_STATUS_ROWS) return;
    const candidates = entry.candidateIds
      .map((id) => task.candidates[id])
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate) && candidate!.status === "possible")
      .map((candidate) => ({ id: candidate.id, label: candidate.label }));
    rows.push({
      path: entry.path,
      kind: entry.kind,
      status: entry.status,
      nodeIds: entry.nodeIds,
      drafted: entry.diffIds.length > 0,
      candidates: candidates.length ? candidates : undefined,
    });
    for (const child of entry.children) visit(child);
  };
  visit(planTree(task));
  return rows;
}

/** Newline-delimited JSON-RPC 2.0 MCP loop over standard I/O. */
export async function runStdioMcpServer(options: McpAugmentOptions = {}, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const { createInterface } = await import("node:readline");
  const server = new McpAugmentServer(options);
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    const response = await server.handle(request as JsonRpcRequest);
    if (!response) continue;
    output.write(`${JSON.stringify(response)}\n`);
  }
}
