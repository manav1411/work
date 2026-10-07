import { lazy, Suspense, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import {
  documentPreviewKind,
  primaryDocumentFile,
} from "../../../shared/documents";
import { useDocumentFiles } from "./useDocumentFiles";
import { documentBlob } from "./files";

const PdfPreview = lazy(() => import("./LatexPdfPreview"));

export function useDocumentPreview(record?: WorkRecord, thumbnail = false) {
  const attachments = useDocumentFiles(
    record?.id,
    field(record, "primaryAttachmentId"),
  );
  const file = record
    ? primaryDocumentFile(record, attachments.files)
    : undefined;
  const [preview, setPreview] = useState({
    url: "",
    pdfData: undefined as Uint8Array | undefined,
    text: record?.body || "",
    error: "",
  });
  useEffect(() => {
    let active = true;
    let url = "";
    setPreview({
      url: "",
      pdfData: undefined,
      text: record?.body || "",
      error: "",
    });
    if (file && documentPreviewKind(file) !== "download")
      void documentBlob(file)
        .then(async (blob) => {
          if (documentPreviewKind(file) === "text") {
            const text = (await blob.text()).slice(0, 200_000);
            if (active)
              setPreview({ url: "", pdfData: undefined, text, error: "" });
          } else if (thumbnail && documentPreviewKind(file) === "pdf") {
            const pdfData = new Uint8Array(await blob.arrayBuffer());
            if (active)
              setPreview({
                url: "",
                pdfData,
                text: record?.body || "",
                error: "",
              });
          } else {
            url = URL.createObjectURL(blob);
            if (active)
              setPreview({
                url,
                pdfData: undefined,
                text: record?.body || "",
                error: "",
              });
            else URL.revokeObjectURL(url);
          }
        })
        .catch(() => {
          if (active)
            setPreview({
              url: "",
              pdfData: undefined,
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
    loading: attachments.loading,
    error: preview.error || attachments.error,
  };
}

export function DocumentPreview({ record }: { record: WorkRecord }) {
  const { url, pdfData, text, file, loading, error } = useDocumentPreview(
    record,
    true,
  );
  return (
    <div className="document-thumbnail" aria-hidden="true">
      {pdfData ? (
        <Suspense fallback={<FileText size={30} />}>
          <PdfPreview data={pdfData} firstPageOnly thumbnail />
        </Suspense>
      ) : url && file && documentPreviewKind(file) === "image" ? (
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
