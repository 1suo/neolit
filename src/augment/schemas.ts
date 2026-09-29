import { z } from "zod";

const pathPattern = z.string().min(1).max(512).refine((value) => !value.includes("\\") && !value.includes("\0") && value !== ".");

export const DomainCandidateSchema = z.object({
  label: z.string().min(1).max(240),
  rationale: z.string().min(1).max(4000),
  touchedPaths: z.array(pathPattern).min(1).max(64),
});

export const DomainProposalSchema = z.object({
  candidates: z.array(DomainCandidateSchema).min(1).max(7),
});

export const ChallengeDomainSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accept") }),
  z.object({ kind: z.literal("missing-candidate"), candidate: DomainCandidateSchema, reason: z.string().min(1).max(4000) }),
  z.object({ kind: z.literal("missing-path"), path: pathPattern, reason: z.string().min(1).max(4000) }),
]);

export const RefinementObligationSchema = z.object({
  kind: z.enum(["test", "documentation", "check", "todo"]),
  description: z.string().min(1).max(2000),
});

export const RefinementChildSchema = z.object({
  path: pathPattern.optional(),
  kind: z.enum(["dir", "file", "hunk", "virtual"]),
  lod: z.enum(["architecture", "file", "hunk"]),
  reason: z.string().min(1).max(4000),
  obligations: z.array(RefinementObligationSchema).max(16).optional(),
  diff: z.object({ patch: z.string().min(1) }).optional(),
});

export const RefinementProposalSchema = z.object({
  children: z.array(RefinementChildSchema).min(1).max(16),
});

export const PatchProposalSchema = z.object({
  patch: z.string().min(1),
  assumptions: z.array(z.string().min(1).max(2000)).max(32).default([]),
});

export type DomainProposal = z.infer<typeof DomainProposalSchema>;
export type ChallengeDomainProposal = z.infer<typeof ChallengeDomainSchema>;
export type RefinementProposal = z.infer<typeof RefinementProposalSchema>;
export type PatchProposal = z.infer<typeof PatchProposalSchema>;
