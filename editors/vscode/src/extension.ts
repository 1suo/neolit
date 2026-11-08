import * as vscode from "vscode";
import path from "node:path";
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
type HunkNode = { kind: "hunk"; path: string; previousPath?: string; hunkIndex: number; label: string };
type GroupNode = { kind: "group"; label: string };
type PlanFileNode = { kind: "file"; path: string; taskKey: string; label: string };
type PlanNode = TaskNode | RequirementNode | HunkNode | GroupNode | PlanFileNode;
const execFileAsync = promisify(execFile);
const BASE_SCHEME = "neolit-base";

class BaseDocumentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly root: string, private readonly getWorkspace: () => PlanningWorkspace | undefined) {}
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const relative = uri.path.replace(/^\\//u, "");
    const workspace = this.getWorkspace();
    const baseCommit = uri.query;
    if (!workspace || !/^[0-9a-f]{40,64}$/iu.test(baseCommit) || !relative || relative.split("/").some((part) => part === "..")) return "";
    const file = workspace.git.changedFiles.find((item) => item.path === relative);
    const sourcePath = file?.previousPath ?? relative;
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
      item.contextValue = "changeGroup";
      item.iconPath = new vscode.ThemeIcon("git-compare");
      return item;
    }
    if (node.kind === "file") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "plannedFile";
      item.iconPath = new vscode.ThemeIcon("file");
      const task = this.workspace?.tasks.find((entry) => entry.key === node.taskKey);
      item.tooltip = task?.description.join("\n") || "File referenced by this TODO task.";
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
    item.command = { command: "neolit.openChangedFile", title: "Open changed file", arguments: [node] };
    return item;
  }
  getChildren(node?: PlanNode): PlanNode[] {
    const workspace = this.workspace;
    if (!workspace) return [];
    if (!node) {
      const tasks: TaskNode[] = workspace.tasks.map((task) => ({ kind: "task", key: task.key, label: task.text }));
      const changes: GroupNode[] = workspace.git.hunkAssociations.length
        ? [{ kind: "group", label: `Git changes · ${workspace.git.hunkAssociations.length} hunks` }]
        : [];
      return [...tasks, ...changes];
    }
    if (node.kind === "group") return workspace.git.hunkAssociations.map((association) => {
      const file = workspace.git.changedFiles.find((item) => item.path === association.path);
      return {
        kind: "hunk" as const, path: association.path, previousPath: file?.previousPath,
        hunkIndex: association.hunkIndex,
        label: `${association.state === "documentation" ? "DOC" : association.state === "unplanned" ? "?" : "~"} ${association.path} · hunk ${association.hunkIndex + 1}`,
      };
    });
    if (node.kind === "requirement") {
      return workspace.tasks.filter((task) => task.resolvedRequirements.some((item) => item.specPath === node.specPath && item.id === node.id))
        .map((task) => ({ kind: "task" as const, key: task.key, label: task.text }));
    }
    if (node.kind !== "task") return [];
    const task = workspace.tasks.find((item) => item.key === node.key);
    if (!task) return [];
    const files: PlanFileNode[] = task.filePaths.map((file) => ({ kind: "file", path: file, taskKey: task.key, label: file }));
    const requirements: RequirementNode[] = task.resolvedRequirements.map((item) => ({
      kind: "requirement", key: node.key, specPath: item.specPath, id: item.id,
      label: `${item.id} — ${item.text}`,
    }));
    const hunks: HunkNode[] = (workspace.derived.tasks[node.key]?.hunkReviews ?? []).map((review) => ({
      kind: "hunk", path: review.path, hunkIndex: review.hunkIndex,
      label: `${review.state === "documentation" ? "DOC" : review.state === "unplanned" ? "?" : "~"} ${review.path} · hunk ${review.hunkIndex + 1}`,
    }));
    return [...files, ...requirements, ...hunks];
  }
}

class PlanningDecorationProvider implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private paths = new Set<string>();
  private plannedPaths = new Set<string>();
  refresh(workspace: PlanningWorkspace): void {
    this.paths = new Set(workspace.git.changedFiles.map((file) => path.normalize(file.path)));
    this.plannedPaths = new Set(workspace.tasks.flatMap((task) => task.filePaths.map((file) => path.normalize(file))));
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
  const baseDocuments = new BaseDocumentProvider(root, () => current);
  const view = vscode.window.createTreeView("neolit.plan", { treeDataProvider: tree, showCollapseAll: true });
  context.subscriptions.push(view, tree, decorations, vscode.window.registerFileDecorationProvider(decorations), vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, baseDocuments));
  let current: PlanningWorkspace | undefined;

  const refresh = async () => {
    try {
      current = await load(root);
      tree.refresh(current);
      decorations.refresh(current);
    } catch (error) {
      vscode.window.showErrorMessage(`Neolit planning refresh failed: ${String(error)}`);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("neolit.refresh", refresh),
    vscode.commands.registerCommand("neolit.openTask", async (node?: TaskNode) => {
      if (!node || node.kind !== "task" || !current) return;
      const task = current.tasks.find((item) => item.key === node.key);
      if (!task) return;
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, task.key.slice(0, task.key.indexOf("::"))));
      const position = new vscode.Position(Math.max(0, task.range.startLine - 1), 0);
      await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
    }),
    vscode.commands.registerCommand("neolit.openRequirement", async (node?: RequirementNode) => {
      if (!node || node.kind !== "requirement" || !current) return;
      const spec = current.specs.find((item) => item.path === node.specPath);
      const requirement = spec?.requirements.find((item) => item.id === node.id);
      if (!spec || !requirement) return;
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, node.specPath));
      const position = new vscode.Position(Math.max(0, requirement.range.startLine - 1), 0);
      await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
    }),
    vscode.commands.registerCommand("neolit.openPlanFile", async (node?: PlanFileNode) => {
      if (!node || node.kind !== "file" || !current) return;
      const changed = current.git.changedFiles.find((item) => item.path === node.path);
      if (changed) {
        const base = vscode.Uri.from({ scheme: BASE_SCHEME, path: `/${node.path}`, query: current.git.base });
        const working = vscode.Uri.joinPath(folder.uri, node.path);
        await vscode.commands.executeCommand("vscode.diff", base, working, `Neolit: ${node.path} · ${current.git.base.slice(0, 8)}`);
        return;
      }
      const uri = vscode.Uri.joinPath(folder.uri, node.path);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    }),
    vscode.commands.registerCommand("neolit.openChangedFile", async (node?: HunkNode) => {
      if (!node || node.kind !== "hunk") return;
      const uri = vscode.Uri.joinPath(folder.uri, node.path);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    }),
    vscode.commands.registerCommand("neolit.openHunkDiff", async (node?: HunkNode) => {
      if (!node || node.kind !== "hunk" || !current) return;
      const file = current.git.changedFiles.find((item) => item.path === node.path);
      const hunk = file?.hunks[node.hunkIndex];
      if (!file || !hunk) return;
      const working = vscode.Uri.joinPath(folder.uri, node.path);
      const base = vscode.Uri.from({ scheme: BASE_SCHEME, path: `/${node.path}`, query: current.git.base });
      await vscode.commands.executeCommand("vscode.diff", base, working, `Neolit: ${node.path} · ${current.git.base.slice(0, 8)}`);
    }),
    vscode.commands.registerCommand("neolit.copyHunkContext", async (node?: HunkNode) => {
      if (!node || node.kind !== "hunk" || !current) return;
      const file = current.git.changedFiles.find((item) => item.path === node.path);
      const hunk = file?.hunks[node.hunkIndex];
      if (!file || !hunk) return;
      const currentFileDiff = file.rawDiff;
      if (!currentFileDiff) return;
      const anchor = createDiffAnchor({
        path: node.path, side: "working-tree", baseCommit: current.git.base,
        diffText: currentFileDiff, hunk,
      });
      const relatedTasks = selectRelatedTaskContexts({ path: node.path, previousPath: file.previousPath, tasks: current.tasks });
      const documentationContext = relatedTasks.length === 1
        ? selectTaskDocumentationContext({ task: current.tasks.find((item) => item.key === relatedTasks[0]!.task.key)!, readmes: current.readmeContents })
        : undefined;
      const packet = buildDiffQuestionPacket({
        question: "Please explain this change, its relationship to the linked plan, and any gaps or risks.",
        anchor, currentBaseCommit: current.git.base, currentDiffText: currentFileDiff,
        selectedDiffText: file.rawDiff, relatedTasks, documentationContext,
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
