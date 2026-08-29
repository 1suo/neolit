import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { emptyCheckpoint, MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it } from "vitest";
import { DurableFileSaver } from "../src/durable-checkpointer.js";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neolit-durable-"));
  directories.push(directory);
  return directory;
}

function checkpoint(id: string, channelValues: Record<string, unknown> = {}) {
  return { ...emptyCheckpoint(), id, channel_values: channelValues };
}

function fileFor(directory: string, threadId: string): string {
  return path.join(directory, `${createHash("sha256").update(threadId).digest("hex")}.json`);
}

afterEach(() => {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
  directories.length = 0;
});

describe("DurableFileSaver", () => {
  it("preserves full checkpoint and write history across namespaces", async () => {
    const directory = temporaryDirectory();
    const saver = new DurableFileSaver(directory);
    await saver.put({ configurable: { thread_id: "thread", checkpoint_ns: "" } }, checkpoint("0001", { value: "first" }), {});
    await saver.putWrites({ configurable: { thread_id: "thread", checkpoint_ns: "", checkpoint_id: "0001" } }, [["events", "one"]], "task-1");
    await saver.put({ configurable: { thread_id: "thread", checkpoint_ns: "", checkpoint_id: "0001" } }, checkpoint("0002", { value: "second" }), {});
    await saver.put({ configurable: { thread_id: "thread", checkpoint_ns: "child" } }, checkpoint("1001", { value: "child" }), {});

    const reopened = new DurableFileSaver(directory);
    const root = [];
    for await (const tuple of reopened.list({ configurable: { thread_id: "thread", checkpoint_ns: "" } })) root.push(tuple);
    const child = await reopened.getTuple({ configurable: { thread_id: "thread", checkpoint_ns: "child" } });

    expect(root.map((tuple) => tuple.checkpoint.id)).toEqual(["0002", "0001"]);
    expect(root[1].pendingWrites).toEqual([["task-1", "events", "one"]]);
    expect(child?.checkpoint.channel_values).toEqual({ value: "child" });
    expect(fs.readFileSync(fileFor(directory, "thread"), "utf8").trim().split("\n")).toHaveLength(5);
  });

  it("keeps writes made before their first checkpoint", async () => {
    const directory = temporaryDirectory();
    await new DurableFileSaver(directory).putWrites(
      { configurable: { thread_id: "thread", checkpoint_ns: "pending", checkpoint_id: "0001" } },
      [["events", "early"]],
      "task-1",
    );

    const reopened = new DurableFileSaver(directory);
    await reopened.put({ configurable: { thread_id: "thread", checkpoint_ns: "pending" } }, checkpoint("0001"), {});
    const tuple = await new DurableFileSaver(directory).getTuple({ configurable: { thread_id: "thread", checkpoint_ns: "pending", checkpoint_id: "0001" } });
    expect(tuple?.pendingWrites).toEqual([["task-1", "events", "early"]]);
  });

  it("loads ancestor history before serving delta channels", async () => {
    const directory = temporaryDirectory();
    const saver = new DurableFileSaver(directory);
    await saver.put({ configurable: { thread_id: "thread" } }, checkpoint("0001", { delta: "seed" }), {});
    await saver.putWrites({ configurable: { thread_id: "thread", checkpoint_ns: "", checkpoint_id: "0001" } }, [["delta", "one"]], "task-1");
    await saver.put({ configurable: { thread_id: "thread", checkpoint_id: "0001" } }, checkpoint("0002"), {});
    await saver.putWrites({ configurable: { thread_id: "thread", checkpoint_ns: "", checkpoint_id: "0002" } }, [["delta", "two"]], "task-2");
    await saver.put({ configurable: { thread_id: "thread", checkpoint_id: "0002" } }, checkpoint("0003"), {});

    const history = await new DurableFileSaver(directory).getDeltaChannelHistory({
      config: { configurable: { thread_id: "thread", checkpoint_id: "0003" } },
      channels: ["delta"],
    });
    expect(history.delta).toEqual({ seed: "seed", writes: [["task-1", "delta", "one"], ["task-2", "delta", "two"]] });
  });

  it("loads the legacy snapshot format and converts it on the next write", async () => {
    const directory = temporaryDirectory();
    const memory = new MemorySaver();
    await memory.put({ configurable: { thread_id: "legacy" } }, checkpoint("0001", { value: "old" }), {});
    const legacy = { threadId: "legacy", storage: memory.storage.legacy, writes: memory.writes };
    fs.writeFileSync(fileFor(directory, "legacy"), JSON.stringify(legacy, (_key, value) => value instanceof Uint8Array ? { __langgraphBytes: Buffer.from(value).toString("base64") } : value));

    const saver = new DurableFileSaver(directory);
    expect((await saver.getTuple({ configurable: { thread_id: "legacy" } }))?.checkpoint.id).toBe("0001");
    await saver.put({ configurable: { thread_id: "legacy", checkpoint_id: "0001" } }, checkpoint("0002", { value: "new" }), {});

    const records = fs.readFileSync(fileFor(directory, "legacy"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records[0]).toEqual({ format: "neolit-checkpoints", version: 1, threadId: "legacy" });
    expect(records.filter((record) => record.type === "checkpoint").map((record) => record.checkpointId)).toEqual(["0001", "0002"]);
  });

  it("does not replace loaded state when a reload fails", async () => {
    const directory = temporaryDirectory();
    const saver = new DurableFileSaver(directory);
    await saver.put({ configurable: { thread_id: "thread" } }, checkpoint("0001", { value: "safe" }), {});
    const file = fileFor(directory, "thread");
    const valid = fs.readFileSync(file);
    fs.writeFileSync(file, '{"format":"neolit-checkpoints","version":1,"threadId":"thread"}\nnot-json\n');

    await expect(saver.getTuple({ configurable: { thread_id: "thread" } })).rejects.toThrow();
    fs.writeFileSync(file, valid);
    expect((await saver.getTuple({ configurable: { thread_id: "thread" } }))?.checkpoint.channel_values).toEqual({ value: "safe" });
  });

  it("invalidates another saver's cached thread after deletion", async () => {
    const directory = temporaryDirectory();
    const writer = new DurableFileSaver(directory);
    const reader = new DurableFileSaver(directory);
    await writer.put({ configurable: { thread_id: "thread" } }, checkpoint("0001"), {});
    expect(await reader.getTuple({ configurable: { thread_id: "thread" } })).toBeDefined();
    await writer.deleteThread("thread");
    expect(await reader.getTuple({ configurable: { thread_id: "thread" } })).toBeUndefined();
  });

  it("invalidates deleted cached threads during unscoped listing", async () => {
    const directory = temporaryDirectory();
    const writer = new DurableFileSaver(directory);
    const reader = new DurableFileSaver(directory);
    await writer.put({ configurable: { thread_id: "thread" } }, checkpoint("0001"), {});
    for await (const _tuple of reader.list({ configurable: {} })) { /* populate cache */ }
    await writer.deleteThread("thread");
    const listed = [];
    for await (const tuple of reader.list({ configurable: {} })) listed.push(tuple);
    expect(listed).toEqual([]);
  });
});
