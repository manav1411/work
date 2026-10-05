import { useEffect, useRef, useState } from "react";

/** Preserve the device draft until the exact typed snapshot has reached the server. */
export function useInlineAutosave<T>(
  initial: T,
  key: string,
  persist: (value: T) => Promise<void>,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null")?.value ?? initial;
    } catch {
      return initial;
    }
  });
  const [state, setState] = useState("Saved");
  const [error, setError] = useState("");
  const [recovered, setRecovered] = useState(
    () => JSON.stringify(value) !== JSON.stringify(initial),
  );
  const blocked = useRef(recovered);
  const latest = useRef(value);
  latest.current = value;
  const saved = useRef(JSON.stringify(initial));
  const callback = useRef(persist);
  callback.current = persist;
  const busy = useRef(false);
  const alive = useRef(true);
  const retry = useRef<() => Promise<void>>(async () => {});
  retry.current = async () => {
    if (
      blocked.current ||
      busy.current ||
      JSON.stringify(latest.current) === saved.current
    )
      return;
    busy.current = true;
    if (alive.current) {
      setState("Saving…");
      setError("");
    }
    let failed = false;
    try {
      while (JSON.stringify(latest.current) !== saved.current) {
        const snapshot = structuredClone(latest.current);
        await callback.current(snapshot);
        saved.current = JSON.stringify(snapshot);
        if (JSON.stringify(latest.current) === saved.current)
          localStorage.removeItem(key);
      }
      if (alive.current) setState("Saved");
    } catch (failure) {
      failed = true;
      if (alive.current) {
        setState("Not saved");
        setError(
          failure instanceof Error
            ? failure.message
            : "Save failed. Your device draft is retained.",
        );
      }
    } finally {
      busy.current = false;
      if (!failed && JSON.stringify(latest.current) !== saved.current)
        void retry.current();
    }
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void retry.current();
    };
  }, []);
  useEffect(() => {
    if (JSON.stringify(value) === saved.current) return;
    try {
      localStorage.setItem(key, JSON.stringify({ value }));
    } catch {
      /* Keep typed values in memory. */
    }
    const timer = setTimeout(() => void retry.current(), 800);
    return () => clearTimeout(timer);
  }, [value, key]);
  return {
    value,
    setValue,
    state,
    error,
    recovered,
    acceptDraft: () => {
      blocked.current = false;
      setRecovered(false);
      void retry.current();
    },
    discardDraft: () => {
      blocked.current = false;
      setRecovered(false);
      setValue(initial);
      localStorage.removeItem(key);
    },
    flush: () => void retry.current(),
  };
}
