import type {
  ChangedFile,
  ResolvedTask,
  SpecDocument,
  TaskDiffAssociation,
} from "./markdown.js";

export type DerivedTaskState =
  | "planned"
  | "in-progress"
  | "implemented"
  | "verified"
  | "blocked"
  | "unmapped";

export type DerivedRequirementState = "unplanned" | DerivedTaskState;

export type VerificationEvidence = {
  command: string;
  result: string;
  passed: boolean;
  baseCommit: string;
  diffIdentity: string;
  taskKeys?: string[];
  acceptanceCriteriaRefs?: string[];
};

export type TaskStateProjection = {
  taskKey: string;
  state: DerivedTaskState;
  changedPaths: string[];
  acceptanceCriteria: Array<{ ref: string; verified: boolean }>;
};

export type RequirementStateProjection = {
  specPath: string;
  requirementId: string;
  state: DerivedRequirementState;
  taskKeys: string[];
  acceptanceCriteria: Array<{ ref: string; verified: boolean }>;
};

export type PlanningStateProjection = {
  tasks: Record<string, TaskStateProjection>;
  requirements: RequirementStateProjection[];
};

function criterionRef(specPath: string, id: string): string {
  return `${specPath}#${id}`;
}

function hasBlocker(task: ResolvedTask): boolean {
  return task.description.some((line) => /^\s*(?:blocked|blocker):\s*\S/iu.test(line));
}

function validEvidence(
  evidence: VerificationEvidence[],
  baseCommit: string,
  diffIdentity: string,
): VerificationEvidence[] {
  return evidence.filter((item) =>
    item.command.trim().length > 0
    && item.result.trim().length > 0
    && item.baseCommit === baseCommit
    && item.diffIdentity === diffIdentity,
  );
}

function criterionVerified(
  ref: string,
  evidence: VerificationEvidence[],
): boolean {
  return evidence.some((item) => item.passed && item.acceptanceCriteriaRefs?.includes(ref));
}

function stateForTask(
  task: ResolvedTask,
  changedPaths: string[],
  expectedPaths: string[],
  evidence: VerificationEvidence[],
  criterionCoverage: Array<{ ref: string; verified: boolean }>,
): DerivedTaskState {
  if (task.state === "unmapped") return "unmapped";
  if (hasBlocker(task)) return "blocked";

  let state: DerivedTaskState;
  if (changedPaths.length === 0) {
    state = "planned";
  } else if (
    expectedPaths.length > 0
    && expectedPaths.every((expected) => changedPaths.some((changed) => changed === expected))
  ) {
    state = "implemented";
  } else {
    state = "in-progress";
  }

  if (state !== "implemented") return state;

  const verified = criterionCoverage.length > 0
    ? criterionCoverage.every((criterion) => criterion.verified)
    : evidence.some((item) => item.passed && item.taskKeys?.includes(task.key));
  return verified ? "verified" : "implemented";
}

/**
 * Derive task and requirement presentation states from Markdown, actual Git
 * path associations, and check evidence bound to the exact base/diff.
 * TODO checkbox values are deliberately ignored.
 */
export function derivePlanningStates(input: {
  specs: SpecDocument[];
  tasks: ResolvedTask[];
  changedFiles: ChangedFile[];
  associations: TaskDiffAssociation[];
  verificationEvidence?: VerificationEvidence[];
  baseCommit: string;
  diffIdentity: string;
}): PlanningStateProjection {
  const evidence = validEvidence(input.verificationEvidence ?? [], input.baseCommit, input.diffIdentity);
  const taskProjections: Record<string, TaskStateProjection> = {};

  for (const task of input.tasks) {
    const associations = input.associations.filter((item) => item.taskKeys.includes(task.key));
    const changedPaths = [...new Set(associations.map((item) => item.path))];
    const expectedPaths = [...new Set(task.filePaths)];
    const criterionCoverage = task.resolvedAcceptanceCriteria.map((criterion) => {
      const ref = criterionRef(criterion.specPath, criterion.id);
      return { ref, verified: criterionVerified(ref, evidence) };
    });
    taskProjections[task.key] = {
      taskKey: task.key,
      state: stateForTask(task, changedPaths, expectedPaths, evidence, criterionCoverage),
      changedPaths,
      acceptanceCriteria: criterionCoverage,
    };
  }

  const requirements: RequirementStateProjection[] = [];
  for (const spec of input.specs) {
    for (const requirement of spec.requirements) {
      const taskMatches = input.tasks.filter((task) =>
        task.resolvedRequirements.some((item) => item.specPath === spec.path && item.id === requirement.id),
      );
      const taskKeys = taskMatches.map((task) => task.key);
      const acceptanceCriteria = spec.acceptanceCriteria
        .filter((criterion) => criterion.requirementIds.includes(requirement.id))
        .map((criterion) => {
          const ref = criterionRef(spec.path, criterion.id);
          return { ref, verified: criterionVerified(ref, evidence) };
        });

      let state: DerivedRequirementState = "unplanned";
      if (taskMatches.length > 0) {
        const taskStates = taskMatches.map((task) => taskProjections[task.key]!.state);
        if (taskStates.includes("unmapped")) state = "unmapped";
        else if (taskStates.includes("blocked")) state = "blocked";
        else if (
          taskStates.every((taskState) => taskState === "verified")
          && acceptanceCriteria.every((criterion) => criterion.verified)
        ) state = "verified";
        else if (taskStates.some((taskState) => taskState === "in-progress")) state = "in-progress";
        else if (taskStates.some((taskState) => taskState === "implemented" || taskState === "verified")) {
          state = taskStates.some((taskState) => taskState === "planned") ? "in-progress" : "implemented";
        } else state = "planned";
      }

      requirements.push({
        specPath: spec.path,
        requirementId: requirement.id,
        state,
        taskKeys,
        acceptanceCriteria,
      });
    }
  }

  return { tasks: taskProjections, requirements };
}
