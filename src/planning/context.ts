import { createHash } from "node:crypto";
import type { DiffHunk, SourceRange, SpecRequirement, TodoTask } from "./markdown.js";

export type DiffSide = "base" | "working-tree";

export type DiffAnchor = {
  path: string;
  side: DiffSide;
  baseCommit: string;
  diffIdentity: string;
  lineRange?: SourceRange;
  hunk?: DiffHunk;
  blobOid?: string;
};

export type DiffAnchorCurrentness =
  | { current: true }
  | { current: false; reason: "base-changed" | "diff-changed" | "blob-changed" };

export type RelatedTaskContext = {
  todoPath: string;
  task: TodoTask;
  requirements: Array<{ specPath: string; requirement: SpecRequirement }>;
};

function validateRepoPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) {
    throw new TypeError("Diff anchor path must be repository-relative.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new TypeError("Diff anchor path must not escape the repository root.");
  }
  return normalized;
}

function validateRange(range: SourceRange, label: string): void {
  if (
    !Number.isInteger(range.startLine)
    || !Number.isInteger(range.endLine)
    || range.startLine < 1
    || range.endLine < range.startLine
  ) {
    throw new RangeError(`${label} must be a positive, ordered line range.`);
  }
}

export function identifyDiff(diffText: string): string {
  return createHash("sha256").update(diffText, "utf8").digest("hex");
}

/** Create a path/side/range anchor tied to one exact base and Git diff. */
export function createDiffAnchor(input: {
  path: string;
  side: DiffSide;
  baseCommit: string;
  diffText: string;
  lineRange?: SourceRange;
  hunk?: DiffHunk;
  blobOid?: string;
}): DiffAnchor {
  if (!input.baseCommit.trim()) {
    throw new TypeError("Diff anchor requires an explicit base commit.");
  }
  if (input.lineRange) validateRange(input.lineRange, "Line range");
  if (input.hunk && (
    !Number.isInteger(input.hunk.oldStart)
    || !Number.isInteger(input.hunk.oldLines)
    || !Number.isInteger(input.hunk.newStart)
    || !Number.isInteger(input.hunk.newLines)
    || input.hunk.oldStart < 0
    || input.hunk.oldLines < 0
    || input.hunk.newStart < 0
    || input.hunk.newLines < 0
  )) {
    throw new RangeError("Hunk coordinates must be non-negative integers.");
  }
  return {
    path: validateRepoPath(input.path),
    side: input.side,
    baseCommit: input.baseCommit,
    diffIdentity: identifyDiff(input.diffText),
    ...(input.lineRange ? { lineRange: input.lineRange } : {}),
    ...(input.hunk ? { hunk: input.hunk } : {}),
    ...(input.blobOid ? { blobOid: input.blobOid } : {}),
  };
}

/** Revalidate an anchor immediately before sending its context to an agent. */
export function checkDiffAnchorCurrent(
  anchor: DiffAnchor,
  current: { baseCommit: string; diffText: string; blobOid?: string },
): DiffAnchorCurrentness {
  if (anchor.baseCommit !== current.baseCommit) return { current: false, reason: "base-changed" };
  if (anchor.diffIdentity !== identifyDiff(current.diffText)) return { current: false, reason: "diff-changed" };
  if (anchor.blobOid && anchor.blobOid !== current.blobOid) {
    return { current: false, reason: "blob-changed" };
  }
  return { current: true };
}

export type DiffQuestionPacketResult =
  | { status: "ready"; packet: string }
  | { status: "stale"; reason: "base-changed" | "diff-changed" | "blob-changed" };

/**
 * Build a compact, copyable question packet. The full file diff is used only
 * to validate freshness; selectedDiffText may contain just the chosen hunk.
 */
export function buildDiffQuestionPacket(input: {
  question: string;
  anchor: DiffAnchor;
  currentBaseCommit: string;
  currentDiffText: string;
  currentBlobOid?: string;
  selectedDiffText?: string;
  relatedTasks?: RelatedTaskContext[];
}): DiffQuestionPacketResult {
  const question = input.question.trim();
  if (!question) throw new TypeError("A contextual question is required.");

  const currentness = checkDiffAnchorCurrent(input.anchor, {
    baseCommit: input.currentBaseCommit,
    diffText: input.currentDiffText,
    ...(input.currentBlobOid ? { blobOid: input.currentBlobOid } : {}),
  });
  if (!currentness.current) return { status: "stale", reason: currentness.reason };
  if (input.selectedDiffText && !input.currentDiffText.includes(input.selectedDiffText)) {
    return { status: "stale", reason: "diff-changed" };
  }

  const anchor = input.anchor;
  const location = anchor.lineRange
    ? ` lines ${anchor.lineRange.startLine}-${anchor.lineRange.endLine}`
    : anchor.hunk
      ? ` hunk old ${anchor.hunk.oldLines === 0 ? "no lines" : `${anchor.hunk.oldStart}-${anchor.hunk.oldStart + anchor.hunk.oldLines - 1}`}, new ${anchor.hunk.newLines === 0 ? "no lines" : `${anchor.hunk.newStart}-${anchor.hunk.newStart + anchor.hunk.newLines - 1}`}`
      : "";
  const sections = [
    `Question: ${question}`,
    [
      `Selected Git diff: ${anchor.path}${location}`,
      `Diff side: ${anchor.side}`,
      `Base commit: ${anchor.baseCommit}`,
      `Diff identity (sha256): ${anchor.diffIdentity}`,
      ...(anchor.blobOid ? [`Blob identity: ${anchor.blobOid}`] : []),
    ].join("\\n"),
    `~~~diff\\n${input.selectedDiffText ?? input.currentDiffText}\\n~~~`,
  ];

  if (input.relatedTasks?.length) {
    const plan = input.relatedTasks.flatMap(({ todoPath, task, requirements }) => [
      `- TODO ${todoPath}:${task.range.startLine}: ${task.text}`,
      ...requirements.map(({ specPath, requirement }) =>
        `  - ${specPath}#${requirement.id}: ${requirement.text}`,
      ),
    ]);
    sections.push(`Related plan:\\n${plan.join("\\n")}`);
  }

  return { status: "ready", packet: sections.join("\\n\\n") };
}
