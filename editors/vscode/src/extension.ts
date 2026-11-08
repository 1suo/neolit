import * as vscode from "vscode";
import path from "node:path";
import { realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildDiffQuestionPacket,
  createDiffAnchor,
  loadPlanningWorkspace,
  selectRelatedTaskContexts,
  selectTaskDocumentationContext,
  type PlanningWorkspace,
} from "neolit/planning";

type TaskNode = { kind: "task"; key: string; label: string };
type RequirementNode = { kind: "requirement"; key: string; specPath: string; id: string; label: string };
type ChangedFileNode = { kind: "changedFile"; path: string; previousPath?: string; label: string };
type HunkNode = { kind: "hunk"; path: string; previousPath?: string; hunkIndex: number; candidateTaskKeys: string[]; candidateRequirementRefs: string[]; label: string };
type GroupNode = { kind: "group"; group: "changes" | "diagnostics"; label: string };
type DiagnosticNode = { kind: "diagnostic"; todoPath: string; line?: number; message: string; label: string };
type PlanFileNode = { kind: "file"; path: string; taskKey: string; label: string };
type PlanNode = TaskNode | RequirementNode | HunkNode | GroupNode | PlanFileNode | ChangedFileNode | DiagnosticNode;
const execFileAsync = promisify(execFile);
const BASE_SCHEME = "neolit-base";
const EMPTY_SCHEME = "neolit-empty";

function workspaceFileUri(folder: vscode.WorkspaceFolder, relativePath: string): vscode.Uri | undefined {
  if (!relativePath || path.isAbsolute(relativePath)
    || relativePath.replaceAll("\\", "/").split("/").some((segment) => segment === ".." || segment === "." || segment === "")) return undefined;
  const absolute = path.resolve(folder.uri.fsPath, relativePath);
  const relative = path.relative(folder.uri.fsPath, absolute);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return undefined;

  // Resolve the target or its nearest existing ancestor so symlinked paths
  // cannot redirect a planned-file navigation outside the selected worktree.
  const realRoot = realpathSync(folder.uri.fsPath);
  let ancestor = absolute;
  let resolvedAncestor = ancestor;
  while (true) {
    try {
      resolvedAncestor = realpathSync(ancestor);
      break;
    } catch {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return undefined;
      ancestor = parent;
    }
  }
  const realRelative = path.relative(realRoot, resolvedAncestor);
  if (realRelative === ".." || realRelative.startsWith(".." + path.sep) || path.isAbsolute(realRelative)) return undefined;
  return vscode.Uri.file(absolute);
}

class BaseDocumentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly root: string, private readonly getWorkspace: () => PlanningWorkspace | undefined) {}
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const relative = uri.path.replace(/^\//u, "");
    if (!relative || relative.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) return "";
    const absolute = path.resolve(this.root, relative);
    const withinRoot = path.relative(this.root, absolute);
    const workspace = this.getWorkspace();
    const baseCommit = uri.query;
    if (!workspace || !/^[0-9a-f]{40,64}$/iu.test(baseCommit) || !relative || withinRoot === ".." || withinRoot.startsWith(".." + path.sep) || path.isAbsolute(withinRoot)) return "";
    const file = workspace.git.changedFiles.find((item) => item.path === relative);
    const sourcePath = file?.previousPath ?? relative;
    if (sourcePath.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) return "";
    const sourceAbsolute = path.resolve(this.root, sourcePath);
    const sourceRelative = path.relative(this.root, sourceAbsolute);
    if (sourceRelative === ".." || sourceRelative.startsWith(".." + path.sep) || path.isAbsolute(sourceRelative)) return "";
    try {
      const { stdout } = await execFileAsync("git", ["show", `${baseCommit}:${sourcePath}`], {
        cwd: this.root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    } catch {
      // Added/untracked files have no base-side content.
      return "";
    }
  }
}

class EmptyDocumentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(): string { return ""; }
}

class PlanningTree implements vscode.TreeDataProvider<PlanNode> {
  private readonly emitter = new vscode.EventEmitter<PlanNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  workspace?: PlanningWorkspace;
  constructor() {}
  dispose(): void { this.emitter.dispose(); }
  refresh(workspace: PlanningWorkspace): void { this.workspace = workspace; this.emitter.fire(undefined); }
  getTreeItem(node: PlanNode): vscode.TreeItem {
    if (node.kind === "group") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = node.group === "changes" ? "changeGroup" : "diagnosticsGroup";
      item.iconPath = new vscode.ThemeIcon(node.group === "changes" ? "git-compare" : "warning");
      return item;
    }
    if (node.kind === "diagnostic") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "diagnostic";
      item.description = `${node.todoPath}:${node.line ?? "?"}`;
      item.tooltip = node.message;
      item.iconPath = new vscode.ThemeIcon("warning");
      item.command = { command: "neolit.openDiagnostic", title: "Open TODO diagnostic", arguments: [node] };
      return item;
    }
    if (node.kind === "changedFile") {
      const file = this.workspace?.git.changedFiles.find((item) => item.path === node.path);
      const item = new vscode.TreeItem(node.label, file?.hunks.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.contextValue = "changedFile";
      item.iconPath = new vscode.ThemeIcon("file-modified");
      item.description = file?.status;
      item.command = { command: "neolit.openChangedFile", title: "Open native file diff", arguments: [node] };
      return item;
    }
    if (node.kind === "file") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "plannedFile";
      item.iconPath = new vscode.ThemeIcon("file");
      const task = this.workspace?.tasks.find((entry) => entry.key === node.taskKey);
      item.tooltip = task ? [task.text, ...task.description].filter(Boolean).join("\n") : "File referenced by this TODO task.";
      item.command = { command: "neolit.openPlanFile", title: "Open planned file or diff", arguments: [node] };
      return item;
    }
    if (node.kind === "task") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = "task";
      item.description = this.workspace?.derived.tasks[node.key]?.state;
      item.tooltip = [node.label, ...(this.workspace?.tasks.find((entry) => entry.key === node.key)?.description ?? [])].join("\n");
      item.iconPath = new vscode.ThemeIcon("tasklist");
      item.command = { command: "neolit.openTask", title: "Open TODO task", arguments: [node] };
      return item;
    }
    if (node.kind === "requirement") {
      const projection = this.workspace?.derived.requirements.find((item) => item.specPath === node.specPath && item.requirementId === node.id);
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = "requirement";
      item.description = projection?.state;
      item.iconPath = new vscode.ThemeIcon("symbol-interface");
      item.command = { command: "neolit.openRequirement", title: "Open SPEC requirement", arguments: [node] };
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.contextValue = "hunk";
    item.iconPath = new vscode.ThemeIcon("diff");
    item.description = node.path;
    const candidateTasks = (this.workspace?.tasks ?? []).filter((task) => node.candidateTaskKeys.includes(task.key));
    const candidateRequirements = node.candidateRequirementRefs.map((reference) => {
      const separator = reference.lastIndexOf("#");
      const specPath = reference.slice(0, separator);
      const id = reference.slice(separator + 1);
      const requirement = this.workspace?.specs.find((spec) => spec.path === specPath)?.requirements.find((item) => item.id === id);
      return requirement ? `${reference}: ${requirement.text}` : reference;
    });
    item.tooltip = [
      "Candidate tasks:",
      ...(candidateTasks.length ? candidateTasks.map((task) => `- ${task.text}`) : ["- none"]),
      "Candidate requirements:",
      ...(candidateRequirements.length ? candidateRequirements.map((requirement) => `- ${requirement}`) : ["- none"]),
    ].join("\n");
    item.command = { command: "neolit.openHunkDiff", title: "Open native hunk diff", arguments: [node] };
    return item;
  }
  getChildren(node?: PlanNode): PlanNode[] {
    const workspace = this.workspace;
    if (!workspace) return [];
    if (!node) {
      const tasks: TaskNode[] = workspace.tasks.map((task) => ({ kind: "task", key: task.key, label: task.text }));
      const changes: GroupNode[] = workspace.git.changedFiles.length
        ? [{ kind: "group", group: "changes", label: `Git changes · ${workspace.git.changedFiles.length} files · ${workspace.git.hunkAssociations.length} hunks` }]
        : [];
      const diagnostics: GroupNode[] = workspace.diagnostics.length
        ? [{ kind: "group", group: "diagnostics", label: `Documentation diagnostics · ${workspace.diagnostics.length}` }]
        : [];
      return [...tasks, ...changes, ...diagnostics];
    }
    if (node.kind === "group" && node.group === "diagnostics") return workspace.diagnostics.map((diagnostic) => ({
      kind: "diagnostic" as const,
      todoPath: diagnostic.todoPath,
      line: diagnostic.line,
      message: diagnostic.message,
      label: `${diagnostic.code}: ${diagnostic.message}`,
    }));
    if (node.kind === "group" && node.group === "changes") return workspace.git.changedFiles.map((file) => ({
      kind: "changedFile" as const,
      path: file.path,
      previousPath: file.previousPath,
      label: file.path,
    }));
    if (node.kind === "changedFile") return workspace.git.hunkAssociations
      .filter((association) => association.path === node.path)
      .map((association) => ({
        kind: "hunk" as const, path: association.path, previousPath: node.previousPath,
        hunkIndex: association.hunkIndex, candidateTaskKeys: association.candidateTaskKeys,
        candidateRequirementRefs: association.candidateRequirementRefs,
        label: `${association.state === "attributed" ? "DOC↳" : association.state === "documentation" ? "DOC" : association.state === "unplanned" ? "?" : "~"} hunk ${association.hunkIndex + 1} · ${association.candidateTaskKeys.length} task / ${association.candidateRequirementRefs.length} req`,
      }));
    if (node.kind === "requirement") {
      return workspace.tasks.filter((task) => task.resolvedRequirements.some((item) => item.specPath === node.specPath && item.id === node.id))
        .map((task) => ({ kind: "task" as const, key: task.key, label: task.text }));
    }
    if (node.kind !== "task") return [];
    const task = workspace.tasks.find((item) => item.key === node.key);
    if (!task) return [];
    const files: PlanFileNode[] = [...new Set(task.filePaths)].map((file) => ({ kind: "file", path: file, taskKey: task.key, label: file }));
    const requirements: RequirementNode[] = task.resolvedRequirements.map((item) => ({
      kind: "requirement", key: node.key, specPath: item.specPath, id: item.id,
      label: `${item.id} — ${item.text}`,
    }));
    const hunks: HunkNode[] = (workspace.derived.tasks[node.key]?.hunkReviews ?? []).map((review) => ({
      kind: "hunk", path: review.path, hunkIndex: review.hunkIndex, candidateTaskKeys: review.candidateTaskKeys,
      candidateRequirementRefs: review.candidateRequirementRefs,
      label: `${review.state === "attributed" ? "DOC↳" : review.state === "documentation" ? "DOC" : review.state === "unplanned" ? "?" : "~"} ${review.path} · hunk ${review.hunkIndex + 1} · ${review.candidateTaskKeys.length} task / ${review.candidateRequirementRefs.length} req`,
    }));
    return [...files, ...requirements, ...hunks];
  }
}

class PlanningDecorationProvider implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private paths = new Set<string>();
  private plannedPaths = new Set<string>();
  refresh(workspace: PlanningWorkspace, folder: vscode.WorkspaceFolder): void {
    this.paths = new Set(workspace.git.changedFiles.map((file) => path.normalize(file.path)));
    this.plannedPaths = new Set(workspace.tasks.flatMap((task) => task.filePaths
      .filter((file) => workspaceFileUri(folder, file) !== undefined)
      .map((file) => path.normalize(file))));
    this.emitter.fire(undefined);
  }
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const relative = path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "", uri.fsPath);
    if (this.paths.has(path.normalize(relative))) return new vscode.FileDecoration(
      "N",
      "Neolit changed-file review annotation; actual Git status remains in Source Control.",
      new vscode.ThemeColor("charts.blue"),
    );
    if (!this.plannedPaths.has(path.normalize(relative))) return undefined;
    return new vscode.FileDecoration(
      "P",
      "Neolit planned-file annotation; this does not mean the file is modified or untracked.",
      new vscode.ThemeColor("charts.blue"),
    );
  }
  dispose(): void { this.emitter.dispose(); }
}

async function load(root: string): Promise<PlanningWorkspace> {
  return loadPlanningWorkspace(root);
}

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const root = folder.uri.fsPath;
  const tree = new PlanningTree();
  const decorations = new PlanningDecorationProvider();
  let current: PlanningWorkspace | undefined;
  const baseDocuments = new BaseDocumentProvider(root, () => current);
  const view = vscode.window.createTreeView("neolit.plan", { treeDataProvider: tree, showCollapseAll: true });
  context.subscriptions.push(
    view,
    tree,
    decorations,
    vscode.window.registerFileDecorationProvider(decorations),
    vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, baseDocuments),
    vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, new EmptyDocumentProvider()),
  );

  const refresh = async () => {
    try {
      current = await load(root);
      tree.refresh(current);
      decorations.refresh(current, folder);
    } catch (error) {
      vscode.window.showErrorMessage(`Neolit planning refresh failed: ${String(error)}`);
    }
  };

  // Re-read Git immediately before hunk navigation or agent handoff. Focus and
  // save events improve responsiveness, but an external Git process can change
  // the index/HEAD without either event firing.
  const ensureCurrent = async (): Promise<boolean> => {
    const previous = current;
    try {
      const fresh = await load(root);
      current = fresh;
      tree.refresh(fresh);
      decorations.refresh(fresh, folder);
      if (!previous || previous.git.base !== fresh.git.base || previous.git.diffIdentity !== fresh.git.diffIdentity) {
        vscode.window.showWarningMessage("Git state changed since this hunk was selected. Neolit refreshed; select the hunk again.");
        return false;
      }
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Neolit could not refresh Git state before the action: ${String(error)}`);
      return false;
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("neolit.refresh", refresh),
    vscode.commands.registerCommand("neolit.openTask", async (node?: TaskNode) => {
      if (!node || node.kind !== "task" || !current) return;
      const task = current.tasks.find((item) => item.key === node.key);
      if (!task) return;
      const taskUri = workspaceFileUri(folder, task.key.slice(0, task.key.indexOf("::")));
      if (!taskUri) return;
      const document = await vscode.workspace.openTextDocument(taskUri);
      const position = new vscode.Position(Math.max(0, task.range.startLine - 1), 0);
      await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
    }),
    vscode.commands.registerCommand("neolit.openDiagnostic", async (node?: DiagnosticNode) => {
      if (!node || node.kind !== "diagnostic") return;
      const uri = workspaceFileUri(folder, node.todoPath);
      if (!uri) return;
      const document = await vscode.workspace.openTextDocument(uri);
      const position = new vscode.Position(Math.max(0, (node.line ?? 1) - 1), 0);
      await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
    }),
    vscode.commands.registerCommand("neolit.openRequirement", async (node?: RequirementNode) => {
      if (!node || node.kind !== "requirement" || !current) return;
      const spec = current.specs.find((item) => item.path === node.specPath);
      const requirement = spec?.requirements.find((item) => item.id === node.id);
      if (!spec || !requirement) return;
      const specUri = workspaceFileUri(folder, node.specPath);
      if (!specUri) return;
      const document = await vscode.workspace.openTextDocument(specUri);
      const position = new vscode.Position(Math.max(0, requirement.range.startLine - 1), 0);
      await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
    }),
    vscode.commands.registerCommand("neolit.openPlanFile", async (node?: PlanFileNode) => {
      if (!node || node.kind !== "file" || !current) return;
      let changed = current.git.changedFiles.find((item) => item.path === node.path || item.previousPath === node.path);
      if (changed) {
        if (!await ensureCurrent()) return;
        changed = current?.git.changedFiles.find((item) => item.path === node.path || item.previousPath === node.path);
        if (!changed || !current) {
          const uri = workspaceFileUri(folder, node.path);
          if (uri) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
          return;
        }
        const base = vscode.Uri.from({ scheme: BASE_SCHEME, path: `/${changed.path}`, query: current.git.base });
        const working = changed.status === "deleted"
          ? vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${changed.path}` })
          : workspaceFileUri(folder, changed.path);
        if (!working) return;
        await vscode.commands.executeCommand("vscode.diff", base, working, `Neolit: ${changed.path} · ${current.git.base.slice(0, 8)}`);
        return;
      }
      const uri = workspaceFileUri(folder, node.path);
      if (!uri) return;
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    }),
    vscode.commands.registerCommand("neolit.openChangedFile", async (node?: HunkNode | ChangedFileNode) => {
      if (!node || (node.kind !== "hunk" && node.kind !== "changedFile") || !current) return;
      if (!await ensureCurrent()) return;
      const file = current.git.changedFiles.find((item) => item.path === node.path);
      if (!file) return;
      const fileUri = workspaceFileUri(folder, file.path);
      if (!fileUri) return;
      if (file.status !== "deleted" && file.hunks.length === 0) {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fileUri));
        return;
      }
      const base = vscode.Uri.from({ scheme: BASE_SCHEME, path: `/${file.path}`, query: current.git.base });
      const working = file.status === "deleted"
        ? vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${file.path}` })
        : fileUri;
      await vscode.commands.executeCommand("vscode.diff", base, working, `Neolit: ${file.path} · ${current.git.base.slice(0, 8)}`);
    }),
    vscode.commands.registerCommand("neolit.openHunkDiff", async (node?: HunkNode) => {
      if (!node || node.kind !== "hunk" || !current) return;
      if (!await ensureCurrent()) return;
      const file = current.git.changedFiles.find((item) => item.path === node.path);
      const hunk = file?.hunks[node.hunkIndex];
      if (!file || !hunk) return;
      const fileUri = workspaceFileUri(folder, node.path);
      if (!fileUri) return;
      const base = vscode.Uri.from({ scheme: BASE_SCHEME, path: `/${node.path}`, query: current.git.base });
      const working = file.status === "deleted"
        ? vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${node.path}` })
        : fileUri;
      await vscode.commands.executeCommand("vscode.diff", base, working, `Neolit: ${node.path} · ${current.git.base.slice(0, 8)}`);
      await vscode.commands.executeCommand(file.status === "deleted"
        ? "workbench.action.compareEditor.focusPrimarySide"
        : "workbench.action.compareEditor.focusSecondarySide");
      for (let index = 0; index <= node.hunkIndex; index += 1) {
        await vscode.commands.executeCommand("workbench.action.compareEditor.nextChange");
      }
    }),
    vscode.commands.registerCommand("neolit.copyHunkContext", async (node?: HunkNode) => {
      if (!node || node.kind !== "hunk" || !current) return;
      if (!await ensureCurrent()) return;
      const file = current.git.changedFiles.find((item) => item.path === node.path);
      const hunk = file?.hunks[node.hunkIndex];
      if (!file || !hunk) return;
      const currentFileDiff = file.rawDiff;
      if (!currentFileDiff) return;
      const anchor = createDiffAnchor({
        path: node.path, side: "working-tree", baseCommit: current.git.base,
        diffText: currentFileDiff, hunk,
      });
      const relatedTasks = selectRelatedTaskContexts({ path: node.path, previousPath: file.previousPath, tasks: current.tasks })
        .filter((item) => node.candidateTaskKeys.includes(item.task.key));
      const relatedRequirements = node.candidateRequirementRefs.flatMap((reference) => {
        const separator = reference.lastIndexOf("#");
        if (separator < 1) return [];
        const specPath = reference.slice(0, separator);
        const id = reference.slice(separator + 1);
        const spec = current.specs.find((item) => item.path === specPath);
        const requirement = spec?.requirements.find((item) => item.id === id);
        return requirement ? [{ specPath, requirement }] : [];
      });
      const documentationContext = relatedTasks.length === 1
        ? selectTaskDocumentationContext({ task: current.tasks.find((item) => item.key === relatedTasks[0]!.task.key)!, readmes: current.readmeContents })
        : undefined;
      const packet = buildDiffQuestionPacket({
        question: "Please explain this change, its relationship to the linked plan, and any gaps or risks.",
        anchor, currentBaseCommit: current.git.base, currentDiffText: currentFileDiff,
        relatedTasks, relatedRequirements, documentationContext,
      });
      if (packet.status === "stale") {
        vscode.window.showWarningMessage("This diff context is stale. Refresh Neolit before copying it.");
        return;
      }
      await vscode.env.clipboard.writeText(packet.packet);
      vscode.window.showInformationMessage("Neolit hunk context copied. Paste it into your existing coding-agent session.");
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const relative = path.relative(root, document.uri.fsPath);
      if (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) void refresh();
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) void refresh();
    }),
  );
  void refresh();
}

export function deactivate(): void {}
