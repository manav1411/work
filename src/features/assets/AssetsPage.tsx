import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronUp, FileText, GitFork, Plus } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import { documentRecords } from "../../../shared/documents";
import { Button, Card, Modal, PageHeader } from "../../components/ui";
import { useEditMode } from "../../lib/edit-mode";
import { useSavingWorkspace as useWorkspace } from "../search/useSaving";
import { errorMessage } from "../search/domain";
import { getDocumentLinks, type DocumentType } from "./documentLinks";
import { DocumentEditor } from "./DocumentEditor";
import { DocumentPreview, DocumentComparison } from "./DocumentPreview";
import { DocumentViewer } from "./DocumentViewer";
import { ProfileLinks } from "./ProfileLinks";
import "./documents.css";
const LatexPanel = lazy(() => import("./LatexDocumentPanel"));
export { getDocumentLinks } from "./documentLinks";
const FAMILIES = [
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
  forkFrom?: WorkRecord;
};
const familyOf = (record?: WorkRecord) =>
  field(record, "type").replace("cover-letter", "letter");

export function AssetsPage() {
  const { records, remove, pending } = useWorkspace();
  const { editing: editMode } = useEditMode();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<DocumentEdit>();
  const [deleting, setDeleting] = useState<WorkRecord>();
  const [error, setError] = useState("");
  const [sourceReady, setSourceReady] = useState<string[]>([]);
  const [comparison, setComparison] = useState<{
    before: WorkRecord;
    after: WorkRecord;
  }>();
  const documents = documentRecords(records);
  const defaults = getDocumentLinks(records);
  const selected = documents.find((item) => item.id === params.get("record"));
  const selectedFamily = selected ? familyOf(selected) : params.get("default");
  function open(record?: WorkRecord, type?: DocumentType) {
    setParams(record ? { record: record.id } : type ? { default: type } : {});
  }
  function edit(value: DocumentEdit) {
    setEditing(value);
    setError("");
  }
  function collapse(type?: DocumentType) {
    setParams({});
    requestAnimationFrame(() =>
      document
        .getElementById(
          type ? `document-family-${type}` : `document-card-${selected?.id}`,
        )
        ?.focus(),
    );
  }
  function management(record: WorkRecord) {
    return (
      editMode && (
        <div className="inline-actions document-management">
          <Button
            variant="ghost"
            aria-label={`Edit ${record.title}`}
            onClick={() => edit({ record })}
          >
            Edit
          </Button>
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
        </div>
      )
    );
  }
  return (
    <div className="page-stack documents-page">
      <PageHeader
        title="Documents"
        action={
          editMode ? (
            <Button onClick={() => edit({})}>
              <Plus size={18} /> Add document
            </Button>
          ) : undefined
        }
      />
      <div className="document-grid">
        {FAMILIES.map((family) => {
          const primary = defaults[family.key].record;
          const expanded = selectedFamily === family.type;
          const variants = documents.filter(
            (item) => familyOf(item) === family.type,
          );
          const current =
            selected && familyOf(selected) === family.type ? selected : primary;
          return (
            <Card
              key={family.type}
              className={`document-card document-${family.type} ${expanded ? "document-family-expanded" : ""}`}
            >
              <button
                id={`document-family-${family.type}`}
                className="document-family-open"
                aria-expanded={expanded}
                onClick={() =>
                  expanded ? collapse(family.type) : open(primary, family.type)
                }
              >
                {!expanded && (
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
                <span className="document-family-title">
                  {family.title}
                  {expanded ? (
                    <ChevronUp size={20} />
                  ) : (
                    <span className="document-family-count">
                      {variants.length > 1 ? `${variants.length} versions` : ""}
                    </span>
                  )}
                </span>
              </button>
              {expanded && (
                <div className="document-family-content">
                  <div
                    className="document-variant-strip"
                    aria-label={`${family.title} variants`}
                  >
                    {variants.map((variant) => (
                      <div className="document-variant-chip" key={variant.id}>
                        <button
                          className={`document-variant-select ${current?.id === variant.id ? "is-selected" : ""}`}
                          onClick={() => open(variant)}
                        >
                          {variant.title}
                          {primary?.id === variant.id && (
                            <span className="document-default-label">Main</span>
                          )}
                        </button>
                        {management(variant)}
                      </div>
                    ))}
                    {editMode && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          edit(
                            current
                              ? { forkFrom: current }
                              : { defaultType: family.type },
                          )
                        }
                      >
                        {current ? <GitFork size={16} /> : <Plus size={16} />}
                        {current ? "New variant" : "Add document"}
                      </Button>
                    )}
                  </div>
                  {current ? (
                    <>
                      <Suspense
                        fallback={<p role="status">Loading document…</p>}
                      >
                        <LatexPanel
                          key={current.id}
                          record={current}
                          primary={primary}
                          onSourceReady={() =>
                            setSourceReady((currentIds) =>
                              currentIds.includes(current.id)
                                ? currentIds
                                : [...currentIds, current.id],
                            )
                          }
                        />
                      </Suspense>
                      {!current.data.latexProject &&
                        !sourceReady.includes(current.id) && (
                          <DocumentViewer
                            inline
                            record={current}
                            title={current.title}
                            onBack={() => collapse(family.type)}
                            onEdit={() => edit({ record: current })}
                          />
                        )}
                      {primary &&
                        current.id !== primary.id &&
                        !current.data.latexProject &&
                        !sourceReady.includes(current.id) && (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setComparison({ before: primary, after: current })
                            }
                          >
                            Compare uploaded versions
                          </Button>
                        )}
                    </>
                  ) : (
                    <div className="document-inline-empty">
                      {editMode ? (
                        <Button
                          onClick={() =>
                            edit({
                              defaultType: family.type,
                            })
                          }
                        >
                          Create {family.title.toLowerCase()}
                        </Button>
                      ) : (
                        <span className="muted">No document yet.</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {documents.some(
        (item) => !["resume", "letter"].includes(familyOf(item)),
      ) && (
        <section>
          <div className="document-section-heading">
            <h2>More documents</h2>
          </div>
          <div className="document-more-grid">
            {documents
              .filter((item) => !["resume", "letter"].includes(familyOf(item)))
              .map((record) => (
                <Card
                  className={`document-card document-named ${selected?.id === record.id ? "document-more-expanded" : ""}`}
                  key={record.id}
                >
                  <button
                    id={`document-card-${record.id}`}
                    className="document-family-open"
                    aria-expanded={selected?.id === record.id}
                    onClick={() =>
                      selected?.id === record.id ? collapse() : open(record)
                    }
                  >
                    {selected?.id !== record.id && (
                      <DocumentPreview record={record} />
                    )}
                    <span className="document-family-title">
                      {record.title}
                      {selected?.id === record.id && <ChevronUp size={18} />}
                    </span>
                  </button>
                  {management(record)}
                  {selected?.id === record.id && (
                    <DocumentViewer
                      inline
                      record={record}
                      title={record.title}
                      onBack={() => collapse()}
                      onEdit={() => edit({ record })}
                    />
                  )}
                </Card>
              ))}
          </div>
        </section>
      )}
      {params.has("record") && !selected && (
        <p role="status">
          Document unavailable.{" "}
          <Button variant="ghost" onClick={() => setParams({})}>
            Close
          </Button>
        </p>
      )}
      <ProfileLinks />
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
            onClose={() => setEditing(undefined)}
            onSaved={(record) => {
              setEditing(undefined);
              open(record);
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
        {comparison && <DocumentComparison {...comparison} />}
      </Modal>
      <Modal
        open={!!deleting}
        title={`Delete ${deleting?.title || "document"}?`}
        onClose={() => {
          if (!pending) setDeleting(undefined);
        }}
      >
        <p>Independent variants remain available.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <Button
            variant="danger"
            disabled={!!pending}
            onClick={() =>
              void (async () => {
                try {
                  await remove(deleting!.id);
                  if (selected?.id === deleting!.id) setParams({});
                  setDeleting(undefined);
                } catch (failure) {
                  setError(errorMessage(failure));
                }
              })()
            }
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
