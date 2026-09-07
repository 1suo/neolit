import { describe, expect, it } from "vitest";
import { applyBatchRecords, consumeInterruptedSchemaReservations, ensureRunnableWork, initialNetwork, queueActivation, reserveSchemaAttempts } from "../src/solution-lod/reducer.js";
import type { ActivationTaskResult, SolutionNetwork } from "../src/solution-lod/types.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

function fail(network: SolutionNetwork, activationId: string, attempts: number): SolutionNetwork {
  const activation = network.activations.find((item) => item.id === activationId)!;
  const start = activation.schemaReservation!.attemptOrdinal;
  const record: ActivationTaskResult = {
    activationId, logicalActivationId: activation.logicalActivationId, regionId: activation.regionId, capability: activation.capability,
    basisRevision: activation.basisRevision, startedAt: 0, finishedAt: 1, usage, outcome: "error", error: "schema", failureKind: "schema", networkDelta: null,
    promptAttempts: Array.from({ length: attempts }, (_, index) => ({ physicalActivationId: activation.id, logicalActivationId: activation.logicalActivationId, attemptOrdinal: start + index, kind: index ? "schema-repair" as const : "initial" as const, outcome: "invalid" as const })),
    schemaRetries: Math.max(0, attempts - 1), schemaRepairs: Math.max(0, attempts - 1),
  };
  return applyBatchRecords(network, [record]).network;
}

describe("state v11 progress ledgers", () => {
  it("accumulates schema attempts across physical replacement and checkpoint-style replay", () => {
    let network = reserveSchemaAttempts(initialNetwork("task"), "a1");
    const logical = network.activations[0]!.logicalActivationId!;
    network = fail(network, "a1", 2);
    network = ensureRunnableWork(network).network;
    const replacement = network.activations.at(-1)!;
    expect(replacement.logicalActivationId).toBe(logical);
    network = reserveSchemaAttempts(network, replacement.id);
    expect(replacement.id).not.toBe("a1");
    expect(network.activations.at(-1)!.schemaReservation).toMatchObject({ attemptOrdinal: 3, maxAttempts: 1 });
    network = fail(network, replacement.id, 1);
    expect(network.schemaRetries[logical]).toMatchObject({ attempts: 3, retries: 1, repairs: 1, reservedAttempts: 0 });
    expect(ensureRunnableWork(network).blocked).toContain("No activation can make a novel state delta");
  });

  it("admits a fresh schema budget only for changed context", () => {
    let network = reserveSchemaAttempts(initialNetwork("task"), "a1");
    const oldLogical = network.activations[0]!.logicalActivationId!;
    network = fail(network, "a1", 3);
    network.regions[0]!.objective = "changed admitted objective";
    network = ensureRunnableWork(network).network;
    const fresh = network.activations.at(-1)!;
    expect(fresh.logicalActivationId).not.toBe(oldLogical);
    network = reserveSchemaAttempts(network, fresh.id);
    expect(network.activations.at(-1)!.schemaReservation).toMatchObject({ attemptOrdinal: 1, maxAttempts: 3 });
  });

  it("keeps independent requests on independent logical ledgers", () => {
    let network = initialNetwork("task");
    network.activations[0]!.status = "failed";
    network = queueActivation(network, "inspect", "r1", "one", "fact-one");
    network = queueActivation(network, "inspect", "r1", "two", "fact-two");
    const logicalIds = network.activations.slice(-2).map((item) => item.logicalActivationId);
    expect(new Set(logicalIds).size).toBe(2);
  });

  it("consumes only the uncertain attempt and releases unused retries after process death", () => {
    let network = reserveSchemaAttempts(initialNetwork("task"), "a1");
    network.activations[0]!.status = "running";
    const logical = network.activations[0]!.logicalActivationId!;
    network = consumeInterruptedSchemaReservations(network);
    expect(network.activations[0]).toMatchObject({ status: "failed", schemaReservation: undefined });
    expect(network.schemaRetries[logical]).toMatchObject({ attempts: 1, retries: 0, repairs: 0, reservedAttempts: 0 });
    expect(network.schemaRetries[logical]!.trace).toHaveLength(1);
    const recovered = ensureRunnableWork(network).network.activations.at(-1)!;
    expect(recovered.id).not.toBe("a1");
    expect(reserveSchemaAttempts(ensureRunnableWork(network).network, recovered.id).activations.at(-1)!.schemaReservation).toMatchObject({ attemptOrdinal: 2, maxAttempts: 2 });
  });

  it("continues the child session after a scheduling quantum yield", () => {
    let network = reserveSchemaAttempts(initialNetwork("task"), "a1");
    network.activations[0]!.status = "running";
    const activation = network.activations[0]!;
    network = applyBatchRecords(network, [{
      activationId: activation.id, logicalActivationId: activation.logicalActivationId, regionId: activation.regionId, capability: activation.capability,
      basisRevision: activation.basisRevision, startedAt: 0, finishedAt: 1, sessionId: "child-1", usage, outcome: "deferred", error: "Agent scheduling quantum reached: turns", failureKind: "inactivity", retryable: true, progressText: "inspected files", networkDelta: null,
      promptAttempts: [{ physicalActivationId: activation.id, logicalActivationId: activation.logicalActivationId, attemptOrdinal: 1, kind: "initial", outcome: "submitted" }],
    }]).network;
    const scheduled = ensureRunnableWork(network).network.activations.at(-1)!;
    expect(scheduled).toMatchObject({ status: "queued", recovery: { sessionId: "child-1", strategy: "fork" } });
  });

  it("does not spend semantic retry budget on reboot-interrupted schema reservations", () => {
    let network = initialNetwork("task");
    network.activations[0]!.status = "completed";
    network.regions[0]!.status = "implemented";
    const enqueue = () => { network = queueActivation(network, "verify", "r1", "verify", "same-verification"); return network.activations.at(-1)!; };
    for (let index = 0; index < 2; index++) {
      const activation = enqueue();
      activation.status = "failed";
      activation.error = "Host process exited during a reserved schema attempt; the uncertain attempt was consumed and unused retries were released.";
    }
    const verifier = enqueue();
    verifier.status = "failed";
    verifier.error = "Agent scheduling quantum reached: turns";
    const recovered = ensureRunnableWork(network).network.activations.at(-1)!;
    expect(recovered).toMatchObject({ capability: "verify", status: "queued" });
    expect(recovered.id).not.toBe(verifier.id);
  });
});
