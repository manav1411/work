import { useState } from "react";
import type {
  RecordInput,
  RecordPatch,
  UserPreferences,
} from "../../../shared/model";
import { useWorkspace } from "../../lib/workspace";

/** Form busy state is separate from the offline outbox, so queued work never locks editing. */
export function useSavingWorkspace() {
  const workspace = useWorkspace();
  const [pending, setPending] = useState(0);
  async function track<T>(operation: () => Promise<T>): Promise<T> {
    setPending((count) => count + 1);
    try {
      return await operation();
    } finally {
      setPending((count) => count - 1);
    }
  }
  return {
    ...workspace,
    pending,
    create: (input: RecordInput) => track(() => workspace.create(input)),
    update: (id: string, patch: RecordPatch, expectedVersion?: number) =>
      track(() => workspace.update(id, patch, expectedVersion)),
    remove: (id: string) => track(() => workspace.remove(id)),
    savePreferences: (patch: Partial<UserPreferences>) =>
      track(() => workspace.savePreferences(patch)),
  };
}
