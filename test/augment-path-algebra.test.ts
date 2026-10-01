import { describe, expect, it } from "vitest";
import { candidateScopeEscapes, createPlanTask, generateDomain, normalizePath, pathIsAllowed, pathIsLocked, PlanStateError, setPathRestriction } from "../src/augment/state.js";

/**
 * Deterministic property tests for the controller's path algebra: the
 * restriction plain, scope containment, and normalization. Cases come from a
 * fixed-seed LCG so failures always reproduce; a failure reports the seed and
 * case index.
 */
const SEED = 20261001;

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const SEGMENTS = ["src", "auth", "test", "session.ts", "a.ts", "retry"];

function randomPath(random: () => number, depth: number): string {
  const parts = Array.from({ length: 1 + Math.floor(random() * depth) }, () => SEGMENTS[Math.floor(random() * SEGMENTS.length)]!);
  return parts.join("/");
}

function property(name: string, cases: number, run: (random: () => number, index: number) => void) {
  it(name, () => {
    const random = generator(SEED);
    for (let index = 0; index < cases; index++) {
      try {
        run(random, index);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`seed=${SEED} case=${index}: ${detail}`);
      }
    }
  });
}

function lockedTask(marked: string[]) {
  let task = createPlanTask({ id: "task:paths", objective: "path algebra", basisRevision: "commit:1" });
  for (const path of marked) {
    task = setPathRestriction(task, { taskId: task.id, expectedRevision: task.revision, path, mode: "lock", marked: true });
  }
  return task;
}

function allowedTask(marked: string[]) {
  let task = createPlanTask({ id: "task:paths", objective: "path algebra", basisRevision: "commit:1" });
  task = setPathRestriction(task, { taskId: task.id, expectedRevision: task.revision, mode: "allow" });
  for (const path of marked) {
    task = setPathRestriction(task, { taskId: task.id, expectedRevision: task.revision, path, mode: "allow", marked: true });
  }
  return task;
}

describe("planned-diff path algebra", () => {
  property("normalization is idempotent and canonical", 500, (random) => {
    const raw = randomPath(random, 4);
    const once = normalizePath(raw);
    expect(normalizePath(once)).toBe(once);
    expect(once).not.toMatch(/\/\//u);
    expect(once).not.toMatch(/(^|\/)\.($|\/)/u);
    expect(once.endsWith("/")).toBe(false);
    if (once !== ".") expect(once.startsWith("/")).toBe(false);
    expect(() => normalizePath(`../${raw}`)).toThrow(PlanStateError);
    expect(() => normalizePath(`${raw}\\x`)).toThrow(PlanStateError);
  });

  property("concrete locks never match by bare substring", 500, (random) => {
    const marked = randomPath(random, 3);
    const probe = randomPath(random, 3);
    const task = lockedTask([marked]);
    if (pathIsLocked(task, probe)) {
      expect(probe === marked || probe.startsWith(`${marked}/`)).toBe(true);
    }
  });

  property("a segment-glob locks only matching names at its own directory level", 200, (random) => {
    const task = lockedTask(["src/*.ts"]);
    const name = SEGMENTS[Math.floor(random() * SEGMENTS.length)]!;
    expect(pathIsLocked(task, `src/${name}`)).toBe(name.endsWith(".ts"));
    expect(pathIsLocked(task, `src/auth/${name}`)).toBe(false);
    expect(pathIsLocked(task, "test/a.ts")).toBe(false);
  });

  property("a recursive glob locks its whole subtree", 200, (random) => {
    const task = lockedTask(["src/**"]);
    const probe = randomPath(random, 4);
    const expected = probe === "src" || probe.startsWith("src/");
    expect(pathIsLocked(task, probe)).toBe(expected);
  });

  property("lock and allow are exact polarity inverses", 500, (random) => {
    const marked = randomPath(random, 3);
    const probe = randomPath(random, 4);
    expect(pathIsAllowed(allowedTask([marked]), probe)).toBe(pathIsLocked(lockedTask([marked]), probe));
  });

  property("an empty allow plain locks everything", 100, (random) => {
    const task = allowedTask([]);
    const probe = randomPath(random, 4);
    expect(pathIsLocked(task, probe)).toBe(true);
  });

  property("node scope contains real children and excludes prefix siblings", 500, (random) => {
    const task = createPlanTask({ id: "task:scope", objective: "scope algebra", basisRevision: "commit:1" });
    const withDomain = generateDomain(task, {
      taskId: task.id,
      expectedRevision: task.revision,
      nodeId: task.rootNodeId,
      candidates: [{ label: "Scope", rationale: "establish a selected subtree", confidence: 70, touchedPaths: ["src"] }],
    });
    const scopePath = randomPath(random, 2);
    const child = `${scopePath}/${randomPath(random, 2)}`;
    const sibling = `${scopePath}x/${randomPath(random, 2)}`;
    const node = { ...withDomain.nodes[withDomain.rootNodeId]!, path: scopePath, kind: "dir" as const };
    const scoped = { ...withDomain, nodes: { ...withDomain.nodes, [node.id]: node } };
    expect(candidateScopeEscapes(scoped, node.id, [child, scopePath])).toEqual([]);
    expect(candidateScopeEscapes(scoped, node.id, [sibling])).toEqual([sibling]);
  });
});
