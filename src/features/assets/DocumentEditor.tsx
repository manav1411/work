import { useState, type FormEvent } from "react";
import { Upload } from "lucide-react";
import { field, type Attachment, type WorkRecord } from "../../../shared/model";
import {
  DOCUMENT_ACCEPT,
  DocumentFileSaveError,
  documentUploadError,
  documentUrl,
  saveDocumentFile,
} from "../../../shared/documents";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { uploadAttachment } from "../../lib/api";
import { useWorkspace as useRawWorkspace } from "../../lib/workspace";
import { useSavingWorkspace as useWorkspace } from "../search/useSaving";
import { errorMessage } from "../search/domain";
import type { DocumentType } from "./documentLinks";
import {
  documentBlob,
  downloadDocumentFile,
  selectDocumentFile,
} from "./files";
import { primaryDocumentFile } from "../../../shared/documents";
import { getAttachments } from "../../lib/api";
import { useDocumentFiles } from "./useDocumentFiles";

export function DocumentEditor({
  record,
  defaultType,
  initialUrl = "",
  forkFrom,
  onSaved,
  onClose,
}: {
  record?: WorkRecord;
  defaultType?: DocumentType;
  initialUrl?: string;
  forkFrom?: WorkRecord;
  onSaved: (record: WorkRecord) => void;
  onClose: () => void;
}) {
  const { records, create, update, refresh, pending } = useWorkspace();
  const offlinePending = useRawWorkspace().pending;
  const [savedRecord, setSavedRecord] = useState(record);
  const [name, setName] = useState(
    record?.title ||
      (forkFrom ? `${forkFrom.title} — variant` : "") ||
      (defaultType === "resume"
        ? "Résumé"
        : defaultType === "letter"
          ? "Cover letter"
          : ""),
  );
  const [url, setUrl] = useState(
    field(record, "sourceUrl", field(record, "overleaf", initialUrl)),
  );
  const [defaultChoice, setDefaultChoice] = useState(
    defaultType ||
      (record?.data.documentDefault === true &&
      ["resume", "letter"].includes(field(record, "type"))
        ? field(record, "type")
        : "none"),
  );
  const [file, setFile] = useState<File>();
  const [family, setFamily] = useState(
    defaultType || field(record || forkFrom, "type", "document"),
  );
  const [body, setBody] = useState(record?.body || forkFrom?.body || "");
  const [uploaded, setUploaded] = useState<Attachment>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const history = useDocumentFiles(savedRecord?.id);
  const workingRecord =
    records.find((item) => item.id === savedRecord?.id) || savedRecord;

  async function save(event: FormEvent) {
    event.preventDefault();
    const destination = documentUrl(url);
    if (url.trim() && !destination) {
      setError("Use an Overleaf project or read-only document link.");
      return;
    }
    if (file && documentUploadError(file)) {
      setError(documentUploadError(file));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const data = {
        ...workingRecord?.data,
        type: defaultChoice === "none" ? family : defaultChoice,
        sourceUrl: destination,
        overleaf: destination,
        documentDefault: defaultChoice !== "none",
        ...(forkFrom ? { forkedFromTitle: forkFrom.title } : {}),
      };
      const next = workingRecord
        ? await update(workingRecord.id, { title: name.trim(), body, data })
        : await create({ kind: "asset", title: name.trim(), body, data });
      setSavedRecord(next);
      if (defaultChoice !== "none") {
        for (const previous of records.filter(
          (item) =>
            item.kind === "asset" &&
            item.id !== next.id &&
            item.data.documentDefault === true &&
            field(item, "type") === defaultChoice,
        ))
          await update(previous.id, {
            data: { ...previous.data, documentDefault: false },
          });
      }
      let upload = file;
      if (
        !upload &&
        forkFrom &&
        !uploaded &&
        !field(workingRecord, "primaryAttachmentId")
      ) {
        const source = primaryDocumentFile(
          forkFrom,
          await getAttachments(forkFrom.id),
        );
        if (source)
          upload = new File([await documentBlob(source)], source.filename, {
            type: source.contentType,
          });
        setFile(upload);
      }
      if (upload) {
        if (
          next.id.startsWith("offline-") ||
          (workingRecord && next.version <= workingRecord.version) ||
          offlinePending ||
          (typeof navigator !== "undefined" && !navigator.onLine)
        )
          throw new Error(
            "Document details are saved on this device. The file is pending: reconnect, wait for sync, then retry. Keep this page open, or choose the file again after reloading.",
          );
        const attached = await saveDocumentFile(
          {
            upload: () => uploadAttachment(next.id, upload!),
            select: (attachment) => selectDocumentFile(next.id, attachment),
          },
          uploaded,
        );
        setUploaded(attached);
        await refresh();
      }
      onSaved(next);
    } catch (failure) {
      if (failure instanceof DocumentFileSaveError) {
        setUploaded(failure.attachment);
        history.reload();
        setError(
          failure.attachment
            ? `Your file was uploaded, but selecting it needs another try. Previous files are retained. ${failure.message}`
            : `The file is still pending on this page. Retry after reconnecting. ${failure.message}`,
        );
      } else setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function useVersion(attachment: Attachment) {
    if (!workingRecord) return;
    setBusy(true);
    setError("");
    try {
      if (offlinePending)
        throw new Error("Wait for document changes to sync, then try again.");
      await selectDocumentFile(workingRecord.id, attachment);
      await refresh();
      onSaved(workingRecord);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      <Field label="Document name">
        <Input
          autoFocus
          required
          maxLength={240}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Resume for Google"
        />
      </Field>
      {forkFrom && (
        <p className="muted">
          Independent copy of {forkFrom.title}. Its uploaded file and comparison
          text are copied; your original stays unchanged. Add a separate
          Overleaf project link if needed.
        </p>
      )}
      <Field label="Document family">
        <Select
          value={family}
          onChange={(event) => setFamily(event.target.value)}
        >
          <option value="document">More documents</option>
          <option value="resume">Résumé</option>
          <option value="letter">Cover letter</option>
        </Select>
      </Field>
      <Field
        label="Comparison text (optional)"
        hint="Paste the document's text to highlight changes between PDF or DOCX variants. Text uploads are compared directly."
      >
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
        />
      </Field>
      <Field label="Overleaf URL (optional)">
        <Input
          type="url"
          maxLength={2048}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.overleaf.com/project/…"
        />
      </Field>
      <Field label="Default document">
        <Select
          value={defaultChoice}
          onChange={(event) => setDefaultChoice(event.target.value)}
        >
          <option value="none">Additional document</option>
          <option value="resume">Default résumé</option>
          <option value="letter">Default cover letter</option>
        </Select>
      </Field>
      <Field
        label={
          field(workingRecord, "primaryAttachmentId")
            ? "Replace uploaded copy (optional)"
            : "Upload a file (optional)"
        }
        hint="PDF, DOCX, PNG, JPEG, WebP, GIF, text, Markdown, CSV or JSON · up to 10 MB. PDFs, images and text open inside Work."
      >
        <Input
          type="file"
          accept={DOCUMENT_ACCEPT}
          disabled={busy}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            setFile(chosen);
            setUploaded(undefined);
            setError(chosen ? documentUploadError(chosen) : "");
          }}
        />
      </Field>
      {file && (
        <p className="document-upload-state" role="status">
          <Upload size={16} />{" "}
          {uploaded ? "Uploaded; selection pending" : "File pending until Save"}
          : {file.name}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <Button type="submit" disabled={busy || !!pending || !name.trim()}>
          {busy ? "Saving…" : file && error ? "Retry save" : "Save document"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
      {history.loading && <p className="muted">Loading uploaded copies…</p>}
      {history.error && (
        <p className="form-error" role="alert">
          {history.error}{" "}
          <Button variant="ghost" type="button" onClick={history.reload}>
            Retry
          </Button>
        </p>
      )}
      {history.files.length > 0 && (
        <details className="document-version-history">
          <summary>Uploaded copies ({history.files.length})</summary>
          <p className="muted">
            Previous copies remain available when you replace a file.
          </p>
          {history.files.map((attachment) => (
            <div className="document-version" key={attachment.id}>
              <div>
                <strong>{attachment.filename}</strong>
                <small>
                  {new Date(attachment.createdAt).toLocaleDateString()} ·{" "}
                  {Math.ceil(attachment.size / 1024)} KB
                  {field(workingRecord, "primaryAttachmentId") === attachment.id
                    ? " · Current copy"
                    : ""}
                </small>
              </div>
              <div className="inline-actions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    void downloadDocumentFile(attachment).catch((failure) =>
                      setError(errorMessage(failure)),
                    )
                  }
                >
                  Download
                </Button>
                {field(workingRecord, "primaryAttachmentId") !==
                  attachment.id && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void useVersion(attachment)}
                  >
                    Use this copy
                  </Button>
                )}
              </div>
            </div>
          ))}
        </details>
      )}
    </form>
  );
}
