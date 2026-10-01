import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "ink";
import { cleanup, render as renderInk } from "ink-testing-library";
import { extractAssistantText, extractJsonOnly, OpenCodeCliRuntime } from "../src/tui/opencode-runtime.js";
import { AugmentTuiController, plannedTreeRows } from "../src/tui/controller.js";
import { AugmentTui, tuiRenderOptions } from "../src/tui/augment.js";
import { detailLines, frameLayout } from "../src/tui/detail.js";
import { configFromEnvironment, effectiveConfig, loadAugmentConfig, saveAugmentConfig } from "../src/tui/config.js";
import type { ModelCallRequest, ModelRuntime } from "../src/augment/types.js";

const temporaryFiles: string[] = [];
const temporaryDirectories: string[] = [];
const isolatedStateHome = fs.mkdtempSync(path.join(os.tmpdir(), "augment-state-"));
temporaryDirectories.push(isolatedStateHome);
process.env.XDG_STATE_HOME = isolatedStateHome;
afterEach(() => {
  cleanup();
  for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true });
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fakeOpenCode(output = "{\"type\":\"message\",\"parts\":[{\"type\":\"text\",\"text\":\"{\\\"kind\\\":\\\"accept\\\"}\"}]}"): string {
  const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
  fs.writeFileSync(file, `#!/bin/sh\ncat <<'JSON'\n${output}\nJSON\n`);
  fs.chmodSync(file, 0o755);
  temporaryFiles.push(file);
  return file;
}

function tempGitRepo(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "augment-apply-"));
  temporaryDirectories.push(directory);
  const git = (args: string[]) => execFileSync("git", ["-C", directory, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  fs.writeFileSync(path.join(directory, "session.ts"), "alpha\nbeta\n");
  git(["add", "session.ts"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=test", "commit", "-q", "-m", "init"]);
  return directory;
}

function singleFileRuntime(patch: string): ModelRuntime {
  return {
    async call(request: ModelCallRequest) {
      if (request.operation === "generate-domain") {
        return { value: { candidates: [{ label: "Edit session", rationale: "direct edit", confidence: 80, touchedPaths: ["session.ts"] }] } };
      }
      if (request.operation === "challenge-domain") return { value: { kind: "accept" } };
      if (request.operation === "refine-node") {
        return { value: { children: [{ kind: "file", path: "session.ts", lod: "hunk", reason: "apply the edit" }] } };
      }
      if (request.operation === "draft-patch") return { value: { patch, assumptions: [] } };
      throw new Error(`unexpected operation ${request.operation}`);
    },
  };
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
      if (request.operation === "draft-patch") {
        const path = request.context.node.path ?? "src/auth/session.ts";
        return { value: { patch: `--- a/${path}\n+++ b/${path}\n`, assumptions: [] } };
      }
      if (request.operation === "explain-project") {
        return {
          value: {
            topic: "retry policy",
            entries: [
              { path: "src/augment/state.ts", role: "primary", summary: "Owns planned state.", detail: "It stores tasks, candidates, locks, and planned diffs.", confidence: 92 },
              { path: "src/augment", role: "supporting", summary: "Core planning subsystem.", detail: "Contains the planned-diff state machine and model contracts.", confidence: 88 },
            ],
          },
        };
      }
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
    expect(state.rows.map((row) => row.id)).toContain("entry:src/auth/session.ts");
    expect(state.rows.some((row) => row.repositoryOnly)).toBe(true);

    expect(state.message).toBe("Single viable approach adopted. Press D to develop it into files.");
    expect(state.task?.nodes[state.task!.rootNodeId]).toMatchObject({ status: "collapsed" });
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

    const fileOutput = renderToString(React.createElement(AugmentTui, { controller, modelAvailable: true }));
    expect(fileOutput).toContain("CHANGES");
    expect(fileOutput).not.toContain("EXACT DIFF");
    expect(fileOutput).not.toContain("APPROACHES");
    expect(fileOutput).toContain("--- a/src/auth/session.ts");
  });

  it("shows the complete repository tree and enforces path locks", async () => {    const runtime: ModelRuntime = {
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
    await controller.toggleRestriction("lock");
    expect(controller.snapshot().task?.lockedPaths).toEqual(["package.json"]);
    await controller.crystallize();
    expect(controller.snapshot().error).toContain("touches locked path");

    await controller.toggleRestriction("lock");
    expect(controller.snapshot().task?.lockedPaths).toEqual([]);
    await controller.crystallize();
    expect(controller.snapshot().error).toBeUndefined();
  });

  it("locks paths before a task starts and constrains the first model run", async () => {
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "generate-domain") {
          return { value: { candidates: [{ label: "Edit package", rationale: "forbidden", confidence: 90, touchedPaths: ["package.json"] }] } };
        }
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    controller.select("entry:package.json");
    await controller.toggleRestriction("lock");
    let snapshot = controller.snapshot();
    expect(snapshot.task).toBeUndefined();
    expect(snapshot.pendingMarks).toEqual(["package.json"]);

    await controller.toggleRestriction("lock");
    expect(controller.snapshot().pendingMarks).toEqual([]);
    await controller.toggleRestriction("lock");
    expect(controller.snapshot().pendingMarks).toEqual(["package.json"]);

    await controller.start("change package metadata", "commit:1");
    snapshot = controller.snapshot();
    expect(snapshot.pendingMarks).toEqual([]);
    expect(snapshot.task?.lockedPaths).toEqual(["package.json"]);
    await controller.crystallize();
    expect(controller.snapshot().error).toContain("touches locked path");
  });

  it("tracks the active and failed node of model operations", async () => {
    let fail = true;
    let gate: Promise<void> = Promise.resolve();
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "generate-domain") {
          await gate;
          if (fail) throw new Error("model exploded");
          return { value: { candidates: [{ label: "Fixed retry count", rationale: "Smallest change", confidence: 78, touchedPaths: ["src/auth/session.ts"] }] } };
        }
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const failed = controller.snapshot();
    expect(failed.failed).toMatchObject({ operation: "Generating approaches", nodeId: failed.task!.rootNodeId, error: expect.stringContaining("model exploded") });
    expect(failed.active).toBeUndefined();

    fail = false;
    let releaseRetry!: () => void;
    gate = new Promise<void>((resolve) => { releaseRetry = resolve; });
    const retry = controller.crystallize();
    const inFlight = controller.snapshot();
    expect(inFlight.active).toMatchObject({ operation: "Generating approaches", nodeId: inFlight.task!.rootNodeId });
    expect(inFlight.failed?.nodeId).toBe(inFlight.task!.rootNodeId);
    releaseRetry();
    await retry;
    const recovered = controller.snapshot();
    expect(recovered.active).toBeUndefined();
    expect(recovered.failed).toBeUndefined();
  });

  it("skips challenge rounds when AUGMENT_CHALLENGE_ROUNDS is zero", async () => {
    process.env.AUGMENT_CHALLENGE_ROUNDS = "0";
    try {
      const operations: string[] = [];
      const runtime: ModelRuntime = {
        call: async (request) => {
          operations.push(request.operation);
          return modelRuntime().call(request);
        },
      };
      const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
      await controller.start("bounded retries", "commit:1");
      await controller.crystallize();
      expect(operations).toEqual(["generate-domain"]);
      const node = controller.snapshot().task!.nodes[controller.snapshot().task!.rootNodeId]!;
      expect(node.status).toBe("domain");
      expect(node.challengeExhausted).toBe(false);
    } finally {
      delete process.env.AUGMENT_CHALLENGE_ROUNDS;
    }
  });

  it("enforces one restriction plain: marks, polarity, and inversion", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    controller.select("entry:src/augment");
    await controller.toggleRestriction("allow");
    expect(controller.snapshot().pendingMarks).toEqual(["src/augment"]);
    expect(controller.snapshot().pendingMode).toBe("allow");
    await controller.start("bounded retries", "commit:1");
    expect(controller.snapshot().task?.restrictionMode).toBe("allow");
    expect(controller.snapshot().task?.lockedPaths).toEqual(["src/augment"]);
    await controller.crystallize();
    expect(controller.snapshot().error).toContain("escapes the allowed paths");

    await controller.toggleRestriction("lock");
    expect(controller.snapshot().task?.restrictionMode).toBe("lock");
    expect(controller.snapshot().task?.lockedPaths).toEqual(["src/augment"]);
    await controller.rethink();
    expect(controller.snapshot().error).toBeUndefined();
    expect(controller.snapshot().task?.nodes[controller.snapshot().task!.rootNodeId]).toMatchObject({ status: "collapsed" });
  });

  it("persists the active task and resumes it in a new controller", async () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "augment-state-"));
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = state;
    try {
      const first = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime(), persistTasks: true });
      await first.start("bounded retries", "commit:1");
      await first.crystallize();
      const second = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime(), persistTasks: true });
      const snapshot = second.snapshot();
      expect(snapshot.message).toContain("Resumed task: bounded retries");
      expect(snapshot.task?.objective).toBe("bounded retries");
      expect(snapshot.task?.nodes[snapshot.task!.rootNodeId]).toMatchObject({ status: "collapsed" });
      expect(JSON.parse(fs.readFileSync(path.join(state, "neolit", "augment-tasks.json"), "utf8"))).toHaveLength(1);
      await second.develop();
      expect(second.snapshot().error).toBeUndefined();
      expect(Object.values(second.snapshot().task?.nodes ?? {}).some((node) => node.kind === "file")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
    }
  });

  it("explains the selected node inside an active change task", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    await controller.develop();
    controller.select("entry:src/auth/session.ts");
    await controller.explain("retry policy");
    const snapshot = controller.snapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.task?.mode).toBe("change");
    expect(Object.keys(snapshot.task?.explanations ?? {})).toHaveLength(2);
    expect(snapshot.message).toContain("Explained 2 paths around src/auth/session.ts");
  });

  it("aggregates directory changes and shows descendant exact patches", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    controller.select("entry:src/auth/session.ts");
    await controller.draftPatch();
    controller.select("entry:src");
    const directory = controller.snapshot().rows.find((row) => row.id === "entry:src");
    expect(directory?.entry.diffIds).toHaveLength(1);

    const detail = detailLines(controller.snapshot().task, directory);
    const lines = detail.map((line) => line.text);
    expect(lines.some((line) => line.includes("auth/") && line.includes("retry cutoff"))).toBe(true);
    expect(lines).toContain("CHANGES");
    expect(lines).toContain("1 changed");
    expect(lines.some((line) => line.includes("retry cutoff"))).toBe(true);
    expect(lines.some((line) => line.includes("session.ts"))).toBe(true);
    expect(lines.some((line) => line.includes("--- a/src/auth/session.ts"))).toBe(true);
    expect(lines).not.toContain("APPROACHES");
    expect(lines.filter((line) => line === "DESCRIPTION" || line === "CHANGES" || line === "KEYS")).toEqual(["DESCRIPTION", "CHANGES"]);

    const output = renderToString(React.createElement(AugmentTui, { controller, modelAvailable: true }));
    expect(output).toContain("DESCRIPTION");
    expect(output).toContain("--- a/src/auth/session.ts");
  });

  it("highlights explained files and directories with selected-path details", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.startExplanation("retry policy");
    const state = controller.snapshot();
    expect(state.task?.mode).toBe("explanation");
    expect(state.rows.find((row) => row.id === "entry:src/augment/state.ts")?.repositoryOnly).toBe(false);
    expect(state.rows.find((row) => row.id === "entry:src/augment")?.repositoryOnly).toBe(false);

    controller.select("entry:src/augment");
    const output = renderToString(React.createElement(AugmentTui, { controller, modelAvailable: true }));
    expect(output).toContain("EXPLANATION");
    expect(output).toContain("Owns planned state.");
    expect(output).toContain("Core planning subsystem.");
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

  it("develops a path one step at a time: refine, then draft", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    controller.select("entry:.");
    await controller.develop();
    expect(controller.snapshot().task?.nodes[controller.snapshot().task!.rootNodeId]).toMatchObject({ status: "refined" });
    controller.select("entry:src/auth/session.ts");
    await controller.develop();
    const snapshot = controller.snapshot();
    expect(Object.keys(snapshot.task?.diffs ?? {})).toHaveLength(1);
    await controller.develop();
    expect(controller.snapshot().error).toContain("already has a drafted patch");
  });

  it("targets the folder's own node when regenerating a folder row", async () => {
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "generate-domain") {
          return { value: { candidates: [{ label: "Direct edit", rationale: "one family", confidence: 75, touchedPaths: ["test/new-file.test.ts"] }] } };
        }
        if (request.operation === "challenge-domain") return { value: { kind: "accept" } };
        if (request.operation === "refine-node") {
          if (request.context.node.path === ".") {
            return { value: { children: [{ kind: "dir", path: "test", lod: "file", reason: "tests" }] } };
          }
          return { value: { children: [{ kind: "file", path: "test/existing.test.ts", lod: "hunk", reason: "extend" }] } };
        }
        throw new Error(`unexpected operation ${request.operation}`);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("split tests", "commit:1");
    await controller.crystallize();
    controller.select("entry:.");
    await controller.develop();
    controller.select("entry:test");
    await controller.develop();
    controller.select("entry:test");
    await controller.rethink();
    const snapshot = controller.snapshot();
    expect(snapshot.error).toBeUndefined();
    const testNode = Object.values(snapshot.task?.nodes ?? {}).find((node) => node.path === "test")!;
    expect(testNode.status).toBe("collapsed");
    expect(Object.values(snapshot.task?.constraints ?? {}).some((constraint) => constraint.text.includes("Out-of-scope"))).toBe(false);
    expect(Object.values(snapshot.task?.nodes ?? {}).some((node) => node.path === "test/existing.test.ts")).toBe(false);
  });

  it("develops through refined directories: crystallize the next undrafted dir, then refine and draft it", async () => {
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "generate-domain") {
          return { value: { candidates: [{ label: "Direct edit", rationale: "one family", confidence: 75, touchedPaths: ["src/auth/session.ts"] }] } };
        }
        if (request.operation === "challenge-domain") return { value: { kind: "accept" } };
        if (request.operation === "refine-node") {
          const parent = request.context.node.path;
          if (parent === ".") {
            return { value: { children: [
              { kind: "dir", path: "src/auth", lod: "file", reason: "owns the session work" },
              { kind: "file", path: "TODO-augment.md", lod: "file", reason: "track the gap" },
            ] } };
          }
          return { value: { children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "retry cutoff" }] } };
        }
        if (request.operation === "draft-patch") {
          const path = request.context.node.path ?? "src/auth/session.ts";
          return { value: { patch: `--- a/${path}\n+++ b/${path}\n`, assumptions: [] } };
        }
        throw new Error(`unexpected operation ${request.operation}`);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    controller.select("entry:.");
    await controller.develop();
    expect(controller.snapshot().task?.nodes[controller.snapshot().task!.rootNodeId]).toMatchObject({ status: "refined" });
    expect(controller.snapshot().selectedRowId).toBe("entry:src/auth");
    await controller.develop();
    expect(controller.snapshot().message ?? controller.snapshot().error).toContain("Single viable approach adopted");
    await controller.develop();
    expect(controller.snapshot().selectedRowId).toBe("entry:src/auth/session.ts");
    await controller.develop();
    expect(Object.keys(controller.snapshot().task?.diffs ?? {})).toHaveLength(1);
    controller.select("entry:.");
    await controller.develop();
    expect(controller.snapshot().selectedRowId).toBe("entry:TODO-augment.md");
    expect(Object.keys(controller.snapshot().task?.diffs ?? {})).toHaveLength(2);
    controller.select("entry:.");
    await controller.develop();
    expect(controller.snapshot().error).toContain("Every file under this path is drafted");
  });

  it("tells the user to choose an approach before refining a domain path", async () => {
    const twoCandidates: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "generate-domain") {
          return {
            value: {
              candidates: [
                { label: "First approach", rationale: "one family", confidence: 70, touchedPaths: ["src/auth/session.ts"] },
                { label: "Second approach", rationale: "another family", confidence: 60, touchedPaths: ["src/auth/session.ts"] },
              ],
            },
          };
        }
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: twoCandidates });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    expect(task.nodes[task.rootNodeId]).toMatchObject({ status: "domain" });
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    const fileNode = Object.values(controller.snapshot().task!.nodes).find((node) => node.path === "src/auth/session.ts")!;
    controller.select("entry:src/auth/session.ts");
    await controller.constrain("Preserve the retry API.");
    expect(controller.snapshot().task?.nodes[fileNode.id]).toMatchObject({ status: "domain" });
    await controller.refine();
    expect(controller.snapshot().error).toBe("This path has 2 approaches — choose one with keys 1-7, then press D to develop it.");
    expect(controller.snapshot().task?.nodes[fileNode.id]).toMatchObject({ status: "domain" });
  });

  it("carries already-drafted task diffs into later draft context", async () => {
    const draftContexts: unknown[] = [];
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "draft-patch") draftContexts.push(request.context);
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    controller.select("entry:src/auth/session.ts");
    await controller.draftPatch();
    controller.select("entry:test/auth/retry.test.ts");
    await controller.draftPatch();
    expect(draftContexts).toHaveLength(2);
    const second = draftContexts[1] as { taskDiffs: Array<{ path: string }>; taskTree: Array<{ path: string; drafted: boolean }> };
    expect(second.taskDiffs.map((diff) => diff.path)).toEqual(["src/auth/session.ts"]);
    expect(second.taskTree.some((entry) => entry.path === "src/auth/session.ts" && entry.drafted)).toBe(true);
  });

  it("rethinks with an optional guiding message persisted as a constraint", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    await controller.rethink("avoid touching the kernel scheduler");
    const snapshot = controller.snapshot();
    expect(snapshot.error).toBeUndefined();
    expect(Object.values(snapshot.task?.constraints ?? {}).some((constraint) => constraint.text.includes("avoid touching the kernel scheduler"))).toBe(true);
    expect(snapshot.task?.nodes[snapshot.task!.rootNodeId]).toMatchObject({ status: "collapsed" });
    expect(snapshot.message).toContain("regenerated from your note");
    await controller.rethink();
    expect(controller.snapshot().message).toBe("Approaches regenerated; single viable approach adopted. Press D to develop it.");
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
    await controller.refine();
    const fileNode = Object.values(controller.snapshot().task!.nodes).find((node) => node.path === "src/auth/session.ts")!;
    controller.select("entry:src/auth/session.ts");
    await controller.constrain("Preserve the retry API.");
    expect(generatedNodeIds).toEqual([task.rootNodeId, fileNode.id]);
    expect(controller.snapshot().task?.nodes[fileNode.id]).toMatchObject({ status: "collapsed" });
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

describe("augment TUI apply", () => {
  const validPatch = "--- a/session.ts\n+++ b/session.ts\n@@ -1,2 +1,3 @@\n alpha\n+gamma\n beta\n";

  it("applies the selected drafted patch to the working tree", async () => {
    const directory = tempGitRepo();
    const controller = new AugmentTuiController({ directory, runtime: singleFileRuntime(validPatch) });
    await controller.start("edit session");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    controller.select("entry:session.ts");
    await controller.draftPatch();
    await controller.applySelected();
    expect(fs.readFileSync(path.join(directory, "session.ts"), "utf8")).toBe("alpha\ngamma\nbeta\n");
    const snapshot = controller.snapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.message).toContain("Applied 1 drafted change");
    expect(snapshot.appliedDiffIds).toHaveLength(1);
    expect(snapshot.rows.some((row) => row.id === "entry:session.ts")).toBe(true);

    const appliedRow = snapshot.rows.find((row) => row.id === "entry:session.ts");
    const detail = detailLines(snapshot.task, appliedRow, { appliedDiffIds: snapshot.appliedDiffIds }).map((line) => line.text);
    expect(detail.join("\n")).toContain("1 changed ✓");
    expect(detail.some((line) => line.includes("session.ts · changed ✓"))).toBe(true);
    const output = renderToString(React.createElement(AugmentTui, { controller, modelAvailable: true }));
    expect(output).toContain("✓ session.ts");
    expect(output).toContain("Applied 1 drafted change");
  });

  it("commits only the session-applied paths, leaving unrelated work untouched", async () => {
    const directory = tempGitRepo();
    fs.writeFileSync(path.join(directory, "unrelated.txt"), "leave me alone\n");
    const controller = new AugmentTuiController({ directory, runtime: singleFileRuntime("--- a/session.ts\n+++ b/session.ts\n@@ -1,2 +1,3 @@\n alpha\n+gamma\n beta\n") });
    await controller.start("edit session");
    await controller.crystallize();
    await controller.refine();
    controller.select("entry:session.ts");
    await controller.draftPatch();
    await controller.commitApplied();
    expect(controller.snapshot().error).toContain("Nothing applied this session");
    await controller.applySelected();
    await controller.commitApplied();
    const snapshot = controller.snapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.message).toMatch(/Committed 1 applied path as [0-9a-f]+/);
    const subject = execFileSync("git", ["-C", directory, "log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
    expect(subject).toBe("augment: edit session");
    const status = execFileSync("git", ["-C", directory, "status", "--porcelain"], { encoding: "utf8" });
    expect(status).toContain("?? unrelated.txt");
    expect(status).not.toContain("session.ts");
  });

  it("rejects the whole apply when the preflight fails and leaves the tree untouched", async () => {
    const directory = tempGitRepo();
    const brokenPatch = "--- a/session.ts\n+++ b/session.ts\n@@ -1,2 +1,2 @@\n alpha\n-missing\n+delta\n";
    const controller = new AugmentTuiController({ directory, runtime: singleFileRuntime(brokenPatch) });
    await controller.start("edit session");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    controller.select("entry:session.ts");
    await controller.draftPatch();
    await controller.applySelected();
    const snapshot = controller.snapshot();
    expect(snapshot.error).toContain("git apply");
    expect(fs.readFileSync(path.join(directory, "session.ts"), "utf8")).toBe("alpha\nbeta\n");
  });
});

describe("augment TUI rendering", () => {
  // Root padding (2) + header (1) + legend (2) + status line (1) + pane borders (2) + pane label (1).
  const IDLE_PANE_CHROME_ROWS = 11;
  // The bordered input box replaces the one-row status line while typing.
  const TYPING_PANE_CHROME_ROWS = 11;

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

  it("does not crash or open a path message prompt without an active task", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd() });
    const instance = renderInk(React.createElement(AugmentTui, { controller, modelAvailable: false }));
    instance.stdin.write("\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(instance.lastFrame()).toContain("No task is active");
    expect(instance.lastFrame()).not.toContain("Message about selected path");
    instance.unmount();
  });

  it("renders the initial planned-tree layout without a model runtime", () => {
    const controller = new AugmentTuiController({ directory: process.cwd() });
    const output = renderToString(React.createElement(AugmentTui, { controller, modelAvailable: false }));
    expect(output).toContain("NEOLIT");
    expect(output).toContain("FILES");
    expect(output).toContain("NO MODEL");
    expect(output).toContain("package.json");
    expect(output).toContain("augment/");
    expect(output).not.toContain("unchanged");
    expect(output).toContain("Press [N] to describe a change.");
  });

  it("animates the active operation in the tree and preview, then clears it", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "generate-domain") {
          await gate;
          return { value: { candidates: [{ label: "Fixed retry count", rationale: "Smallest change", confidence: 78, touchedPaths: ["src/auth/session.ts"] }] } };
        }
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("bounded retries", "commit:1");
    const instance = renderInk(React.createElement(AugmentTui, { controller, modelAvailable: false }));
    instance.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 30));
    instance.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(instance.lastFrame()).toMatch(/rethinking selected path…/i);
    releaseGate();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(instance.lastFrame()).not.toMatch(/rethinking selected path…/i);
    instance.unmount();
  });

  it("keeps every frame inside the viewport at any terminal height", () => {
    expect(frameLayout(10, "idle")).toEqual({ frameRows: 10, treeRows: 1, detailRows: 1 });
    expect(frameLayout(14, "idle").detailRows).toBe(3);
    expect(frameLayout(40, "idle").detailRows).toBe(29);
    expect(frameLayout(40, "objective").detailRows).toBe(29);
    for (const windowRows of [10, 12, 14, 20, 40]) {
      const idle = frameLayout(windowRows, "idle");
      if (windowRows >= IDLE_PANE_CHROME_ROWS) {
        expect(IDLE_PANE_CHROME_ROWS + Math.max(idle.treeRows, idle.detailRows)).toBeLessThanOrEqual(windowRows);
      } else {
        // Below the panel's own chrome the panes degrade to one row instead of overflowing.
        expect(idle.treeRows).toBe(1);
        expect(idle.detailRows).toBe(1);
      }
      // A 3-row input box plus its chrome cannot fit below TYPING_PANE_CHROME_ROWS,
      // so typing frames are only asserted where they are representable at all.
      if (windowRows < TYPING_PANE_CHROME_ROWS) continue;
      const typing = frameLayout(windowRows, "objective");
      expect(TYPING_PANE_CHROME_ROWS + typing.detailRows).toBeLessThanOrEqual(windowRows);
      expect(typing.treeRows).toBeLessThanOrEqual(idle.treeRows);
    }
    const unknown = frameLayout(undefined, "idle");
    expect(unknown.frameRows).toBeGreaterThan(0);
    expect(IDLE_PANE_CHROME_ROWS + unknown.detailRows).toBeLessThanOrEqual(unknown.frameRows);
  });

  it("paints frames incrementally inside the alternate screen", () => {
    expect(tuiRenderOptions()).toMatchObject({ alternateScreen: true, incrementalRendering: true });
  });

  it("truncates the tallest tree and the longest patch to the pane budget", async () => {
    const patch = [
      "--- a/src/auth/session.ts",
      "+++ b/src/auth/session.ts",
      "@@ -1,2 +1,122 @@",
      " alpha",
      ...Array.from({ length: 120 }, (_, index) => `+added line ${index + 1}`),
    ].join("\n");
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "draft-patch") return { value: { patch, assumptions: [] } };
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    controller.select("entry:src/auth/session.ts");
    await controller.draftPatch();

    const snapshot = controller.snapshot();
    const detail = detailLines(snapshot.task, snapshot.rows.find((item) => item.id === "entry:src/auth/session.ts"));
    for (const windowRows of [12, 14, 20, 40]) {
      const idle = frameLayout(windowRows, "idle");
      expect(detail.length).toBeGreaterThan(idle.detailRows);
      expect(snapshot.rows.length).toBeGreaterThan(idle.treeRows);
      expect(IDLE_PANE_CHROME_ROWS + idle.detailRows).toBeLessThanOrEqual(windowRows);
    }
  });
});

describe("selected-path detail model", () => {
  it("renders the complete patch for a drafted file, not a preview", async () => {
    const patch = [
      "--- a/src/auth/session.ts",
      "+++ b/src/auth/session.ts",
      "@@ -1,4 +1,6 @@",
      ...Array.from({ length: 24 }, (_, index) => `${index % 2 ? "-" : "+"}changed line ${index + 1}`),
      "+final marker line",
    ].join("\n");
    const runtime: ModelRuntime = {
      call: async (request) => {
        if (request.operation === "draft-patch") return { value: { patch, assumptions: [] } };
        return modelRuntime().call(request);
      },
    };
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    controller.select("entry:src/auth/session.ts");
    await controller.draftPatch();

    const row = controller.snapshot().rows.find((item) => item.id === "entry:src/auth/session.ts");
    const lines = detailLines(controller.snapshot().task, row).map((line) => line.text);
    expect(lines).toContain("1 changed · 28 lines · basis commit:1");
    expect(lines).toContain("--- a/src/auth/session.ts");
    expect(lines).toContain("+changed line 1");
    expect(lines).toContain("-changed line 24");
    expect(lines).toContain("+final marker line");
  });

  it("tells the user how to draft a planned file", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    controller.select("entry:src/auth/session.ts");
    const row = controller.snapshot().rows.find((item) => item.id === "entry:src/auth/session.ts");
    const lines = detailLines(controller.snapshot().task, row).map((line) => line.text);
    expect(lines).toContain("DESCRIPTION");
    expect(lines).toContain("  [D] develop — drafts this file's exact patch · [A] apply after");
  });

  it("summarizes folder contents when a directory is selected", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("bounded retries", "commit:1");
    await controller.crystallize();
    const task = controller.snapshot().task!;
    await controller.selectCandidate(task.nodes[task.rootNodeId]!.candidateIds[0]!);
    await controller.refine();
    controller.select("entry:src/auth/session.ts");
    await controller.draftPatch();
    controller.select("entry:src/auth");

    const row = controller.snapshot().rows.find((item) => item.id === "entry:src/auth");
    const lines = detailLines(controller.snapshot().task, row).map((line) => line.text);
    expect(lines.some((line) => line.includes("session.ts") && line.includes("retry cutoff"))).toBe(true);
  });

  it("leads the preview with live operation and failure status", async () => {
    const controller = new AugmentTuiController({ directory: process.cwd(), runtime: modelRuntime() });
    await controller.start("bounded retries", "commit:1");
    const snapshot = controller.snapshot();
    const row = snapshot.rows.find((item) => item.id === "entry:.");
    const rootNodeId = snapshot.task!.rootNodeId;

    const active = detailLines(snapshot.task, row, { live: { spinner: "⠋", active: { nodeId: rootNodeId, operation: "Generating approaches" } } }).map((line) => line.text);
    expect(active[0]).toContain("⠋ Generating approaches…");

    const failed = detailLines(snapshot.task, row, { live: { spinner: "⠋", failed: { nodeId: rootNodeId, operation: "Generating approaches", error: "model exploded\nsecond line" } } }).map((line) => line.text);
    expect(failed[0]).toContain("× Generating approaches failed");
    expect(failed.join("\n")).toContain("model exploded");
    expect(failed.join("\n")).not.toContain("second line");
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

  it("reports likely truncation when the model output never completes the JSON object", async () => {
    const truncated = "I will inspect the files first.\n{\"children\":[{\"path\":\"src/a.ts\",\"kind\":\"file\"";
    const wrapped = JSON.stringify({ type: "message", parts: [{ type: "text", text: truncated }] });
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: fakeOpenCode(wrapped), timeoutMs: 5_000, retries: 0 });
    await expect(runtime.call({
      operation: "refine-node",
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
    })).rejects.toThrow(/no JSON object for refine-node: The response looks truncated/);
  });

  it("embeds the target file for one-shot drafts and routes them to the draft model", async () => {
    const capture = path.join(os.tmpdir(), `augment-capture-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(capture);
    const output = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"patch\":\"--- a/package.json\"}" }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(capture)}\ncat <<'JSON'\n${output}\nJSON\n`);
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000, draftModel: "fast/small-model" });
    await runtime.call({
      operation: "draft-patch",
      context: {
        taskId: "task:1",
        taskRevision: 1,
        objective: "objective",
        basisRevision: "commit:1",
        node: { path: "package.json", kind: "file" } as never,
        candidates: [],
        constraints: [],
        obligations: [],
        diffs: [],
        lockedPaths: [],
        rejectedCandidates: [],
      },
      temperature: "low",
      lod: "hunk",
    });
    const captured = fs.readFileSync(capture, "utf8");
    expect(captured).toContain("--model fast/small-model");
    expect(captured).toContain("exact current content of package.json");
    expect(captured).toContain("Do NOT read any file");
    expect(captured).toContain("\"scripts\"");
    expect(captured).toContain("single-file unified diff touching ONLY the target path");
  });

  it("tells one-shot drafts when the target path is new", async () => {
    const capture = path.join(os.tmpdir(), `augment-capture-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(capture);
    const output = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"patch\":\"--- a/src/new.ts\"}" }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(capture)}\ncat <<'JSON'\n${output}\nJSON\n`);
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000 });
    await runtime.call({
      operation: "draft-patch",
      context: {
        taskId: "task:1",
        taskRevision: 1,
        objective: "objective",
        basisRevision: "commit:1",
        node: { path: "src/definitely-new-file.ts", kind: "file" } as never,
        candidates: [],
        constraints: [],
        obligations: [],
        diffs: [],
        lockedPaths: [],
        rejectedCandidates: [],
      },
      temperature: "low",
      lod: "hunk",
    });
    const captured = fs.readFileSync(capture, "utf8");
    expect(captured).toContain("must create it as a new file");
  });

  it("retries once with a correction when a draft comes back with an empty patch", async () => {
    const marker = path.join(os.tmpdir(), `augment-retried-${process.pid}-${temporaryFiles.length}.flag`);
    const log = path.join(os.tmpdir(), `augment-retry-log-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(marker, log);
    const empty = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"patch\":\"\",\"assumptions\":[]}" }] });
    const valid = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"patch\":\"--- a/package.json\",\"assumptions\":[]}" }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nif [ -f ${JSON.stringify(marker)} ]; then cat <<'JSON'\n${valid}\nJSON\nelse touch ${JSON.stringify(marker)}; cat <<'JSON'\n${empty}\nJSON\nfi\n`);
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000 });
    const result = await runtime.call({
      operation: "draft-patch",
      context: {
        taskId: "task:1",
        taskRevision: 1,
        objective: "objective",
        basisRevision: "commit:1",
        node: { path: "package.json", kind: "file" } as never,
        candidates: [],
        constraints: [],
        obligations: [],
        diffs: [],
        lockedPaths: [],
        rejectedCandidates: [],
      },
      temperature: "low",
      lod: "hunk",
    });
    expect(result.value).toEqual({ patch: "--- a/package.json", assumptions: [] });
    const logged = fs.readFileSync(log, "utf8");
    expect(logged).toContain("patch field must be a non-empty string");
    expect(logged.match(/--title augment-draft-patch/g)?.length).toBe(2);
  });

  it("embeds head and tail when the draft target exceeds the embed limit", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "augment-embed-"));
    temporaryDirectories.push(directory);
    fs.writeFileSync(path.join(directory, "big.ts"), `HEADMARK\n${"x".repeat(70_000)}\nTAILMARK\n`);
    const capture = path.join(os.tmpdir(), `augment-capture-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(capture);
    const output = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"patch\":\"--- a/big.ts\"}" }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(capture)}\ncat <<'JSON'\n${output}\nJSON\n`);
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory, command: file, timeoutMs: 5_000 });
    await runtime.call({
      operation: "draft-patch",
      context: {
        taskId: "task:1",
        taskRevision: 1,
        objective: "objective",
        basisRevision: "commit:1",
        node: { path: "big.ts", kind: "file" } as never,
        candidates: [],
        constraints: [],
        obligations: [],
        diffs: [],
        lockedPaths: [],
        rejectedCandidates: [],
      },
      temperature: "low",
      lod: "hunk",
    });
    const captured = fs.readFileSync(capture, "utf8");
    expect(captured).toContain("HEADMARK");
    expect(captured).toContain("TAILMARK");
    expect(captured).toContain("characters are omitted");
    expect(captured).toContain("first 44800 and the last 19200");
  });

  it("retries once with git's diagnostic when a draft patch is structurally corrupt", async () => {
    const directory = tempGitRepo();
    const corrupt = "--- a/session.ts\n+++ b/session.ts\n@@ -1,2 +1,2 @@\n alpha\n";
    const valid = "--- a/session.ts\n+++ b/session.ts\n@@ -1,2 +1,3 @@\n alpha\n+gamma\n beta\n";
    const marker = path.join(os.tmpdir(), `augment-retried-${process.pid}-${temporaryFiles.length}.flag`);
    const log = path.join(os.tmpdir(), `augment-retry-log-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(marker, log);
    const validOutput = JSON.stringify({ type: "message", parts: [{ type: "text", text: JSON.stringify({ patch: valid, assumptions: [] }) }] });
    const corruptOutput = JSON.stringify({ type: "message", parts: [{ type: "text", text: JSON.stringify({ patch: corrupt, assumptions: [] }) }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      `if [ -f ${JSON.stringify(marker)} ]; then printf '%s' ${JSON.stringify(validOutput)}; else touch ${JSON.stringify(marker)}; printf '%s' ${JSON.stringify(corruptOutput)}; fi`,
      "",
    ].join("\n"));
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory, command: file, timeoutMs: 5_000 });
    const result = await runtime.call({
      operation: "draft-patch",
      context: {
        taskId: "task:1",
        taskRevision: 1,
        objective: "objective",
        basisRevision: "commit:1",
        node: { path: "session.ts", kind: "file" } as never,
        candidates: [],
        constraints: [],
        obligations: [],
        diffs: [],
        lockedPaths: [],
        rejectedCandidates: [],
      },
      temperature: "low",
      lod: "hunk",
    });
    expect(result.value).toEqual({ patch: valid, assumptions: [] });
    const logged = fs.readFileSync(log, "utf8");
    expect(logged).toContain("does not apply cleanly");
    expect(logged.match(/--title augment-draft-patch/g)?.length).toBe(2);
  });

  it("continues the previous OpenCode session per task", async () => {
    const log = path.join(os.tmpdir(), `augment-session-log-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(log);
    const output = JSON.stringify({ type: "message", sessionID: "ses_cont1", parts: [{ type: "text", text: "{\"kind\":\"accept\"}" }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nprintf '%s' ${JSON.stringify(output)}\n`);
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000 });
    const request = (taskId: string): ModelCallRequest => ({
      operation: "challenge-domain",
      context: {
        taskId,
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
    });
    await runtime.call(request("task:a"));
    await runtime.call(request("task:a"));
    await runtime.call(request("task:b"));
    const logged = fs.readFileSync(log, "utf8");
    expect(logged.match(/--session ses_cont1/g)?.length).toBe(1);
    expect(logged.match(/--title augment-challenge-domain/g)?.length).toBe(2);
    expect(logged).toContain("CURRENT authoritative state");
  });

  it("starts fresh sessions per call when continuation is disabled", async () => {
    process.env.AUGMENT_OPENCODE_SESSIONS = "0";
    try {
      const log = path.join(os.tmpdir(), `augment-session-log-${process.pid}-${temporaryFiles.length}.txt`);
      temporaryFiles.push(log);
      const output = JSON.stringify({ type: "message", sessionID: "ses_cont2", parts: [{ type: "text", text: "{\"kind\":\"accept\"}" }] });
      const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
      fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nprintf '%s' ${JSON.stringify(output)}\n`);
      fs.chmodSync(file, 0o755);
      temporaryFiles.push(file);
      const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000 });
      const request = {
        operation: "challenge-domain" as const,
        context: {
          taskId: "task:a",
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
        temperature: "normal" as const,
        lod: "file" as const,
      };
      await runtime.call(request);
      await runtime.call(request);
      const logged = fs.readFileSync(log, "utf8");
      expect(logged).not.toContain("--session");
      expect(logged.match(/--title augment-challenge-domain/g)?.length).toBe(2);
    } finally {
      delete process.env.AUGMENT_OPENCODE_SESSIONS;
    }
  });

  it("warns regenerations not to echo rejected approaches", async () => {
    const capture = path.join(os.tmpdir(), `augment-capture-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(capture);
    const output = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"candidates\":[{\"label\":\"A\",\"rationale\":\"r\",\"confidence\":70,\"touchedPaths\":[\"src/a.ts\"]}]}" }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(capture)}\nprintf '%s' ${JSON.stringify(output)}\n`);
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000 });
    const base = {
      taskRevision: 1,
      objective: "objective",
      basisRevision: "commit:1",
      node: {} as never,
      candidates: [] as unknown[],
      constraints: [] as unknown[],
      obligations: [] as unknown[],
      diffs: [] as unknown[],
      taskDiffs: [] as unknown[],
      lockedPaths: [] as string[],
    };
    await runtime.call({ operation: "generate-domain", context: { taskId: "task:1", rejectedCandidates: [{ label: "Old idea", reason: "rejected" }], ...base }, temperature: "normal", lod: "file" } as never);
    const rejected = fs.readFileSync(capture, "utf8");
    expect(rejected).toContain("never repeat a rejected label");
    await runtime.call({ operation: "generate-domain", context: { taskId: "task:2", rejectedCandidates: [], ...base }, temperature: "normal", lod: "file" } as never);
    const fresh = fs.readFileSync(capture, "utf8");
    expect(fresh.endsWith("never repeat a rejected label")).toBe(false);
  });

  it("routes challenge calls to the challenge model", async () => {
    const capture = path.join(os.tmpdir(), `augment-capture-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(capture);
    const output = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"kind\":\"accept\"}" }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(capture)}\nprintf '%s' ${JSON.stringify(output)}\n`);
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000, challengeModel: "fast/challenge" });
    await runtime.call({
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
        taskDiffs: [],
        lockedPaths: [],
        rejectedCandidates: [],
      },
      temperature: "normal",
      lod: "file",
    });
    expect(fs.readFileSync(capture, "utf8")).toContain("--model fast/challenge");
  });

  it("corrects reasoning-only replies and retries with an explicit instruction", async () => {
    const log = path.join(os.tmpdir(), `augment-reasoning-log-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(log);
    const reasoningOnly = JSON.stringify({ type: "message", parts: [{ type: "reasoning", text: "the model thought about the patch and stopped" }] });
    const answered = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"kind\":\"accept\"}" }] });
    const seen1 = path.join(os.tmpdir(), `augment-reasoning-1-${process.pid}-${temporaryFiles.length}.flag`);
    const seen2 = path.join(os.tmpdir(), `augment-reasoning-2-${process.pid}-${temporaryFiles.length}.flag`);
    temporaryFiles.push(seen1, seen2);
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      `if [ -f ${JSON.stringify(seen2)} ]; then printf '%s' ${JSON.stringify(answered)};`,
      `elif [ -f ${JSON.stringify(seen1)} ]; then touch ${JSON.stringify(seen2)}; printf '%s' ${JSON.stringify(reasoningOnly)};`,
      `else touch ${JSON.stringify(seen1)}; printf '%s' ${JSON.stringify(reasoningOnly)}; fi`,
      "",
    ].join("\n"));
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000, retryDelayMs: 1 });
    const result = await runtime.call({
      operation: "challenge-domain",
      context: {
        taskId: "task:reasoning",
        taskRevision: 1,
        objective: "objective",
        basisRevision: "commit:1",
        node: {} as never,
        candidates: [],
        constraints: [],
        obligations: [],
        diffs: [],
        taskDiffs: [],
        taskTree: [],
        lockedPaths: [],
        restrictionMode: "lock",
        rejectedCandidates: [],
      },
      temperature: "normal",
      lod: "file",
    });
    expect(result.value).toEqual({ kind: "accept" });
    const logged = fs.readFileSync(log, "utf8");
    expect(logged).toContain("contained no answer text");
    expect(logged.match(/--title augment-challenge-domain/g)?.length).toBe(3);
  });

  it("connects to a configured server address instead of spawning implicitly", async () => {
    const capture = path.join(os.tmpdir(), `augment-server-flag-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(capture);
    const output = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"kind\":\"accept\"}" }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(capture)}\nprintf '%s' ${JSON.stringify(output)}\n`);
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    process.env.AUGMENT_OPENCODE_SERVER = "http://127.0.0.1:49374";
    try {
      const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000 });
      await runtime.call({
        operation: "challenge-domain",
        context: {
          taskId: "task:server",
          taskRevision: 1,
          objective: "objective",
          basisRevision: "commit:1",
          node: {} as never,
          candidates: [],
          constraints: [],
          obligations: [],
          diffs: [],
          taskDiffs: [],
          taskTree: [],
          lockedPaths: [],
          restrictionMode: "lock",
          rejectedCandidates: [],
        },
        temperature: "normal",
        lod: "file",
      });
      expect(fs.readFileSync(capture, "utf8")).toContain("--server http://127.0.0.1:49374");
    } finally {
      delete process.env.AUGMENT_OPENCODE_SERVER;
    }
  });

  it("retries transient provider failures with backoff and then succeeds", async () => {
    const marker = path.join(os.tmpdir(), `augment-retried-${process.pid}-${temporaryFiles.length}.flag`);
    const log = path.join(os.tmpdir(), `augment-retry-log-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(marker, log);
    const output = JSON.stringify({ type: "message", parts: [{ type: "text", text: "{\"kind\":\"accept\"}" }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      `if [ ! -f ${JSON.stringify(marker)} ]; then touch ${JSON.stringify(marker)}; echo "Error: rate limit exceeded (429), try again later" >&2; exit 1; fi`,
      `printf '%s' ${JSON.stringify(output)}`,
      "",
    ].join("\n"));
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000, retryDelayMs: 1 });
    const result = await runtime.call({
      operation: "challenge-domain",
      context: {
        taskId: "task:retry",
        taskRevision: 1,
        objective: "objective",
        basisRevision: "commit:1",
        node: {} as never,
        candidates: [],
        constraints: [],
        obligations: [],
        diffs: [],
        taskDiffs: [],
        lockedPaths: [],
        rejectedCandidates: [],
      },
      temperature: "normal",
      lod: "file",
    });
    expect(result.value).toEqual({ kind: "accept" });
    const logged = fs.readFileSync(log, "utf8");
    expect(logged.match(/--title augment-challenge-domain/g)?.length).toBe(2);
  });

  it("persists session mappings across runtime instances", async () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "augment-state-"));
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = state;
    try {
      const log = path.join(os.tmpdir(), `augment-session-log-${process.pid}-${temporaryFiles.length}.txt`);
      temporaryFiles.push(log);
      const output = JSON.stringify({ type: "message", sessionID: "ses_persist1", parts: [{ type: "text", text: "{\"kind\":\"accept\"}" }] });
      const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
      fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nprintf '%s' ${JSON.stringify(output)}\n`);
      fs.chmodSync(file, 0o755);
      temporaryFiles.push(file);
      const request = {
        operation: "challenge-domain" as const,
        context: {
          taskId: "task:persist",
          taskRevision: 1,
          objective: "objective",
          basisRevision: "commit:1",
          node: {} as never,
          candidates: [],
          constraints: [],
          obligations: [],
          diffs: [],
          taskDiffs: [],
          lockedPaths: [],
          rejectedCandidates: [],
        },
        temperature: "normal" as const,
        lod: "file" as const,
      };
      await new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000 }).call(request);
      await new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 5_000 }).call(request);
      const logged = fs.readFileSync(log, "utf8");
      expect(logged.match(/--session ses_persist1/g)?.length).toBe(1);
      expect(JSON.parse(fs.readFileSync(path.join(state, "neolit", "augment-sessions.json"), "utf8"))).toEqual({ "task:persist": "ses_persist1" });
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
    }
  });

  it("retries when a draft conflicts with the task's other drafted changes", async () => {
    const directory = tempGitRepo();
    const otherDiff = { id: "diff:1", nodeId: "node:other", path: "session.ts", patch: "--- a/session.ts\n+++ b/session.ts\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+X\n", kind: "modify" as const, basisRevision: "commit:1" };
    const conflicting = "--- a/session.ts\n+++ b/session.ts\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+Y\n";
    const compatible = "--- a/session.ts\n+++ b/session.ts\n@@ -1,1 +1,2 @@\n alpha\n+top line\n";
    const marker = path.join(os.tmpdir(), `augment-retried-${process.pid}-${temporaryFiles.length}.flag`);
    const log = path.join(os.tmpdir(), `augment-retry-log-${process.pid}-${temporaryFiles.length}.txt`);
    temporaryFiles.push(marker, log);
    const validOutput = JSON.stringify({ type: "message", parts: [{ type: "text", text: JSON.stringify({ patch: compatible, assumptions: [] }) }] });
    const conflictingOutput = JSON.stringify({ type: "message", parts: [{ type: "text", text: JSON.stringify({ patch: conflicting, assumptions: [] }) }] });
    const file = path.join(os.tmpdir(), `augment-opencode-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      `if [ -f ${JSON.stringify(marker)} ]; then printf '%s' ${JSON.stringify(validOutput)}; else touch ${JSON.stringify(marker)}; printf '%s' ${JSON.stringify(conflictingOutput)}; fi`,
      "",
    ].join("\n"));
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory, command: file, timeoutMs: 5_000 });
    const result = await runtime.call({
      operation: "draft-patch",
      context: {
        taskId: "task:1",
        taskRevision: 2,
        objective: "objective",
        basisRevision: "commit:1",
        node: { id: "node:self", path: "session.ts", kind: "file" } as never,
        candidates: [],
        constraints: [],
        obligations: [],
        diffs: [],
        taskDiffs: [otherDiff],
        taskTree: [],
        lockedPaths: [],
        restrictionMode: "lock",
        rejectedCandidates: [],
      },
      temperature: "low",
      lod: "hunk",
    });
    expect(result.value).toEqual({ patch: compatible, assumptions: [] });
    const logged = fs.readFileSync(log, "utf8");
    expect(logged).toContain("other drafted changes");
    expect(logged.match(/--title augment-draft-patch/g)?.length).toBe(2);
  });

  it("rejects with an actionable message when the runtime exceeds its timeout", async () => {
    const previous = process.env.XDG_CONFIG_HOME;
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "augment-config-"));
    process.env.XDG_CONFIG_HOME = state;
    try {
      expect(loadAugmentConfig()).toEqual({});
      saveAugmentConfig({ model: "opencode/x", challengeRounds: 1, server: undefined });
      expect(loadAugmentConfig()).toEqual({ model: "opencode/x", challengeRounds: 1 });
      saveAugmentConfig({ draftModel: "opencode/y" });
      expect(loadAugmentConfig()).toEqual({ model: "opencode/x", draftModel: "opencode/y", challengeRounds: 1 });
      expect(configFromEnvironment({ AUGMENT_OPENCODE_MODEL: "opencode/env" })).toEqual({ model: "opencode/env" });
      expect(effectiveConfig({ model: "opencode/x" }, { model: "opencode/env", draftModel: "opencode/env-draft" })).toEqual({ model: "opencode/env", draftModel: "opencode/env-draft" });
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
  });

  it("exits with an actionable message when the runtime exceeds its timeout", async () => {
    const file = path.join(os.tmpdir(), `augment-opencode-slow-${process.pid}-${temporaryFiles.length}.sh`);
    fs.writeFileSync(file, "#!/bin/sh\nsleep 5\n");
    fs.chmodSync(file, 0o755);
    temporaryFiles.push(file);
    const runtime = new OpenCodeCliRuntime({ directory: process.cwd(), command: file, timeoutMs: 150, retries: 0 });
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
    })).rejects.toThrow(/timed out after 150ms\. Set AUGMENT_OPENCODE_TIMEOUT_MS/);
  });
});
