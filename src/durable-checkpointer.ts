import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { MemorySaver } from "@langchain/langgraph";

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;

function processIdentity(pid: number): string | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch { return; }
}

function lockOwnerAlive(owner: { pid?: number; processStart?: string }): boolean {
  if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0) return false;
  try { process.kill(owner.pid!, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") return false; }
  const current = processIdentity(owner.pid!);
  return !owner.processStart || !current || owner.processStart === current;
}

function threadFromWriteKey(key: string): string | undefined {
  try { return JSON.parse(key)[0] as string; } catch { return; }
}

type ThreadSnapshot = {
  threadId: string;
  storage: MemorySaver["storage"][string];
  writes: MemorySaver["writes"];
};

function encode(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) return { __langgraphBytes: Buffer.from(value).toString("base64") };
  return value;
}

function decode(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "__langgraphBytes" in value) return new Uint8Array(Buffer.from(String((value as { __langgraphBytes: unknown }).__langgraphBytes), "base64"));
  if (value && typeof value === "object" && (value as { type?: unknown }).type === "Buffer" && Array.isArray((value as { data?: unknown }).data)) return new Uint8Array((value as { data: number[] }).data);
  return value;
}

/** A dependency-free, atomic, per-thread persistent LangGraph saver. */
export class DurableFileSaver extends MemorySaver {
  private readonly pending = new Map<string, Promise<void>>();
  constructor(readonly directory: string, readonly lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS) {
    super();
  }

  private file(threadId: string): string {
    return path.join(this.directory, `${createHash("sha256").update(threadId).digest("hex")}.json`);
  }

  private async readSnapshot(file: string, expectedThreadId?: string): Promise<ThreadSnapshot> {
    const storage: MemorySaver["storage"][string] = Object.create(null);
    const writes: MemorySaver["writes"] = Object.create(null);
    let threadId: string | undefined;
    let lineNumber = 0;
    let legacy: ThreadSnapshot | undefined;
    const lines = createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      lineNumber++;
      const record = JSON.parse(line, decode) as Record<string, unknown>;
      if (lineNumber === 1 && "storage" in record && "writes" in record) {
        legacy = record as ThreadSnapshot;
        continue;
      }
      if (legacy) throw new Error("Invalid legacy checkpoint file");
      if (lineNumber === 1) {
        if (record.format !== "neolit-checkpoints" || record.version !== 1 || typeof record.threadId !== "string") throw new Error("Unsupported checkpoint file format");
        threadId = record.threadId;
      } else if (record.type === "checkpoint" && typeof record.namespace === "string" && typeof record.checkpointId === "string" && Array.isArray(record.value)) {
        storage[record.namespace] ??= Object.create(null);
        storage[record.namespace][record.checkpointId] = record.value as MemorySaver["storage"][string][string][string];
      } else if (record.type === "writes" && typeof record.key === "string" && record.value && typeof record.value === "object") {
        writes[record.key] = record.value as MemorySaver["writes"][string];
      } else {
        throw new Error("Invalid checkpoint record");
      }
    }
    const snapshot = legacy ?? (threadId ? { threadId, storage, writes } : undefined);
    if (!snapshot || typeof snapshot.threadId !== "string" || !snapshot.storage || !snapshot.writes) throw new Error("Empty or invalid checkpoint file");
    if (expectedThreadId !== undefined && snapshot.threadId !== expectedThreadId) throw new Error("Checkpoint thread hash collision");
    for (const key of Object.keys(snapshot.writes)) if (threadFromWriteKey(key) !== snapshot.threadId) throw new Error("Checkpoint write belongs to another thread");
    return snapshot;
  }

  private applySnapshot(snapshot: ThreadSnapshot): void {
    this.storage[snapshot.threadId] = snapshot.storage;
    for (const key of Object.keys(this.writes)) if (threadFromWriteKey(key) === snapshot.threadId) delete this.writes[key];
    Object.assign(this.writes, snapshot.writes);
  }

  private async loadThread(threadId: string): Promise<void> {
    const file = this.file(threadId);
    if (!fs.existsSync(file)) {
      delete this.storage[threadId];
      for (const key of Object.keys(this.writes)) if (threadFromWriteKey(key) === threadId) delete this.writes[key];
      return;
    }
    this.applySnapshot(await this.readSnapshot(file, threadId));
  }

  private async loadAll(): Promise<void> {
    if (!fs.existsSync(this.directory)) return;
    const names = fs.readdirSync(this.directory);
    const files = new Set(names.filter((name) => name.endsWith(".json")));
    for (const threadId of Object.keys(this.storage)) {
      if (files.has(path.basename(this.file(threadId)))) continue;
      delete this.storage[threadId];
      for (const key of Object.keys(this.writes)) if (threadFromWriteKey(key) === threadId) delete this.writes[key];
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        this.applySnapshot(await this.readSnapshot(path.join(this.directory, name)));
      } catch { /* ignore incomplete or externally edited checkpoints */ }
    }
  }

  private persistThread(threadId: string): void {
    fs.mkdirSync(this.directory, { recursive: true });
    const file = this.file(threadId);
    const storage = this.storage[threadId] ?? {};
    const writes = Object.fromEntries(Object.entries(this.writes).filter(([key]) => {
      return threadFromWriteKey(key) === threadId;
    }));
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(temporary, "wx");
      const write = (record: unknown) => fs.writeFileSync(descriptor!, `${JSON.stringify(record, encode)}\n`);
      write({ format: "neolit-checkpoints", version: 1, threadId });
      for (const [namespace, checkpoints] of Object.entries(storage)) {
        for (const [checkpointId, value] of Object.entries(checkpoints)) write({ type: "checkpoint", namespace, checkpointId, value });
      }
      for (const [key, value] of Object.entries(writes)) write({ type: "writes", key, value });
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, file);
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(temporary); } catch { /* best effort cleanup */ }
      throw error;
    }
  }

  private async mutateThread<T>(threadId: string, action: () => Promise<T>, persist = true): Promise<T> {
    const prior = this.pending.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(() => turn);
    this.pending.set(threadId, tail);
    await prior;
    const lock = `${this.file(threadId)}.lock`;
    fs.mkdirSync(this.directory, { recursive: true });
    const token = randomUUID();
    const processStart = processIdentity(process.pid);
    const deadline = Date.now() + this.lockTimeoutMs;
    let acquired = false;
    try {
      while (true) {
        try {
          fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, processStart, token }), { flag: "wx" });
          acquired = true;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          let dead = false;
          try {
            const owner = JSON.parse(fs.readFileSync(lock, "utf8")) as { pid?: number; processStart?: string };
            dead = !lockOwnerAlive(owner);
          } catch { dead = true; }
          if (dead) { try { fs.unlinkSync(lock); } catch { /* another writer recovered it */ } continue; }
          if (Date.now() >= deadline) throw new Error(`Timed out waiting for checkpoint lock for thread ${threadId}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      await this.loadThread(threadId);
      const result = await action();
      if (persist) this.persistThread(threadId);
      return result;
    } finally {
      try {
        const owner = JSON.parse(fs.readFileSync(lock, "utf8")) as { token?: string };
        if (acquired && owner.token === token) fs.unlinkSync(lock);
      } catch { /* recovered or removed */ }
      release();
      if (this.pending.get(threadId) === tail) this.pending.delete(threadId);
    }
  }

  override async getTuple(config: Parameters<MemorySaver["getTuple"]>[0]) {
    const threadId = config.configurable?.thread_id;
    if (typeof threadId === "string") await this.loadThread(threadId);
    return super.getTuple(config);
  }

  override async *list(config: Parameters<MemorySaver["list"]>[0], options?: Parameters<MemorySaver["list"]>[1]) {
    const threadId = config.configurable?.thread_id;
    if (typeof threadId === "string") await this.loadThread(threadId); else await this.loadAll();
    yield* super.list(config, options);
  }

  override async getDeltaChannelHistory(options: Parameters<MemorySaver["getDeltaChannelHistory"]>[0]) {
    const threadId = options.config.configurable?.thread_id;
    if (typeof threadId === "string") await this.loadThread(threadId);
    return super.getDeltaChannelHistory(options);
  }

  override async put(config: Parameters<MemorySaver["put"]>[0], checkpoint: Parameters<MemorySaver["put"]>[1], metadata: Parameters<MemorySaver["put"]>[2]) {
    const threadId = String(config.configurable?.thread_id);
    return this.mutateThread(threadId, () => super.put(config, checkpoint, metadata));
  }

  override async putWrites(config: Parameters<MemorySaver["putWrites"]>[0], writes: Parameters<MemorySaver["putWrites"]>[1], taskId: Parameters<MemorySaver["putWrites"]>[2]) {
    const threadId = String(config.configurable?.thread_id);
    await this.mutateThread(threadId, () => super.putWrites(config, writes, taskId));
  }

  async ensureInputWrite(threadId: string): Promise<void> {
    await this.mutateThread(threadId, async () => {
      const tuple = await super.getTuple({ configurable: { thread_id: threadId } });
      if (!tuple || tuple.pendingWrites?.length) return;
      const checkpointId = tuple.checkpoint.id;
      const config = { configurable: { thread_id: threadId, checkpoint_ns: "", checkpoint_id: checkpointId } };
      await super.putWrites(config, [["__start__", null]], "__input__");
    });
  }

  async latestCheckpointId(threadId: string): Promise<string | undefined> {
    await this.loadThread(threadId);
    return (await super.getTuple({ configurable: { thread_id: threadId } }))?.checkpoint.id;
  }

  async resumeConfig(threadId: string): Promise<Record<string, unknown>> {
    await this.mutateThread(threadId, async () => {
      const tuple = await super.getTuple({ configurable: { thread_id: threadId } });
      if (tuple && !Object.keys(tuple.checkpoint.channel_versions).length) {
        tuple.checkpoint.channel_versions.__start__ = this.getNextVersion(undefined);
        tuple.checkpoint.versions_seen.__start__ = {};
        await super.put(tuple.config, tuple.checkpoint, tuple.metadata!);
      }
    });
    return { thread_id: threadId, __pregel_resuming: true };
  }
  override async deleteThread(threadId: string): Promise<void> {
    await this.mutateThread(threadId, async () => {
      await super.deleteThread(threadId);
      try { fs.unlinkSync(this.file(threadId)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }, false);
  }
}
