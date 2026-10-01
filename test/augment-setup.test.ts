import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { filterItems, pickerWindow, selectFromList } from "../src/tui/setup.js";

describe("setup picker", () => {
  it("filters items across id, label, and hint", () => {
    const items = [
      { id: "opencode/space-bunny-free", label: "space-bunny-free", hint: "free tier" },
      { id: "sonnet", label: "sonnet", hint: "balanced" },
      { id: "opus", label: "opus", hint: "heavy" },
    ];
    expect(filterItems(items, "free").map((item) => item.id)).toEqual(["opencode/space-bunny-free"]);
    expect(filterItems(items, "OPUS").map((item) => item.id)).toEqual(["opus"]);
    expect(filterItems(items, "").length).toBe(3);
  });

  it("windows long lists around the cursor", () => {
    expect(pickerWindow(5, 0)).toEqual({ start: 0, end: 5 });
    const { start, end } = pickerWindow(100, 50);
    expect(end - start).toBe(16);
    expect(start).toBeLessThanOrEqual(50);
    expect(end).toBeGreaterThan(50);
  });

  it("falls back to numbered selection on non-TTY streams", async () => {
    const input = new Readable({ read() {} });
    const promise = selectFromList({
      title: "Agent",
      items: [
        { id: "opencode", label: "opencode" },
        { id: "claude", label: "claude" },
      ],
      input,
    });
    await new Promise((resolve) => setImmediate(resolve));
    input.push("2\n");
    await expect(promise).resolves.toBe("claude");
  });
});
