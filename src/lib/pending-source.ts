import {
  actionInput,
  goalInputSchema,
  type Goal,
  type GoalInput,
} from "../../shared/goals";
import type { UserPreferences } from "../../shared/model";
import {
  latexSourceSchema,
  type LatexProject,
  type LatexSource,
} from "../../shared/latex";
import { jsonRequest, request } from "./api";
import { isAutosaveActive, mergeAutosaveValues } from "./autosave";
import { mergeLatexProjects } from "./latex-autosave";
import { editorDraftsFor } from "./device-drafts";
import { learningUsername } from "../../shared/learning";

const sourceOf = (project: LatexProject): LatexSource => ({
  files: project.files,
  mainFile: project.mainFile,
  engine: project.engine,
});

/** Resume source saves after navigation or a browser restart, without opening the editor. */
export async function resumePendingSources(
  owner: string,
  canSave: () => boolean,
) {
  let changed = false;
  for (const draft of editorDraftsFor(owner)) {
    if (
      !draft.key.startsWith(`work:latex-draft:${owner}:`) ||
      isAutosaveActive(draft.key)
    )
      continue;
    if (!canSave()) break;
    try {
      const raw = JSON.parse(draft.value);
      if (raw.conflict === true) continue;
      if (raw.__autosave !== 1 || !Object.hasOwn(raw, "baseValue")) continue;
      const value: LatexProject | null = raw.value;
      if (!value) continue;
      const local = latexSourceSchema.safeParse(sourceOf(value));
      if (!local.success) continue;
      const id = draft.key.split(":").at(-1)!;
      const api = `/api/latex/${encodeURIComponent(id)}`;
      const { project: remote } = await request<{
        project: LatexProject | null;
      }>(api);
      if (
        !canSave() ||
        isAutosaveActive(draft.key) ||
        localStorage.getItem(draft.key) !== draft.value
      )
        continue;
      const base =
        raw.__autosave === 1 && raw.baseValue
          ? sourceOf(raw.baseValue)
          : remote
            ? sourceOf(remote)
            : local.data;
      const projectMerge = remote
        ? mergeLatexProjects({ ...value, ...base }, value, remote)
        : { value, conflict: false };
      const merged = {
        value: projectMerge.value ? sourceOf(projectMerge.value) : local.data,
        conflict: projectMerge.conflict,
      };
      if (merged.conflict) continue; // Both copies remain available in the editor.
      if (
        remote &&
        JSON.stringify(merged.value) === JSON.stringify(sourceOf(remote))
      ) {
        localStorage.removeItem(draft.key);
        continue;
      }
      // For a new source project the expected version is the parent record version.
      const version = remote?.version ?? raw.baseVersion ?? value.version;
      if (typeof version !== "number") continue;
      await request<{ project: LatexProject }>(
        api,
        jsonRequest("PUT", { ...merged.value, expectedVersion: version }),
      );
      if (!canSave()) break;
      if (localStorage.getItem(draft.key) === draft.value)
        localStorage.removeItem(draft.key);
      changed = true;
      // The server compiles saved source independently, including after navigation.
    } catch {
      // Keep the durable local copy for the next reconnect or editor visit.
    }
  }
  return changed;
}

/** Goals and preferences also have saves outside the record outbox. */
export async function resumePendingSettings(
  owner: string,
  canSave: () => boolean,
  onPreferences: (value: UserPreferences) => void,
) {
  for (const draft of editorDraftsFor(owner)) {
    const goalDraft = draft.key.startsWith(`work:goal-draft:${owner}:`);
    const settingsDraft = draft.key.startsWith(
      `work:preferences-draft:${owner}:`,
    );
    if (
      (!goalDraft && !settingsDraft) ||
      isAutosaveActive(draft.key) ||
      !canSave()
    )
      continue;
    try {
      const raw = JSON.parse(draft.value);
      if (raw.conflict === true) continue;
      if (raw.__autosave !== 1 || !raw.value || !raw.baseValue) continue;
      let savedPreferences: UserPreferences | undefined;
      if (goalDraft) {
        const id = draft.key.split(":").at(-1)!;
        const { goals } = await request<{ goals: Goal[] }>("/api/goals");
        const remote = goals.find((goal) => goal.id === id);
        if (!remote) continue;
        const remoteInput = actionInput(remote);
        const merged = mergeAutosaveValues(
          raw.baseValue as GoalInput,
          raw.value as GoalInput,
          remoteInput,
        );
        if (merged.conflict) continue;
        const parsed = goalInputSchema.safeParse({
          ...merged.value,
          title: merged.value.title.trim() || "Untitled action",
        });
        if (
          !parsed.success ||
          !canSave() ||
          isAutosaveActive(draft.key) ||
          localStorage.getItem(draft.key) !== draft.value
        )
          continue;
        if (JSON.stringify(parsed.data) !== JSON.stringify(remoteInput))
          await request(
            `/api/goals/${encodeURIComponent(id)}`,
            jsonRequest("PATCH", { ...parsed.data, version: remote.version }),
          );
      } else {
        const { preferences: remote } = await request<{
          preferences: UserPreferences;
        }>("/api/preferences");
        const merged = mergeAutosaveValues(
          raw.baseValue as UserPreferences,
          raw.value as UserPreferences,
          remote,
        );
        if (merged.conflict) continue;
        const value = merged.value;
        value.displayName = value.displayName.trim();
        value.timezone = value.timezone.trim();
        new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format();
        const rawHandle = value.leetcode.trim();
        const handle = learningUsername(rawHandle);
        if (rawHandle && !handle) continue;
        value.leetcode = handle;
        if (
          !canSave() ||
          isAutosaveActive(draft.key) ||
          localStorage.getItem(draft.key) !== draft.value
        )
          continue;
        const result = await request<{ preferences: UserPreferences }>(
          "/api/preferences",
          jsonRequest("PUT", value),
        );
        savedPreferences = result.preferences;
      }
      if (!canSave()) break;
      if (localStorage.getItem(draft.key) === draft.value)
        localStorage.removeItem(draft.key);
      if (savedPreferences) onPreferences(savedPreferences);
    } catch {
      // A pending value stays on this device until a later retry succeeds.
    }
  }
}
