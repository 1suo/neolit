import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { identifyDiff } from "./context.js";
import { derivePlanningStates, type VerificationEvidence } from "./state.js";
import { promisify } from "node:util";
import {
  mapDiffToTasks,
  parseSpecDocument,
  parseTodoDocument,
  parseUnifiedDiff,
  resolvePlanningDocuments,
  type ChangedFile,
  type PlanningDiagnostic,
  type ResolvedTask,
  type SpecDocument,
  type TodoDocument,
  type TaskDiffAssociation,
} from "./markdown.js";

const execFileAsync = promisify(execFile);
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/gu;

export type GitStatusEntry = {
  path: string;
  index: string;
  worktree: string;
  originalPath?: string;
};

export type PlanningWorkspace = {
  root: string;
  readmes: string[];
  specs: SpecDocument[];
  todos: TodoDocument[];
  tasks: ResolvedTask[];
  diagnostics: PlanningDiagnostic[];
  git: {
    branch: string;
    head: string;
    status: GitStatusEntry[];
    changedFiles: ChangedFile[];
    associations: TaskDiffAssociation[];
    diff: string;
    diffIdentity: string;
  };
  derived: ReturnType<typeof derivePlanningStates>;
};

function repoPath(root: string, candidate: string): string | undefined {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return relative.split(path.sep).join("/");
  }
  return undefined;
}

function linkedMarkdown(content: string): string[] {
  const result: string[] = [];
  for (const match of content.matchAll(MARKDOWN_LINK)) {
    const target = match[1]!.split("#", 1)[0]!.trim();
    if (!target || target.startsWith("<") || /^[a-z][a-z\d+.-]*:/iu.test(target) || !target.toLowerCase().endsWith(".md")) continue;
    result.push(target);
  }
  return result;
}

function isPlanningDocument(file: string, kind: "SPEC" | "TODO"): boolean {
  const name = path.posix.basename(file).toUpperCase();
  return kind === "SPEC"
    ? name === "SPEC.MD" || name.endsWith("-SPEC.MD")
    : name === "TODO.MD" || name.startsWith("TODO-") && name.endsWith(".MD");
}

async function discoverDocuments(root: string): Promise<{ readmes: string[]; specs: string[]; todos: string[] }> {
  const readmes: string[] = [];
  const specs = new Set<string>();
  const todos = new Set<string>();
  const visited = new Set<string>();
  const queue = ["README.md"];

  while (queue.length) {
    const current = queue.shift()!;
    const safePath = repoPath(root, current);
    if (!safePath || visited.has(safePath)) continue;
    visited.add(safePath);
    let content: string;
    try {
      content = await readFile(path.join(root, safePath), "utf8");
    } catch {
      continue;
    }
    readmes.push(safePath);
    for (const target of linkedMarkdown(content)) {
      const resolved = repoPath(root, path.posix.join(path.posix.dirname(safePath), target));
      if (!resolved) continue;
      if (path.posix.basename(resolved).toUpperCase() === "README.MD") {
        queue.push(resolved);
      } else if (isPlanningDocument(resolved, "SPEC")) {
        specs.add(resolved);
      } else if (isPlanningDocument(resolved, "TODO")) {
        todos.add(resolved);
      }
    }
  }

  return { readmes, specs: [...specs].sort(), todos: [...todos].sort() };
}

async function readDocuments(root: string, files: string[], kind: "SPEC" | "TODO") {
  const contents = await Promise.all(files.map(async (file) => ({
    file,
    content: await readFile(path.join(root, file), "utf8"),
  })));
  return kind === "SPEC"
    ? contents.map(({ file, content }) => parseSpecDocument(file, content))
    : contents.map(({ file, content }) => parseTodoDocument(file, content));
}

function parseGitStatus(output: string): GitStatusEntry[] {
  const tokens = output.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token) continue;
    const code = token.slice(0, 2);
    const file = token.slice(3);
    if (!file) continue;
    const entry: GitStatusEntry = { path: file, index: code[0]!, worktree: code[1]! };
    if (code.includes("R") || code.includes("C")) {
      const originalPath = tokens[index + 1];
      if (originalPath) {
        entry.originalPath = originalPath;
        index += 1;
      }
    }
    entries.push(entry);
  }
  return entries;
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return result.stdout;
}

async function gitNoIndexDiff(root: string, file: string): Promise<string> {
  try {
    return await git(root, [
      "-c", "core.quotePath=false",
      "diff", "--no-index", "--no-ext-diff", "--no-color", "--",
      "/dev/null", file,
    ]);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 1) {
      return "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    }
    throw error;
  }
}

export async function loadPlanningWorkspace(
  directory: string,
  options: { verificationEvidence?: VerificationEvidence[] } = {},
): Promise<PlanningWorkspace> {
  const root = await realpath(directory);
  const [branch, head, statusOutput] = await Promise.all([
    git(root, ["branch", "--show-current"]),
    git(root, ["rev-parse", "--verify", "HEAD"]).catch(() => ""),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  const diff = head.trim()
    ? await git(root, ["diff", "--no-ext-diff", "--no-color", "--find-renames", "HEAD", "--"])
    : "";

  const documents = await discoverDocuments(root);
  const [specs, todos] = await Promise.all([
    readDocuments(root, documents.specs, "SPEC") as Promise<SpecDocument[]>,
    readDocuments(root, documents.todos, "TODO") as Promise<TodoDocument[]>,
  ]);
  const resolved = resolvePlanningDocuments({ specs, todos });
  const status = parseGitStatus(statusOutput);
  const changedFiles = parseUnifiedDiff(diff);

  const untrackedResults = await Promise.all(status
    .filter((entry) => entry.index === "?" && entry.worktree === "?")
    .map(async (entry) => {
      try {
        const contents = await readFile(path.join(root, entry.path));
        const contentIdentity = identifyDiff(contents.toString("base64"));
        const rawDiff = await gitNoIndexDiff(root, entry.path);
        const parsed = parseUnifiedDiff(rawDiff).find((file) => file.path === entry.path);
        return {
          identity: [entry.path, contentIdentity].join(":"),
          file: parsed
            ? { ...parsed, untracked: true }
            : { path: entry.path, status: "added" as const, untracked: true, hunks: [], rawDiff },
        };
      } catch {
        return {
          identity: [entry.path, "unavailable"].join(":"),
          file: { path: entry.path, status: "added" as const, untracked: true, hunks: [] },
        };
      }
    }));

  changedFiles.push(...untrackedResults.map((item) => item.file));
  const untrackedIdentities = untrackedResults.map((item) => item.identity);


  const associations = mapDiffToTasks(changedFiles, resolved.tasks);
  const diffIdentity = identifyDiff(JSON.stringify([
    head.trim(),
    diff,
    statusOutput,
    untrackedIdentities,
  ]));
  const derived = derivePlanningStates({
    specs,
    tasks: resolved.tasks,
    changedFiles,
    associations,
    verificationEvidence: options.verificationEvidence,
    baseCommit: head.trim(),
    diffIdentity,
  });

  return {
    root,
    readmes: documents.readmes,
    specs,
    todos,
    tasks: resolved.tasks,
    diagnostics: resolved.diagnostics,
    derived,
    git: {
      branch: branch.trim(),
      head: head.trim(),
      status,
      changedFiles,
      associations,
      diff,
      diffIdentity,
    },
  };
}
