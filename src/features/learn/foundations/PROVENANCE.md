# Learning foundations v1

Source: the owner's `Personal-website` repository, `src/components/learn`,
`src/data/curriculumWeeks.ts`, `src/data/roadmapData.ts`, `src/lib/content.ts`,
`src/lib/leetcode.ts` (types only), and `src/lib/leetcodeMetrics.ts`.
Adapted on 2026-10-04. This self-contained snapshot is version 1.
Source revision: `8839256caa0493f18e6839012c23b01438fadb30`.

`curriculumWeeks`, `roadmapData`, and `leetcodeMetrics` are vendored directly with
framework import aliases changed. Work's `shared/learning.ts` uses the source's
week, problem, task, and statistics contracts with bounded runtime validation.
`WeekBoard`, `WeekCard`, `SlideDeck`, `HomeworkList`, `DifficultyBadge`, and
`Roadmap` retain their source interactions and calculations, with Work's art
tokens, native accessible dialogs, and a shared authenticated data adapter.

Live authored slides/homework/tasks come from the personal site's public
`/api/admin/content` endpoint, not these seed titles. Statistics and accumulated
history come from its `/api/leetcode` endpoint. Manual curriculum task completion
uses its `/api/progress` endpoint and the same stable task IDs/LeetCode identity.
Work sends no private goals, applications, interviews, cookies, or auth tokens to
the source. Work's demo uses separate synthetic fixtures without network calls.

The public source identifies checklist owners by handle. These tasks remain
public curriculum checkboxes, not private career records. Accumulated solve
history is observation history, not a complete imported list of past solves.

To update the snapshot, compare those source paths, copy pure-data and metric
changes, adapt component changes, and run `learning.test.ts` and `prepare.spec.ts`.
No build or runtime import relies on the sibling repository being present.
