import path from "node:path";

export type SourceRange = { startLine: number; endLine: number };
export type SpecRequirement = {
  id: string;
  text: string;
  headingPath: string[];
  range: SourceRange;
};
export type SpecDocument = {
  path: string;
  requirements: SpecRequirement[];
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
  code: "missing-spec" | "missing-requirement" | "task-without-spec";
  message: string;
  todoPath: string;
  taskKey?: string;
  line?: number;
};
export type ResolvedTask = TodoTask & {
  resolvedRequirements: SpecRequirement[];
  unresolvedReferences: SpecReference[];
  state: "planned" | "unmapped";
};
export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
};
export type ChangedFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string;
  hunks: DiffHunk[];
};
export type TaskDiffAssociation = {
  path: string;
  granularity: "file";
  taskKeys: string[];
  requirementIds: string[];
  state: "planned" | "partially-mapped" | "unplanned";
};

const REQUIREMENT = /^\s*[-*+]\s+\*\*(R-\d{2,})\*\*\s+(.+?)\s*$/u;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/u;
const SPEC_REF = /([^\s`<>]+\.md)#(R-\d{2,}(?:\s*,\s*R-\d{2,})*)/gu;

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
    if (!match) continue;
    requirements.push({
      id: match[1]!,
      text: match[2]!,
      headingPath: [...headings],
      range: { startLine: index + 1, endLine: index + 1 },
    });
  }

  return { path: normalizeRepoPath(documentPath), requirements };
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
      const resolvedRequirements: SpecRequirement[] = [];
      const unresolvedReferences: SpecReference[] = [];
      if (task.specReferences.length === 0) {
        diagnostics.push({
          code: "task-without-spec",
          message: "TODO task does not reference a SPEC requirement.",
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
          const requirement = spec.requirements.find((candidate) => candidate.id === id);
          if (requirement) {
            resolvedRequirements.push(requirement);
          } else {
            unresolvedReferences.push({ path: reference.path, ids: [id] });
            diagnostics.push({
              code: "missing-requirement",
              message: `Requirement ${id} not found in ${reference.path}`,
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
        unresolvedReferences,
        state: unresolvedReferences.length > 0 || task.specReferences.length === 0 ? "unmapped" : "planned",
      });
    }
  }

  return { tasks, diagnostics };
}

export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | undefined;

  const finish = () => {
    if (current) files.push(current);
    current = undefined;
  };

  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      finish();
      const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
      if (match) current = { path: normalizeRepoPath(match[2]!), previousPath: normalizeRepoPath(match[1]!), status: "modified", hunks: [] };
      continue;
    }
    if (!current) continue;
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
      if (match) current.hunks.push({
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? 1),
        header: match[5]!.trim(),
      });
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
    const matching = tasks.filter((task) => task.filePaths.some((filePath) =>
      filePath === file.path || filePath === file.previousPath,
    ));
    const unresolved = matching.some((task) => task.state === "unmapped");
    return {
      path: file.path,
      granularity: "file",
      taskKeys: matching.map((task) => task.key),
      requirementIds: [...new Set(matching.flatMap((task) => task.resolvedRequirements.map((requirement) => requirement.id)))],
      state: matching.length === 0 ? "unplanned" : unresolved ? "partially-mapped" : "planned",
    };
  });
}
