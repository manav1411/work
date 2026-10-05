import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Plus, GitFork } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import { documentRecords, documentUrl } from "../../../shared/documents";
import {
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
} from "../../components/ui";
import { useEditMode } from "../../lib/edit-mode";
import { DocumentPreview, DocumentComparison } from "./DocumentPreview";
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
  forkFrom?: WorkRecord;
};

export function AssetsPage() {
  const { records, preferences, remove, pending } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const defaults = getDocumentLinks(records, preferences);
  const documents = documentRecords(records);
  const [editing, setEditing] = useState<DocumentEdit>();
  const [deleting, setDeleting] = useState<WorkRecord>();
  const [error, setError] = useState("");
  const { editing: editMode } = useEditMode();
  const [comparison, setComparison] = useState<{
    before: string;
    after: string;
  }>();
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
  async function deleteDocument() {
    if (!deleting) return;
    try {
      await remove(deleting.id);
      setDeleting(undefined);

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
        {!type ? (
          <button
            className="document-preview-open"
            aria-label={`Open ${record?.title}`}
            onClick={() => open(record)}
          >
            {record && <DocumentPreview record={record} />}
          </button>
        ) : (
          <div className="document-art" aria-hidden="true">
            <div className="document-paper">
              <FileText size={38} strokeWidth={1.6} />
              <i />
              <i />
              <i />
            </div>
            <span className="document-star">✦</span>
          </div>
        )}
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
          {editMode && (
            <Button
              variant="ghost"
              aria-label={`Edit ${record?.title || title}`}
              onClick={() => edit({ record, defaultType: type, url })}
            >
              Edit
            </Button>
          )}
          {editMode && record && (
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
        {type && (
          <div className="document-variants">
            {documents
              .filter(
                (item) =>
                  item.id !== record?.id &&
                  (field(item, "type") === type ||
                    (type === "letter" &&
                      field(item, "type") === "cover-letter")),
              )
              .map((variant) => (
                <div className="document-variant-row" key={variant.id}>
                  <button
                    className="document-variant-open"
                    onClick={() => open(variant)}
                  >
                    {variant.title}
                  </button>
                  {editMode && (
                    <div className="inline-actions">
                      <Button
                        variant="ghost"
                        aria-label={`Edit ${variant.title}`}
                        onClick={() => edit({ record: variant })}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Delete ${variant.title}`}
                        onClick={() => {
                          setDeleting(variant);
                          setError("");
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      record &&
                      setComparison({ before: record.id, after: variant.id })
                    }
                  >
                    Compare
                  </Button>
                </div>
              ))}
          </div>
        )}
        {type && editMode && record && (
          <Button variant="ghost" onClick={() => edit({ forkFrom: record })}>
            <GitFork size={16} /> New variant
          </Button>
        )}
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
              editMode ? (
                <Button onClick={() => edit({})}>
                  <Plus size={18} /> Add document
                </Button>
              ) : undefined
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
          {documents.some(
            (item) =>
              !defaultIds.has(item.id) &&
              !["resume", "letter", "cover-letter"].includes(
                field(item, "type"),
              ),
          ) && (
            <section>
              <div className="document-section-heading">
                <h2>More documents</h2>
              </div>
              <div className="document-more-grid">
                {documents
                  .filter(
                    (item) =>
                      !defaultIds.has(item.id) &&
                      !["resume", "letter", "cover-letter"].includes(
                        field(item, "type"),
                      ),
                  )
                  .map((item) => documentCard(item, item.title))}
              </div>
            </section>
          )}
          <ProfileLinks />
        </>
      )}
      {error && !editing && !deleting && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Modal
        open={!!editing}
        title={
          editing?.record
            ? "Edit document"
            : editing?.forkFrom
              ? "Fork document"
              : "Add document"
        }
        onClose={() => setEditing(undefined)}
      >
        {editing && (
          <DocumentEditor
            key={
              editing.record?.id ||
              editing.forkFrom?.id ||
              editing.defaultType ||
              "new"
            }
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
        open={!!comparison}
        size="large"
        title="Compare document versions"
        onClose={() => setComparison(undefined)}
      >
        {comparison && (
          <>
            <div className="document-comparison-grid">
              {(["before", "after"] as const).map((side) => (
                <select
                  aria-label={
                    side === "before" ? "Original document" : "Variant document"
                  }
                  key={side}
                  value={comparison[side]}
                  onChange={(event) =>
                    setComparison({ ...comparison, [side]: event.target.value })
                  }
                >
                  {documents
                    .filter(
                      (item) =>
                        field(item, "type").replace(
                          "cover-letter",
                          "letter",
                        ) ===
                        field(
                          documents.find(
                            (value) => value.id === comparison.before,
                          ),
                          "type",
                        ).replace("cover-letter", "letter"),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                </select>
              ))}
            </div>
            {documents.find((item) => item.id === comparison.before) &&
              documents.find((item) => item.id === comparison.after) && (
                <DocumentComparison
                  before={documents.find(
                    (item) => item.id === comparison.before,
                  )!}
                  after={documents.find(
                    (item) => item.id === comparison.after,
                  )!}
                />
              )}
          </>
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
          This removes the document from your workspace. Independent variants
          remain available.
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
