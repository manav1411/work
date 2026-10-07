# Learning roadmap provenance

The static 150-problem catalogue and roadmap layout derive from the owner's Personal-website learning components and the NeetCode roadmap. The metrics and difficulty badges derive from the same source. The catalogue is centralized in `src/content/problems.ts`; the app has no runtime dependency on the sibling repository.

Only public LeetCode statistics are fetched. Problem solve observations support roadmap indicators; they are source statistics, not private workspace content revisions. Private notes, goals, applications, and credentials stay in Work. Browser demo statistics are synthetic and make no provider requests.

Verify catalogue, metrics, and UI changes with `learning.test.ts`, `prepare.test.ts`, and `prepare.spec.ts`.
