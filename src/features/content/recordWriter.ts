import { ApiError } from "../../lib/api";
import type {
  RecordInput,
  RecordPatch,
  WorkRecord,
} from "../../../shared/model";

/** Serialize creation and edits of one lazily created note so its first two edits cannot fork it. */
export function contentRecordWriter({
  read,
  input,
  create,
  update,
}: {
  read: () => WorkRecord | undefined;
  input: () => RecordInput;
  create: (input: RecordInput) => Promise<WorkRecord>;
  update: (
    id: string,
    patch: RecordPatch,
    expectedVersion?: number,
  ) => Promise<WorkRecord>;
}) {
  let captured: WorkRecord | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  return (
    patch: RecordPatch,
    expectedVersion?: number,
  ): Promise<WorkRecord> => {
    const write = async () => {
      const stored = read();
      const base =
        !captured ||
        (stored &&
          (stored.version > captured.version ||
            stored.updatedAt > captured.updatedAt))
          ? stored
          : captured;
      if (
        base &&
        expectedVersion !== undefined &&
        base.version !== expectedVersion
      )
        throw new ApiError("This note changed in another session.", 409);
      const seed = input();
      const data = patch.data
        ? { ...(base?.data ?? seed.data), ...patch.data }
        : undefined;
      const next = base
        ? await update(
            base.id,
            { ...patch, ...(data ? { data } : {}) },
            expectedVersion,
          )
        : await create({ ...seed, ...patch, data: data ?? seed.data });
      captured = next;
      return next;
    };
    const next = queue.catch(() => undefined).then(write);
    queue = next;
    return next;
  };
}
