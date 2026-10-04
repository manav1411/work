import { useEffect, useRef, useState } from "react";
import { Eye, Pencil, RefreshCw } from "lucide-react";
import type { RecordInput, WorkRecord } from "../../../shared/model";
import {
  Button,
  Field,
  Markdown,
  SaveState,
  Textarea,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { ApiError } from "../../lib/api";
import "./content.css";

export function AutosaveNote({
  record,
  input,
  draftKey,
  label = "Notes",
  initialBody = "",
  onSaved,
  persist,
}: {
  record?: WorkRecord;
  input: RecordInput;
  draftKey: string;
  label?: string;
  initialBody?: string;
  onSaved?: (record: WorkRecord) => void;
  persist?: (body: string, expectedVersion?: number) => Promise<WorkRecord>;
}) {
  const { create, update, refresh, user, pending } = useWorkspace();
  const storageKey = `work-content-draft:${user?.id ?? "anonymous"}:${draftKey}`;
  const starting = record?.body ?? initialBody;
  const [body, setBody] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? starting;
    } catch {
      return starting;
    }
  });
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<"saved" | "saving" | "draft" | "error">(
    body === starting ? "saved" : "error",
  );
  const [error, setError] = useState(
    body === starting ? "" : "Recovered unsaved text. Review it before saving.",
  );
  const [needsReview, setNeedsReview] = useState(body !== starting);
  const [draftStored, setDraftStored] = useState(body !== starting);
  const [revision, setRevision] = useState(0);
  const saved = useRef(starting);
  const baseVersion = useRef(record?.version);
  const currentBody = useRef(body);
  currentBody.current = body;
  const recordRef = useRef(record);
  if (record) recordRef.current = record;
  const inputRef = useRef(input);
  inputRef.current = input;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const callbackRef = useRef(onSaved);
  callbackRef.current = onSaved;
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const next = record?.body ?? initialBody;
    if (saving.current) return;
    if (next === saved.current) {
      // Updating tags, references or the title does not change this editor's text.
      baseVersion.current = record?.version;
      return;
    }
    if (currentBody.current !== saved.current) {
      setNeedsReview(true);
      setState("error");
      setError(
        "Saved text changed while you were editing. Compare the versions before retrying.",
      );
      return;
    }
    saved.current = next;
    baseVersion.current = record?.version;
    currentBody.current = next;
    setBody(next);
  }, [record?.body, record?.version, initialBody]);
  useEffect(() => {
    if (
      state === "draft" &&
      !pending &&
      body === saved.current &&
      record &&
      !record.id.startsWith("offline-")
    )
      setState("saved");
  }, [pending, state, body, record]);
  useEffect(() => {
    if (body === saved.current || saving.current || state === "error") return;
    try {
      localStorage.setItem(storageKey, body);
      setDraftStored(true);
    } catch {
      setDraftStored(false);
      /* The workspace outbox remains available. */
    }
    const timer = window.setTimeout(async () => {
      saving.current = true;
      setState("saving");
      const value = currentBody.current;
      try {
        const next = persistRef.current
          ? await persistRef.current(value, baseVersion.current)
          : recordRef.current
            ? await update(
                recordRef.current.id,
                { body: value },
                baseVersion.current,
              )
            : await create({ ...inputRef.current, body: value });
        recordRef.current = next;
        saved.current = value;
        baseVersion.current = next.version;
        callbackRef.current?.(next);
        if (currentBody.current === value) {
          try {
            localStorage.removeItem(storageKey);
          } catch {
            /* Optional device storage. */
          }
        }
        if (mounted.current) {
          setError("");
          setNeedsReview(false);
          setState(
            next.id.startsWith("offline-") || pending > 0 ? "draft" : "saved",
          );
        }
      } catch (failure) {
        if (mounted.current) {
          setState("error");
          if (failure instanceof ApiError && failure.status === 409)
            setNeedsReview(true);
          setError(
            failure instanceof Error
              ? failure.message
              : "Notes could not be saved.",
          );
        }
      } finally {
        saving.current = false;
        if (mounted.current) setRevision((value) => value + 1);
      }
    }, 850);
    return () => window.clearTimeout(timer);
  }, [body, create, update, storageKey, state, revision, pending]);
  return (
    <div className="content-note">
      <div className="content-note-toolbar">
        <SaveState state={pending > 0 && state === "saved" ? "draft" : state} />
        <Button variant="ghost" onClick={() => setEditing(!editing)}>
          {editing ? <Eye size={15} /> : <Pencil size={15} />}
          {editing ? "Preview" : body ? "Edit notes" : "Write notes"}
        </Button>
      </div>
      {editing ? (
        <Field
          label={label}
          hint="Markdown supports headings, links, lists and checklists (- [ ]). Changes save automatically."
        >
          <Textarea
            rows={8}
            value={body}
            onChange={(event) => {
              const value = event.target.value;
              currentBody.current = value;
              setBody(value);
              setState(needsReview ? "error" : "draft");
              try {
                localStorage.setItem(storageKey, value);
                setDraftStored(true);
              } catch {
                setDraftStored(false);
                /* Optional storage. */
              }
            }}
          />
        </Field>
      ) : body ? (
        <Markdown content={body} />
      ) : (
        <p className="muted">
          Add things to remember, a checklist, or a thought.
        </p>
      )}
      {error && (
        <div role="alert" className="content-save-error">
          <span>
            {error}{" "}
            {draftStored
              ? "Your text is retained on this device."
              : "Your text is retained in this editor."}
          </span>
          {needsReview && record && (
            <details className="content-conflict-preview">
              <summary>Compare with saved text</summary>
              <Markdown content={record.body} />
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await refresh();
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "Latest saved text could not be loaded.",
                    );
                  }
                }}
              >
                Load latest saved text
              </Button>
            </details>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              setNeedsReview(false);
              baseVersion.current = recordRef.current?.version;
              setState("draft");
              setRevision((value) => value + 1);
            }}
          >
            <RefreshCw size={15} />
            Retry save
          </Button>
        </div>
      )}
    </div>
  );
}
