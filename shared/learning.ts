import { z } from "zod";

// Adapted from Personal-website/src/lib/content.ts and lib/leetcode.ts.
// Stable task IDs and problem slugs are shared with the public learning source.
export const LEARNING_SOURCE = "https://manavdodia.com";
export const LEARNING_USERNAME = /^[A-Za-z0-9_-]{1,40}$/;
export const LEARNING_TASK_ID = /^[A-Za-z0-9_-]{1,100}$/;
const slug = z.string().regex(/^[a-z0-9-]{1,200}$/);
export const problemSchema = z.object({
  name: z.string().min(1).max(4000),
  slug,
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
});
const topicSchema = z.object({ homework: z.array(problemSchema).max(200) });
export const weekSchema = z.object({
  week: z.number().int().min(1).max(200),
  title: z.string().min(1).max(4000),
  accessible: z.boolean(),
  slides: z.array(z.object({ content: z.string().max(20000) })).max(200),
  topic2SlideStart: z.number().int().min(0).max(200),
  topics: z.tuple([topicSchema, topicSchema]),
  tasks: z
    .array(
      z.object({
        id: z.string().regex(LEARNING_TASK_ID),
        label: z.string().min(1).max(4000),
      }),
    )
    .max(200)
    .optional(),
});
export const learningContentSchema = z
  .object({
    weeks: z.array(weekSchema).min(1).max(200),
  })
  .superRefine(({ weeks }, context) => {
    const weekIds = new Set<number>();
    const taskIds = new Set<string>();
    for (const week of weeks) {
      if (weekIds.has(week.week))
        context.addIssue({ code: "custom", message: "Duplicate week number" });
      weekIds.add(week.week);
      for (const task of week.tasks ?? []) {
        if (taskIds.has(task.id))
          context.addIssue({ code: "custom", message: "Duplicate task ID" });
        taskIds.add(task.id);
      }
    }
  });
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
export const learningProgressSchema = z
  .object({
    tasks: z.record(z.string().regex(LEARNING_TASK_ID), z.boolean()),
  })
  .refine(({ tasks }) => Object.keys(tasks).length <= 500, "Too many tasks");
export const learningToggleSchema = z
  .object({
    taskId: z.string().regex(LEARNING_TASK_ID),
    done: z.boolean(),
  })
  .strict();

export type Week = z.infer<typeof weekSchema>;
export type Slide = Week["slides"][number];
export type HomeworkProblem = z.infer<typeof problemSchema>;
export type ProblemDifficulty = HomeworkProblem["difficulty"];
export type WeekTask = NonNullable<Week["tasks"]>[number];
export type WeekTopic = Week["topics"][number];
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
