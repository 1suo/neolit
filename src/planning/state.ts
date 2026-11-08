import type {
  ChangedFile,
  ResolvedTask,
  SpecDocument,
  TaskDiffAssociation,
  TaskHunkAssociation,
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
  hunkReviews: Array<{ path: string; hunkIndex: number; oldStart: number; oldLines: number; newStart: number; newLines: number; state: TaskHunkAssociation["state"]; reason: TaskHunkAssociation["reason"]; candidateTaskKeys: string[]; candidateRequirementRefs: string[] }>;
  acceptanceCriteria: Array<{ ref: string; verified: boolean }>;
};

export type RequirementStateProjection = {
  specPath: string;
  requirementId: string;
  state: DerivedRequirementState;
  taskKeys: string[];
  hunkReviews: Array<{ path: string; hunkIndex: number; oldStart: number; oldLines: number; newStart: number; newLines: number; state: TaskHunkAssociation["state"]; reason: TaskHunkAssociation["reason"]; candidateTaskKeys: string[]; candidateRequirementRefs: string[] }>;
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
  return task.description.some((line) => /^\s*(?:[-*+]\s*)?(?:blocked|blocker):\s*\S/iu.test(line));
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
  evidence: VerificationEvidence[],
  criterionCoverage: Array<{ ref: string; verified: boolean }>,
): DerivedTaskState {
  if (task.state === "unmapped") return "unmapped";
  if (
    hasBlocker(task)
    || evidence.some((item) => !item.passed && item.taskKeys?.includes(task.key)
      && /^\s*(?:blocked|blocker):\s*\S/iu.test(item.result))
  ) return "blocked";

  if (changedPaths.length === 0) return "planned";

  // File: hints establish relevance, not that the changed hunk implements the
  // task. Until a precise hunk association exists, path-only evidence stays
  // in-progress. Explicit passing evidence may verify linked criteria/tasks.
  const verified = criterionCoverage.length > 0
    ? criterionCoverage.every((criterion) => criterion.verified)
    : evidence.some((item) => item.passed && item.taskKeys?.includes(task.key));
  return verified ? "verified" : "in-progress";
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
  hunkAssociations?: TaskHunkAssociation[];
  verificationEvidence?: VerificationEvidence[];
  baseCommit: string;
  diffIdentity: string;
}): PlanningStateProjection {
  const evidence = validEvidence(input.verificationEvidence ?? [], input.baseCommit, input.diffIdentity);
  const taskProjections: Record<string, TaskStateProjection> = {};

  for (const task of input.tasks) {
    const associations = input.associations.filter((item) => item.taskKeys.includes(task.key));
    const changedPaths = [...new Set(associations.map((item) => item.path))];
    const hunkReviews = (input.hunkAssociations ?? []).filter((item) => item.candidateTaskKeys.includes(task.key)).map((item) => ({
      path: item.path, hunkIndex: item.hunkIndex, oldStart: item.hunk.oldStart, oldLines: item.hunk.oldLines,
      newStart: item.hunk.newStart, newLines: item.hunk.newLines, state: item.state, reason: item.reason,
      candidateTaskKeys: item.candidateTaskKeys, candidateRequirementRefs: item.candidateRequirementRefs,
    }));
    const criterionCoverage = task.resolvedAcceptanceCriteria.map((criterion) => {
      const ref = criterionRef(criterion.specPath, criterion.id);
      return { ref, verified: criterionVerified(ref, evidence) };
    });
    taskProjections[task.key] = {
      taskKey: task.key,
      state: stateForTask(task, changedPaths, evidence, criterionCoverage),
      changedPaths,
      hunkReviews,
      acceptanceCriteria: criterionCoverage,
    };
  }

  const requirements: RequirementStateProjection[] = [];
  for (const spec of input.specs) {
    const referencePath = spec.referencePath ?? spec.path;
    for (const requirement of spec.requirements) {
      const taskMatches = input.tasks.filter((task) =>
        task.resolvedRequirements.some((item) => item.specPath === referencePath && item.id === requirement.id),
      );
      const taskKeys = taskMatches.map((task) => task.key);
      const criteriaByRef = new Map<string, { ref: string; verified: boolean }>();
      for (const task of taskMatches) {
        const taskRequirements = task.resolvedRequirements.filter((item) => item.specPath === referencePath);
        for (const criterion of task.resolvedAcceptanceCriteria) {
          const linkedById = criterion.requirementIds.includes(requirement.id);
          const linkedBySingleRequirement = criterion.requirementIds.length === 0
            && taskRequirements.length === 1
            && taskRequirements[0]!.id === requirement.id;
          if (criterion.specPath !== referencePath || (!linkedById && !linkedBySingleRequirement)) continue;
          const ref = criterionRef(referencePath, criterion.id);
          criteriaByRef.set(ref, { ref, verified: criterionVerified(ref, evidence) });
        }
      }
      const acceptanceCriteria = [...criteriaByRef.values()];
      const requirementRef = criterionRef(referencePath, requirement.id);
      const hunkReviews = (input.hunkAssociations ?? []).filter((item) =>
        item.candidateRequirementRefs.includes(requirementRef),
      ).map((item) => ({
        path: item.path, hunkIndex: item.hunkIndex, oldStart: item.hunk.oldStart, oldLines: item.hunk.oldLines,
        newStart: item.hunk.newStart, newLines: item.hunk.newLines, state: item.state, reason: item.reason,
        candidateTaskKeys: item.candidateTaskKeys, candidateRequirementRefs: item.candidateRequirementRefs,
      }));

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
        hunkReviews,
        acceptanceCriteria,
      });
    }
  }

  return { tasks: taskProjections, requirements };
}
