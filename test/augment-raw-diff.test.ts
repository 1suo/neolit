import { describe, expect, it } from "vitest";
import { parseRawDraftReply } from "../src/augment/raw-diff.js";
import { AugmentModelError, draftPatchWithModel, repairPatchWithModel } from "../src/augment/kernel.js";
import { acceptDomain, collapseNode, createPlanTask, generateDomain, refineNode } from "../src/augment/state.js";
import type { ModelRuntime, PlanTask } from "../src/augment/types.js";

const DIFF = [
  "--- a/src/auth/session.ts",
  "+++ b/src/auth/session.ts",
  "@@ -1,3 +1,4 @@",
  " const retry = policy();",
  "-const attempt = 0;",
  "+const attempt = 1;",
  " // keep going",
].join("\n");

describe("raw draft reply parsing", () => {
  it("extracts a bare unified diff verbatim", () => {
    expect(parseRawDraftReply(DIFF)).toEqual({ patch: DIFF, assumptions: [] });
  });

  it("keeps git extended headers and \\ No newline markers", () => {
    const gitDiff = ["diff --git a/src/new.ts b/src/new.ts", "new file mode 100644", "index 0000000..1111111", "--- /dev/null", "+++ b/src/new.ts", "@@ -0,0 +1,2 @@", "+export const answer = 42;", "+", "\\ No newline at end of file"].join("\n");
    expect(parseRawDraftReply(gitDiff)).toEqual({ patch: gitDiff, assumptions: [] });
  });

  it("skips prose before the diff, code fences around it, and chatter after it", () => {
    const fenced = `Here is the diff you asked for:\n\n\`\`\`diff\n${DIFF}\n\`\`\`\n\nThis change keeps retries bounded.`;
    expect(parseRawDraftReply(fenced)).toEqual({ patch: DIFF, assumptions: [] });
  });

  it("collects trailing Assumption lines after the diff, across blank lines", () => {
    const reply = `${DIFF}\n\nAssumption: the policy defaults are optional\nAssumption: tests cover the cutoff\nThanks!`;
    expect(parseRawDraftReply(reply)).toEqual({
      patch: DIFF,
      assumptions: ["the policy defaults are optional", "tests cover the cutoff"],
    });
  });

  it("does not strip diff body lines that merely look like assumptions", () => {
    const withBodyLine = ["--- a/config.ts", "+++ b/config.ts", "@@ -1,2 +1,3 @@", " const x = 1;", "+Assumption: documented in config", " Assumption: existing context line"].join("\n");
    expect(parseRawDraftReply(withBodyLine)?.patch).toBe(withBodyLine);
    expect(parseRawDraftReply(withBodyLine)?.assumptions).toEqual([]);
  });

  it("returns undefined when the reply contains no diff header", () => {
    expect(parseRawDraftReply("I could not produce a diff because the target is unclear.")).toBeUndefined();
    expect(parseRawDraftReply("")).toBeUndefined();
    expect(parseRawDraftReply("@@ -1 +1 @@\n-x\n+y")).toBeUndefined();
  });
});

function draftedTask(): { task: PlanTask; nodeId: string } {
  let task = createPlanTask({ id: "task:raw", objective: "make retries bounded", basisRevision: "commit:1" });
  task = generateDomain(task, {
    taskId: task.id,
    expectedRevision: task.revision,
    nodeId: task.rootNodeId,
    candidates: [{ label: "Fixed count", rationale: "smallest change", confidence: 80, touchedPaths: ["src/auth/session.ts"] }],
  });
  task = acceptDomain(task, { taskId: task.id, expectedRevision: task.revision, nodeId: task.rootNodeId, challengeRound: 1 });
  task = collapseNode(task, { taskId: task.id, expectedRevision: task.revision, nodeId: task.rootNodeId, candidateId: task.nodes[task.rootNodeId]!.candidateIds[0]! });
  task = refineNode(task, {
    taskId: task.id,
    expectedRevision: task.revision,
    nodeId: task.rootNodeId,
    children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "retry cutoff" }],
  });
  return { task, nodeId: Object.values(task.nodes).find((node) => node.path === "src/auth/session.ts")!.id };
}

describe("raw draft replies through the kernel", () => {
  it("attaches the raw diff and records trailing assumptions as model constraints", async () => {
    const { task, nodeId } = draftedTask();
    const reply = `${DIFF}\nAssumption: the cutoff is configurable`;
    const runtime: ModelRuntime = { async call() { return { value: reply }; } };
    const drafted = await draftPatchWithModel(runtime, task, { taskId: task.id, nodeId, temperature: "low" });
    const diff = drafted.diffs[drafted.nodes[nodeId]!.diffIds[0]!]!;
    expect(diff.patch).toBe(DIFF);
    expect(diff.path).toBe("src/auth/session.ts");
    expect(Object.values(drafted.constraints).map((constraint) => constraint.text)).toEqual(["Draft assumption: the cutoff is configurable"]);
    expect(Object.values(drafted.constraints).every((constraint) => constraint.source === "model")).toBe(true);
  });

  it("still accepts the JSON envelope", async () => {
    const { task, nodeId } = draftedTask();
    const runtime: ModelRuntime = { async call() { return { value: { patch: DIFF, assumptions: [] } }; } };
    const drafted = await draftPatchWithModel(runtime, task, { taskId: task.id, nodeId, temperature: "low" });
    expect(drafted.diffs[drafted.nodes[nodeId]!.diffIds[0]!]!.patch).toBe(DIFF);
  });

  it("repairs an existing diff from a raw reply", async () => {
    const { task, nodeId } = draftedTask();
    const first: ModelRuntime = { async call() { return { value: DIFF }; } };
    const drafted = await draftPatchWithModel(first, task, { taskId: task.id, nodeId, temperature: "low" });
    const diffId = drafted.nodes[nodeId]!.diffIds[0]!;
    const replacement = ["--- a/src/auth/session.ts", "+++ b/src/auth/session.ts", "@@ -1,2 +1,2 @@", " const retry = policy();", "-const attempt = 0;", "+const attempt = 2;"].join("\n");
    const repaired = await repairPatchWithModel({ async call() { return { value: replacement }; } }, drafted, {
      taskId: drafted.id,
      diffId,
      failedCheck: "cutoff too low",
      temperature: "low",
    });
    expect(repaired.diffs[diffId]!.patch).toBe(replacement);
    expect(repaired.diffs[diffId]!.failedCheck).toBe("cutoff too low");
  });

  it("fails without state change when a raw reply holds no diff", async () => {
    const { task, nodeId } = draftedTask();
    const runtime: ModelRuntime = { async call() { return { value: "sorry, no diff here" }; } };
    await expect(draftPatchWithModel(runtime, task, { taskId: task.id, nodeId, temperature: "low" }))
      .rejects.toThrow(AugmentModelError);
    await expect(draftPatchWithModel(runtime, task, { taskId: task.id, nodeId, temperature: "low" }))
      .rejects.toThrow(/no unified diff/u);
  });
});
