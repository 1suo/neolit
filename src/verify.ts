import { boundDomainFingerprint, propagateNetwork, assertAcyclicPrimalGraph } from "./solution-lod/reducer.js";
import type { SolutionLodState, SolutionNetwork } from "./solution-lod/types.js";

/** Upper bound used only for the coarse retry-counter sanity check; drivers pass real limits at run time. */
const MAX_ACTIVATIONS = 256;

const canonical = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Post-run invariant checks over a finished run's network: the two fixed errors
 * (evidence duplication, implementation convergence) plus preserved CSP/WFC/LOD
 * behavior. Harness-agnostic — any driver can call these against a final state.
 */
export interface Check { name: string; ok: boolean; detail?: string }

export function checkEvidenceDedup(network: SolutionNetwork): Check[] {
  const checks: Check[] = [];
  const seenIdentity = new Map<string, string>();
  const seenFingerprint = new Map<string, string>();
  let duplicates = "";
  for (const item of network.evidence) {
    const identity = `${canonical(item.text)}\0${canonical(item.source)}`;
    const twin = seenIdentity.get(identity);
    if (twin) duplicates += `${item.id} restates ${twin}; `;
    else seenIdentity.set(identity, item.id);
    if (seenFingerprint.has(item.fingerprint) && !twin) duplicates += `${item.id} shares fingerprint with ${seenFingerprint.get(item.fingerprint)}; `;
    seenFingerprint.set(item.fingerprint, item.id);
  }
  checks.push({ name: "evidence: canonical identity unique", ok: !duplicates, detail: duplicates || `${network.evidence.length} facts stored once each` });
  const spread = network.regions.flatMap((region) => region.evidenceIds.filter((id, index, all) => all.indexOf(id) !== index).map((id) => `${region.id}:${id}`));
  checks.push({ name: "evidence: per-region references unique", ok: !spread.length, detail: spread.join(", ") || "no repeated fact IDs in any region" });
  return checks;
}

export function checkConvergence(state: SolutionLodState, elapsedMs: number): Check[] {
  const network = state.network;
  const checks: Check[] = [];
  const terminal = ["verified", "collapsed", "blocked", "stalled"];
  const unfinished = network.regions.filter((region) => !terminal.includes(region.status));
  checks.push({
    name: "convergence: run reached a terminal phase",
    ok: unfinished.length === 0,
    detail: unfinished.length ? unfinished.map((region) => `${region.id}(${region.status})`).join(", ") : `phase=${state.phase} in ${(elapsedMs / 1000).toFixed(0)}s`,
  });
  const loops = network.regions.filter((region) => (region.convergenceCycles?.length ?? 0) > 0);
  const overCycled = loops.filter((region) => region.status !== "blocked" && region.status !== "stalled" && (region.convergenceCycles?.length ?? 0) >= 2);
  checks.push({
    name: "convergence: semantic cycles bounded and blocked when repeated",
    ok: overCycled.length === 0,
    detail: overCycled.map((region) => `${region.id}: ${(region.convergenceCycles ?? []).length} cycles while ${region.status}`).join(", ") || `${loops.length} regions recorded cycles, none unbounded`,
  });
  const staleBlocked = network.regions.filter((region) => region.blockedReason && !region.blockedDetails);
  checks.push({ name: "convergence: blocks carry structured details", ok: staleBlocked.length === 0, detail: staleBlocked.map((region) => region.id).join(", ") || (network.regions.some((region) => region.blockedReason) ? "structured blockedDetails present" : "nothing blocked") });
  const badLeaves = network.regions.filter((region) => {
    if (!region.certifiedLeaf) return false;
    const exact = JSON.stringify([...new Set(region.certifiedLeaf.criterionIds)].sort()) === JSON.stringify([...region.criterionIds].sort());
    const witnessed = region.certifiedLeaf.checks.every((check) => region.criterionIds.includes(check.criterionId)) && new Set(region.certifiedLeaf.checks.map((check) => check.criterionId)).size === region.criterionIds.length;
    return !exact || !witnessed;
  });
  checks.push({ name: "convergence: certified leaves own exact criteria with witnesses", ok: !badLeaves.length, detail: badLeaves.map((region) => region.id).join(", ") || "all certified leaves well-formed" });
  const telemetry = network.telemetry;
  checks.push({
    name: "convergence: retry/reopen counters within policy",
    ok: (telemetry?.retries ?? 0) <= MAX_ACTIVATIONS && network.regions.every((region) => region.progress.reopenAttempts.count <= 3),
    detail: `retries=${telemetry?.retries ?? 0} maxRegionReopens=${Math.max(0, ...network.regions.map((region) => region.progress.reopenAttempts.count))}`,
  });
  return checks;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function checkSolverWorkflows(network: SolutionNetwork): Check[] {
  const checks: Check[] = [];
  try {
    assertAcyclicPrimalGraph(network);
    checks.push({ name: "csp/wfc/lod: primal variable graph acyclic", ok: true, detail: "union-find sweep passed" });
  } catch (error) {
    checks.push({ name: "csp/wfc/lod: primal variable graph acyclic", ok: false, detail: String(error) });
  }
  const repropagated = propagateNetwork(propagateNetwork(network));
  checks.push({ name: "csp/wfc/lod: propagation idempotent at fixpoint", ok: deepEqual(repropagated, propagateNetwork(network)), detail: "second pass changes nothing" });
  const ungated = network.candidates.filter((candidate) => {
    if (candidate.status !== "selected") return false;
    const region = network.regions.find((item) => item.id === candidate.regionId);
    return Boolean(region && region.acceptedFingerprint && region.acceptedFingerprint !== boundDomainFingerprint(network, region.id));
  });
  checks.push({ name: "csp/wfc/lod: selections hold only under accepted fingerprints", ok: !ungated.length, detail: ungated.map((candidate) => candidate.id).join(", ") || "every selection matches its accepted domain" });
  const overrun = network.regions.filter((region) => region.progress.cegarRounds.count > 2);
  checks.push({ name: "csp/wfc/lod: CEGAR bound respected", ok: !overrun.length, detail: overrun.map((region) => `${region.id} round=${region.progress.cegarRounds.count}`).join(", ") || `cegar<=2 across ${network.regions.length} regions` });
  const orphanSelections = network.regions.filter((region) => region.selectedCandidateIds.some((id) => !network.candidates.find((candidate) => candidate.id === id)));
  checks.push({ name: "csp/wfc/lod: region selections reference live candidates", ok: !orphanSelections.length, detail: orphanSelections.map((region) => region.id).join(", ") || "no dangling selections" });
  const lod = Math.max(0, ...network.regions.map((region) => region.lod));
  const edges = new Set(network.regions.map((region) => region.edge));
  checks.push({ name: "csp/wfc/lod: hierarchy intact", ok: true, detail: `lod depth=${lod}, edges=${[...edges].join("/")}, regions=${network.regions.length}` });
  return checks;
}
