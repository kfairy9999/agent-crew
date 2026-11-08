import { z } from "zod";

export const planSchema = z.object({
  audience: z.string().trim().min(1).max(160),
  thesis: z.string().trim().min(1).max(400),
  questions: z.array(z.string().trim().min(1).max(200)).min(1).max(4),
  searchQueries: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
  outline: z.array(z.string().trim().min(1).max(80)).min(1).max(4),
  rationale: z.string().trim().min(1).max(400),
});

export const researchSchema = z.object({
  rationale: z.string().trim().min(1).max(400),
  notes: z
    .array(
      z.object({
        claim: z.string().trim().min(1).max(400),
        sourceIds: z.array(z.number().int().positive()).min(1).max(4),
        confidence: z.enum(["low", "medium", "high"]),
      }),
    )
    .max(6),
  gaps: z.array(z.string().trim().min(1).max(240)).max(4),
});

export const draftSchema = z.object({
  title: z.string().trim().min(1).max(140),
  summary: z.string().trim().min(1).max(800),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(1).max(80),
        paragraphs: z.array(z.string().trim().min(1).max(700)).min(1).max(3),
      }),
    )
    .min(1)
    .max(4),
  rationale: z.string().trim().min(1).max(400),
});

export const critiqueSchema = z.object({
  verdict: z.enum(["approve", "revise"]),
  issues: z.array(z.string().trim().min(1).max(300)).max(5),
  rationale: z.string().trim().min(1).max(400),
});

export const runBodySchema = z.object({
  topic: z
    .string()
    .trim()
    .min(8, "Give the crew at least a short assignment.")
    .max(400, "Keep the assignment under 400 characters."),
  mode: z.enum(["demo", "live"]).default("demo"),
  pace: z.enum(["realtime", "instant"]).default("realtime"),
});
