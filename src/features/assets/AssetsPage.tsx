import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronUp, FileText, GitFork, Plus } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import { documentRecords } from "../../../shared/documents";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "../../components/ui";
import { useEditMode } from "../../lib/edit-mode";
import { useWorkspace } from "../../lib/workspace";
import { errorMessage } from "../search/domain";
import { request, jsonRequest } from "../../lib/api";
import { DocumentEditor } from "./DocumentEditor";
import { DocumentPreview } from "./DocumentPreview";
import { DocumentViewer } from "./DocumentViewer";
import { ProfileLinks } from "./ProfileLinks";
import { InlineTitle } from "../content/InlineTitle";
import { variantTree } from "./variantTree";
import "./documents.css";
const LatexPanel = lazy(() => import("./LatexDocumentPanel"));
export { getDocumentLinks } from "./documentLinks";
const FAMILIES = [
  { type: "resume", title: "Résumé" },
  { type: "letter", title: "Cover letter" },
] as const;
const familyOf = (record: WorkRecord) =>
  field(record, "type").replace("cover-letter", "letter");
const native = (record: WorkRecord) =>
  !!record.data.latexProject || record.data.nativeDocument === true;

export function AssetsPage() {
  const { records, create, update, remove, refresh, pending } = useWorkspace();
  const { editing } = useEditMode();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<WorkRecord>();
  const [fork, setFork] = useState<WorkRecord>();
  const [forkTarget, setForkTarget] = useState<{
    parentId: string;
    record: WorkRecord;
    forked?: boolean;
  }>();
  const [name, setName] = useState("");
  const [application, setApplication] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const documents = documentRecords(records);
  const selected = documents.find(
    (record) => record.id === params.get("record"),
  );
  useEffect(() => {
    if (!params.has("record") && !params.has("default")) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      const expanded = pageRef.current?.querySelector(
        ".document-family-expanded, .document-more-expanded",
      );
      if (
        target instanceof Node &&
        expanded &&
        !expanded.contains(target)
      )
        setParams({});
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [params, setParams]);
  const applications = records.filter(
    (record) => record.kind === "application" && !record.deletedAt,
  );
  function open(record: WorkRecord) {
    setParams({ record: record.id });
  }
  async function createNative(type: "resume" | "letter", parent?: WorkRecord) {
    setBusy(true);
    setError("");
    try {
      const result =
        parent && forkTarget?.parentId === parent.id
          ? forkTarget.record
          : await create({
              kind: "asset",
              title: parent
                ? name.trim() || "Untitled variant"
                : type === "resume"
                  ? "Main résumé"
                  : "Main cover letter",
              data: {
                type,
                nativeDocument: true,
                documentDefault: !parent,
                ...(parent ? { forkedFromTitle: parent.title } : {}),
                ...(application ? { applicationIds: [application] } : {}),
              },
            });
      if (parent && !forkTarget)
        setForkTarget({ parentId: parent.id, record: result });
      if (
        parent &&
        !(forkTarget?.parentId === parent.id && forkTarget.forked)
      ) {
        await request(
          `/api/latex/${encodeURIComponent(parent.id)}/fork`,
          jsonRequest("POST", { targetAssetId: result.id }),
        );
        setForkTarget({ parentId: parent.id, record: result, forked: true });
      }
      await refresh();
      setFork(undefined);
      setForkTarget(undefined);
      setName("");
      setApplication("");
      open(result);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  function deletion(record: WorkRecord) {
    return (
      editing && (
        <Button
          variant="ghost"
          onClick={() => setDeleting(record)}
          aria-label={`Delete ${record.title}`}
        >
          Delete
        </Button>
      )
    );
  }
  return (
    <div className="page-stack documents-page" ref={pageRef}>
      <PageHeader title="Documents" />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="document-grid">
        {FAMILIES.map((family) => {
          const variants = documents.filter(
            (record) => native(record) && familyOf(record) === family.type,
          );
          const primary =
            variants.find((record) => record.data.documentDefault === true) ||
            variants.find((record) => !field(record, "parentVariantId")) ||
            variants[0];
          const expanded =
            params.get("default") === family.type ||
            (selected &&
              native(selected) &&
              familyOf(selected) === family.type);
          const current =
            selected && variants.includes(selected) ? selected : primary;
          return (
            <Card
              key={family.type}
              className={`document-card document-${family.type} ${expanded ? "document-family-expanded" : ""}`}
            >
              <button
                id={`document-family-${family.type}`}
                className="document-family-open"
                aria-expanded={!!expanded}
                onClick={() =>
                  expanded
                    ? setParams({})
                    : primary
                      ? open(primary)
                      : setParams({ default: family.type })
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
                    className="document-variant-tree"
                    aria-label={`${family.title} variants`}
                  >
                    {variantTree(variants).map(
                      ({ record, depth, historicalParent }) => (
                        <div
                          key={record.id}
                          className="document-variant-row"
                          style={{ paddingLeft: `${depth * 1.2}rem` }}
                        >
                          {depth > 0 && <GitFork size={14} />}
                          <button
                            className={`document-variant-select ${current?.id === record.id ? "is-selected" : ""}`}
                            onClick={() => open(record)}
                          >
                            {editing ? <FileText size={15} /> : record.title}
                            {record.id === primary?.id && (
                              <span className="document-default-label">
                                Main
                              </span>
                            )}
                          </button>
                          {editing && (
                            <InlineTitle
                              value={record.title}
                              label="Variant name"
                              onSave={async (title) => {
                                await update(
                                  record.id,
                                  { title: title.trim() || "Untitled variant" },
                                  record.version,
                                );
                              }}
                            />
                          )}
                          {historicalParent && (
                            <small className="muted">
                              Historical parent:{" "}
                              {field(
                                record,
                                "forkedFromTitle",
                                "removed variant",
                              )}
                            </small>
                          )}
                          {Array.isArray(record.data.applicationIds) &&
                            record.data.applicationIds.length > 0 && (
                              <small className="muted">
                                Application variant
                              </small>
                            )}
                          {deletion(record)}
                        </div>
                      ),
                    )}
                  </div>
                  {editing && current && !!current.data.latexProject && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setFork(current);
                        setName("");
                        setApplication("");
                      }}
                    >
                      <GitFork size={16} />
                      New variant
                    </Button>
                  )}
                  {fork && variants.includes(fork) && (
                    <form
                      className="document-fork-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void createNative(family.type, fork);
                      }}
                    >
                      <Field label="Variant name">
                        <Input
                          autoFocus
                          value={name}
                          maxLength={240}
                          placeholder="Security, Master, Google…"
                          onChange={(event) => setName(event.target.value)}
                        />
                      </Field>
                      <Field label="Application">
                        <Select
                          value={application}
                          onChange={(event) =>
                            setApplication(event.target.value)
                          }
                        >
                          <option value="">General variant</option>
                          {applications.map((record) => (
                            <option key={record.id} value={record.id}>
                              {field(record, "company")} · {record.title} ·{" "}
                              {field(record, "status")}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <div className="inline-actions">
                        <Button type="submit" disabled={busy}>
                          Create variant
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setFork(undefined)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                  {current ? (
                    <Suspense fallback={<p role="status">Loading document…</p>}>
                      <LatexPanel
                        key={current.id}
                        record={current}
                        primary={primary}
                      />
                    </Suspense>
                  ) : editing ? (
                    <Button
                      disabled={busy}
                      onClick={() => void createNative(family.type)}
                    >
                      <Plus size={16} />
                      Write in LaTeX
                    </Button>
                  ) : (
                    <p className="muted">No document yet.</p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <section>
        <div className="document-section-heading">
          <h2>Other documents</h2>
          {editing && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={16} />
              Add document
            </Button>
          )}
        </div>
        {adding && (
          <Card>
            <DocumentEditor
              onClose={() => setAdding(false)}
              onSaved={(record) => {
                setAdding(false);
                open(record);
              }}
            />
          </Card>
        )}
        <div className="document-more-grid">
          {documents
            .filter((record) => !native(record))
            .map((record) => (
              <Card
                className={`document-card document-named ${selected?.id === record.id ? "document-more-expanded" : ""}`}
                key={record.id}
              >
                <button
                  className="document-family-open"
                  aria-expanded={selected?.id === record.id}
                  onClick={() =>
                    selected?.id === record.id ? setParams({}) : open(record)
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
                {selected?.id === record.id ? null : deletion(record)}
                {selected?.id === record.id && (
                  <DocumentViewer
                    inline
                    record={record}
                    title={record.title}
                    onBack={() => setParams({})}
                    onDelete={editing ? () => setDeleting(record) : undefined}
                  />
                )}
              </Card>
            ))}
        </div>
      </section>
      <ProfileLinks />
      <Modal
        open={!!deleting}
        title={`Delete ${deleting?.title || "document"}?`}
        onClose={() => setDeleting(undefined)}
      >
        <p>Independent variants and submitted versions remain available.</p>
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
