# Reviewed manual token-waste reductions

These are manual patches only. They are not applied to the graph or plugin.

Recommended disposition:

- Apply 1 and 2 with the listed regression tests.
- Apply the corrected version of 4 after its focused tests pass.
- Do not apply 3 or 5 without workload evidence and a safer design.

## 1. Stop repeating invalid JSON on schema retries

Target: `/home/isuo/Projects/opencode-langgraph/src/opencode/runtime.ts`

```diff
-          const validationError = errorMessage(error);
-          const invalidOutput = output.text.slice(0, 4_000);
-          prompt = `Your previous JSON failed validation.\n\nFAILED PRECONDITION\n${validationError}\n\nADMISSIBLE CORRECTION\nKeep the same task and every valid prior decision. Correct only the rejected structure, then return one complete JSON value matching the original schema with no prose.\n\nPREVIOUS INVALID OUTPUT\n${invalidOutput}`;
+          const validationError = errorMessage(error);
+          prompt = `Your previous JSON failed validation.
+
+FAILED PRECONDITION
+${validationError}
+
+ADMISSIBLE CORRECTION
+The assistant JSON from the preceding failed turn is already present in this child session.
+Keep the same task and every valid prior decision. Correct only the rejected
+structure, then return one complete JSON value matching the original schema
+with no prose.`;
```

Update the retry tests to assert that both attempts use the same child session,
the correction retains `FAILED PRECONDITION`, and the invalid JSON is not copied
into the correction prompt. Add a two-retry case to prevent accumulation.

## 2. Send chosen decisions once, not twice

Target: `src/solution-lod/graph.ts`

Add immediately after `implementationContract`:

```ts
  const fixedDecisions = activation.capability === "refine" || activation.capability === "implement"
    ? undefined
    : context.earlierChoices ?? context.chosenApproach;
```

Replace:

```ts
    section("FIXED DECISIONS", context.earlierChoices ?? context.chosenApproach),
```

with:

```ts
    section("FIXED DECISIONS", fixedDecisions),
```

Add a prompt regression test proving that refine and implement contain the
selected lineage once, while other capabilities retain `FIXED DECISIONS`.

## 3. Defer conversation-context filtering

Target: `/home/isuo/Projects/opencode-langgraph/src/opencode/server.ts`

Do not apply the original text-based filter. The existing function already
excludes the current message by ID, removes one final duplicate by content, and
ignores synthetic parts.

The rejected filter would:

- Treat natural-language tasks such as `Graph the dependencies` as commands.
- Confuse `/graph` (the viewer) with `/run-graph` (task execution).
- Remove every historical repetition instead of only the current duplicate.
- Drop potentially meaningful `/graph-resume` answers.
- Depend on unstable presenter prose prefixes.

If lifecycle chatter becomes measurable, mark it structurally when created and
filter only assistant acknowledgements linked to that marker. If defensive task
normalization becomes necessary, strip only an explicit `/run-graph` prefix,
before truncation, and only for the final duplicate candidate.

## 4. Give inspectors a narrow schema

Target: `src/solution-lod/types.ts`

Immediately after `export type SolutionDelta = ...`, add:

```ts
export const InspectionOutputSchema = SolutionDeltaSchema.pick({
  region: true,
  evidence: true,
  factIds: true,
  validations: true,
  answer: true,
  resolvedAnswer: true,
  taskScopes: true,
  taskDispositions: true,
  materialRequirements: true,
  certifiedVerdict: true,
  activations: true,
}).extend({
  region: SolutionDeltaSchema.shape.region.unwrap().omit({
    objective: true,
  }).strict().optional(),
}).strict();

export type InspectionOutput = z.infer<typeof InspectionOutputSchema>;
```

Target: `src/solution-lod/graph.ts`

Add `InspectionOutputSchema` to the import from `./types.js`.

Replace the schema selection with:

```ts
const schema = activation.operation === "generate-domain" ? DomainGenerationOutputSchema
  : activation.operation === "challenge-domain" ? DomainChallengeOutputSchema
    : activation.operation === "select-candidate" ? CandidateSelectionOutputSchema
      : activation.capability === "implement" ? ImplementationOutputSchema
        : activation.capability === "verify" ? VerificationOutputSchema
          : activation.capability === "present" ? PresentationOutputSchema
            : activation.capability === "refine" ? RefinementOutputSchema
              : activation.capability === "inspect" ? InspectionOutputSchema
                : SolutionDeltaSchema;
```

In `validateStructured`, parse inspection output into the complete delta type
before semantic validation. Replace the inspection dispatch and final
`return parsed` with the equivalent of:

```ts
let parsed: unknown = schema.parse(value);

if (activation.operation) {
  validateSynthesisOutput(state, activation, parsed as SynthesisOutput);
} else if (activation.capability === "inspect") {
  parsed = SolutionDeltaSchema.parse(parsed);
  validateSolutionDelta(
    state,
    activation.regionId,
    activation.capability,
    parsed as SolutionDelta,
  );
} else if (schema === RefinementOutputSchema) {
  validateRefinementOutput(state, activation.regionId, parsed as RefinementOutput);
} else if (schema === ImplementationOutputSchema) {
  validateImplementationOutput(state, activation.regionId, parsed as ImplementationOutput);
} else if (schema === VerificationOutputSchema) {
  validateVerificationOutput(state, activation.regionId, parsed as VerificationOutput);
}

return parsed;
```

Keep the existing final `validatedOutput(SolutionDeltaSchema)` return. The
runtime validator expands narrow inspector output through `SolutionDeltaSchema`,
which restores default arrays without an unsafe `as SolutionDelta` transport
cast. The text fallback also parses correctly through the complete schema.

The corrected schema is about 37% smaller than `SolutionDeltaSchema` while
preserving region criteria, direct answers, and strict rejection of forbidden
candidate, constraint, selection, and variable fields.

## 5. Defer candidate evidence-ID deduplication

Target: `src/solution-lod/graph.ts`

Do not apply the original wrapper. For ordinary small domains and short evidence
IDs, `{ sharedSupportingFactIds, candidates }` is larger than the current array.
It also changes the exported context shape and leaves `challenge-domain` without
an explanation of the new representation.

Revisit only if telemetry shows that repeated candidate evidence consumes
meaningful prompt space. Any later version must prove positive savings on a
representative workload, preserve one documented synthesis-context shape, and
explain shared evidence to generation, challenge, and selection consistently.

## Verification

Before applying source patches:

1. Run both repositories' existing test suites from a clean baseline.
2. Confirm retry prompts do not repeat malformed output and remain in one child session.
3. Confirm refine and implement render selected lineage exactly once.
4. Confirm the inspector JSON schema is smaller than `SolutionDeltaSchema`.
5. Confirm inspector region criteria, `resolvedAnswer`, task decomposition, claim validation, and certified verdicts still work.
6. Confirm forbidden inspector candidate and selection fields fail validation rather than being stripped.
