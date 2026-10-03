import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Bold,
  Code,
  Download,
  Eye,
  FileText,
  History,
  ImagePlus,
  Link2,
  List,
  Pin,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import {
  arrayField,
  boolField,
  field,
  niceDate,
  type Attachment,
  type RecordRevision,
  type WorkRecord,
} from "../../../shared/model";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Markdown,
  Modal,
  PageHeader,
  RecordLinks,
  Select,
  Textarea,
} from "../../components/ui";
import {
  ApiError,
  downloadFile,
  getAttachments,
  getAttachmentUrl,
  getRevisions,
  removeAttachment,
  uploadAttachment,
} from "../../lib/api";
import { useWorkspace } from "../../lib/workspace";
import { NOTE_TEMPLATES } from "../../content/templates";
import { splitTags } from "../prepare/helpers";
import "../prepare/prepare.css";

interface NoteDraft {
  title: string;
  body: string;
  collection: string;
  tags: string;
  links: string[];
  version: number;
  savedAt: string;
}
const fromRecord = (record: WorkRecord): NoteDraft => ({
  title: record.title,
  body: record.body,
  collection: field(record, "collection", "Inbox"),
  tags: record.tags.join(", "),
  links: record.links,
  version: record.version,
  savedAt: record.updatedAt,
});
const draftContent = (draft: NoteDraft) =>
  JSON.stringify([
    draft.title,
    draft.body,
    draft.collection,
    draft.tags,
    draft.links,
  ]);

export function NotesPage() {
  const { records, create, notify } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("All collections");
  const [template, setTemplate] = useState("blank");
  const [creating, setCreating] = useState(false);
  const notes = records.filter((record) => record.kind === "note");
  const selected = notes.find((note) => note.id === params.get("record"));
  const collections = [
    ...new Set([
      "Inbox",
      ...notes.map((note) => field(note, "collection", "Inbox")),
    ]),
  ].sort();
  const filtered = notes
    .filter(
      (note) =>
        (collection === "All collections" ||
          field(note, "collection", "Inbox") === collection) &&
        [note.title, note.body, ...note.tags]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(boolField(b, "pinned")) - Number(boolField(a, "pinned")) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  async function newNote() {
    if (creating) return;
    setCreating(true);
    try {
      const starter =
        NOTE_TEMPLATES.find((item) => item.id === template) ??
        NOTE_TEMPLATES[0];
      const note = await create({
        kind: "note",
        title: template === "blank" ? "Untitled note" : starter.title,
        body: starter.body,
        data: { collection: "Inbox", pinned: false },
      });
      setParams({ record: note.id });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not create note.",
        "error",
      );
    } finally {
      setCreating(false);
    }
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="YOUR KNOWLEDGE, CONNECTED"
        title="Think on paper"
        description="Capture the useful stuff. Find it when it matters."
        action={
          <Button onClick={newNote} disabled={creating}>
            <Plus size={18} /> New note
          </Button>
        }
      />
      <div className="toolbar">
        <div className="search-input">
          <Search size={18} />
          <Input
            aria-label="Search notes"
            placeholder="Search titles, content or tags…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          aria-label="Filter note collection"
          value={collection}
          onChange={(event) => setCollection(event.target.value)}
        >
          {["All collections", ...collections].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <Select
          aria-label="Note template"
          value={template}
          onChange={(event) => setTemplate(event.target.value)}
        >
          {NOTE_TEMPLATES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </Select>
        <Link className="text-link" to="/settings/import-export">
          Import / export
        </Link>
      </div>
      <div className="notes-layout">
        <Card className="note-list">
          <div className="section-heading">
            <h2>Your notes</h2>
            <Badge tone="blue">{filtered.length}</Badge>
          </div>
          {filtered.length ? (
            filtered.map((note) => (
              <button
                key={note.id}
                className={`note-row ${selected?.id === note.id ? "selected" : ""}`}
                onClick={() => setParams({ record: note.id })}
              >
                <div>
                  <span>
                    {boolField(note, "pinned") && <Pin size={13} />}{" "}
                    {note.title || "Untitled note"}
                  </span>
                  <small>
                    {field(note, "collection", "Inbox")} ·{" "}
                    {niceDate(note.updatedAt)}
                  </small>
                  <p>
                    {note.body.replace(/[#*`[\]]/g, "").slice(0, 95) ||
                      "A fresh page. Make it yours."}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <EmptyState
              title={search ? "No matching notes" : "Make room for an idea"}
              description={
                search
                  ? "Try another word or collection."
                  : "Start with a blank page or a useful template."
              }
              action={<Button onClick={newNote}>Create a note</Button>}
            />
          )}
        </Card>
        {selected ? (
          <NoteEditor
            key={selected.id}
            record={selected}
            onRemoved={() => setParams({})}
          />
        ) : (
          <Card className="note-welcome">
            <FileText size={48} />
            <h2>Ideas welcome here.</h2>
            <p>
              Your notes connect to applications, problems, evidence and every
              part of your career.
            </p>
            <Button onClick={newNote}>
              <Plus size={18} /> Start a note
            </Button>
            {params.has("record") && (
              <p className="muted">
                That note may be in Trash. You can restore it from Settings.
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function NoteEditor({
  record,
  onRemoved,
}: {
  record: WorkRecord;
  onRemoved: () => void;
}) {
  const { update, remove, notify, user, mode, pending, refresh } =
    useWorkspace();
  const draftKey = `work:note-draft:${mode}:${user?.id ?? "local"}:${record.id}`;
  const [draft, setDraft] = useState<NoteDraft>(() => fromRecord(record));
  const [saved, setSaved] = useState(() => draftContent(fromRecord(record)));
  const [recovery, setRecovery] = useState<NoteDraft | null>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      return parsed &&
        typeof parsed.title === "string" &&
        typeof parsed.body === "string" &&
        typeof parsed.collection === "string" &&
        typeof parsed.tags === "string" &&
        typeof parsed.version === "number" &&
        Array.isArray(parsed.links) &&
        parsed.links.every((link: unknown) => typeof link === "string") &&
        draftContent(parsed) !== draftContent(fromRecord(record))
        ? parsed
        : null;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<
    "saved" | "saving" | "unsaved" | "failed"
  >("saved");
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>(
    {},
  );
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(
    null,
  );
  const [attachmentError, setAttachmentError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState(false);
  const [revisions, setRevisions] = useState<RecordRevision[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [revision, setRevision] = useState<RecordRevision | null>(null);
  const [deleting, setDeleting] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const recordRef = useRef(record);
  const baseline = useRef(record.version);
  const saving = useRef(false);
  const dirty = draftContent(draft) !== saved;
  draftRef.current = draft;
  recordRef.current = record;

  useEffect(() => {
    let current = true;
    getAttachments(record.id)
      .then((items) => {
        if (current) setAttachments(items);
      })
      .catch((error) => {
        if (current)
          setAttachmentError(
            error instanceof Error
              ? error.message
              : "Attachments could not load.",
          );
      });
    return () => {
      current = false;
    };
  }, [record.id]);
  useEffect(() => {
    let current = true;
    Promise.all(
      attachments.map(
        async (attachment) =>
          [attachment.id, await getAttachmentUrl(attachment.id)] as const,
      ),
    )
      .then((entries) => {
        if (current) setAttachmentUrls(Object.fromEntries(entries));
      })
      .catch((error) => {
        if (current) setAttachmentError(String(error));
      });
    return () => {
      current = false;
    };
  }, [attachments]);
  useEffect(() => {
    if (record.version === baseline.current || saving.current) return;
    if (draftContent(draftRef.current) !== saved || recovery) {
      setConflict(true);
      return;
    }
    baseline.current = record.version;
    const fresh = fromRecord(record);
    setDraft(fresh);
    setSaved(draftContent(fresh));
  }, [record, saved, recovery]);
  useEffect(() => {
    if (!dirty) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          ...draft,
          savedAt: new Date().toISOString(),
          version: baseline.current,
        }),
      );
    } catch {
      /* In-memory editing remains available when device storage is full. */
    }
    setStatus("unsaved");
    if (conflict || recovery) return;
    const timer = window.setTimeout(() => {
      void saveDraft();
    }, 900);
    return () => window.clearTimeout(timer);
    // saveDraft reads current state from refs to prevent a stale autosave.
  }, [draft, dirty, conflict, recovery]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draftContent(draftRef.current) !== saved) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saved]);

  function change(patch: Partial<NoteDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }
  async function saveDraft(force = false) {
    if (saving.current || (conflict && !force) || recovery) return;
    const snapshot = { ...draftRef.current };
    if (!snapshot.title.trim() && !snapshot.body.trim()) {
      setStatus("failed");
      notify("Add a title or some note content.", "error");
      return;
    }
    saving.current = true;
    setStatus("saving");
    try {
      const result = await update(record.id, {
        title: snapshot.title.trim() || "Untitled note",
        body: snapshot.body,
        tags: splitTags(snapshot.tags),
        links: snapshot.links,
        data: {
          ...recordRef.current.data,
          collection: snapshot.collection.trim() || "Inbox",
        },
      });
      baseline.current = result.version;
      setSaved(draftContent(snapshot));
      setConflict(false);
      setStatus("saved");
      if (draftContent(draftRef.current) === draftContent(snapshot)) {
        localStorage.removeItem(draftKey);
      }
    } catch (error) {
      setStatus("failed");
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        await refresh().catch(() => undefined);
      }
      notify(
        error instanceof Error
          ? error.message
          : "Save failed. Your device draft is retained.",
        "error",
      );
    } finally {
      saving.current = false;
      if (draftContent(draftRef.current) !== draftContent(snapshot))
        setDraft((current) => ({ ...current }));
    }
  }
  async function togglePin() {
    if (saving.current) return;
    saving.current = true;
    try {
      const result = await update(record.id, {
        data: {
          ...recordRef.current.data,
          pinned: !boolField(recordRef.current, "pinned"),
        },
      });
      baseline.current = result.version;
    } catch (error) {
      notify(String(error), "error");
    } finally {
      saving.current = false;
      if (dirty) setDraft((current) => ({ ...current }));
    }
  }
  function wrap(before: string, after = "") {
    const el = textarea.current;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    change({
      body:
        draft.body.slice(0, start) +
        before +
        draft.body.slice(start, end) +
        after +
        draft.body.slice(end),
    });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  }
  async function loadHistory() {
    setHistory(true);
    setHistoryError("");
    try {
      const items = await getRevisions(record.id);
      setRevisions(items);
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : "History could not load.",
      );
    }
  }
  async function restoreRevision(item: RecordRevision) {
    if (dirty || conflict || recovery || saving.current) {
      notify(
        "Save or resolve your current draft before restoring a revision.",
        "info",
      );
      return;
    }
    try {
      const result = await update(record.id, {
        title: item.title,
        body: item.body,
        tags: item.tags,
        links: item.links,
        data: item.data,
      });
      baseline.current = result.version;
      const fresh = fromRecord(result);
      setDraft(fresh);
      setSaved(draftContent(fresh));
      setStatus("saved");
      setConflict(false);
      setRecovery(null);
      localStorage.removeItem(draftKey);
      setHistory(false);
      setRevision(null);
      notify(
        "Previous revision restored. The current version remains in history.",
        "success",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not restore revision.",
        "error",
      );
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setAttachmentError("");
    try {
      for (const file of Array.from(files)) {
        await uploadAttachment(record.id, file);
      }
      setAttachments(await getAttachments(record.id));
      notify("Attachment saved.", "success");
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }
  async function trash() {
    try {
      await remove(record.id);
      localStorage.removeItem(draftKey);
      onRemoved();
      setDeleting(false);
      notify("Note moved to Trash. Restore it from Settings.", "info");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not move note to Trash.",
        "error",
      );
    }
  }

  return (
    <Card className="note-editor">
      {recovery && (
        <div className="notice">
          <strong>A device draft is waiting.</strong>
          <p>
            Recovered from {new Date(recovery.savedAt).toLocaleString()}. It may
            contain edits that have not synced.
          </p>
          <div className="inline-actions">
            <Button
              onClick={() => {
                setDraft(recovery);
                setRecovery(null);
                setConflict(recovery.version !== record.version);
              }}
            >
              Recover draft
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setRecovery(null);
                localStorage.removeItem(draftKey);
              }}
            >
              Use saved version
            </Button>
          </div>
        </div>
      )}
      {conflict && (
        <div className="notice notice-warning">
          <strong>This note changed elsewhere.</strong>
          <p>
            Your device draft is preserved. Compare the saved note before
            choosing which content to keep.
          </p>
          <details>
            <summary>View the latest saved note</summary>
            <Markdown content={record.body} />
          </details>
          <div className="inline-actions">
            <Button
              variant="secondary"
              onClick={() => {
                const fresh = fromRecord(record);
                baseline.current = record.version;
                setDraft(fresh);
                setSaved(draftContent(fresh));
                setConflict(false);
                localStorage.removeItem(draftKey);
              }}
            >
              Use latest saved note
            </Button>
            <Button onClick={() => saveDraft(true)}>
              Save my draft as a new revision
            </Button>
          </div>
        </div>
      )}
      <div className="note-editor-top">
        <span role="status" className={`save-status status-${status}`}>
          {status === "saved"
            ? pending > 0
              ? "✓ Saved on device · sync pending"
              : "✓ Saved"
            : status === "saving"
              ? "Saving…"
              : status === "failed"
                ? "Save failed · device draft kept"
                : "Device draft · waiting to save"}
        </span>
        <div className="inline-actions">
          <Button
            variant="ghost"
            aria-label={boolField(record, "pinned") ? "Unpin note" : "Pin note"}
            onClick={togglePin}
          >
            <Pin size={17} />
          </Button>
          <Button variant="ghost" onClick={loadHistory}>
            <History size={17} /> History
          </Button>
          <Button
            variant="ghost"
            aria-label="Export note as Markdown"
            onClick={() =>
              downloadFile(
                `# ${draft.title}\n\n${draft.body}`,
                `${draft.title.replace(/[^a-z0-9 -]/gi, "") || "note"}.md`,
                "text/markdown",
              )
            }
          >
            <Download size={17} />
          </Button>
          <Button
            variant="ghost"
            aria-label="Move note to Trash"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={17} />
          </Button>
        </div>
      </div>
      <Input
        className="note-title-input"
        aria-label="Note title"
        placeholder="Give this idea a title"
        value={draft.title}
        onChange={(event) => change({ title: event.target.value })}
      />
      <div className="form-grid">
        <Field label="Collection">
          <Input
            aria-label="Collection"
            list="note-collections"
            value={draft.collection}
            onChange={(event) => change({ collection: event.target.value })}
          />
          <datalist id="note-collections">
            <option>Inbox</option>
            <option>Interview preparation</option>
            <option>Learning</option>
            <option>Company research</option>
            <option>Work evidence</option>
          </datalist>
        </Field>
        <Field label="Tags" hint="Separate tags with commas">
          <Input
            aria-label="Tags"
            value={draft.tags}
            onChange={(event) => change({ tags: event.target.value })}
            placeholder="python, google, reflection"
          />
        </Field>
      </div>
      <div className="markdown-toolbar">
        <div className="inline-actions">
          <Button
            variant="ghost"
            aria-label="Insert heading"
            onClick={() => wrap("## ")}
          >
            H2
          </Button>
          <Button
            variant="ghost"
            aria-label="Bold selection"
            onClick={() => wrap("**", "**")}
          >
            <Bold size={16} />
          </Button>
          <Button
            variant="ghost"
            aria-label="Insert list item"
            onClick={() => wrap("- ")}
          >
            <List size={16} />
          </Button>
          <Button
            variant="ghost"
            aria-label="Insert checklist item"
            onClick={() => wrap("- [ ] ")}
          >
            ☑
          </Button>
          <Button
            variant="ghost"
            aria-label="Insert code block"
            onClick={() => wrap("\n```python\n", "\n```\n")}
          >
            <Code size={16} />
          </Button>
          <Button
            variant="ghost"
            aria-label="Insert link"
            onClick={() => wrap("[", "](https://)")}
          >
            <Link2 size={16} />
          </Button>
          <Button
            variant="ghost"
            aria-label="Insert Markdown table"
            onClick={() => wrap("\n| Topic | Notes |\n| --- | --- |\n| | |\n")}
          >
            Table
          </Button>
        </div>
        <Button
          variant={preview ? "primary" : "secondary"}
          onClick={() => setPreview(!preview)}
        >
          <Eye size={16} /> {preview ? "Edit" : "Preview"}
        </Button>
      </div>
      {preview ? (
        <div className="note-preview">
          <Markdown
            content={draft.body || "*Your note preview will appear here.*"}
          />
        </div>
      ) : (
        <Textarea
          ref={textarea}
          className="markdown-editor"
          aria-label="Note content"
          placeholder="Start writing. Markdown, code and half-formed ideas welcome."
          value={draft.body}
          onChange={(event) => change({ body: event.target.value })}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              void saveDraft();
            }
          }}
        />
      )}
      <div className="editor-footer">
        <span className="muted">
          {draft.body.trim().split(/\s+/).filter(Boolean).length} words ·
          Markdown · ⌘/Ctrl S to save
        </span>
        <Button
          onClick={() => saveDraft()}
          disabled={!dirty || status === "saving" || conflict || !!recovery}
        >
          <Save size={16} /> Save now
        </Button>
      </div>
      <Field label="Connected records">
        <RecordLinks
          value={draft.links}
          onChange={(links) => change({ links })}
          excludeId={record.id}
        />
      </Field>
      <div className="section-heading">
        <h3>Attachments</h3>
        <label className="attachment-upload">
          <ImagePlus size={16} /> {uploading ? "Uploading…" : "Add image / PDF"}
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown"
            disabled={uploading}
            onChange={(event) => {
              void upload(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {attachmentError && (
        <p role="alert" className="error-text">
          {attachmentError}
        </p>
      )}
      <div className="attachment-list">
        {attachments.map((attachment) => (
          <div key={attachment.id} className="attachment-row">
            {attachmentUrls[attachment.id] ? (
              <a
                href={attachmentUrls[attachment.id]}
                target="_blank"
                rel="noreferrer"
              >
                {attachment.filename}
              </a>
            ) : (
              <span>{attachment.filename}</span>
            )}
            <small>{Math.ceil(attachment.size / 1024)} KB</small>
            {(attachment.contentType.startsWith("image/") ||
              attachment.contentType === "application/pdf") && (
              <Button
                variant="ghost"
                aria-label={`Preview ${attachment.filename}`}
                disabled={!attachmentUrls[attachment.id]}
                onClick={() => setPreviewAttachment(attachment)}
              >
                <Eye size={15} />
              </Button>
            )}
            <Button
              variant="ghost"
              aria-label={`Remove ${attachment.filename}`}
              onClick={async () => {
                try {
                  await removeAttachment(attachment.id);
                  setAttachments((items) =>
                    items.filter((item) => item.id !== attachment.id),
                  );
                } catch (error) {
                  notify(String(error), "error");
                }
              }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>
      {!attachments.length && (
        <p className="muted">
          Images and PDFs stay with this note. Uploads are private to your
          workspace.
        </p>
      )}
      {arrayField(record, "sourceFiles").length > 0 && (
        <p className="muted">
          Imported from {arrayField(record, "sourceFiles").join(", ")}
        </p>
      )}
      <Modal
        open={history}
        onClose={() => {
          setHistory(false);
          setRevision(null);
        }}
        title="Revision history"
        description="Restoring makes a new revision, so your current saved content remains recoverable."
        size="wide"
      >
        <div className="revision-layout">
          <div className="stack">
            {historyError && <p role="alert">{historyError}</p>}
            {!revisions.length && !historyError && (
              <p className="muted">
                No earlier revisions yet. Changes create history when saved.
              </p>
            )}
            {revisions.map((item) => (
              <Button
                key={item.id}
                variant={revision?.id === item.id ? "primary" : "secondary"}
                onClick={() => setRevision(item)}
              >
                Version {item.version} · {niceDate(item.createdAt)}
              </Button>
            ))}
          </div>
          {revision && (
            <div>
              <h3>{revision.title}</h3>
              <Markdown content={revision.body} />
              {(dirty || conflict || recovery) && (
                <p className="muted">
                  Save or resolve your device draft before restoring.
                </p>
              )}
              <Button
                disabled={
                  dirty || conflict || !!recovery || status === "saving"
                }
                onClick={() => restoreRevision(revision)}
              >
                Restore this version
              </Button>
            </div>
          )}
        </div>
      </Modal>
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Move this note to Trash?"
        description="You can restore it from Settings. Attachments and revisions stay with it."
      >
        <div className="inline-actions">
          <Button variant="secondary" onClick={() => setDeleting(false)}>
            Keep note
          </Button>
          <Button variant="danger" onClick={trash}>
            Move to Trash
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        title={previewAttachment?.filename ?? "Attachment preview"}
        size="wide"
      >
        {previewAttachment &&
          (previewAttachment.contentType.startsWith("image/") ? (
            <img
              className="note-attachment-preview"
              src={attachmentUrls[previewAttachment.id]}
              alt={previewAttachment.filename}
            />
          ) : (
            <iframe
              className="note-pdf-preview"
              title={previewAttachment.filename}
              src={attachmentUrls[previewAttachment.id]}
            />
          ))}
        {previewAttachment && (
          <a
            className="text-link"
            href={attachmentUrls[previewAttachment.id]}
            target="_blank"
            rel="noreferrer"
          >
            Open / download attachment
          </a>
        )}
      </Modal>
    </Card>
  );
}
