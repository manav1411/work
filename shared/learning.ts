import { z } from "zod";

// Adapted from Personal-website/src/lib/content.ts and lib/leetcode.ts.
// Stable task IDs and problem slugs are shared with the public learning source.
export const LEARNING_SOURCE = "https://manavdodia.com";
export const LEARNING_USERNAME = /^[A-Za-z0-9_-]{1,40}$/;
const slug = z.string().regex(/^[a-z0-9-]{1,200}$/);
export type ProblemDifficulty = "Easy" | "Medium" | "Hard";
export const difficultyCountSchema = z.object({
  difficulty: z.enum(["All", "Easy", "Medium", "Hard"]),
  count: z.number().int().nonnegative(),
});
const solvedProblemSchema = z.object({
  title: z.string().max(4000),
  titleSlug: slug,
});
export const learningStatsSchema = z.object({
  username: z.string().regex(LEARNING_USERNAME),
  profile: z.object({
    userAvatar: z.string().nullable(),
    ranking: z.number().nonnegative().nullable(),
  }),
  solved: z.array(difficultyCountSchema).max(4),
  totalQuestions: z.array(difficultyCountSchema).max(4),
  calendar: z.object({
    submissions: z.record(
      z.string().regex(/^\d+$/),
      z.number().int().nonnegative(),
    ),
  }),
  recent: z
    .array(solvedProblemSchema.extend({ timestamp: z.string().regex(/^\d+$/) }))
    .max(1000),
  solvedDays: z
    .record(z.string().regex(/^\d+$/), z.array(solvedProblemSchema).max(10000))
    .optional(),
});
export type LeetCodeStats = z.infer<typeof learningStatsSchema>;
export type DifficultyCount = z.infer<typeof difficultyCountSchema>;
export type Difficulty = DifficultyCount["difficulty"];
export type SolvedProblem = z.infer<typeof solvedProblemSchema>;
export interface LearningFreshness {
  fetchedAt: string | null;
  stale: boolean;
  error?: string;
}
export interface LearningSourceResponse<T> {
  data: T;
  source: LearningFreshness;
  username?: string;
  configured?: boolean;
}

export function learningUsername(value: string): string {
  const trimmed = value.trim().replace(/^@/, "");
  if (LEARNING_USERNAME.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      !["leetcode.com", "www.leetcode.com"].includes(url.hostname)
    )
      return "";
    const match = /^\/u\/([A-Za-z0-9_-]{1,40})\/?$/.exec(url.pathname);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}
