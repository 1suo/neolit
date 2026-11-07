import { describe, expect, it } from "vitest";
import { parseSpecDocument, parseTodoDocument, resolvePlanningDocuments, mapDiffToTasks } from "../src/planning/markdown.js";
import { derivePlanningStates, type VerificationEvidence } from "../src/planning/state.js";

const spec = parseSpecDocument("src/auth/SPEC.md", [
  "# Authentication",
  "## Requirements",
  "- **R-01** Refresh expired sessions.",
  "- **R-02** Reject invalid credentials.",
  "- **R-03** Preserve the login audit trail.",
  "## Acceptance criteria",
  "- **AC-01** R-01 retries the original request once.",
  "- **AC-02** R-01 preserves the request body.",
  "- **AC-03** R-02 returns a typed authentication error.",
].join("\n"));

const todo = parseTodoDocument("src/auth/TODO.md", [
  "- [x] Implement refresh",
  "  - SPEC: `SPEC.md#R-01`",
  "  - File: `src/auth/refresh.ts`",
  "  - File: `src/auth/session.ts`",
  "- [ ] Reject invalid credentials",
  "  - SPEC: `SPEC.md#R-02`",
  "  - File: `src/auth/login.ts`",
  "- [ ] Work blocked by decision",
  "  - SPEC: `SPEC.md#R-02`",
  "  - File: `src/auth/blocked.ts`",
  "  - Blocked: awaiting product decision",
  "- [ ] Broken mapping",
  "  - SPEC: `missing.md#R-99`",
  "  - File: `src/auth/unmapped.ts`",
].join("\n"));

const resolved = resolvePlanningDocuments({ specs: [spec], todos: [todo] });

function projection(paths: string[], evidence: VerificationEvidence[] = []) {
  const changedFiles = paths.map((path) => ({ path, status: "modified" as const, hunks: [] }));
  const associations = mapDiffToTasks(changedFiles, resolved.tasks);
  return derivePlanningStates({
    specs: [spec],
    tasks: resolved.tasks,
    changedFiles,
    associations,
    verificationEvidence: evidence,
    baseCommit: "base-123",
    diffIdentity: "diff-123",
  });
}

describe("derived planning states", () => {
  it("ignores TODO checkboxes and derives partial/full implementation from Git paths", () => {
    const result = projection([
      "src/auth/refresh.ts",
      "src/auth/login.ts",
      "src/auth/blocked.ts",
      "src/auth/unmapped.ts",
    ]);
    const refresh = resolved.tasks[0]!;
    const login = resolved.tasks[1]!;
    const blocked = resolved.tasks[2]!;
    const unmapped = resolved.tasks[3]!;

    expect(result.tasks[refresh.key]!.state).toBe("in-progress");
    expect(result.tasks[login.key]!.state).toBe("implemented");
    expect(result.tasks[blocked.key]!.state).toBe("blocked");
    expect(result.tasks[unmapped.key]!.state).toBe("unmapped");
    expect(result.requirements.find((item) => item.requirementId === "R-01")!.state).toBe("in-progress");
    expect(result.requirements.find((item) => item.requirementId === "R-02")!.state).toBe("blocked");
    expect(result.requirements.find((item) => item.requirementId === "R-03")!.state).toBe("unplanned");
  });

  it("verifies only when every linked acceptance criterion has current passing evidence", () => {
    const refresh = resolved.tasks[0]!;
    const changed = ["src/auth/refresh.ts", "src/auth/session.ts"];
    const oneCriterion: VerificationEvidence[] = [{
      command: "npm test -- refresh",
      result: "passed",
      passed: true,
      baseCommit: "base-123",
      diffIdentity: "diff-123",
      acceptanceCriteriaRefs: ["src/auth/SPEC.md#AC-01"],
    }];

    expect(projection(changed, oneCriterion).tasks[refresh.key]!.state).toBe("implemented");

    const allCriteria: VerificationEvidence[] = [
      ...oneCriterion,
      {
        command: "npm test -- refresh-body",
        result: "passed",
        passed: true,
        baseCommit: "base-123",
        diffIdentity: "diff-123",
        acceptanceCriteriaRefs: ["src/auth/SPEC.md#AC-02"],
      },
    ];
    const verified = projection(changed, allCriteria);
    expect(verified.tasks[refresh.key]!.state).toBe("verified");
    expect(verified.requirements.find((item) => item.requirementId === "R-01")!.state).toBe("verified");
    expect(verified.tasks[refresh.key]!.acceptanceCriteria.every((item) => item.verified)).toBe(true);
  });

  it("ignores stale, failed, or incomplete verification records", () => {
    const refresh = resolved.tasks[0]!;
    const changed = ["src/auth/refresh.ts", "src/auth/session.ts"];
    const evidence: VerificationEvidence[] = [
      {
        command: "npm test",
        result: "passed on old base",
        passed: true,
        baseCommit: "old-base",
        diffIdentity: "diff-123",
        acceptanceCriteriaRefs: ["src/auth/SPEC.md#AC-01", "src/auth/SPEC.md#AC-02"],
      },
      {
        command: "npm test",
        result: "failed",
        passed: false,
        baseCommit: "base-123",
        diffIdentity: "diff-123",
        acceptanceCriteriaRefs: ["src/auth/SPEC.md#AC-01", "src/auth/SPEC.md#AC-02"],
      },
      {
        command: "",
        result: "passed",
        passed: true,
        baseCommit: "base-123",
        diffIdentity: "diff-123",
        acceptanceCriteriaRefs: ["src/auth/SPEC.md#AC-01", "src/auth/SPEC.md#AC-02"],
      },
    ];
    expect(projection(changed, evidence).tasks[refresh.key]!.state).toBe("implemented");
  });
  it("derives blocked state from an explicit failed check blocker", () => {
    const login = resolved.tasks[1]!;
    const evidence: VerificationEvidence[] = [{
      command: "npm test -- login",
      result: "BLOCKED: authentication provider is unavailable",
      passed: false,
      baseCommit: "base-123",
      diffIdentity: "diff-123",
      taskKeys: [login.key],
    }];
    const result = projection(["src/auth/login.ts"], evidence);
    expect(result.tasks[login.key]!.state).toBe("blocked");
  });

});
