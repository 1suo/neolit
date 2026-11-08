import { createHash } from "node:crypto";
import {
  parseUnifiedDiff,
  type DiffHunk,
  type ResolvedTask,
  type SourceRange,
  type SpecAcceptanceCriterion,
  type SpecRequirement,
  type TodoTask,
} from "./markdown.js";

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
  acceptanceCriteria?: Array<{ specPath: string; criterion: SpecAcceptanceCriterion }>;
};

export type RelatedRequirementContext = {
  specPath: string;
  requirement: SpecRequirement;
};

/**
 * Select only TODO tasks that explicitly name the anchored file. A rename
 * matches either side of the path; shared file hints remain multiple
 * candidates and are never silently reduced to one task.
 */
export function selectRelatedTaskContexts(input: {
  path: string;
  previousPath?: string;
  tasks: ResolvedTask[];
}): RelatedTaskContext[] {
  const paths = new Set([input.path, ...(input.previousPath ? [input.previousPath] : [])]);
  return input.tasks
    .filter((task) => task.filePaths.some((filePath) => paths.has(filePath)))
    .map((task) => ({
      todoPath: task.key.slice(0, task.key.indexOf("::")),
      task,
      requirements: task.resolvedRequirements.map((requirement) => ({
        specPath: requirement.specPath,
        requirement,
      })),
      acceptanceCriteria: task.resolvedAcceptanceCriteria.map((criterion) => ({
        specPath: criterion.specPath,
        criterion,
      })),
    }));
}

export type TaskDocumentationContext = {
  currentBehavior: Array<{ readmePath: string; content: string }>;
  desiredBehavior: Array<{ specPath: string; requirements: SpecRequirement[]; acceptanceCriteria: SpecAcceptanceCriterion[] }>;
  diagnostics: string[];
};

/** Resolve only the documentation relevant to one explicitly selected task. */
export function selectTaskDocumentationContext(input: {
  task: ResolvedTask;
  readmes: Array<{ path: string; content: string }>;
  maxReadmeChars?: number;
}): TaskDocumentationContext {
  const limit = input.maxReadmeChars ?? 12_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new RangeError("README context limit must be from 1 to 100000.");
  const directories = [...new Set([
    ...input.task.filePaths.map((file) => file.replaceAll("\\", "/").split("/").slice(0, -1).join("/")),
    ...input.task.specReferences.map((ref) => ref.path.split("/").slice(0, -1).join("/")),
  ])];
  const selectedByPath = new Map<string, { path: string; content: string }>();
  const diagnostics: string[] = input.task.unresolvedReferences.map((reference) => `Unresolved SPEC reference in ${reference.path}: ${reference.ids.join(", ")}.`);
  for (const relatedDirectory of directories) {
    const candidates = input.readmes.flatMap((readme) => {
      const readmeDirectory = readme.path.replaceAll("\\", "/").split("/").slice(0, -1).join("/");
      if (relatedDirectory !== readmeDirectory && !relatedDirectory.startsWith(readmeDirectory ? `${readmeDirectory}/` : "")) return [];
      return [{ readme, depth: readmeDirectory ? readmeDirectory.split("/").length : 0 }];
    });
    if (!candidates.length) continue;
    const deepest = Math.max(...candidates.map((candidate) => candidate.depth));
    const matches = candidates.filter((candidate) => candidate.depth === deepest).map((candidate) => candidate.readme);
    if (matches.length > 1) diagnostics.push(`Multiple equally specific README documents match ${relatedDirectory || "the repository root"}: ${matches.map((item) => item.path).join(", ")}.`);
    for (const match of matches) selectedByPath.set(match.path, match);
  }
  if (selectedByPath.size === 0) {
    const rootReadme = input.readmes.find((readme) => readme.path === "README.md");
    if (rootReadme) selectedByPath.set(rootReadme.path, rootReadme);
    else diagnostics.push("No README matches the task's explicit file or SPEC locations.");
  }
  const selected = [...selectedByPath.values()];
  const currentBehavior = selected.map((item) => ({
    readmePath: item.path,
    content: boundedText(item.content, limit, "README"),
  }));
  const grouped = new Map<string, { specPath: string; requirements: SpecRequirement[]; acceptanceCriteria: SpecAcceptanceCriterion[] }>();
  for (const item of input.task.resolvedRequirements) {
    const group = grouped.get(item.specPath) ?? { specPath: item.specPath, requirements: [], acceptanceCriteria: [] };
    group.requirements.push(item); grouped.set(item.specPath, group);
  }
  for (const item of input.task.resolvedAcceptanceCriteria) {
    const group = grouped.get(item.specPath) ?? { specPath: item.specPath, requirements: [], acceptanceCriteria: [] };
    group.acceptanceCriteria.push(item); grouped.set(item.specPath, group);
  }
  return { currentBehavior, desiredBehavior: [...grouped.values()], diagnostics };
}

function validateRepoPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) {
    throw new TypeError("Diff anchor path must be repository-relative.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
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

export type DiffQuestionPacketLimits = {
  maxQuestionChars?: number;
  maxDiffChars?: number;
  maxSelectedLinesChars?: number;
  maxRelatedTasks?: number;
  maxRelatedChars?: number;
};

const DEFAULT_PACKET_LIMITS: Required<DiffQuestionPacketLimits> = {
  maxQuestionChars: 2_000,
  maxDiffChars: 24_000,
  maxSelectedLinesChars: 8_000,
  maxRelatedTasks: 8,
  maxRelatedChars: 8_000,
};

function boundedText(value: string, maxChars: number, label: string): string {
  if (value.length <= maxChars) return value;
  const marker = `...[ ${label} truncated ]`;
  if (marker.length >= maxChars) return marker.slice(0, maxChars);
  return `${value.slice(0, maxChars - marker.length - 1)}\n${marker}`;
}

function selectHunkDiff(rawDiff: string, expected: DiffHunk): string | undefined {
  const lines = rawDiff.split(/\r?\n/u);
  const start = lines.findIndex((line) => {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u.exec(line);
    return match
      && Number(match[1]) === expected.oldStart
      && Number(match[2] ?? 1) === expected.oldLines
      && Number(match[3]) === expected.newStart
      && Number(match[4] ?? 1) === expected.newLines;
  });
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !lines[end]!.startsWith("@@ ")) end += 1;
  const headers = lines.slice(0, start).filter((line) =>
    line.startsWith("diff --git ") || line.startsWith("index ")
    || line.startsWith("--- ") || line.startsWith("+++ "));
  return [...headers, ...lines.slice(start, end)].join("\n");
}

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
  selectedLinesText?: string;
  relatedTasks?: RelatedTaskContext[];
  relatedRequirements?: RelatedRequirementContext[];
  documentationContext?: TaskDocumentationContext;
  limits?: DiffQuestionPacketLimits;
}): DiffQuestionPacketResult {
  const question = input.question.trim();
  if (!question) throw new TypeError("A contextual question is required.");
  const limits = { ...DEFAULT_PACKET_LIMITS, ...input.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1 || value > 100_000) {
      throw new RangeError(`Context packet limit ${name} must be an integer from 1 to 100000.`);
    }
  }
  if (question.length > limits.maxQuestionChars) {
    throw new RangeError(`Contextual question exceeds ${limits.maxQuestionChars} characters.`);
  }

  const currentness = checkDiffAnchorCurrent(input.anchor, {
    baseCommit: input.currentBaseCommit,
    diffText: input.currentDiffText,
    ...(input.currentBlobOid ? { blobOid: input.currentBlobOid } : {}),
  });
  if (!currentness.current) return { status: "stale", reason: currentness.reason };
  const anchor = input.anchor;
  const changedFile = parseUnifiedDiff(input.currentDiffText).find((file) =>
    file.path === anchor.path || file.previousPath === anchor.path,
  );
  if (!changedFile?.rawDiff) return { status: "stale", reason: "diff-changed" };

  const selectedHunk = anchor.hunk ? selectHunkDiff(changedFile.rawDiff, anchor.hunk) : undefined;
  if (anchor.hunk && !selectedHunk) return { status: "stale", reason: "diff-changed" };
  if (input.selectedDiffText && !changedFile.rawDiff.includes(input.selectedDiffText)) {
    return { status: "stale", reason: "diff-changed" };
  }
  if (input.selectedDiffText && anchor.hunk && (!selectedHunk || !selectedHunk.includes(input.selectedDiffText))) {
    return { status: "stale", reason: "diff-changed" };
  }
  const selectedDiffText = input.selectedDiffText ?? selectedHunk ?? changedFile.rawDiff;
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
    ].join("\n"),
    `~~~diff\n${boundedText(selectedDiffText, limits.maxDiffChars, "diff")}\n~~~`,
  ];
  if (input.selectedLinesText !== undefined) {
    sections.push(`Selected source lines:\n~~~text\n${boundedText(input.selectedLinesText, limits.maxSelectedLinesChars, "selected lines")}\n~~~`);
  }

  if (input.relatedTasks?.length) {
    const selectedTasks = input.relatedTasks.slice(0, limits.maxRelatedTasks);
    const plan = selectedTasks.flatMap(({ todoPath, task, requirements, acceptanceCriteria }) => [
      `- TODO ${todoPath}:${task.range.startLine}: ${task.text}`,
      ...requirements.map(({ specPath, requirement }) =>
        `  - ${specPath}#${requirement.id}: ${requirement.text}`,
      ),
      ...(acceptanceCriteria ?? []).map(({ specPath, criterion }) =>
        `  - ${specPath}#${criterion.id}: ${criterion.text}`,
      ),
    ]);
    if (input.relatedTasks.length > selectedTasks.length) {
      const omitted = input.relatedTasks.length - selectedTasks.length;
      plan.push(`- ... ${omitted} additional related task${omitted === 1 ? "" : "s"} omitted`);
    }
    sections.push(`Related plan:\n${boundedText(plan.join("\n"), limits.maxRelatedChars, "related plan")}`);
  }

  if (input.relatedRequirements?.length) {
    const includedByTasks = new Set((input.relatedTasks ?? []).flatMap((item) =>
      item.requirements.map(({ specPath, requirement }) => `${specPath}#${requirement.id}`),
    ));
    const requirements = input.relatedRequirements.filter(({ specPath, requirement }) =>
      !includedByTasks.has(`${specPath}#${requirement.id}`),
    );
    if (requirements.length) {
      const lines = requirements.map(({ specPath, requirement }) =>
        `- ${specPath}#${requirement.id}: ${requirement.text}`,
      );
      sections.push(`Candidate SPEC requirements:\n${boundedText(lines.join("\n"), limits.maxRelatedChars, "candidate requirements")}`);
    }
  }

  if (input.documentationContext) {
    const docs = input.documentationContext;
    const current = docs.currentBehavior.map((item) => `### ${item.readmePath} (current shipped behavior)\n~~~markdown\n${item.content}\n~~~`);
    const desired = docs.desiredBehavior.map((item) => [
      `### ${item.specPath} (desired behavior)`,
      ...item.requirements.map((requirement) => `- ${requirement.id}: ${requirement.text}`),
      ...item.acceptanceCriteria.map((criterion) => `- ${criterion.id}: ${criterion.text}`),
    ].join("\n"));
    const diagnostics = docs.diagnostics.map((diagnostic) => `- ${diagnostic}`);
    if (current.length) sections.push(`Current shipped behavior (README)\n${boundedText(current.join("\n\n"), limits.maxRelatedChars, "README context")}`);
    if (desired.length) sections.push(`Desired behavior (SPEC)\n${boundedText(desired.join("\n\n"), limits.maxRelatedChars, "SPEC context")}`);
    if (diagnostics.length) sections.push(`Documentation context diagnostics:\n${boundedText(diagnostics.join("\n"), limits.maxRelatedChars, "documentation diagnostics")}`);
  }

  return { status: "ready", packet: sections.join("\n\n") };
}
