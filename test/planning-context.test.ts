import { describe, expect, it } from "vitest";
import {
  buildDiffQuestionPacket,
  checkDiffAnchorCurrent,
  createDiffAnchor,
} from "../src/planning/context.js";
import { parseSpecDocument, parseTodoDocument } from "../src/planning/markdown.js";

const diff = [
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+export const value = 1;",
  "+export const next = 2;",
].join("\n");

describe("diff context", () => {
  it("creates an anchor with an exact base, side, range, and diff identity", () => {
    const anchor = createDiffAnchor({
      path: "src/new.ts",
      side: "working-tree",
      baseCommit: "abc123",
      diffText: diff,
      lineRange: { startLine: 1, endLine: 2 },
      hunk: { oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, header: "" },
    });
    expect(anchor).toMatchObject({
      path: "src/new.ts",
      side: "working-tree",
      baseCommit: "abc123",
      diffIdentity: expect.stringMatching(/^[a-f0-9]{64}$/u),
      lineRange: { startLine: 1, endLine: 2 },
    });
  });

  it("rejects absolute and parent-traversal paths and invalid ranges", () => {
    expect(() => createDiffAnchor({ path: "../secret.ts", side: "working-tree", baseCommit: "abc", diffText: diff })).toThrow(/repository root/u);
    expect(() => createDiffAnchor({ path: "/tmp/secret.ts", side: "working-tree", baseCommit: "abc", diffText: diff })).toThrow(/repository-relative/u);
    expect(() => createDiffAnchor({
      path: "src/file.ts",
      side: "working-tree",
      baseCommit: "abc",
      diffText: diff,
      lineRange: { startLine: 5, endLine: 4 },
    })).toThrow(/line range/u);
  });

  it("detects stale base, diff, and blob identities", () => {
    const anchor = createDiffAnchor({
      path: "src/new.ts",
      side: "working-tree",
      baseCommit: "abc123",
      diffText: diff,
      blobOid: "blob-1",
    });
    expect(checkDiffAnchorCurrent(anchor, { baseCommit: "def456", diffText: diff, blobOid: "blob-1" }))
      .toEqual({ current: false, reason: "base-changed" });
    expect(checkDiffAnchorCurrent(anchor, { baseCommit: "abc123", diffText: diff + "\n", blobOid: "blob-1" }))
      .toEqual({ current: false, reason: "diff-changed" });
    expect(checkDiffAnchorCurrent(anchor, { baseCommit: "abc123", diffText: diff }))
      .toEqual({ current: false, reason: "blob-changed" });
  });

  it("builds a compact packet with only the selected hunk and related plan", () => {
    const anchor = createDiffAnchor({
      path: "src/new.ts",
      side: "working-tree",
      baseCommit: "abc123",
      diffText: diff,
      hunk: { oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, header: "" },
    });
    const todo = parseTodoDocument("src/new/TODO.md", [
      "- [ ] Implement value",
      "  - SPEC: `SPEC.md#R-01`",
    ].join("\n"));
    const spec = parseSpecDocument("src/new/SPEC.md", "- **R-01** Export the value.");
    const result = buildDiffQuestionPacket({
      question: "Why is this value exported?",
      anchor,
      currentBaseCommit: "abc123",
      currentDiffText: diff,
      selectedDiffText: "@@ -0,0 +1,2 @@\n+export const value = 1;",
      relatedTasks: [{
        todoPath: todo.path,
        task: todo.tasks[0]!,
        requirements: [{ specPath: spec.path, requirement: spec.requirements[0]! }],
      }],
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected a current context packet");
    expect(result.packet).toContain("Diff side: working-tree");
    expect(result.packet).toContain("src/new.ts hunk old no lines, new 1-2");
    expect(result.packet).toContain("+export const value = 1;");
    expect(result.packet).not.toContain("+export const next = 2;");
    expect(result.packet).toContain("src/new/TODO.md:1: Implement value");
    expect(result.packet).toContain("src/new/SPEC.md#R-01: Export the value.");
  });

  it("refuses to build a packet from stale or missing selected diff text", () => {
    const anchor = createDiffAnchor({
      path: "src/new.ts",
      side: "working-tree",
      baseCommit: "abc123",
      diffText: diff,
    });
    expect(buildDiffQuestionPacket({
      question: "Explain this",
      anchor,
      currentBaseCommit: "changed",
      currentDiffText: diff,
    })).toEqual({ status: "stale", reason: "base-changed" });
    expect(buildDiffQuestionPacket({
      question: "Explain this",
      anchor,
      currentBaseCommit: "abc123",
      currentDiffText: diff,
      selectedDiffText: "not in the current diff",
    })).toEqual({ status: "stale", reason: "diff-changed" });
  });
});
