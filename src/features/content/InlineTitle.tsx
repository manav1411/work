import { useEffect, useRef, useState } from "react";
import { useEditMode } from "../../lib/edit-mode";
export function InlineTitle({
  value,
  onSave,
  label = "Name",
  autoFocus = false,
}: {
  value: string;
  onSave: (title: string) => Promise<unknown>;
  label?: string;
  autoFocus?: boolean;
}) {
  const { editing } = useEditMode();
  const [text, setText] = useState(value === "Untitled" ? "" : value);
  const [error, setError] = useState("");
  const latest = useRef(text);
  latest.current = text;
  const saved = useRef(value === "Untitled" ? "" : value);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  const flush = () => {
    clearTimeout(timer.current);
    const next = latest.current;
    if (saved.current === next) return;
    saved.current = next;
    queue.current = queue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await saveRef.current(next.trim() || "Untitled");
          setError("");
        } catch (failure) {
          saved.current = value;
          setError(
            failure instanceof Error
              ? failure.message
              : "Name could not be saved.",
          );
        }
      });
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  useEffect(() => {
    if (latest.current === saved.current) {
      const next = value === "Untitled" ? "" : value;
      latest.current = next;
      saved.current = next;
      setText(next);
    }
  }, [value]);
  return (
    <>
      {editing ? (
        <input
          className="inline-title"
          aria-label={label}
          placeholder="Untitled"
          maxLength={200}
          autoFocus={autoFocus}
          value={text}
          onBlur={flush}
          onChange={(event) => {
            latest.current = event.target.value;
            setText(event.target.value);
            clearTimeout(timer.current);
            timer.current = setTimeout(flush, 800);
          }}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        value
      )}
      {error && <small role="alert">{error}</small>}
    </>
  );
}
