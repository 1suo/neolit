import path from "node:path";

export type SourceRange = { startLine: number; endLine: number };
export type SpecRequirement = {
  id: string;
  text: string;
  headingPath: string[];
  range: SourceRange;
};
export type SpecAcceptanceCriterion = {
  id: string;
  text: string;
  headingPath: string[];
  range: SourceRange;
  requirementIds: string[];
};
export type SpecDocument = {
  path: string;
  requirements: SpecRequirement[];
  acceptanceCriteria: SpecAcceptanceCriterion[];
};
export type SpecReference = { path: string; ids: string[] };
export type TodoTask = {
  key: string;
  text: string;
  checked: boolean;
  headingPath: string[];
  range: SourceRange;
  specReferences: SpecReference[];
  filePaths: string[];
  description: string[];
};
export type TodoDocument = { path: string; tasks: TodoTask[] };
export type PlanningDiagnostic = {
  code: "missing-spec" | "missing-requirement" | "duplicate-requirement" | "missing-acceptance-criterion" | "duplicate-acceptance-criterion" | "task-without-spec";
  message: string;
  todoPath: string;
  taskKey?: string;
  line?: number;
};
export type ResolvedTask = TodoTask & {
  resolvedRequirements: Array<SpecRequirement & { specPath: string }>;
  unresolvedReferences: SpecReference[];
  resolvedAcceptanceCriteria: Array<SpecAcceptanceCriterion & { specPath: string }>;
  state: "planned" | "unmapped";
};
export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  addedLines: string[];
  removedLines: string[];
};
export type ChangedFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string;
  untracked?: boolean;
  hunks: DiffHunk[];
  rawDiff?: string;
};
export type TaskDiffAssociation = {
  path: string;
  granularity: "file";
  taskKeys: string[];
  requirementIds: string[];
  state: "planned" | "partially-mapped" | "unplanned" | "unresolved" | "documentation";
};

const REQUIREMENT = /^\s*[-*+]\s+\*\*(R-\d{2,})\*\*\s+(.+?)\s*$/u;
const ACCEPTANCE_CRITERION = /^\s*[-*+]\s+\*\*(AC-\d{2,})\*\*\s+(.+?)\s*$/u;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/u;
const SPEC_REF = /([^\s\x60<>]+\.md)#((?:R|AC)-\d{2,}(?:\s*,\s*(?:R|AC)-\d{2,})*)/gu;

function headingAt(line: string): { level: number; text: string } | undefined {
  const match = HEADING.exec(line);
  return match ? { level: match[1]!.length, text: match[2]! } : undefined;
}

function normalizeRepoPath(value: string): string {
  return path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//u, "");
}

function resolveReference(todoPath: string, specPath: string): string {
  return normalizeRepoPath(path.posix.join(path.posix.dirname(todoPath), specPath));
}

export function parseSpecDocument(documentPath: string, content: string): SpecDocument {
  const headings: string[] = [];
  const requirements: SpecRequirement[] = [];
  const acceptanceCriteria: SpecAcceptanceCriterion[] = [];
  const lines = content.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const heading = headingAt(line);
    if (heading) {
      headings.length = heading.level - 1;
      headings[heading.level - 1] = heading.text;
      continue;
    }
    const match = REQUIREMENT.exec(line);
    if (match) {
      requirements.push({
        id: match[1]!,
        text: match[2]!,
        headingPath: [...headings],
        range: { startLine: index + 1, endLine: index + 1 },
      });
      continue;
    }
    const criterion = ACCEPTANCE_CRITERION.exec(line);
    if (criterion) {
      acceptanceCriteria.push({
        id: criterion[1]!,
        text: criterion[2]!,
        headingPath: [...headings],
        range: { startLine: index + 1, endLine: index + 1 },
        requirementIds: [...new Set([...criterion[2]!.matchAll(/\bR-\d{2,}\b/gu)].map((item) => item[0]))],
      });
    }
  }

  return { path: normalizeRepoPath(documentPath), requirements, acceptanceCriteria };
}

export function parseTodoDocument(documentPath: string, content: string): TodoDocument {
  const lines = content.split(/\r?\n/u);
  const headings: string[] = [];
  const tasks: TodoTask[] = [];
  let current: TodoTask | undefined;
  let taskIndent = -1;

  const finish = (endLine: number) => {
    if (current) current.range.endLine = Math.max(current.range.startLine, endLine);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const heading = headingAt(line);
    if (heading) {
      finish(index);
      current = undefined;
      taskIndent = -1;
      headings.length = heading.level - 1;
      headings[heading.level - 1] = heading.text;
      continue;
    }

    const taskMatch = TASK.exec(line);
    if (taskMatch) {
      const indent = taskMatch[1]!.length;
      if (current && indent <= taskIndent) finish(index);
      current = {
        key: `${normalizeRepoPath(documentPath)}::${[...headings, taskMatch[3]!].join(" / ")}`,
        text: taskMatch[3]!,
        checked: taskMatch[2]!.toLowerCase() === "x",
        headingPath: [...headings],
        range: { startLine: index + 1, endLine: index + 1 },
        specReferences: [],
        filePaths: [],
        description: [],
      };
      tasks.push(current);
      taskIndent = indent;
      continue;
    }

    if (!current || !line.trim()) continue;
    const indent = line.match(/^\s*/u)?.[0].length ?? 0;
    if (indent <= taskIndent) {
      finish(index);
      current = undefined;
      taskIndent = -1;
      continue;
    }

    current.range.endLine = index + 1;
    const specLine = /^\s*(?:[-*+]\s+)?SPEC:\s*(.+?)\s*$/iu.exec(line);
    if (specLine) {
      for (const match of specLine[1]!.matchAll(SPEC_REF)) {
        current.specReferences.push({
          path: resolveReference(documentPath, match[1]!),
          ids: match[2]!.split(",").map((id) => id.trim()),
        });
      }
      continue;
    }
    const fileLine = /^\s*(?:[-*+]\s+)?File:\s*(.+?)\s*$/iu.exec(line);
    if (fileLine) {
      const value = fileLine[1]!.replaceAll("`", "").trim();
      if (value) current.filePaths.push(normalizeRepoPath(value));
      continue;
    }
    const descriptionLine = /^\s*(?:[-*+]\s+)?Description:\s*(.+?)\s*$/iu.exec(line);
    if (descriptionLine) {
      current.description.push(descriptionLine[1]!);
      continue;
    }
    current.description.push(line.trim());
  }

  finish(lines.length);
  return { path: normalizeRepoPath(documentPath), tasks };
}

export function resolvePlanningDocuments(input: {
  specs: SpecDocument[];
  todos: TodoDocument[];
}): { tasks: ResolvedTask[]; diagnostics: PlanningDiagnostic[] } {
  const specs = new Map(input.specs.map((spec) => [spec.path, spec]));
  const tasks: ResolvedTask[] = [];
  const diagnostics: PlanningDiagnostic[] = [];

  for (const todo of input.todos) {
    for (const task of todo.tasks) {
      const resolvedRequirements: Array<SpecRequirement & { specPath: string }> = [];
      const resolvedAcceptanceCriteria: Array<SpecAcceptanceCriterion & { specPath: string }> = [];
      const unresolvedReferences: SpecReference[] = [];
      const hasRequirementReference = task.specReferences.some((reference) =>
        reference.ids.some((id) => id.startsWith("R-")),
      );
      if (!hasRequirementReference) {
        diagnostics.push({
          code: "task-without-spec",
          message: "TODO task does not reference a SPEC requirement ID.",
          todoPath: todo.path,
          taskKey: task.key,
          line: task.range.startLine,
        });
      }

      for (const reference of task.specReferences) {
        const spec = specs.get(reference.path);
        if (!spec) {
          unresolvedReferences.push(reference);
          diagnostics.push({
            code: "missing-spec",
            message: `Referenced SPEC document not found: ${reference.path}`,
            todoPath: todo.path,
            taskKey: task.key,
            line: task.range.startLine,
          });
          continue;
        }
        for (const id of reference.ids) {
          if (id.startsWith("AC-")) {
            const criteria = spec.acceptanceCriteria.filter((candidate) => candidate.id === id);
            if (criteria.length === 1) {
              if (!resolvedAcceptanceCriteria.some((item) => item.specPath === reference.path && item.id === id)) {
                resolvedAcceptanceCriteria.push({ ...criteria[0]!, specPath: reference.path });
              }
            } else {
              unresolvedReferences.push({ path: reference.path, ids: [id] });
              diagnostics.push({
                code: criteria.length === 0 ? "missing-acceptance-criterion" : "duplicate-acceptance-criterion",
                message: criteria.length === 0
                  ? `Acceptance criterion ${id} not found in ${reference.path}`
                  : `Acceptance criterion ${id} is defined more than once in ${reference.path}`,
                todoPath: todo.path,
                taskKey: task.key,
                line: task.range.startLine,
              });
            }
            continue;
          }

          const matches = spec.requirements.filter((candidate) => candidate.id === id);
          if (matches.length === 1) {
            resolvedRequirements.push({ ...matches[0]!, specPath: reference.path });
            for (const criterion of spec.acceptanceCriteria.filter((item) => item.requirementIds.includes(id))) {
              const duplicates = spec.acceptanceCriteria.filter((item) => item.id === criterion.id).length;
              if (duplicates > 1) {
                if (!unresolvedReferences.some((item) => item.path === reference.path && item.ids.includes(criterion.id))) {
                  unresolvedReferences.push({ path: reference.path, ids: [criterion.id] });
                  diagnostics.push({
                    code: "duplicate-acceptance-criterion",
                    message: `Acceptance criterion ${criterion.id} is defined more than once in ${reference.path}`,
                    todoPath: todo.path,
                    taskKey: task.key,
                    line: task.range.startLine,
                  });
                }
              } else if (!resolvedAcceptanceCriteria.some((item) => item.specPath === reference.path && item.id === criterion.id)) {
                resolvedAcceptanceCriteria.push({ ...criterion, specPath: reference.path });
              }
            }
          } else {
            unresolvedReferences.push({ path: reference.path, ids: [id] });
            diagnostics.push({
              code: matches.length === 0 ? "missing-requirement" : "duplicate-requirement",
              message: matches.length === 0
                ? `Requirement ${id} not found in ${reference.path}`
                : `Requirement ${id} is defined more than once in ${reference.path}`,
              todoPath: todo.path,
              taskKey: task.key,
              line: task.range.startLine,
            });
          }
        }
      }

      tasks.push({
        ...task,
        resolvedRequirements,
        resolvedAcceptanceCriteria,
        unresolvedReferences,
        state: unresolvedReferences.length > 0 || !hasRequirementReference ? "unmapped" : "planned",
      });
    }
  }

  return { tasks, diagnostics };
}

export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | undefined;
  let currentLines: string[] = [];
  let currentHunk: DiffHunk | undefined;

  const finish = () => {
    if (current) {
      current.rawDiff = currentLines.join("\n");
      files.push(current);
    }
    current = undefined;
    currentLines = [];
    currentHunk = undefined;
  };

  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      finish();
      const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
      if (match) {
        current = { path: normalizeRepoPath(match[2]!), status: "modified", hunks: [] };
        currentLines.push(line);
      }
      continue;
    }
    if (!current) continue;
    currentLines.push(line);
    if (line.startsWith("new file mode ")) current.status = "added";
    else if (line.startsWith("deleted file mode ")) current.status = "deleted";
    else if (line.startsWith("rename from ")) {
      current.previousPath = normalizeRepoPath(line.slice("rename from ".length));
      current.status = "renamed";
    } else if (line.startsWith("rename to ")) {
      current.path = normalizeRepoPath(line.slice("rename to ".length));
      current.status = "renamed";
    } else if (line.startsWith("--- /dev/null")) current.status = "added";
    else if (line.startsWith("+++ /dev/null")) current.status = "deleted";
    else if (line.startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u.exec(line);
      if (match) {
        currentHunk = {
          oldStart: Number(match[1]),
          oldLines: Number(match[2] ?? 1),
          newStart: Number(match[3]),
          newLines: Number(match[4] ?? 1),
          header: match[5]!.trim(),
          addedLines: [],
          removedLines: [],
        };
        current.hunks.push(currentHunk);
      }
    } else if (currentHunk && line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.addedLines.push(line.slice(1));
    } else if (currentHunk && line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.removedLines.push(line.slice(1));
    }
  }
  finish();
  return files;
}

export function mapDiffToTasks(
  changedFiles: ChangedFile[],
  tasks: ResolvedTask[],
): TaskDiffAssociation[] {
  return changedFiles.map((file) => {
    // Documentation changes are first-class review items, not implementation
    // evidence for whichever task happens to mention the same path.
    if (/(?:^|\\/)(?:README|SPEC|TODO(?:-[^/]*)?)\.md$/iu.test(file.path)) {
      return {
        path: file.path,
        granularity: "file" as const,
        taskKeys: [],
        requirementIds: [],
        state: "documentation" as const,
      };
    }

    const matching = tasks.filter((task) => task.filePaths.some((filePath) =>
      filePath === file.path || filePath === file.previousPath,
    ));
    const unresolved = matching.some((task) => task.state === "unmapped");
    const ambiguous = matching.length > 1;
    return {
      path: file.path,
      granularity: "file" as const,
      taskKeys: matching.map((task) => task.key),
      requirementIds: [...new Set(matching.flatMap((task) => task.resolvedRequirements.map((requirement) => requirement.id)))],
      // A shared File: hint does not prove which task owns the change. Keep
      // every candidate visible and require a more precise mapping.
      state: matching.length === 0
        ? "unplanned" as const
        : ambiguous
          ? "unresolved" as const
          : unresolved
            ? "partially-mapped" as const
            : "planned" as const,
    };
  });
}


export type TaskIdentityMatch = {
  state: "matched" | "added" | "removed" | "ambiguous";
  previousKey?: string;
  currentKey?: string;
  previousKeys?: string[];
  currentKeys?: string[];
  reason: "structural-key" | "unique-text" | "unique-requirements" | "new-task" | "removed-task" | "duplicate-or-competing-match";
};

function taskRequirementSignature(task: TodoTask): string {
  return [...new Set(task.specReferences.flatMap((reference) =>
    reference.ids.map((id) => `${reference.path}#${id}`),
  ))].sort().join("|");
}

/**
 * Conservatively relates tasks across two versions of one TODO document.
 *
 * Exact structural keys win only when unique on both sides. Remaining tasks
 * may be matched by unique text, or by a unique SPEC-reference set when the
 * task text was edited. Any competing candidate is reported as ambiguous;
 * this function never chooses by array order or line proximity.
 */
export function remapTaskIdentity(
  previous: TodoDocument,
  current: TodoDocument,
): TaskIdentityMatch[] {
  const previousTasks = previous.tasks;
  const currentTasks = current.tasks;
  const previousMatched = new Set<number>();
  const currentMatched = new Set<number>();
  const matches: TaskIdentityMatch[] = [];

  const pushAmbiguous = (oldIndices: number[], newIndices: number[]) => {
    matches.push({
      state: "ambiguous",
      previousKeys: oldIndices.map((index) => previousTasks[index]!.key),
      currentKeys: newIndices.map((index) => currentTasks[index]!.key),
      reason: "duplicate-or-competing-match",
    });
  };

  const groupBy = (tasks: TodoTask[], indices: number[], key: (task: TodoTask) => string) => {
    const groups = new Map<string, number[]>();
    for (const index of indices) {
      const value = key(tasks[index]!);
      if (!value) continue;
      const group = groups.get(value) ?? [];
      group.push(index);
      groups.set(value, group);
    }
    return groups;
  };

  const availablePrevious = () => previousTasks.map((_, index) => index).filter((index) => !previousMatched.has(index));
  const availableCurrent = () => currentTasks.map((_, index) => index).filter((index) => !currentMatched.has(index));

  const exactPrevious = groupBy(previousTasks, availablePrevious(), (task) => task.key);
  const exactCurrent = groupBy(currentTasks, availableCurrent(), (task) => task.key);
  for (const [key, oldIndices] of exactPrevious) {
    const newIndices = exactCurrent.get(key);
    if (!newIndices) continue;
    if (oldIndices.length === 1 && newIndices.length === 1) {
      const oldIndex = oldIndices[0]!;
      const newIndex = newIndices[0]!;
      previousMatched.add(oldIndex);
      currentMatched.add(newIndex);
      matches.push({
        state: "matched",
        previousKey: previousTasks[oldIndex]!.key,
        currentKey: currentTasks[newIndex]!.key,
        reason: "structural-key",
      });
    } else {
      for (const oldIndex of oldIndices) previousMatched.add(oldIndex);
      for (const newIndex of newIndices) currentMatched.add(newIndex);
      pushAmbiguous(oldIndices, newIndices);
    }
  }

  const matchUnique = (
    key: (task: TodoTask) => string,
    reason: "unique-text" | "unique-requirements",
  ) => {
    const oldGroups = groupBy(previousTasks, availablePrevious(), key);
    const newGroups = groupBy(currentTasks, availableCurrent(), key);
    for (const [signature, oldIndices] of oldGroups) {
      const newIndices = newGroups.get(signature);
      if (!newIndices) continue;
      if (oldIndices.length === 1 && newIndices.length === 1) {
        const oldIndex = oldIndices[0]!;
        const newIndex = newIndices[0]!;
        previousMatched.add(oldIndex);
        currentMatched.add(newIndex);
        matches.push({
          state: "matched",
          previousKey: previousTasks[oldIndex]!.key,
          currentKey: currentTasks[newIndex]!.key,
          reason,
        });
      } else {
        for (const oldIndex of oldIndices) previousMatched.add(oldIndex);
        for (const newIndex of newIndices) currentMatched.add(newIndex);
        pushAmbiguous(oldIndices, newIndices);
      }
    }
  };

  // Same task text can survive a heading move. Scope identity to the owning
  // TODO document; never transfer state across different TODO documents.
  if (previous.path === current.path) {
    matchUnique((task) => task.text.trim().replace(/\s+/gu, " ").toLowerCase(), "unique-text");
    // A unique requirement set can preserve identity across a task-text edit.
    // Shared requirement sets are common, so only a one-to-one match is safe.
    matchUnique((task) => taskRequirementSignature(task), "unique-requirements");
  }

  for (let index = 0; index < previousTasks.length; index += 1) {
    if (!previousMatched.has(index)) {
      matches.push({ state: "removed", previousKey: previousTasks[index]!.key, reason: "removed-task" });
    }
  }
  for (let index = 0; index < currentTasks.length; index += 1) {
    if (!currentMatched.has(index)) {
      matches.push({ state: "added", currentKey: currentTasks[index]!.key, reason: "new-task" });
    }
  }
  return matches;
}
