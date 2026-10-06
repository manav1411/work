import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

type AutosaveEnvelope<T> = {
  __autosave: 1;
  baseValue: T;
  baseVersion?: number;
  value: T;
  conflict?: boolean;
  conflictServerValue?: T;
};

export type AutosavePersistResult<T> = {
  version?: number;
  value?: T;
  offline?: boolean;
};

type LegacyDraft<T> = { value: T; version?: number };

export type UseAutosaveOptions<T> = {
  initial: T;
  version?: number;
  storageKey: string;
  enabled?: boolean;
  persist: (
    value: T,
    expectedVersion?: number,
  ) => Promise<AutosavePersistResult<T> | void>;
  decodeLegacy?: (raw: unknown) => LegacyDraft<T> | undefined;
  refresh?: () => Promise<void>;
  validate?: (value: T) => string | null;
  merge?: (base: T, local: T, remote: T) => { value: T; conflict: boolean };
  /** Reflects a durable workspace outbox item after its network save has queued. */
  pending?: boolean;
};

export type UseAutosaveResult<T> = {
  value: T;
  setValue: Dispatch<SetStateAction<T>>;
  state: string;
  error: string;
  conflict: boolean;
  savedValue: T;
  flush: () => Promise<void>;
  keepLocal: () => Promise<void>;
  useSaved: () => void;
};

function equal(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type MergeResult = { value: unknown; conflicts: boolean };

function mergeThreeWay(
  base: unknown,
  local: unknown,
  remote: unknown,
): MergeResult {
  if (equal(local, base)) return { value: remote, conflicts: false };
  if (equal(remote, base) || equal(local, remote))
    return { value: local, conflicts: false };

  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    const merged: Record<string, unknown> = { ...remote };
    let conflicts = false;
    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);
    for (const key of keys) {
      const hadBase = Object.hasOwn(base, key);
      const hasLocal = Object.hasOwn(local, key);
      const hasRemote = Object.hasOwn(remote, key);
      const oldValue = hadBase ? base[key] : undefined;
      const localValue = hasLocal ? local[key] : undefined;
      const remoteValue = hasRemote ? remote[key] : undefined;
      const result = mergeThreeWay(oldValue, localValue, remoteValue);
      conflicts ||= result.conflicts;
      if (!hasLocal && !hadBase) continue;
      if (result.value === undefined && !hasLocal && !hasRemote) {
        delete merged[key];
      } else if (result.value === undefined && !hasLocal) {
        delete merged[key];
      } else {
        merged[key] = result.value;
      }
    }
    return { value: merged, conflicts };
  }

  return { value: local, conflicts: true };
}

/** Merge independent plain-object edits while preserving local text on overlap. */
export function mergeAutosaveValues<T>(
  base: T,
  local: T,
  remote: T,
): { value: T; conflict: boolean } {
  const merged = mergeThreeWay(base, local, remote);
  return { value: merged.value as T, conflict: merged.conflicts };
}

function defaultLegacy<T>(raw: unknown): LegacyDraft<T> | undefined {
  if (isPlainObject(raw) && Object.hasOwn(raw, "value")) {
    return {
      value: raw.value as T,
      ...(typeof raw.version === "number" ? { version: raw.version } : {}),
    };
  }
  return undefined;
}

function readStored<T>(
  key: string,
  decodeLegacy: (raw: unknown) => LegacyDraft<T> | undefined,
): AutosaveEnvelope<T> | undefined {
  try {
    const rawText = localStorage.getItem(key);
    if (rawText === null) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(rawText);
    } catch {
      raw = rawText;
    }
    if (
      isPlainObject(raw) &&
      raw.__autosave === 1 &&
      Object.hasOwn(raw, "value") &&
      Object.hasOwn(raw, "baseValue")
    )
      return raw as AutosaveEnvelope<T>;
    const legacy = decodeLegacy(raw);
    if (!legacy) return undefined;
    return {
      __autosave: 1,
      value: legacy.value,
      baseValue: undefined as T,
      ...(legacy.version !== undefined ? { baseVersion: legacy.version } : {}),
    };
  } catch {
    return undefined;
  }
}

function store<T>(key: string, envelope: AutosaveEnvelope<T>) {
  try {
    localStorage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    // The in-memory edit remains available if browser storage is unavailable.
    return false;
  }
}

function clearStored(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is a recovery aid; removing it must not interrupt the editor.
  }
}

export type AutosaveRecoveryCopy<T = unknown> = {
  savedAt: string;
  reason: "kept-local" | "used-saved";
  value: T;
  baseValue: T;
  baseVersion?: number;
};

function archiveKey(storageKey: string) {
  return `work:autosave-recovery:${encodeURIComponent(storageKey)}`;
}

/** Read up to three account-scoped copies displaced by a conflict choice. */
export function readAutosaveArchive<T = unknown>(
  storageKey: string,
): AutosaveRecoveryCopy<T>[] {
  try {
    const archive = JSON.parse(
      localStorage.getItem(archiveKey(storageKey)) ?? "[]",
    );
    return Array.isArray(archive) ? (archive as AutosaveRecoveryCopy<T>[]) : [];
  } catch {
    return [];
  }
}

export function archiveAutosaveCopy<T>(
  storageKey: string,
  copy: AutosaveRecoveryCopy<T>,
) {
  try {
    localStorage.setItem(
      archiveKey(storageKey),
      JSON.stringify([...readAutosaveArchive<T>(storageKey), copy].slice(-3)),
    );
  } catch {
    // Archival must not prevent a user from resolving a conflict.
  }
}

export function clearAutosaveArchive(storageKey: string) {
  try {
    localStorage.removeItem(archiveKey(storageKey));
  } catch {
    // Recovery copies are optional when browser storage is restricted.
  }
}

function retryable(failure: unknown) {
  const candidate = failure as {
    status?: unknown;
    name?: unknown;
    issues?: unknown;
  };
  if (candidate?.status === 0) return true;
  if (typeof candidate?.status === "number")
    return (
      candidate.status === 408 ||
      candidate.status === 429 ||
      candidate.status >= 500
    );
  if (Array.isArray(candidate?.issues)) return false;
  if (candidate?.name === "TypeError" || candidate?.name === "AbortError")
    return true;
  const message = failure instanceof Error ? failure.message : "";
  return /network|fetch|offline|timed out|timeout|connection/i.test(message);
}

function failureMessage(failure: unknown) {
  const issues = (failure as { issues?: { message?: string }[] } | null)?.issues;
  if (Array.isArray(issues) && typeof issues[0]?.message === "string")
    return issues[0].message;
  return failure instanceof Error ? failure.message : "Couldn’t save this yet.";
}

const activeFlushers = new Set<() => Promise<void>>();
const activeStorageKeys = new Map<string, number>();
let globalListeners = false;
let retryInterval: ReturnType<typeof setInterval> | undefined;
const visibilityListener = () => {
  if (typeof document !== "undefined" && document.visibilityState === "visible")
    flushAllActive();
};

function flushAllActive() {
  for (const flush of activeFlushers) void flush().catch(() => undefined);
}

function installGlobalListeners() {
  if (globalListeners || typeof window === "undefined") return;
  globalListeners = true;
  window.addEventListener("online", flushAllActive);
  window.addEventListener("focus", flushAllActive);
  document.addEventListener("visibilitychange", visibilityListener);
  retryInterval = setInterval(flushAllActive, 30_000);
}

function removeGlobalListeners() {
  if (
    !globalListeners ||
    activeFlushers.size > 0 ||
    typeof window === "undefined"
  )
    return;
  globalListeners = false;
  window.removeEventListener("online", flushAllActive);
  window.removeEventListener("focus", flushAllActive);
  document.removeEventListener("visibilitychange", visibilityListener);
  if (retryInterval) clearInterval(retryInterval);
  retryInterval = undefined;
}

/** Best-effort flush used before account changes and page teardown. */
export async function flushAutosaves(): Promise<void> {
  await Promise.allSettled([...activeFlushers].map((flush) => flush()));
}

export function isAutosaveActive(storageKey: string) {
  return (activeStorageKeys.get(storageKey) ?? 0) > 0;
}

function initialDraft<T>(
  initial: T,
  version: number | undefined,
  stored: AutosaveEnvelope<T> | undefined,
  merge: (base: T, local: T, remote: T) => { value: T; conflict: boolean },
) {
  if (!stored || equal(stored.value, initial))
    return {
      value: initial,
      baseline: initial,
      version,
      conflict: false,
    };

  if (
    version === undefined &&
    (initial === null || initial === undefined) &&
    stored.baseValue !== undefined
  ) {
    return {
      value: stored.value,
      baseline: stored.baseValue,
      version: stored.baseVersion,
      conflict: stored.conflict === true,
      ...(stored.conflictServerValue !== undefined
        ? { conflictServerValue: stored.conflictServerValue }
        : {}),
    };
  }

  if (stored.baseValue === undefined) {
    // Old drafts did not record a baseline. Resume automatically; the old
    // value alone is not evidence that another session changed the record.
    return { value: stored.value, baseline: initial, version, conflict: false };
  }

  const mergeBase =
    stored.conflict && stored.conflictServerValue !== undefined
      ? stored.conflictServerValue
      : stored.baseValue;
  const merged = merge(mergeBase, stored.value, initial);
  const hasConflict = stored.conflict === true || merged.conflict;
  return {
    value: merged.value,
    baseline: hasConflict ? stored.baseValue : initial,
    version,
    conflict: hasConflict,
    ...(hasConflict ? { conflictServerValue: initial } : {}),
  };
}

export function useAutosave<T>(
  options: UseAutosaveOptions<T>,
): UseAutosaveResult<T> {
  const {
    initial,
    version,
    storageKey,
    enabled = true,
    persist,
    decodeLegacy,
    refresh,
    validate,
    merge = mergeAutosaveValues,
    pending = false,
  } = options;
  const [storedAtMount] = useState<AutosaveEnvelope<T> | undefined>(() =>
    readStored<T>(storageKey, decodeLegacy ?? defaultLegacy<T>),
  );
  const storedDraft = useRef(storedAtMount);
  const previousStorageKey = useRef(storageKey);
  const [seed] = useState(() =>
    initialDraft<T>(initial, version, storedAtMount, merge),
  );
  const [value, setValueState] = useState<T>(seed.value);
  const [state, setState] = useState(
    pending ? "Offline—will sync" : seed.conflict ? "Couldn’t save" : "Saved",
  );
  const [error, setError] = useState(
    seed.conflict ? "This content changed elsewhere. Review both copies." : "",
  );
  const errorRef = useRef(error);
  const [conflict, setConflict] = useState(seed.conflict);
  const latest = useRef(seed.value);
  const savedValueRef = useRef(initial);
  const baseline = useRef(seed.baseline);
  const conflictServerValue = useRef(seed.conflictServerValue);
  const expectedVersion = useRef(version);
  const remoteValue = useRef(initial);
  const remoteVersion = useRef(version);
  const initialRef = useRef(initial);
  const callback = useRef(persist);
  const validateRef = useRef(validate);
  const decodeLegacyRef = useRef(decodeLegacy);
  const mergeRef = useRef(merge);
  const refreshRef = useRef(refresh);
  const keyRef = useRef(storageKey);
  const enabledRef = useRef(enabled);
  const canPersist = useRef(enabled);
  const hadEnabled = useRef(enabled);
  const pendingRef = useRef(pending);
  const conflictRef = useRef(seed.conflict);
  const busy = useRef(false);
  const localDurable = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const retryDelay = useRef(1_000);
  const retryRequested = useRef(false);
  const scopeGeneration = useRef(0);
  const stagedRemote = useRef<{ value: T; version?: number } | null>(null);
  const dirty = useRef(!equal(seed.value, initial));
  const serializedInitial = useRef(JSON.stringify(initial));
  const lastPropVersion = useRef(version);

  callback.current = persist;
  validateRef.current = validate;
  decodeLegacyRef.current = decodeLegacy;
  mergeRef.current = merge;
  refreshRef.current = refresh;
  initialRef.current = initial;
  enabledRef.current = enabled;
  if (enabled) canPersist.current = true;
  pendingRef.current = pending;
  keyRef.current = storageKey;
  errorRef.current = error;

  const writeLocal = useCallback((next: T) => {
    if (equal(next, savedValueRef.current) && !conflictRef.current) {
      clearStored(keyRef.current);
      return;
    }
    const stored = store(keyRef.current, {
      __autosave: 1,
      baseValue: baseline.current,
      baseVersion: expectedVersion.current,
      value: next,
      ...(conflictRef.current
        ? { conflict: true, conflictServerValue: conflictServerValue.current }
        : {}),
    });
    localDurable.current = stored;
    const storageError =
      "Device storage is unavailable. Keep this page open until saving finishes.";
    if (!stored) {
      setState("Couldn’t save");
      setError(storageError);
    } else if (errorRef.current === storageError) {
      setError("");
      setState(pendingRef.current ? "Offline—will sync" : "Saving…");
    }
  }, []);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      const next =
        typeof action === "function"
          ? (action as (previous: T) => T)(latest.current)
          : action;
      latest.current = next;
      dirty.current = !equal(next, savedValueRef.current);
      setValueState(next);
      writeLocal(next);
      if (!conflictRef.current) {
        setError("");
        if (dirty.current && !pendingRef.current) setState("Saving…");
      }
    },
    [writeLocal],
  );
  const reconcileRemoteRef = useRef<
    (incoming: T, incomingVersion?: number, schedule?: boolean) => void
  >(() => {});

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (!canPersist.current) return;
    if (conflictRef.current) return;
    if (!dirty.current || equal(latest.current, savedValueRef.current)) {
      dirty.current = false;
      clearStored(keyRef.current);
      setError("");
      setState(pendingRef.current ? "Offline—will sync" : "Saved");
      return;
    }
    if (busy.current) {
      retryRequested.current = true;
      await inFlight.current;
      return;
    }

    busy.current = true;
    setState("Saving…");
    const task = (async () => {
      let failed = false;
      try {
        do {
          retryRequested.current = false;
          while (
            !conflictRef.current &&
            !equal(latest.current, savedValueRef.current)
          ) {
            const snapshot = latest.current;
            const issue = validateRef.current?.(snapshot) ?? null;
            if (issue) {
              setError(issue);
              setState("Couldn’t save");
              failed = true;
              break;
            }
            const generation = scopeGeneration.current;
            try {
              const result = await callback.current(
                snapshot,
                expectedVersion.current,
              );
              if (generation !== scopeGeneration.current) {
                retryRequested.current = true;
                break;
              }
              const normalized = result?.value ?? snapshot;
              baseline.current = normalized;
              savedValueRef.current = normalized;
              if (result?.version !== undefined)
                expectedVersion.current = result.version;
              remoteValue.current = normalized;
              remoteVersion.current = expectedVersion.current;
              retryDelay.current = 1_000;
              setError("");
              if (equal(latest.current, snapshot)) {
                latest.current = normalized;
                setValueState(normalized);
                dirty.current = false;
                if (conflictRef.current) setConflict(false);
                conflictRef.current = false;
                clearStored(keyRef.current);
              } else {
                dirty.current = !equal(latest.current, normalized);
                writeLocal(latest.current);
              }
              if (result?.offline) pendingRef.current = true;
              const staged = stagedRemote.current;
              if (staged) {
                stagedRemote.current = null;
                serializedInitial.current = JSON.stringify(staged.value);
                lastPropVersion.current = staged.version;
                if (
                  staged.version === undefined ||
                  result?.version === undefined ||
                  staged.version > result.version ||
                  equal(staged.value, normalized)
                ) {
                  reconcileRemoteRef.current(
                    staged.value,
                    staged.version,
                    false,
                  );
                }
              }
            } catch (failure) {
              if (generation !== scopeGeneration.current) {
                failed = false;
                retryRequested.current = true;
                break;
              }
              failed = true;
              const status = (failure as { status?: number })?.status;
              if (status === 409) {
                const staged = stagedRemote.current;
                stagedRemote.current = null;
                if (staged) {
                  serializedInitial.current = JSON.stringify(staged.value);
                  lastPropVersion.current = staged.version;
                  reconcileRemoteRef.current(
                    staged.value,
                    staged.version,
                    false,
                  );
                }
                if (!staged || conflictRef.current) {
                  conflictRef.current = true;
                  setConflict(true);
                  setState("Couldn’t save");
                  setError(failureMessage(failure));
                  writeLocal(latest.current);
                } else {
                  failed = false;
                  retryRequested.current = true;
                }
                void refreshRef.current?.().catch(() => undefined);
              } else if (retryable(failure)) {
                setState(
                  localDurable.current ? "Offline—will sync" : "Couldn’t save",
                );
                setError(
                  localDurable.current
                    ? ""
                    : "Device storage is unavailable. Keep this page open until saving finishes.",
                );
                clearTimeout(retryTimer.current);
                retryTimer.current = setTimeout(() => {
                  retryDelay.current = Math.min(retryDelay.current * 2, 60_000);
                  void flushRef.current();
                }, retryDelay.current);
              } else {
                setState("Couldn’t save");
                setError(failureMessage(failure));
              }
              break;
            }
          }
        } while (retryRequested.current && !failed);
        if (!failed && !conflictRef.current) {
          const hasUnsaved = !equal(latest.current, savedValueRef.current);
          dirty.current = hasUnsaved;
          setState(
            pendingRef.current
              ? "Offline—will sync"
              : hasUnsaved
                ? "Saving…"
                : "Saved",
          );
          if (hasUnsaved) retryRequested.current = true;
        }
      } finally {
        busy.current = false;
        inFlight.current = null;
      }
      if (retryRequested.current && !failed && enabledRef.current)
        void flushRef.current();
    })();
    inFlight.current = task;
    await task;
  }, [writeLocal]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const keepLocal = useCallback(async () => {
    archiveAutosaveCopy<T>(keyRef.current, {
      savedAt: new Date().toISOString(),
      reason: "kept-local",
      value: remoteValue.current,
      baseValue: baseline.current,
      baseVersion: remoteVersion.current,
    });
    baseline.current = initialRef.current;
    expectedVersion.current = remoteVersion.current;
    savedValueRef.current = remoteValue.current;
    conflictServerValue.current = undefined;
    conflictRef.current = false;
    setConflict(false);
    setError("");
    dirty.current = !equal(latest.current, savedValueRef.current);
    writeLocal(latest.current);
    await flushRef.current();
  }, [writeLocal]);

  const useSaved = useCallback(() => {
    const next = initialRef.current;
    archiveAutosaveCopy<T>(keyRef.current, {
      savedAt: new Date().toISOString(),
      reason: "used-saved",
      value: latest.current,
      baseValue: baseline.current,
      baseVersion: expectedVersion.current,
    });
    baseline.current = next;
    savedValueRef.current = next;
    remoteValue.current = next;
    expectedVersion.current = remoteVersion.current;
    conflictServerValue.current = undefined;
    latest.current = next;
    dirty.current = false;
    conflictRef.current = false;
    setConflict(false);
    setError("");
    setValueState(next);
    setState(pendingRef.current ? "Offline—will sync" : "Saved");
    clearStored(keyRef.current);
  }, []);

  useEffect(() => {
    if (previousStorageKey.current === storageKey) return;
    previousStorageKey.current = storageKey;
    scopeGeneration.current += 1;
    stagedRemote.current = null;
    clearTimeout(timer.current);
    clearTimeout(retryTimer.current);
    const stored = readStored<T>(
      storageKey,
      decodeLegacyRef.current ?? defaultLegacy<T>,
    );
    storedDraft.current = stored;
    const next = initialDraft(
      initialRef.current,
      version,
      stored,
      mergeRef.current,
    );
    baseline.current = next.baseline;
    conflictServerValue.current = next.conflictServerValue;
    expectedVersion.current = next.version;
    savedValueRef.current = initialRef.current;
    remoteValue.current = initialRef.current;
    remoteVersion.current = version;
    latest.current = next.value;
    dirty.current = !equal(next.value, initialRef.current);
    conflictRef.current = next.conflict;
    setValueState(next.value);
    setConflict(next.conflict);
    setError(
      next.conflict
        ? "This content changed elsewhere. Review both copies."
        : "",
    );
    setState(
      next.conflict
        ? "Couldn’t save"
        : pendingRef.current
          ? "Offline—will sync"
          : dirty.current
            ? "Saving…"
            : "Saved",
    );
    serializedInitial.current = JSON.stringify(initialRef.current);
    lastPropVersion.current = version;
    if (dirty.current) writeLocal(next.value);
    else clearStored(storageKey);
  }, [storageKey, version, writeLocal]);

  const serverFingerprint = JSON.stringify(initial);
  reconcileRemoteRef.current = (incoming, incomingVersion, schedule = true) => {
    remoteValue.current = incoming;
    remoteVersion.current = incomingVersion;
    if (equal(incoming, latest.current)) {
      baseline.current = incoming;
      savedValueRef.current = incoming;
      expectedVersion.current = incomingVersion;
      dirty.current = false;
      conflictRef.current = false;
      conflictServerValue.current = undefined;
      setConflict(false);
      setError("");
      clearStored(keyRef.current);
      setState(pendingRef.current ? "Offline—will sync" : "Saved");
      return;
    }
    if (!dirty.current || equal(latest.current, savedValueRef.current)) {
      baseline.current = incoming;
      savedValueRef.current = incoming;
      expectedVersion.current = incomingVersion;
      latest.current = incoming;
      dirty.current = false;
      conflictRef.current = false;
      conflictServerValue.current = undefined;
      setConflict(false);
      setError("");
      setValueState(incoming);
      clearStored(keyRef.current);
      setState(pendingRef.current ? "Offline—will sync" : "Saved");
      return;
    }

    const base =
      conflictRef.current && conflictServerValue.current !== undefined
        ? conflictServerValue.current
        : baseline.current;
    const merged = mergeRef.current(base, latest.current, incoming);
    const remainsConflict = conflictRef.current || merged.conflict;
    if (!remainsConflict) baseline.current = incoming;
    if (remainsConflict) conflictServerValue.current = incoming;
    savedValueRef.current = incoming;
    expectedVersion.current = incomingVersion;
    latest.current = merged.value;
    dirty.current = !equal(merged.value, incoming);
    setValueState(merged.value);
    conflictRef.current = remainsConflict;
    setConflict(remainsConflict);
    if (remainsConflict) {
      setState("Couldn’t save");
      setError("This content changed elsewhere. Review both copies.");
    } else {
      setError("");
      setState(dirty.current ? "Saving…" : "Saved");
    }
    writeLocal(merged.value);
    if (schedule && dirty.current && !remainsConflict) void flushRef.current();
  };
  useEffect(() => {
    const valueChanged = serializedInitial.current !== serverFingerprint;
    const previousVersion = lastPropVersion.current;
    const versionChanged = previousVersion !== version;
    if (!valueChanged && !versionChanged) return;
    const incoming = initialRef.current;
    const incomingVersion = version;
    if (busy.current) {
      stagedRemote.current = { value: incoming, version: incomingVersion };
      return;
    }
    serializedInitial.current = serverFingerprint;
    lastPropVersion.current = incomingVersion;

    // Async editors may mount before their first network read. That first
    // versioned value establishes the baseline for any browser copy.
    if (previousVersion === undefined && incomingVersion !== undefined) {
      const stored = storedDraft.current;
      const hydrationBase = stored?.conflictServerValue ?? stored?.baseValue;
      const mergedHydration =
        hydrationBase !== undefined
          ? mergeRef.current(hydrationBase, latest.current, incoming)
          : { value: latest.current, conflict: false };
      const hydrated = {
        ...mergedHydration,
        conflict: stored?.conflict === true || mergedHydration.conflict,
      };
      if (!hydrated.conflict) baseline.current = incoming;
      else conflictServerValue.current = incoming;
      savedValueRef.current = incoming;
      expectedVersion.current = incomingVersion;
      remoteValue.current = incoming;
      remoteVersion.current = incomingVersion;
      if (!dirty.current) {
        latest.current = incoming;
        dirty.current = false;
        setValueState(incoming);
        clearStored(keyRef.current);
      } else {
        latest.current = hydrated.value;
        dirty.current = !equal(hydrated.value, incoming);
        conflictRef.current = hydrated.conflict;
        setConflict(hydrated.conflict);
        writeLocal(hydrated.value);
      }
      if (hydrated.conflict && dirty.current) {
        setState("Couldn’t save");
        setError("This content changed elsewhere. Review both copies.");
      } else {
        conflictRef.current = false;
        setConflict(false);
        setError("");
        setState(
          dirty.current
            ? "Saving…"
            : pendingRef.current
              ? "Offline—will sync"
              : "Saved",
        );
        if (dirty.current && enabledRef.current) void flushRef.current();
      }
      return;
    }
    reconcileRemoteRef.current(incoming, incomingVersion);
  }, [serverFingerprint, version, writeLocal]);

  useEffect(() => {
    if (pending) {
      setState("Offline—will sync");
      pendingRef.current = true;
    } else {
      pendingRef.current = false;
      if (!dirty.current && !conflictRef.current) setState("Saved");
      else if (dirty.current && !conflictRef.current) void flushRef.current();
    }
  }, [pending]);

  useEffect(() => {
    const wasEnabled = hadEnabled.current;
    hadEnabled.current = enabled;
    if (!enabled) {
      if (wasEnabled) void flushRef.current();
      return;
    }
    if (!dirty.current || conflictRef.current) return;
    writeLocal(latest.current);
    setState(pendingRef.current ? "Offline—will sync" : "Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), 700);
    return () => clearTimeout(timer.current);
  }, [value, enabled, writeLocal]);

  useEffect(() => {
    activeStorageKeys.set(
      storageKey,
      (activeStorageKeys.get(storageKey) ?? 0) + 1,
    );
    return () => {
      const count = (activeStorageKeys.get(storageKey) ?? 1) - 1;
      if (count > 0) activeStorageKeys.set(storageKey, count);
      else activeStorageKeys.delete(storageKey);
    };
  }, [storageKey]);

  useEffect(() => {
    const registeredFlush = async () => flushRef.current();
    activeFlushers.add(registeredFlush);
    installGlobalListeners();
    return () => {
      clearTimeout(timer.current);
      clearTimeout(retryTimer.current);
      if (canPersist.current) void flushRef.current();
      activeFlushers.delete(registeredFlush);
      removeGlobalListeners();
    };
  }, []);

  return {
    value,
    setValue,
    state,
    error,
    conflict,
    savedValue: savedValueRef.current,
    flush,
    keepLocal,
    useSaved,
  };
}
