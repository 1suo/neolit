import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_INDEXED_PATHS = 5_000;
const MAX_INDEXED_FILE_BYTES = 256_000;
const MAX_INDEX_BYTES = 12 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".lua", ".py", ".rs", ".go"]);

interface IndexedFile {
  path: string;
  imports: Set<string>;
}

function repositoryPaths(directory: string): string[] {
  try {
    return execFileSync("git", ["-C", directory, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter(Boolean).sort().slice(0, MAX_INDEXED_PATHS);
  } catch {
    const paths: string[] = [];
    const visit = (folder: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".venv" || entry.name === "vendor") continue;
        const absolute = path.join(folder, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else paths.push(path.relative(directory, absolute).split(path.sep).join("/"));
        if (paths.length >= MAX_INDEXED_PATHS) return;
      }
    };
    visit(directory);
    return paths.sort().slice(0, MAX_INDEXED_PATHS);
  }
}

function metadataSignature(directory: string, paths: string[]): string {
  const values: string[] = [];
  for (const relative of paths) {
    try {
      const stat = fs.lstatSync(path.join(directory, relative), { bigint: true });
      values.push(relative, String(stat.dev), String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.mode));
    } catch {
      values.push(relative, "missing");
    }
  }
  return values.join("\0");
}

function importSpecifiers(file: string, source: string): string[] {
  const extension = path.posix.extname(file);
  const patterns: RegExp[] = [];
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"].includes(extension)) {
    patterns.push(/(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/gu);
  } else if (extension === ".lua") {
    patterns.push(/require\s*\(?\s*["']([^"']+)["']/gu);
  } else if (extension === ".py") {
    patterns.push(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gmu);
  } else if (extension === ".rs") {
    patterns.push(/^\s*mod\s+([a-zA-Z0-9_]+)\s*;/gmu);
    patterns.push(/^\s*use\s+crate::([a-zA-Z0-9_:]+)/gmu);
  } else if (extension === ".go") {
    patterns.push(/["'](\.[^"']+)["']/gu);
  }
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[2];
      if (value && value.length < 240) found.add(value);
    }
  }
  return [...found];
}

function insideRepository(candidate: string): boolean {
  return candidate !== ".." && !candidate.startsWith("../") && !path.posix.isAbsolute(candidate);
}

export class RepositoryPathIndex {
  private signature = "";
  private files = new Map<string, IndexedFile>();
  private reverse = new Map<string, Set<string>>();
  private paths: string[] = [];

  constructor(private readonly directory: string) {
    this.refresh();
  }

  /** Rebuild only when path metadata changes; no file bodies leave the host. */
  refresh(): void {
    const paths = repositoryPaths(this.directory);
    const signature = metadataSignature(this.directory, paths);
    if (signature === this.signature) return;
    this.signature = signature;
    this.paths = paths;
    this.files.clear();
    this.reverse.clear();

    let totalBytes = 0;
    for (const relative of paths) {
      if (!SOURCE_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) continue;
      try {
        const stat = fs.lstatSync(path.join(this.directory, relative));
        if (!stat.isFile() || stat.size > MAX_INDEXED_FILE_BYTES || totalBytes + stat.size > MAX_INDEX_BYTES) continue;
        const source = fs.readFileSync(path.join(this.directory, relative), "utf8");
        totalBytes += stat.size;
        if (source.includes("\0")) continue;
        this.files.set(relative, { path: relative, imports: new Set() });
      } catch {
        // A disappearing or unreadable file is omitted from this snapshot.
      }
    }

    for (const file of this.files.values()) {
      let source: string;
      try { source = fs.readFileSync(path.join(this.directory, file.path), "utf8"); } catch { continue; }
      for (const specifier of importSpecifiers(file.path, source)) {
        const resolved = this.resolve(file.path, specifier);
        if (!resolved || resolved === file.path) continue;
        file.imports.add(resolved);
        const inbound = this.reverse.get(resolved) ?? new Set<string>();
        inbound.add(file.path);
        this.reverse.set(resolved, inbound);
      }
    }
  }

  /** A compact, ranked path map for the selected scope; relationships are hints, not scope authority. */
  contextFor(target?: string): string {
    this.refresh();
    const scope = target && target !== "." ? target.replace(/^\.\//u, "").replace(/\/$/u, "") : "";
    const direct = this.paths.filter((entry) => {
      const parent = path.posix.dirname(entry);
      return scope ? parent === scope || entry.startsWith(scope + "/") : parent === ".";
    });
    const directories = new Set<string>();
    for (const entry of this.paths) {
      const parent = path.posix.dirname(entry);
      if (scope && parent !== scope && !parent.startsWith(scope + "/")) continue;
      if (!scope && parent === ".") continue;
      const relative = scope ? path.posix.relative(scope, parent) : parent;
      const first = relative.split("/")[0];
      if (first && first !== ".") directories.add(first);
    }

    const lines = [
      "Repository path index (tracked and non-ignored files; relationships are navigation hints, never permission to expand scope):",
      `Indexed ${this.paths.length} paths and ${this.files.size} source files; scope: ${scope || "."}.`,
    ];
    if (directories.size) lines.push(`Directories: ${[...directories].sort().slice(0, 40).join(", ")}.`);
    if (scope && this.paths.includes(scope) && !this.files.has(scope)) {
      const siblingDir = path.posix.dirname(scope);
      const siblings = this.paths.filter((entry) => entry !== scope && path.posix.dirname(entry) === siblingDir).slice(0, 32);
      if (siblings.length) lines.push("Nearby files:", ...siblings.map((file) => "- " + file + " (same directory)"));
    }
    if (scope && this.files.has(scope)) {
      const ranked = new Map<string, { score: number; reason: string }>();
      for (const imported of this.files.get(scope)!.imports) ranked.set(imported, { score: 6, reason: "imports" });
      for (const importer of this.reverse.get(scope) ?? []) ranked.set(importer, { score: 5, reason: "imported by" });
      const siblingDir = path.posix.dirname(scope);
      for (const sibling of this.files.keys()) {
        if (sibling !== scope && path.posix.dirname(sibling) === siblingDir && !ranked.has(sibling)) {
          ranked.set(sibling, { score: 2, reason: "same directory" });
        }
      }
      const related = [...ranked].sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0])).slice(0, 32);
      if (related.length) lines.push("Related files:", ...related.map(([file, info]) => `- ${file} (${info.reason})`));
    } else if (direct.length) {
      lines.push("Files in scope:", ...direct.slice(0, 48).map((file) => `- ${file}`));
      if (direct.length > 48) lines.push(`- … ${direct.length - 48} more paths in scope`);
    }
    return lines.join("\n");
  }

  private resolve(from: string, specifier: string): string | undefined {
    const extension = path.posix.extname(from);
    const candidates: string[] = [];
    if (specifier.startsWith(".")) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
      if (!insideRepository(base)) return undefined;
      candidates.push(base);
      for (const suffix of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".lua", ".py", ".rs", ".go", "/index.ts", "/index.tsx", "/index.js", "/index.lua", "/__init__.py"]) {
        candidates.push(base + suffix);
      }
    } else if (extension === ".lua") {
      const base = specifier.replaceAll(".", "/");
      candidates.push(base + ".lua", base + "/init.lua");
    } else if (extension === ".py" || extension === ".rs") {
      const base = specifier.replaceAll(".", "/").replaceAll("::", "/");
      candidates.push(base + ".py", base + "/__init__.py", base + ".rs", base + "/mod.rs", "src/" + base + ".rs", "src/" + base + "/mod.rs");
    } else if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
      const base = specifier.slice(2);
      candidates.push(base, "src/" + base, "lua/" + base);
      for (const suffix of [".ts", ".tsx", ".js", ".lua"]) candidates.push(base + suffix, "src/" + base + suffix, "lua/" + base + suffix);
    }
    return candidates.find((candidate) => this.files.has(candidate));
  }
}

const indexes = new Map<string, RepositoryPathIndex>();

export function repositoryIndexContext(directory: string, target?: string): string {
  const key = path.resolve(directory);
  let index = indexes.get(key);
  if (!index) {
    index = new RepositoryPathIndex(key);
    indexes.set(key, index);
  }
  return index.contextFor(target);
}
