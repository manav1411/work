const SCHEMA = "current-workspace-2026-10";
export function clearWorkspaceDeviceStorage() {
  for (const storage of [localStorage, sessionStorage])
    for (const key of Object.keys(storage))
      if (key.startsWith("work") && key !== "work:storage-schema")
        storage.removeItem(key);
}
export function initializeDeviceStorage() {
  try {
    if (localStorage.getItem("work:storage-schema") !== SCHEMA) {
      clearWorkspaceDeviceStorage();
      localStorage.setItem("work:storage-schema", SCHEMA);
    }
  } catch {
    /* Storage is optional. */
  }
}
export function acceptWorkspaceEpoch(owner: string, epoch: string): boolean {
  if (typeof epoch !== "string" || !epoch)
    throw new Error(
      "The workspace response is missing its current generation.",
    );
  try {
    const key = `work:epoch:${owner}`,
      previous = localStorage.getItem(key);
    if (previous && previous !== epoch) {
      clearWorkspaceDeviceStorage();
      localStorage.setItem(key, epoch);
      return false;
    }
    localStorage.setItem(key, epoch);
  } catch {
    /* Cloud state remains authoritative. */
  }
  return true;
}
