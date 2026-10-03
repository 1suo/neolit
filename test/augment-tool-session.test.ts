import { describe, expect, it } from "vitest";
import { formatStreamEvent } from "../src/tui/tool-session.js";

function toolPart(status: string, title: string, input: unknown) {
  return { type: "tool", part: { type: "tool", state: { status, title, input } } };
}

describe("formatStreamEvent", () => {
  it("carries the call's key argument on completed and failed tools", () => {
    expect(formatStreamEvent(toolPart("completed", "execute", { command: "git status --short" })))
      .toEqual({ kind: "tool", text: "✓ execute · git status --short" });
    expect(formatStreamEvent(toolPart("error", "execute", { command: "git push" })))
      .toEqual({ kind: "tool", text: "✗ execute · git push" });
  });

  it("prefers the naming argument across common tool shapes", () => {
    expect(formatStreamEvent(toolPart("completed", "read", { path: "src/tui/controller.ts", encoding: "utf8" })))
      .toEqual({ kind: "tool", text: "✓ read · src/tui/controller.ts" });
    expect(formatStreamEvent(toolPart("completed", "glob", { pattern: "src/**/*.ts", path: "." })))
      .toEqual({ kind: "tool", text: "✓ glob · src/**/*.ts" });
    expect(formatStreamEvent(toolPart("completed", "grep", { query: "retryPolicy", path: "src/" })))
      .toEqual({ kind: "tool", text: "✓ grep · retryPolicy" });
  });

  it("falls back to compact JSON for unknown shapes and marks truncation", () => {
    expect(formatStreamEvent(toolPart("completed", "edit", { weird: true, nested: { a: 1 } })))
      .toEqual({ kind: "tool", text: '✓ edit · {"weird":true,"nested":{"a":1}}' });
    const long = formatStreamEvent(toolPart("completed", "execute", { command: "x".repeat(300) }));
    expect(long!.text.endsWith("…")).toBe(true);
    expect(long!.text.length).toBe("✓ execute · ".length + 200 + 1);
  });

  it("prefers the code argument over the JSON envelope", () => {
    const line = formatStreamEvent(toolPart("completed", "execute", { code: 'const x = await tools.neolit.plan_status({\n  taskId: "task:1",\n});' }));
    expect(line).toEqual({ kind: "tool", text: "✓ execute · const x = await tools.neolit.plan_status({ taskId: \"task:1\", });" });
  });

  it("caps long text at 400 characters with a visible ellipsis", () => {
    const line = formatStreamEvent({ type: "text", text: "y".repeat(500) });
    expect(line!.text.length).toBe(401);
    expect(line!.text.endsWith("…")).toBe(true);
  });

  it("keeps the running marker and survives missing input", () => {
    expect(formatStreamEvent(toolPart("running", "write", { path: "a.ts" })))
      .toEqual({ kind: "tool", text: "→ write · a.ts" });
    expect(formatStreamEvent(toolPart("completed", "tool", undefined)))
      .toEqual({ kind: "tool", text: "✓ tool" });
    expect(formatStreamEvent(toolPart("completed", "tool", { command: "   " })))
      .toEqual({ kind: "tool", text: "✓ tool" });
  });

  it("maps the non-tool event shapes unchanged", () => {
    expect(formatStreamEvent({ type: "step_start" })).toEqual({ kind: "step", text: "▸ step" });
    expect(formatStreamEvent({ type: "error", message: "boom" })).toEqual({ kind: "error", text: "✗ boom" });
    expect(formatStreamEvent({ type: "text", text: "hello\nworld" })).toEqual({ kind: "text", text: "hello world" });
    expect(formatStreamEvent({ type: "whatever" })).toBeUndefined();
    expect(formatStreamEvent(undefined)).toBeUndefined();
  });
});
