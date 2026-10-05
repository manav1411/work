import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Expand, FileText, Upload } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import {
  documentPreviewKind,
  primaryDocumentFile,
} from "../../../shared/documents";
import { Button, Card } from "../../components/ui";
import { errorMessage } from "../search/domain";
import { documentBlob, downloadDocumentFile } from "./files";
import { useDocumentFiles } from "./useDocumentFiles";
import { useEditMode } from "../../lib/edit-mode";

export function DocumentViewer({
  record,
  title,
  onBack,
  onEdit,
  inline = false,
}: {
  record?: WorkRecord;
  title: string;
  onBack: () => void;
  onEdit: () => void;
  inline?: boolean;
}) {
  const { editing } = useEditMode();
  const {
    files,
    loading,
    error: listError,
    reload,
  } = useDocumentFiles(record?.id, field(record, "primaryAttachmentId"));
  const file = record ? primaryDocumentFile(record, files) : undefined;
  const [blobUrl, setBlobUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setBlobUrl("");
    setText("");
    setError("");
    setFileLoading(!!file);
    if (file && documentPreviewKind(file) !== "download")
      void documentBlob(file)
        .then(async (blob) => {
          if (documentPreviewKind(file) === "text") {
            const content = await blob.text();
            if (active) setText(content.slice(0, 200_000));
            return;
          }
          objectUrl = URL.createObjectURL(blob);
          if (active) setBlobUrl(objectUrl);
          else URL.revokeObjectURL(objectUrl);
        })
        .catch((failure) => {
          if (active) setError(errorMessage(failure));
        })
        .finally(() => {
          if (active) setFileLoading(false);
        });
    else setFileLoading(false);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // A file ID identifies immutable stored contents, independent of metadata edits.
  }, [file?.id, retry]);

  const missing =
    !loading &&
    !listError &&
    record &&
    field(record, "primaryAttachmentId") &&
    !file;
  return (
    <div
      className={`document-viewer ${inline ? "document-viewer-inline" : ""}`}
      ref={root}
    >
      <div className="document-viewer-toolbar">
        {!inline && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={17} /> Documents
          </Button>
        )}
        <div className="document-viewer-title">
          {!inline && <h1>{title}</h1>}
          {file && !inline && (
            <span className="muted">Uploaded copy · {file.filename}</span>
          )}
        </div>
        <div className="inline-actions">
          {file && (
            <Button
              variant="secondary"
              onClick={() =>
                void downloadDocumentFile(file).catch((failure) =>
                  setError(errorMessage(failure)),
                )
              }
            >
              <Download size={16} /> Download
            </Button>
          )}
          {editing && (
            <Button variant="ghost" onClick={onEdit}>
              Edit document
            </Button>
          )}
          {blobUrl && (
            <Button
              variant="ghost"
              aria-label="Expand document viewer"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else
                  void root.current
                    ?.requestFullscreen()
                    .catch((failure) => setError(errorMessage(failure)));
              }}
            >
              <Expand size={18} />
            </Button>
          )}
        </div>
      </div>
      {(error || listError) && (
        <Card className="document-viewer-error">
          <p className="form-error" role="alert">
            {error || listError}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              reload();
              setRetry((value) => value + 1);
            }}
          >
            Retry loading
          </Button>
        </Card>
      )}
      {(loading || fileLoading) && (
        <div className="document-viewer-placeholder" role="status">
          Loading uploaded document…
        </div>
      )}
      {!loading &&
        !fileLoading &&
        blobUrl &&
        file &&
        (documentPreviewKind(file) === "pdf" ? (
          <iframe
            className="document-preview-frame"
            title={`Uploaded copy of ${title}`}
            src={blobUrl}
          />
        ) : (
          <div className="document-preview-image">
            <img
              src={blobUrl}
              alt={`Uploaded copy of ${title}`}
              onError={() =>
                setError(
                  "The image could not be displayed. Try downloading this file.",
                )
              }
            />
          </div>
        ))}
      {!loading &&
        !fileLoading &&
        file &&
        documentPreviewKind(file) === "text" &&
        !error && (
          <>
            <pre className="document-preview-text">{text}</pre>
            {text.length >= 200_000 && (
              <p className="muted">
                Preview shows the first 200,000 characters. Download the file
                for its full contents.
              </p>
            )}
          </>
        )}
      {!loading &&
        !fileLoading &&
        !blobUrl &&
        !(file && documentPreviewKind(file) === "text") &&
        !error &&
        !listError && (
          <Card className="document-viewer-placeholder">
            <FileText size={46} />
            <h2>
              {missing
                ? "Uploaded copy unavailable"
                : file
                  ? "Ready to download"
                  : "Add your document"}
            </h2>
            <p className="muted">
              {missing
                ? "Your document details are saved. Upload a new copy or select a previous upload in Edit document."
                : file
                  ? "This format opens in its own app. Download the file to read or edit it."
                  : "Upload a PDF or image to open it here, or create native LaTeX source for your résumé or cover letter."}
            </p>
            <div className="inline-actions">
              {file ? (
                <Button
                  onClick={() =>
                    void downloadDocumentFile(file).catch((failure) =>
                      setError(errorMessage(failure)),
                    )
                  }
                >
                  <Download size={17} /> Download file
                </Button>
              ) : editing ? (
                <Button onClick={onEdit}>
                  <Upload size={17} /> Upload PDF or file
                </Button>
              ) : null}
            </div>
          </Card>
        )}
    </div>
  );
}
