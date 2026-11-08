import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RepositoryOverlay {
  scope?: string;
  source: "user" | "repository";
  title: string;
  text: string;
}

const MAX_OVERLAYS = 32;
const MAX_FILE_BYTES = 48_000;
const RULE_LANGUAGE = /\b(?:must|must not|never|always|required|do not|don't|should|avoid|prefer|only|ensure|keep|preserve)\b/iu;

function trackedPaths(directory: string): string[] {
  try {
    return execFileSync("git", ["-C", directory, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function readMarkdown(directory: string, relative: string): string | undefined {
  try {
    const absolute = path.resolve(directory, relative);
    const root = path.resolve(directory);
    const rel = path.relative(root, absolute);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return undefined;
    const content = fs.readFileSync(absolute, "utf8");
    return content.includes("\0") ? undefined : content;
  } catch {
    return undefined;
  }
}

function wholeFileOverlay(directory: string, relative: string, source: RepositoryOverlay["source"], title: string): RepositoryOverlay | undefined {
  const text = readMarkdown(directory, relative)?.trim();
  if (!text) return undefined;
  // Explicit overlays are repository-wide policies, not scoped to their storage directory.
  return { source, title, text };
}

function documentationRules(relative: string, content: string): RepositoryOverlay[] {
  const scope = path.posix.dirname(relative);
  const heading: string[] = [];
  const rules: RepositoryOverlay[] = [];
  let inFence = false;
  for (const raw of content.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || line.startsWith("<!--")) continue;
    if (/^#{1,6}\s/u.test(line)) {
      heading.splice(0, heading.length, line.replace(/^#{1,6}\s+/u, "").trim());
      continue;
    }
    const rule = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/u, "").trim();
    if (!rule || (!RULE_LANGUAGE.test(rule) && !(path.posix.basename(relative).toLowerCase() === "agents.md" && rule.startsWith("Models propose semantic changes")))) continue;
    const text = (heading.length ? heading.join(" / ") + ": " : "") + rule;
    rules.push({
      scope: scope === "." ? undefined : scope,
      source: "repository",
      title: relative,
      text: text.slice(0, 900),
    });
    if (rules.length >= MAX_OVERLAYS) break;
  }
  return rules;
}

/**
 * Load explicit user/practice overlays and imperative rules from repository
 * instruction/documentation files. Constraints are scoped to the directory
 * that owns the file, so nested AGENTS.md rules remain path-local.
 */
export function loadRepositoryOverlays(directory: string): RepositoryOverlay[] {
  const root = path.resolve(directory);
  const overlays: RepositoryOverlay[] = [];
  const globalConfig = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  const globalOverlay = path.join(globalConfig, "neolit", "overlay.md");
  try {
    const stat = fs.statSync(globalOverlay);
    if (stat.isFile() && stat.size <= MAX_FILE_BYTES) {
      const text = fs.readFileSync(globalOverlay, "utf8").trim();
      if (text) overlays.push({ source: "user", title: "User Neolit overlay", text });
    }
  } catch {
    // Optional global overlay.
  }

  for (const [relative, source, title] of [
    [".neolit/overlay.md", "user", "Repository user overlay"],
    [".neolit/practice.md", "repository", "Repository practice overlay"],
  ] as const) {
    const overlay = wholeFileOverlay(root, relative, source, title);
    if (overlay) overlays.push(overlay);
  }

  const paths = trackedPaths(root).filter((entry) => {
    const name = path.posix.basename(entry).toLowerCase();
    return name === "agents.md"
      || name === "contributing.md"
      || name === "architecture.md"
      || (name === "readme.md" && (entry === "README.md" || entry.startsWith("docs/")));
  }).sort((left, right) => {
    const priority = (value: string) => path.posix.basename(value).toLowerCase() === "agents.md" ? 0
      : path.posix.basename(value).toLowerCase() === "contributing.md" ? 1 : 2;
    return priority(left) - priority(right) || left.localeCompare(right);
  });

  for (const relative of paths) {
    if (overlays.length >= MAX_OVERLAYS) break;
    const content = readMarkdown(root, relative);
    if (!content) continue;
    const rules = documentationRules(relative, content);
    for (const rule of rules) {
      if (overlays.length >= MAX_OVERLAYS) break;
      overlays.push(rule);
    }
  }

  const seen = new Set<string>();
  return overlays.filter((overlay) => {
    const key = [overlay.source, overlay.scope ?? ".", overlay.text].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_OVERLAYS);
}
