import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Task → agent-session bindings, scoped per repository directory. A session
 * belongs to the project it was created in: bindings are read and written
 * only through the owning directory's bucket, so a session can never be
 * revived for — or leak into — another project.
 *
 * On-disk shape: `{ [resolvedDirectory]: { [taskId]: sessionId } }` under
 * `$XDG_STATE_HOME/neolit/augment-sessions.json`. The pre-scoping flat
 * `{ [taskId]: sessionId }` files are ignored: their bindings cannot be
 * attributed to a directory, so they are dropped rather than guessed.
 */

const MAX_BINDINGS_PER_DIRECTORY = 64;

function sessionsStorePath(): string {
  const base = process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.trim()
    ? process.env.XDG_STATE_HOME
    : path.join(os.homedir(), ".local", "state");
  return path.join(base, "neolit", "augment-sessions.json");
}

function loadStore(): Map<string, Map<string, string>> {
  const store = new Map<string, Map<string, string>>();
  try {
    const raw = JSON.parse(fs.readFileSync(sessionsStorePath(), "utf8")) as Record<string, unknown>;
    // Only the scoped shape loads; a flat (or corrupt) file reads as empty.
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [directory, bindings] of Object.entries(raw)) {
        if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) continue;
        const bucket = new Map<string, string>();
        for (const [taskId, sessionId] of Object.entries(bindings)) {
          if (typeof sessionId === "string" && sessionId.startsWith("ses_")) bucket.set(taskId, sessionId);
        }
        if (bucket.size) store.set(directory, bucket);
      }
    }
  } catch {
    // A missing or unreadable store starts empty.
  }
  return store;
}

function saveStore(store: Map<string, Map<string, string>>): void {
  try {
    fs.mkdirSync(path.dirname(sessionsStorePath()), { recursive: true });
    const serializable = Object.fromEntries([...store].map(([directory, bucket]) => [directory, Object.fromEntries(bucket)]));
    fs.writeFileSync(sessionsStorePath(), `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
  } catch {
    // Persistence is best-effort; the caller's session keeps working.
  }
}

/** The session bound to a task in one directory, if any. */
export function sessionBindingFor(directory: string, taskId: string): string | undefined {
  return loadStore().get(path.resolve(directory))?.get(taskId);
}

/** Binds a session to a task inside its directory, evicting the oldest past the cap. */
export function rememberSessionBinding(directory: string, taskId: string, sessionId: string): void {
  const key = path.resolve(directory);
  const store = loadStore();
  const bucket = store.get(key) ?? new Map<string, string>();
  bucket.delete(taskId); // re-set moves the task to the newest end
  bucket.set(taskId, sessionId);
  if (bucket.size > MAX_BINDINGS_PER_DIRECTORY) {
    const oldest = bucket.keys().next().value;
    if (oldest !== undefined) bucket.delete(oldest);
  }
  store.set(key, bucket);
  saveStore(store);
}

/** Drops a task's binding in one directory (for example after a failed resume). */
export function forgetSessionBinding(directory: string, taskId: string): void {
  const key = path.resolve(directory);
  const store = loadStore();
  const bucket = store.get(key);
  if (!bucket?.delete(taskId)) return;
  if (bucket.size) store.set(key, bucket);
  else store.delete(key);
  saveStore(store);
}
