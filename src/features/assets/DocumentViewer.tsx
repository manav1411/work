import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowLeft, Download, FileText, Trash2, X } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import {
  documentPreviewKind,
  primaryDocumentFile,
} from "../../../shared/documents";
import { Button, Card } from "../../components/ui";
import { errorMessage } from "../search/domain";
import { documentBlob, downloadDocumentFile } from "./files";
import { useDocumentFiles } from "./useDocumentFiles";

const PdfPreview = lazy(() => import("./LatexPdfPreview"));

export function DocumentViewer({
  record,
  title,
  onBack,
  onDelete,
  inline = false,
}: {
  record?: WorkRecord;
  title: string;
  onBack: () => void;
  onDelete?: () => void;
  inline?: boolean;
}) {
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
    >
      <div className="document-viewer-toolbar">
        {!inline && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={17} /> Documents
          </Button>
        )}
        <div className="document-viewer-title">
          {inline ? <h2>{title}</h2> : <h1>{title}</h1>}
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
          {inline && onDelete && (
            <Button
              variant="danger"
              onClick={onDelete}
              aria-label={`Delete ${title}`}
            >
              <Trash2 size={16} /> Delete
            </Button>
          )}
          {inline && (
            <Button
              variant="ghost"
              className="icon-button document-viewer-close"
              onClick={onBack}
              aria-label="Close document preview"
            >
              <X size={18} />
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
          <Suspense
            fallback={
              <div className="document-viewer-placeholder" role="status">
                Rendering PDF…
              </div>
            }
          >
            <PdfPreview url={blobUrl} />
          </Suspense>
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
                ? "This uploaded copy is unavailable. You can recover it from a backup or add a new document."
                : file
                  ? "This format opens in its own app. Download the file to read or edit it."
                  : "No uploaded file is associated with this document."}
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
              ) : null}
            </div>
          </Card>
        )}
    </div>
  );
}
