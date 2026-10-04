import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Plus, RotateCcw } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import { documentRecords, documentUrl } from "../../../shared/documents";
import {
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
} from "../../components/ui";
import { request } from "../../lib/api";
import { useSavingWorkspace as useWorkspace } from "../search/useSaving";
import { errorMessage } from "../search/domain";
import { getDocumentLinks, type DocumentType } from "./documentLinks";
import { DocumentEditor } from "./DocumentEditor";
import { DocumentViewer } from "./DocumentViewer";
import { ProfileLinks } from "./ProfileLinks";
import "./documents.css";

export { getDocumentLinks } from "./documentLinks";
const DEFAULTS = [
  { type: "resume" as const, key: "resume" as const, title: "Résumé" },
  {
    type: "letter" as const,
    key: "coverLetter" as const,
    title: "Cover letter",
  },
];
type DocumentEdit = {
  record?: WorkRecord;
  defaultType?: DocumentType;
  url?: string;
};

export function AssetsPage() {
  const { records, preferences, remove, restore, pending } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const defaults = getDocumentLinks(records, preferences);
  const documents = documentRecords(records);
  const [editing, setEditing] = useState<DocumentEdit>();
  const [deleting, setDeleting] = useState<WorkRecord>();
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<WorkRecord[] | null>(null);
  const [recovering, setRecovering] = useState(false);
  const selected = documents.find((item) => item.id === params.get("record"));
  const virtual = DEFAULTS.find((item) => item.type === params.get("default"));
  const virtualLink = virtual ? defaults[virtual.key] : undefined;
  const defaultIds = new Set(
    DEFAULTS.map((item) => defaults[item.key].record?.id),
  );

  function edit(value: DocumentEdit) {
    setEditing(value);
    setError("");
  }
  function open(record?: WorkRecord, type?: DocumentType) {
    setParams(record ? { record: record.id } : type ? { default: type } : {});
  }
  async function showRecovery() {
    setRecovering(true);
    setError("");
    try {
      const response = await request<{ records: WorkRecord[] }>(
        "/api/records?includeDeleted=true&kind=asset",
      );
      setRecovery(
        response.records.filter(
          (item) => item.kind === "asset" && !!item.deletedAt,
        ),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setRecovering(false);
    }
  }
  async function deleteDocument() {
    if (!deleting) return;
    try {
      await remove(deleting.id);
      setDeleting(undefined);
      setRecovery(null);
      if (params.get("record") === deleting.id) setParams({});
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  function documentCard(
    record: WorkRecord | undefined,
    title: string,
    type?: DocumentType,
    url = "",
  ) {
    const hasFile = !!field(record, "primaryAttachmentId");
    const hasSource = !!documentUrl(
      field(record, "sourceUrl", field(record, "overleaf", url)),
    );
    return (
      <Card
        key={record?.id || type}
        className={`document-card document-${type || "named"}`}
      >
        <div className="document-art" aria-hidden="true">
          <div className="document-paper">
            <FileText size={38} strokeWidth={1.6} />
            <i />
            <i />
            <i />
          </div>
          <span className="document-star">✦</span>
        </div>
        <div className="document-card-heading">
          <h2>{record?.title || title}</h2>
          {type && (
            <span className="document-default-label">
              Default {type === "resume" ? "résumé" : "cover letter"}
            </span>
          )}
        </div>
        <p className="document-card-description muted">
          {hasFile
            ? hasSource
              ? "Uploaded copy + Overleaf source"
              : "Uploaded copy"
            : hasSource
              ? "Overleaf source · upload a PDF to read here"
              : record
                ? "Document details saved"
                : "Add an upload or Overleaf link"}
        </p>
        <div className="document-actions">
          <Button variant="secondary" onClick={() => open(record, type)}>
            Open{" "}
            {type === "resume"
              ? "résumé"
              : type === "letter"
                ? "cover letter"
                : "document"}
          </Button>
          <Button
            variant="ghost"
            aria-label={`Edit ${record?.title || title}`}
            onClick={() => edit({ record, defaultType: type, url })}
          >
            Edit
          </Button>
          {record && (
            <Button
              variant="ghost"
              aria-label={`Delete ${record.title}`}
              onClick={() => {
                setDeleting(record);
                setError("");
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="page-stack documents-page">
      {selected || virtual ? (
        <DocumentViewer
          key={selected?.id || virtual?.type}
          record={selected || virtualLink?.record}
          title={
            selected?.title || virtualLink?.record?.title || virtual!.title
          }
          sourceUrl={virtualLink?.url}
          onBack={() => setParams({})}
          onEdit={() =>
            edit({
              record: selected || virtualLink?.record,
              defaultType: virtual?.type,
              url: virtualLink?.url,
            })
          }
        />
      ) : params.has("record") ? (
        <EmptyState
          title="Document unavailable"
          description="It may have been deleted, or this link belongs to another workspace."
          action={
            <Button onClick={() => setParams({})}>Back to Documents</Button>
          }
        />
      ) : (
        <>
          <PageHeader
            title="Documents"
            description="Your documents, uploaded copies and profile links."
            action={
              <Button onClick={() => edit({})}>
                <Plus size={18} /> Add document
              </Button>
            }
          />
          <div className="document-grid">
            {DEFAULTS.map((item) =>
              documentCard(
                defaults[item.key].record,
                item.title,
                item.type,
                defaults[item.key].url,
              ),
            )}
          </div>
          {documents.some((item) => !defaultIds.has(item.id)) && (
            <section>
              <div className="document-section-heading">
                <h2>More documents</h2>
              </div>
              <div className="document-grid">
                {documents
                  .filter((item) => !defaultIds.has(item.id))
                  .map((item) => documentCard(item, item.title))}
              </div>
            </section>
          )}
          <ProfileLinks />
          <div className="document-recovery">
            <Button
              variant="ghost"
              disabled={recovering}
              onClick={() => {
                if (recovery) setRecovery(null);
                else void showRecovery();
              }}
            >
              <RotateCcw size={16} />{" "}
              {recovering
                ? "Loading…"
                : recovery
                  ? "Hide deleted documents"
                  : "Recently deleted documents"}
            </Button>
            {recovery && (
              <Card className="stack">
                {recovery.length ? (
                  recovery.map((item) => (
                    <div className="document-version" key={item.id}>
                      <strong>{item.title}</strong>
                      <Button
                        variant="secondary"
                        disabled={!!pending}
                        onClick={() =>
                          void restore(item.id)
                            .then(() =>
                              setRecovery(
                                (items) =>
                                  items?.filter(
                                    (value) => value.id !== item.id,
                                  ) || null,
                              ),
                            )
                            .catch((failure) => setError(errorMessage(failure)))
                        }
                      >
                        Restore
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="muted">No deleted documents.</p>
                )}
              </Card>
            )}
          </div>
        </>
      )}
      {error && !editing && !deleting && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Modal
        open={!!editing}
        title={editing?.record ? "Edit document" : "Add document"}
        onClose={() => setEditing(undefined)}
      >
        {editing && (
          <DocumentEditor
            key={editing.record?.id || editing.defaultType || "new"}
            {...editing}
            initialUrl={editing.url}
            onClose={() => setEditing(undefined)}
            onSaved={(record) => {
              setEditing(undefined);
              if (params.has("default") || params.has("record")) open(record);
            }}
          />
        )}
      </Modal>
      <Modal
        open={!!deleting}
        title={`Delete ${deleting?.title || "document"}?`}
        onClose={() => {
          if (!pending) setDeleting(undefined);
        }}
      >
        <p>
          The document and its uploaded copies can be restored from Recently
          deleted documents.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <Button
            variant="danger"
            disabled={!!pending}
            onClick={() => void deleteDocument()}
          >
            Delete document
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(undefined)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}
