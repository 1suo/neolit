import { describe, expect, it } from "vitest";
import {
  mapDiffToTasks,
  remapTaskIdentity,
  parseSpecDocument,
  parseTodoDocument,
  parseUnifiedDiff,
  resolvePlanningDocuments,
} from "../src/planning/markdown.js";

const specPath = "src/auth/SPEC.md";
const todoPath = "src/auth/TODO.md";

describe("planning Markdown", () => {
  it("extracts requirement IDs with heading and source location", () => {
    const spec = parseSpecDocument(specPath, [
      "# Authentication",
      "## Requirements",
      "- **R-01** Refresh expired sessions.",
      "- **R-02** Reject invalid credentials.",
      "## Acceptance criteria",
      "- **AC-01** Retry the original request once.",
    ].join("\n"));
    expect(spec.requirements).toEqual([
      { id: "R-01", text: "Refresh expired sessions.", headingPath: ["Authentication", "Requirements"], range: { startLine: 3, endLine: 3 } },
      { id: "R-02", text: "Reject invalid credentials.", headingPath: ["Authentication", "Requirements"], range: { startLine: 4, endLine: 4 } },
    ]);
  });

  it("parses TODO task metadata and resolves SPEC paths relative to TODO", () => {
    const todo = parseTodoDocument(todoPath, [
      "# Authentication implementation",
      "## Tasks",
      "- [ ] Implement refresh",
      "  - SPEC: `SPEC.md#R-01, R-02`",
      "  - File: `src/auth/session.ts`",
      "  - Description: Refresh expired sessions.",
      "- [x] Add tests",
      "  - SPEC: `SPEC.md#R-01`",
    ].join("\n"));
    expect(todo.tasks).toHaveLength(2);
    expect(todo.tasks[0]).toMatchObject({
      checked: false,
      specReferences: [{ path: "src/auth/SPEC.md", ids: ["R-01", "R-02"] }],
      filePaths: ["src/auth/session.ts"],
      description: ["Refresh expired sessions."],
      range: { startLine: 3, endLine: 6 },
    });
    expect(todo.tasks[1]!.checked).toBe(true);
  });

  it("reports missing documents, missing requirements, and tasks without SPEC references", () => {
    const todo = parseTodoDocument(todoPath, [
      "- [ ] Broken link",
      "  - SPEC: `missing.md#R-01`",
      "- [ ] Missing requirement",
      "  - SPEC: `SPEC.md#R-99`",
      "- [ ] No link",
    ].join("\n"));
    const result = resolvePlanningDocuments({
      specs: [parseSpecDocument(specPath, "- **R-01** Exists.")],
      todos: [todo],
    });
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "missing-spec",
      "missing-requirement",
      "task-without-spec",
    ]);
    expect(result.tasks.map((task) => task.state)).toEqual(["unmapped", "unmapped", "unmapped"]);
  });


  it("rejects duplicate requirement IDs instead of choosing one definition", () => {
    const todo = parseTodoDocument(todoPath, [
      "- [ ] Ambiguous requirement",
      "  - SPEC: `SPEC.md#R-01`",
    ].join("\n"));
    const result = resolvePlanningDocuments({
      specs: [parseSpecDocument(specPath, [
        "- **R-01** First definition.",
        "- **R-01** Duplicate definition.",
      ].join("\n"))],
      todos: [todo],
    });
    expect(result.diagnostics.map((item) => item.code)).toEqual(["duplicate-requirement"]);
    expect(result.tasks[0]!.state).toBe("unmapped");
  });

  it("maps actual unified diff paths to TODO tasks without claiming hunk-level proof", () => {
    const todo = parseTodoDocument(todoPath, [
      "- [ ] Implement refresh",
      "  - SPEC: `SPEC.md#R-01`",
      "  - File: `src/auth/session.ts`",
    ].join("\n"));
    const resolved = resolvePlanningDocuments({
      specs: [parseSpecDocument(specPath, "- **R-01** Refresh expired sessions.")],
      todos: [todo],
    });
    const files = parseUnifiedDiff([
      "diff --git a/src/auth/session.ts b/src/auth/session.ts",
      "index 1111111..2222222 100644",
      "--- a/src/auth/session.ts",
      "+++ b/src/auth/session.ts",
      "@@ -10,2 +10,3 @@ function refresh()",
      " const token = current();",
      "+ return refreshToken(token);",
      " return token;",
      "diff --git a/src/unplanned.ts b/src/unplanned.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/unplanned.ts",
      "@@ -0,0 +1 @@",
      "+export const value = 1;",
    ].join("\n"));
    expect(files).toHaveLength(2);
    expect(files[0]!.hunks[0]).toMatchObject({ oldStart: 10, oldLines: 2, newStart: 10, newLines: 3, header: "function refresh()" });
    expect(files[0]!.rawDiff).toContain("+ return refreshToken(token);");
    expect(mapDiffToTasks(files, resolved.tasks)).toEqual([
      {
        path: "src/auth/session.ts",
        granularity: "file",
        taskKeys: [todo.tasks[0]!.key],
        requirementIds: ["R-01"],
        state: "planned",
      },
      {
        path: "src/unplanned.ts",
        granularity: "file",
        taskKeys: [],
        requirementIds: [],
        state: "unplanned",
      },
    ]);
  });

  it("maps renames by the old or new path", () => {
    const todo = parseTodoDocument(todoPath, [
      "- [ ] Move module",
      "  - SPEC: `SPEC.md#R-01`",
      "  - File: `src/auth/old.ts`",
    ].join("\n"));
    const resolved = resolvePlanningDocuments({
      specs: [parseSpecDocument(specPath, "- **R-01** Move module.")],
      todos: [todo],
    });
    const files = parseUnifiedDiff([
      "diff --git a/src/auth/old.ts b/src/auth/new.ts",
      "similarity index 100%",
      "rename from src/auth/old.ts",
      "rename to src/auth/new.ts",
    ].join("\n"));
    expect(mapDiffToTasks(files, resolved.tasks)[0]).toMatchObject({
      path: "src/auth/new.ts",
      taskKeys: [todo.tasks[0]!.key],
    });
  });

  it("remaps tasks conservatively across edits and heading moves", () => {
    const previous = parseTodoDocument(todoPath, [
      "# Authentication",
      "## Sessions",
      "- [ ] Implement refresh",
      "  - SPEC: `SPEC.md#R-01`",
      "- [ ] Reject invalid credentials",
      "  - SPEC: `SPEC.md#R-02`",
    ].join("\n"));
    const current = parseTodoDocument(todoPath, [
      "# Authentication",
      "## Session lifecycle",
      "- [x] Implement session refresh",
      "  - SPEC: `SPEC.md#R-01`",
      "- [ ] Reject invalid credentials",
      "  - SPEC: `SPEC.md#R-02`",
    ].join("\n"));

    expect(remapTaskIdentity(previous, current)).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "matched", reason: "unique-requirements" }),
      expect.objectContaining({ state: "matched", reason: "unique-text" }),
    ]));
  });

  it("does not guess between duplicate task identities", () => {
    const previous = parseTodoDocument(todoPath, [
      "- [ ] Add validation",
      "  - SPEC: `SPEC.md#R-01`",
      "- [ ] Add validation",
      "  - SPEC: `SPEC.md#R-01`",
    ].join("\n"));
    const current = parseTodoDocument(todoPath, [
      "- [ ] Add validation",
      "  - SPEC: `SPEC.md#R-01`",
      "- [ ] Add validation",
      "  - SPEC: `SPEC.md#R-01`",
    ].join("\n"));

    const result = remapTaskIdentity(previous, current);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      state: "ambiguous",
      reason: "duplicate-or-competing-match",
      previousKeys: previous.tasks.map((task) => task.key),
      currentKeys: current.tasks.map((task) => task.key),
    });
  });

  it("reports additions and removals instead of transferring identity across TODO files", () => {
    const previous = parseTodoDocument(todoPath, [
      "- [ ] Old task",
      "  - SPEC: `SPEC.md#R-01`",
    ].join("\n"));
    const moved = parseTodoDocument("src/auth/OTHER-TODO.md", [
      "- [ ] Old task",
      "  - SPEC: `SPEC.md#R-01`",
    ].join("\n"));

    expect(remapTaskIdentity(previous, moved)).toEqual([
      expect.objectContaining({ state: "removed", previousKey: previous.tasks[0]!.key }),
      expect.objectContaining({ state: "added", currentKey: moved.tasks[0]!.key }),
    ]);
  });

  it("marks shared requirement signatures ambiguous when task text also changed", () => {
    const previous = parseTodoDocument(todoPath, [
      "- [ ] Implement first path",
      "  - SPEC: `SPEC.md#R-01`",
      "- [ ] Implement second path",
      "  - SPEC: `SPEC.md#R-01`",
    ].join("\n"));
    const current = parseTodoDocument(todoPath, [
      "- [ ] Build first path",
      "  - SPEC: `SPEC.md#R-01`",
      "- [ ] Build second path",
      "  - SPEC: `SPEC.md#R-01`",
    ].join("\n"));

    const result = remapTaskIdentity(previous, current);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      state: "ambiguous",
      previousKeys: previous.tasks.map((task) => task.key),
      currentKeys: current.tasks.map((task) => task.key),
    });
  });
});
