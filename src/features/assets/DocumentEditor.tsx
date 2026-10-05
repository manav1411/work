import { useState, type FormEvent } from "react";
import {
  DOCUMENT_ACCEPT,
  documentUploadError,
  saveDocumentFile,
  DocumentFileSaveError,
} from "../../../shared/documents";
import type { Attachment, WorkRecord } from "../../../shared/model";
import { Button, Field, Input } from "../../components/ui";
import { uploadAttachment } from "../../lib/api";
import { useSavingWorkspace as useWorkspace } from "../search/useSaving";
import { errorMessage } from "../search/domain";
import { selectDocumentFile } from "./files";

/** Generic files have exactly two inputs; native document families never upload here. */
export function DocumentEditor({
  onSaved,
  onClose,
}: {
  onSaved: (record: WorkRecord) => void;
  onClose: () => void;
}) {
  const { create, refresh, pending } = useWorkspace();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File>();
  const [saved, setSaved] = useState<WorkRecord>();
  const [uploaded, setUploaded] = useState<Attachment>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const invalid = documentUploadError(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const record =
        saved ??
        (await create({
          kind: "asset",
          title: name.trim() || "Untitled document",
          data: { type: "document" },
        }));
      setSaved(record);
      if (record.id.startsWith("offline-") || !navigator.onLine)
        throw new Error(
          "Reconnect before uploading. Your file remains selected here.",
        );
      const attached = await saveDocumentFile(
        {
          upload: () => uploadAttachment(record.id, file),
          select: (attachment) => selectDocumentFile(record.id, attachment),
        },
        uploaded,
      );
      setUploaded(attached);
      await refresh();
      onSaved(record);
    } catch (failure) {
      if (failure instanceof DocumentFileSaveError)
        setUploaded(failure.attachment);
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      <Field label="Name">
        <Input
          autoFocus
          maxLength={240}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Document name"
        />
      </Field>
      <Field label="Upload file">
        <Input
          type="file"
          accept={DOCUMENT_ACCEPT}
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0]);
            setUploaded(undefined);
          }}
        />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <Button type="submit" disabled={busy || !!pending || !file}>
          {busy ? "Uploading…" : "Add document"}
        </Button>
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
