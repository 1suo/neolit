import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { filterItems, pickerWindow, selectFromList, toPickerItems } from "../src/tui/setup.js";

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

describe("picker interaction fixes", () => {
  it("collapses duplicate catalog model ids into unique items", () => {
    const items = toPickerItems(["space-bunny-free", "glm-flash", "space-bunny-free", "space-bunny-free"]);
    expect(items.map((item) => item.id)).toEqual(["space-bunny-free", "glm-flash"]);
  });

  it("lets j and k reach the filter instead of moving the cursor", async () => {
    const { render: renderInk, cleanup } = await import("ink-testing-library");
    const React = (await import("react")).default;
    const Picker = (await import("../src/tui/setup.js")).Picker;
    const instance = renderInk(React.createElement(Picker, {
      title: "pick",
      items: [
        { id: "oak", label: "oak" },
        { id: "jk-rowling", label: "jk-rowling" },
      ],
      onDone: () => {},
    }));
    instance.stdin.write("j");
    instance.stdin.write("k");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(instance.lastFrame()).toContain("filter:");
    expect(instance.lastFrame()).toContain("jk");
    expect(instance.lastFrame()).toContain("jk-rowling");
    instance.stdin.write("\u001b"); // Esc clears the filter first…
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(instance.lastFrame()).toContain("oak");
    instance.unmount();
    cleanup();
  });
});
