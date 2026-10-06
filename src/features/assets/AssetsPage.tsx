import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Copy, FileText, Plus, Trash2, X } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import { documentRecords } from "../../../shared/documents";
import { Button, Card, Modal, PageHeader } from "../../components/ui";
import { useEditMode } from "../../lib/edit-mode";
import { flushAutosaves } from "../../lib/autosave";
import { useWorkspace } from "../../lib/workspace";
import { errorMessage } from "../search/domain";
import { ApiError, request, jsonRequest } from "../../lib/api";
import { DocumentEditor } from "./DocumentEditor";
import { DocumentPreview } from "./DocumentPreview";
import { DocumentViewer } from "./DocumentViewer";
import { ProfileLinks } from "./ProfileLinks";
import { InlineTitle } from "../content/InlineTitle";
import { SortableList } from "../content/SortableList";
import { reorderRecords } from "../content/reorderRecords";
import "./documents.css";
const LatexPanel = lazy(() => import("./LatexDocumentPanel"));
export { getDocumentLinks } from "./documentLinks";
const FAMILIES = [
  { type: "resume", title: "Resume" },
  { type: "letter", title: "Cover letter" },
] as const;
const familyOf = (record: WorkRecord) =>
  field(record, "type").replace("cover-letter", "letter");
const native = (record: WorkRecord) =>
  !!record.data.latexProject || record.data.nativeDocument === true;

export function AssetsPage() {
  const workspace = useWorkspace();
  const { records, create, update, remove, refresh, pending, isPending } =
    workspace;
  const { editing } = useEditMode();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<WorkRecord>();
  const [newTitleId, setNewTitleId] = useState<string>();
  const [copyStates, setCopyStates] = useState<
    Record<string, { sourceId: string; error?: string }>
  >({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const creatingRef = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const wasDocumentExpanded = useRef(false);
  const documentExpandedScrollY = useRef(0);
  const resetScrollOnNextExpand = useRef(false);
  const openedDocumentFromRoute = useRef(
    params.has("record") || params.has("default"),
  );
  const documents = documentRecords(records);
  const selected = documents.find(
    (record) => record.id === params.get("record"),
  );
  useEffect(() => {
    if (!newTitleId || !editing) return;
    const tab = document.getElementById(`document-tab-${newTitleId}`);
    const input = tab?.querySelector<HTMLInputElement>("input.inline-title");
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
    const scroller = tab?.closest<HTMLElement>(".document-tabs");
    if (tab && scroller) {
      const tabBounds = tab.getBoundingClientRect();
      const bounds = scroller.getBoundingClientRect();
      if (tabBounds.left < bounds.left)
        scroller.scrollLeft += tabBounds.left - bounds.left;
      else if (tabBounds.right > bounds.right)
        scroller.scrollLeft += tabBounds.right - bounds.right;
    }
    setNewTitleId(undefined);
  }, [newTitleId, editing, records]);
  useEffect(() => {
    const expanded = params.has("record") || params.has("default");
    if (resetScrollOnNextExpand.current && expanded) {
      documentExpandedScrollY.current = 0;
      resetScrollOnNextExpand.current = false;
      requestAnimationFrame(() => window.scrollTo(0, 0));
    } else if (!wasDocumentExpanded.current && expanded) {
      documentExpandedScrollY.current = window.scrollY;
    }
    if (wasDocumentExpanded.current && !expanded) {
      requestAnimationFrame(() => {
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        window.scrollTo(
          0,
          Math.min(documentExpandedScrollY.current, maxScroll),
        );
      });
    }
    wasDocumentExpanded.current = expanded;
  }, [params]);
  useEffect(() => {
    if (!openedDocumentFromRoute.current) return;
    if (params.has("record") && !selected) return;
    openedDocumentFromRoute.current = false;
    documentExpandedScrollY.current = 0;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => window.scrollTo(0, 0)),
    );
  }, [params, selected?.id]);
  useEffect(() => {
    if (!params.has("record") && !params.has("default")) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      const modal = pageRef.current?.querySelector("dialog[open]");
      const expanded = pageRef.current?.querySelector(
        ".document-family-expanded, .document-more-expanded",
      );
      // Portalled controls consume the dismissal click before the document does.
      if (document.querySelector('[data-work-overlay="open"]')) return;
      if (target instanceof Node && modal?.contains(target)) return;
      if (target instanceof Node && expanded && !expanded.contains(target))
        setParams({});
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [params, setParams]);
  function open(record: WorkRecord) {
    setParams({ record: record.id });
  }
  async function finishCopy(targetId: string, sourceId: string, retry = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      // A lost response may have completed the copy already. Keep that snapshot.
      const existing =
        retry || attempt > 0
          ? await request<{ project: unknown }>(
              `/api/latex/${encodeURIComponent(targetId)}`,
            )
          : null;
      if (existing?.project) break;
      try {
        await request(
          `/api/latex/${encodeURIComponent(sourceId)}/copy`,
          jsonRequest("POST", { targetAssetId: targetId }),
        );
        break;
      } catch (failure) {
        // Naming the new tab can advance its version while the copy is saving.
        if (!(
          failure instanceof ApiError &&
          failure.status === 409 &&
          attempt < 2
        ))
          throw failure;
      }
    }
    await refresh();
    setCopyStates((current) => {
      const next = { ...current };
      delete next[targetId];
      return next;
    });
  }
  async function retryCopy(targetId: string, sourceId: string) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setBusy(true);
    setError("");
    setCopyStates((current) => ({ ...current, [targetId]: { sourceId } }));
    try {
      await finishCopy(targetId, sourceId, true);
    } catch (failure) {
      setCopyStates((current) => ({
        ...current,
        [targetId]: { sourceId, error: errorMessage(failure) },
      }));
    } finally {
      creatingRef.current = false;
      setBusy(false);
    }
  }
  async function createNative(type: "resume" | "letter", source?: WorkRecord) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setBusy(true);
    setError("");
    let copyTarget: { id: string; sourceId: string } | undefined;
    try {
      let latestSource = source;
      if (source) {
        await flushAutosaves();
        const localSource = recordsRef.current.find(
          (record) => record.id === source.id,
        );
        if (localSource) latestSource = localSource;
        if (!isPending(source.id) && !source.id.startsWith("offline-")) {
          const response = await request<{ record: WorkRecord }>(
            `/api/records/${encodeURIComponent(source.id)}`,
          );
          latestSource = response.record;
        }
      }

      const result = await create({
        kind: "asset",
        title: latestSource
          ? `${latestSource.title.slice(0, 233)} (copy)`
          : "Untitled",
        data: {
          type,
          nativeDocument: true,
          order: recordsRef.current.filter(
            (item) => native(item) && familyOf(item) === type,
          ).length,
        },
      });
      if (latestSource?.data.latexProject) {
        const sourceId = latestSource.id;
        copyTarget = { id: result.id, sourceId };
        setCopyStates((current) => ({
          ...current,
          [result.id]: { sourceId },
        }));
      }
      open(result);
      setNewTitleId(result.id);
      if (copyTarget) await finishCopy(copyTarget.id, copyTarget.sourceId);
    } catch (failure) {
      const failedCopy = copyTarget;
      if (failedCopy)
        setCopyStates((current) => ({
          ...current,
          [failedCopy.id]: {
            sourceId: failedCopy.sourceId,
            error: errorMessage(failure),
          },
        }));
      else setError(errorMessage(failure));
    } finally {
      creatingRef.current = false;
      setBusy(false);
    }
  }
  function deletion(record: WorkRecord) {
    return (
      editing && (
        <Button
          variant="danger"
          className="document-variant-delete"
          disabled={busy && !!copyStates[record.id]}
          onClick={() => setDeleting(record)}
          aria-label={`Delete ${record.title}`}
        >
          <Trash2 size={16} /> Delete
        </Button>
      )
    );
  }
  function documentTabs(
    type: "resume" | "letter",
    title: string,
    variants: WorkRecord[],
    current?: WorkRecord,
  ) {
    return (
      <SortableList
        className="section-tabs editable-tabs document-tabs"
        horizontal
        label={`${title} documents`}
        items={variants}
        onReorder={async (ids) => {
          await flushAutosaves();
          const latest =
            workspace.mode === "demo"
              ? recordsRef.current
              : (await request<{ records: WorkRecord[] }>("/api/records"))
                  .records;
          const ordered = ids.map((id) => {
            const item = latest.find((record) => record.id === id);
            if (!item)
              throw new Error(
                "A document changed. Reload the list before arranging it.",
              );
            return item;
          });
          await reorderRecords(ordered, workspace);
        }}
        trailing={
          editing && (
            <Button
              variant="secondary"
              className="document-tab-new"
              disabled={busy}
              onClick={() => void createNative(type)}
            >
              <Plus size={16} /> New blank {title.toLowerCase()}
            </Button>
          )
        }
      >
        {(record, handle) => (
          <div className="document-tab-item">
            <div
              className={`editable-tab document-tab ${current?.id === record.id ? "active" : ""}`}
              role="tab"
              id={`document-tab-${record.id}`}
              aria-controls={`document-content-${type}`}
              aria-label={record.title}
              aria-selected={current?.id === record.id}
              tabIndex={current?.id === record.id ? 0 : -1}
              onClick={() => open(record)}
              onFocusCapture={(event) => {
                if (event.target instanceof HTMLInputElement) open(record);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (["Enter", " "].includes(event.key)) {
                  event.preventDefault();
                  open(record);
                } else if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const index = variants.indexOf(record);
                  const next =
                    variants[
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? variants.length - 1
                          : (index +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              variants.length) %
                            variants.length
                    ];
                  open(next);
                  document.getElementById(`document-tab-${next.id}`)?.focus();
                }
              }}
            >
              {handle}
              <InlineTitle
                draftKey={`document-title:${record.id}`}
                version={record.version}
                value={record.title}
                autoFocus={newTitleId === record.id}
                label={`${title} document name`}
                onSave={(name, version) =>
                  update(
                    record.id,
                    { title: name.trim() || `Untitled ${title.toLowerCase()}` },
                    version,
                  )
                }
              />
            </div>
            {editing && (
              <div className="document-tab-actions">
                {deletion(record)}
                <Button
                  variant="secondary"
                  className="document-variant-copy"
                  aria-label={`Copy ${record.title}`}
                  disabled={busy || !!copyStates[record.id]}
                  onClick={() => void createNative(type, record)}
                >
                  <Copy size={16} /> Copy
                </Button>
              </div>
            )}
          </div>
        )}
      </SortableList>
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
          const familyRecords = documents
            .filter(
              (record) => native(record) && familyOf(record) === family.type,
            )
            .sort(
              (a, b) =>
                a.createdAt.localeCompare(b.createdAt) ||
                a.id.localeCompare(b.id),
            );
          const variants = [...familyRecords].sort(
            (a, b) =>
              (typeof a.data.order === "number"
                ? a.data.order
                : familyRecords.indexOf(a)) -
              (typeof b.data.order === "number"
                ? b.data.order
                : familyRecords.indexOf(b)),
          );
          const expanded = !!(
            params.get("default") === family.type ||
            (selected && native(selected) && familyOf(selected) === family.type)
          );
          const current =
            selected && variants.includes(selected) ? selected : variants[0];
          return (
            <Card
              key={family.type}
              className={`document-card document-${family.type} ${expanded ? "document-family-expanded" : ""}`}
            >
              {expanded ? (
                <div className="document-viewer-toolbar document-family-heading">
                  <h2>{family.title}</h2>
                  <div className="document-family-tabs">
                    {documentTabs(family.type, family.title, variants, current)}
                  </div>
                  <Button
                    variant="ghost"
                    className="icon-button document-viewer-close"
                    onClick={() => setParams({})}
                    aria-label={`Close ${family.title}`}
                  >
                    <X size={18} />
                  </Button>
                </div>
              ) : (
                <button
                  id={`document-family-${family.type}`}
                  className="document-family-open"
                  aria-expanded={false}
                  onClick={() =>
                    current
                      ? open(current)
                      : setParams({ default: family.type })
                  }
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
                  <span className="document-family-title">{family.title}</span>
                </button>
              )}
              {expanded && (
                <div
                  className="document-family-content"
                  id={`document-content-${family.type}`}
                  role="tabpanel"
                  aria-label={current?.title || family.title}
                >
                  {current && copyStates[current.id] ? (
                    <div
                      role={copyStates[current.id].error ? "alert" : "status"}
                    >
                      <p>
                        {copyStates[current.id].error ||
                          "Copying document source…"}
                      </p>
                      {copyStates[current.id].error && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void retryCopy(
                              current.id,
                              copyStates[current.id].sourceId,
                            )
                          }
                        >
                          Retry copy
                        </Button>
                      )}
                    </div>
                  ) : current ? (
                    <Suspense fallback={<p role="status">Loading document…</p>}>
                      <LatexPanel key={current.id} record={current} />
                    </Suspense>
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
                resetScrollOnNextExpand.current = true;
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
                {selected?.id === record.id && (
                  <DocumentViewer
                    inline
                    record={record}
                    title={record.title}
                    onBack={() => setParams({})}
                    onDelete={editing ? () => setDeleting(record) : undefined}
                  />
                )}
                {selected?.id !== record.id && (
                  <>
                    <button
                      className="document-family-open"
                      aria-label={`Open document ${record.title}`}
                      onClick={() => open(record)}
                    >
                      <DocumentPreview record={record} />
                      <span className="document-family-title">
                        {record.title}
                      </span>
                    </button>
                  </>
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
        <p>This document will be removed from your list.</p>
        <div className="inline-actions">
          <Button
            variant="danger"
            disabled={!!pending}
            onClick={() =>
              void (async () => {
                try {
                  await remove(deleting!.id);
                  if (selected?.id === deleting!.id) setParams({});
                  setCopyStates((current) => {
                    const next = { ...current };
                    delete next[deleting!.id];
                    return next;
                  });
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
