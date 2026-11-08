import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface RepositoryChange {
  paths: string[];
  basisChanged: boolean;
}

/**
 * Polls the repository's tracked and non-ignored untracked files. It compares
 * inode, mode, nanosecond mtime, size and symlink target, so same-size edits
 * and atomic editor saves are detected without reading file contents.
 */
export class RepositoryWatcher {
  private snapshot = new Map<string, string>();
  private basis: string | undefined;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private checking = false;

  constructor(
    private readonly directory: string,
    private readonly onChange: (change: RepositoryChange) => void,
    intervalMs = 1000,
  ) {
    this.capture();
    this.timer = setInterval(() => this.poll(), Math.max(250, intervalMs));
    this.timer.unref?.();
  }

  /** Adopt only known host-owned paths; unrelated concurrent edits remain observable. */
  rebaseline(paths: string[]): void {
    for (const relative of paths) {
      const signature = this.readPathSignature(relative);
      if (signature === undefined) this.snapshot.delete(relative);
      else this.snapshot.set(relative, signature);
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private poll(): void {
    if (this.closed || this.checking) return;
    this.checking = true;
    try {
      const next = this.readSnapshot();
      const paths = new Set([...this.snapshot.keys(), ...next.keys()]);
      const changed = [...paths].filter((entry) => this.snapshot.get(entry) !== next.get(entry)).sort();
      const nextBasis = this.readBasis();
      const basisChanged = this.basis !== undefined && nextBasis !== this.basis;
      this.snapshot = next;
      this.basis = nextBasis;
      if (changed.length || basisChanged) this.onChange({ paths: changed, basisChanged });
    } finally {
      this.checking = false;
    }
  }

  private capture(): void {
    this.snapshot = this.readSnapshot();
    this.basis = this.readBasis();
  }

  private readBasis(): string | undefined {
    try {
      return execFileSync("git", ["-C", this.directory, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return undefined;
    }
  }

  private readPathSignature(relative: string): string | undefined {
    try {
      const absolute = path.join(this.directory, relative);
      const stat = fs.lstatSync(absolute, { bigint: true });
      const link = stat.isSymbolicLink() ? fs.readlinkSync(absolute) : "";
      return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, link].join(":");
    } catch {
      return undefined;
    }
  }

  private readSnapshot(): Map<string, string> {
    let names: string[];
    try {
      names = execFileSync("git", ["-C", this.directory, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }).split("\0").filter(Boolean);
    } catch {
      names = [];
      const visit = (folder: string) => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          const absolute = path.join(folder, entry.name);
          if (entry.isDirectory()) visit(absolute);
          else names.push(path.relative(this.directory, absolute).split(path.sep).join("/"));
        }
      };
      visit(this.directory);
    }
    const result = new Map<string, string>();
    for (const name of names) {
      try {
        const signature = this.readPathSignature(name);
        if (signature !== undefined) result.set(name, signature);
      } catch {
        // A disappearing file is represented by its absence in the next map.
      }
    }
    return result;
  }
}
