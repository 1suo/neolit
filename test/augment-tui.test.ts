import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "ink";
import { extractAssistantText, extractJsonOnly, OpenCodeCliRuntime } from "../src/tui/opencode-runtime.js";
import { AugmentTuiController, plannedTreeRows } from "../src/tui/controller.js";
import { AugmentTui } from "../src/tui/augment.js";
import type { ModelCallRequest, ModelRuntime } from "../src/augment/types.js";

const temporaryFiles: string[] = [];
afterEach(() => {
  for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true });
});

function fakeOpenCode(): string {
  const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
  fs.writeFileSync(file, "#!/bin/sh\ncat <<'JSON'\n{\"type\":\"message\",\"parts\":[{\"type\":\"text\",\"text\":\"{\\\"kind\\\":\\\"accept\\\"}\"}]}\nJSON\n");
  fs.chmodSync(file, 0o755);
  temporaryFiles.push(file);
  return file;
}

function modelRuntime(): ModelRuntime {
  return {
    async call(request: ModelCallRequest) {
      if (request.operation === "generate-domain") {
        return { value: { candidates: [{ label: "Fixed retry count", rationale: "Smallest change", confidence: 78, touchedPaths: ["src/auth/session.ts"] }] } };
      }
      if (request.operation === "challenge-domain") return { value: { kind: "accept" } };
      if (request.operation === "refine-node") {
        return {
          value: {
            children: [
              { kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "retry cutoff", obligations: [{ kind: "test", description: "focused retry test" }] },
              { kind: "file", path: "test/auth/retry.test.ts", lod: "hunk", reason: "verify retry cutoff" },
            ],
          },
        };
      }
      if (request.operation === "draft-patch") return { value: { patch: "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n", assumptions: [] } };
      throw new Error(`unexpected operation ${request.operation}`);
    },
  };
}

describe("augment TUI controller", () => {
  it("drives the full planned tree through the in-process server", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("make retries bounded", "commit:1");
    expect(controller.snapshot().task?.objective).toBe("make retries bounded");

    await controller.crystallize();
    let state = controller.snapshot();
    expect(state.rows.map((row) => row.id)).not.toContain("entry:src/auth/session.ts");
    expect(state.rows.some((row) => row.repositoryOnly)).toBe(true);

    const candidateId = state.task!.nodes[state.task!.rootNodeId]!.candidateIds[0]!;
    await controller.selectCandidate(candidateId);
    expect(controller.snapshot().task?.nodes[controller.snapshot().task!.rootNodeId]).toMatchObject({ status: "collapsed" });
    expect(controller.snapshot().rows.map((row) => row.id)).toContain("entry:src/auth/session.ts");

    await controller.refine();
    state = controller.snapshot();
    expect(state.rows.map((row) => row.id)).toContain("entry:src/auth/session.ts");
    expect(state.rows.map((row) => row.id)).toContain("entry:test/auth/retry.test.ts");

    controller.select("entry:src/auth/session.ts");
    await controller.draftPatch();
    const patched = controller.snapshot();
    expect(Object.values(patched.task?.diffs ?? {})).toHaveLength(1);
    expect(Object.values(patched.task?.diffs ?? {})[0]).toMatchObject({ kind: "modify", path: "src/auth/session.ts" });
    expect(patched.error).toBeUndefined();
    expect(patched.message).toContain("Draft change ready");
  });

  it("shows the complete repository tree and enforces path locks", async () => {
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "generate-domain") {
          return { value: { candidates: [{ label: "Edit package", rationale: "forbidden", confidence: 90, touchedPaths: ["package.json"] }] } };
        }
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("change package metadata", "commit:1");
    const initial = controller.snapshot();
    expect(initial.rows.map((row) => row.id)).toContain("entry:src/augment/state.ts");
    expect(initial.rows.map((row) => row.id)).toContain("entry:package.json");
    expect(initial.rows.find((row) => row.id === "entry:src/augment/state.ts")?.repositoryOnly).toBe(true);

    controller.select("entry:package.json");
    await controller.toggleLock();
    expect(controller.snapshot().task?.lockedPaths).toEqual(["package.json"]);
    await controller.crystallize();
    expect(controller.snapshot().error).toContain("touches locked path");

    await controller.toggleLock();
    expect(controller.snapshot().task?.lockedPaths).toEqual([]);
    await controller.crystallize();
    expect(controller.snapshot().error).toBeUndefined();
  });

  it("keeps selection stable when possible and reports action errors", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("bounded retries", "commit:1");
    await controller.constrain("Preserve the public API");
    const constrained = controller.snapshot();
    expect(Object.values(constrained.task?.constraints ?? {})[0]).toMatchObject({ text: "Preserve the public API", source: "user" });

    await controller.draftPatch();
    expect(controller.snapshot().error).toContain("A patch must target a file, hunk, or virtual node");
  });

  it("carries path messages into descendant patch context", async () => {
    const patchConstraints: unknown[] = [];
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "draft-patch") patchConstraints.push(request.context.constraints);
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.constrain("Preserve the public API.");
    await controller.refine();
    controller.select("entry:src/auth/session.ts");
    await controller.draftPatch();
    expect(patchConstraints.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Preserve the public API." }),
    ]));
  });

  it("regenerates only the selected path subtree from a message", async () => {
    const generatedNodeIds: string[] = [];
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "generate-domain") generatedNodeIds.push(request.context.node.id);
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    const fileNode = Object.values(controller.snapshot().task!.nodes).find((node) => node.path === "src/auth/session.ts")!;
    controller.select("entry:src/auth/session.ts");
    await controller.constrain("Preserve the retry API.");
    expect(generatedNodeIds).toEqual([task.rootNodeId, fileNode.id]);
    expect(controller.snapshot().task?.nodes[fileNode.id]).toMatchObject({ status: "domain" });
  });

  it("projects candidates and patches under their filesystem entries", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const crystallized = controller.snapshot().task!;
    const candidateId = crystallized.nodes[crystallized.rootNodeId]!.candidateIds[0]!;
    await controller.selectCandidate(candidateId);
    await controller.refine();
    controller.select("entry:src/auth/session.ts");
    await controller.draftPatch();
    expect(controller.snapshot().error).toBeUndefined();
    const rows = plannedTreeRows(controller.snapshot().task!);
    const rootIndex = rows.findIndex((row) => row.id === "entry:.");
    const dirIndex = rows.findIndex((row) => row.id === "entry:src/auth");
    const fileIndex = rows.findIndex((row) => row.id === "entry:src/auth/session.ts");
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    expect(dirIndex).toBeGreaterThan(rootIndex);
    expect(fileIndex).toBeGreaterThan(dirIndex);
    expect(rows.every((row) => row.kind === "entry")).toBe(true);
    expect(Object.keys(controller.snapshot().task?.diffs ?? {})).toHaveLength(1);
    void crystallized;
  });
});

describe("augment TUI rendering", () => {
  it("reports a running operation immediately instead of appearing idle", async () => {
    const runtime: ModelRuntime = {
      call: async () => {
        expect(controller.snapshot()).toMatchObject({ busy: true, operation: "Generating approaches" });
        return { value: { candidates: [{ label: "Only", rationale: "one", confidence: 80, touchedPaths: ["src/a.ts"] }] } };
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("objective", "commit:1");
    const operation = controller.crystallize();
    expect(controller.snapshot()).toMatchObject({ busy: true, operation: "Generating approaches" });
    await operation;
    expect(controller.snapshot()).toMatchObject({ busy: false, operation: undefined });
  });

  it("renders the initial planned-tree layout without a model runtime", () => {
    const controller = new AugmentTuiController({ directory: process.cwd() });
    const output = renderToString(React.createElement(AugmentTui, { controller, modelAvailable: false }));
    expect(output).toContain("NEOLIT");
    expect(output).toContain("FILES");
    expect(output).toContain("SELECTED PATH");
    expect(output).toContain("NO MODEL");
    expect(output).toContain("package.json");
    expect(output).toContain("augment/");
    expect(output).toContain("unchanged");
    expect(output).toContain("Press [N] to describe a change.");
  });
});

describe("OpenCode CLI runtime parsing", () => {
  it("calls the configured OpenCode-compatible command and returns its typed JSON", async () => {
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: fakeOpenCode(), timeoutMs: 5_000 });
    await expect(runtime.call({
      operation: "challenge-domain",
      context: {
        taskId: "task:1",
        taskRevision: 1,
        objective: "objective",
        basisRevision: "commit:1",
        node: {} as never,
        candidates: [],
        constraints: [],
        obligations: [],
        diffs: [],
        lockedPaths: [],
        rejectedCandidates: [],
      },
      temperature: "normal",
      lod: "file",
    })).resolves.toMatchObject({ value: { kind: "accept" }, text: '{"kind":"accept"}' });
  });

  it("extracts assistant text from JSON event output", () => {
    const output = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"kind\":\"accept\"}" }] });
    expect(extractAssistantText(output)).toBe('{"kind":"accept"}');
  });

  it("rejects OpenCode JSON errors", () => {
    const output = JSON.stringify({ type: "error", error: { message: "quota exceeded" } });
    expect(() => extractAssistantText(output)).toThrow(/quota exceeded/u);
  });

  it("extracts one JSON object even when the model adds prose", () => {
    expect(extractJsonOnly('Here it is:\n```json\n{"kind":"accept"}\n```\n')).toEqual({ kind: "accept" });
    expect(extractJsonOnly('prefix {"patch":"diff"} suffix')).toEqual({ patch: "diff" });
    expect(extractJsonOnly("no object")).toBeUndefined();
  });
});
