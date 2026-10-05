import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import {
  documentPreviewKind,
  primaryDocumentFile,
} from "../../../shared/documents";
import { useDocumentFiles } from "./useDocumentFiles";
import { documentBlob } from "./files";

export function useDocumentPreview(record?: WorkRecord, thumbnail = false) {
  const history = useDocumentFiles(
    record?.id,
    field(record, "primaryAttachmentId"),
  );
  const file = record ? primaryDocumentFile(record, history.files) : undefined;
  const [preview, setPreview] = useState({
    url: "",
    text: record?.body || "",
    error: "",
  });
  useEffect(() => {
    let active = true;
    let url = "";
    setPreview({ url: "", text: record?.body || "", error: "" });
    if (
      file &&
      documentPreviewKind(file) !== "download" &&
      !(thumbnail && documentPreviewKind(file) === "pdf")
    )
      void documentBlob(file)
        .then(async (blob) => {
          if (documentPreviewKind(file) === "text") {
            const text = (await blob.text()).slice(0, 200_000);
            if (active) setPreview({ url: "", text, error: "" });
          } else {
            url = URL.createObjectURL(blob);
            if (active)
              setPreview({ url, text: record?.body || "", error: "" });
            else URL.revokeObjectURL(url);
          }
        })
        .catch(() => {
          if (active)
            setPreview({
              url: "",
              text: record?.body || "",
              error: "Preview unavailable",
            });
        });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file?.id, record?.body, thumbnail]);
  return {
    ...preview,
    file,
    loading: history.loading,
    error: preview.error || history.error,
  };
}

export function DocumentPreview({ record }: { record: WorkRecord }) {
  const { url, text, file, loading, error } = useDocumentPreview(record, true);
  return (
    <div className="document-thumbnail" aria-hidden="true">
      {url && file && documentPreviewKind(file) === "image" ? (
        <img src={url} alt="" />
      ) : text ? (
        <pre>{text.slice(0, 700)}</pre>
      ) : (
        <>
          <FileText size={30} />
          <small>
            {loading
              ? "Loading…"
              : error
                ? "Preview unavailable"
                : file?.filename || "Document"}
          </small>
        </>
      )}
    </div>
  );
}

/** Longest common subsequence preserves duplicate lines and detects reordered text. */
export function changedLines(before: string, after: string) {
  const a = before.split("\n").slice(0, 500);
  const b = after.split("\n").slice(0, 500);
  const table = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        a[i] === b[j]
          ? 1 + table[i + 1][j + 1]
          : Math.max(table[i + 1][j], table[i][j + 1]);
  const removed = new Set(a.map((_, index) => index));
  const added = new Set(b.map((_, index) => index));
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      removed.delete(i++);
      added.delete(j++);
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return {
    before: a,
    after: b,
    removed,
    added,
    truncated:
      before.split("\n").length > 500 || after.split("\n").length > 500,
  };
}

export function DocumentComparison({
  before,
  after,
}: {
  before: WorkRecord;
  after: WorkRecord;
}) {
  const left = useDocumentPreview(before);
  const right = useDocumentPreview(after);
  const diff = changedLines(left.text, right.text);
  return (
    <div className="stack">
      <p className="muted">
        Pink highlights removed lines; green highlights added lines. PDFs and
        images appear side by side. Add comparison text in Edit document to
        highlight their wording changes.
      </p>
      {(left.error || right.error) && (
        <p role="alert" className="form-error">
          {left.error || right.error}
        </p>
      )}
      <div className="document-comparison-grid">
        {[left, right].map((value, side) => (
          <section key={side}>
            <h3>{side ? after.title : before.title}</h3>
            {value.loading && <p role="status">Loading document…</p>}
            {value.url &&
              (value.file && documentPreviewKind(value.file) === "pdf" ? (
                <iframe
                  title={side ? after.title : before.title}
                  src={value.url}
                />
              ) : (
                <img src={value.url} alt={side ? after.title : before.title} />
              ))}
            {value.text ? (
              <pre className="document-diff">
                {(side ? diff.after : diff.before).map((line, index) => (
                  <span
                    key={index}
                    className={
                      (side ? diff.added : diff.removed).has(index)
                        ? side
                          ? "diff-added"
                          : "diff-removed"
                        : ""
                    }
                  >
                    {line || " "}
                    {"\n"}
                  </span>
                ))}
              </pre>
            ) : (
              !value.loading && (
                <p className="muted">
                  No comparison text.{" "}
                  {value.file?.filename || "No uploaded copy."}
                </p>
              )
            )}
          </section>
        ))}
      </div>
      {diff.truncated && (
        <p className="muted">
          Highlights show the first 500 lines of each document.
        </p>
      )}
    </div>
  );
}
