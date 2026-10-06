import type {
  LatexProject as Project,
  LatexFile as ProjectFile,
} from "../../shared/latex";
import { mergeAutosaveValues } from "./autosave";

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
export function mergeLatexProjects(
  base: Project | null,
  local: Project | null,
  remote: Project | null,
): { value: Project | null; conflict: boolean } {
  if (!base || !local || !remote)
    return mergeAutosaveValues(base, local, remote);

  const mergedProject = mergeAutosaveValues(
    { ...base, files: [] },
    { ...local, files: [] },
    { ...remote, files: [] },
  );
  const baseFiles = new Map(base.files.map((file) => [file.path, file]));
  const localFiles = new Map(local.files.map((file) => [file.path, file]));
  const remoteFiles = new Map(remote.files.map((file) => [file.path, file]));
  const paths = new Set([
    ...remote.files.map((file) => file.path),
    ...local.files.map((file) => file.path),
    ...base.files.map((file) => file.path),
  ]);
  const files = new Map<string, ProjectFile>();
  let conflict = mergedProject.conflict;
  for (const path of paths) {
    const before = baseFiles.get(path);
    const mine = localFiles.get(path);
    const theirs = remoteFiles.get(path);
    if (!before) {
      if (mine && theirs && !same(mine, theirs)) conflict = true;
      const file = mine || theirs;
      if (file) files.set(path, file);
      continue;
    }
    if (!mine) {
      if (theirs && !same(theirs, before)) {
        conflict = true;
      }
      continue;
    }
    if (!theirs) {
      if (!same(mine, before)) {
        files.set(path, mine);
        conflict = true;
      }
      continue;
    }
    const mergedFile = mergeAutosaveValues(before, mine, theirs);
    conflict ||= mergedFile.conflict;
    files.set(path, mergedFile.value);
  }

  const orderedFiles = [
    ...remote.files.map((file) => files.get(file.path)).filter(Boolean),
    ...local.files
      .filter((file) => !remoteFiles.has(file.path))
      .map((file) => files.get(file.path))
      .filter(Boolean),
  ] as ProjectFile[];
  return {
    value: { ...mergedProject.value, files: orderedFiles },
    conflict,
  };
}
