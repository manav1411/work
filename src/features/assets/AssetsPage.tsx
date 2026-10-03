import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  field,
  localDate,
  niceDate,
  recordUrl,
  safeUrl,
  type Attachment,
  type RecordRevision,
  type WorkRecord,
} from "../../../shared/model";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Markdown,
  Modal,
  PageHeader,
  RecordLinks,
  Select,
  Textarea,
} from "../../components/ui";
import {
  downloadFile,
  getAttachments,
  getAttachmentUrl,
  getRevisions,
  removeAttachment,
  uploadAttachment,
} from "../../lib/api";
import { useSavingWorkspace as useWorkspace } from "../search/useSaving";
import { assetVersions, errorMessage, relatedRecords } from "../search/domain";
import {
  defaultProfileTasks,
  emptyEntry,
  emptyResume,
  profileTasks,
  resumeContent,
  resumeMarkdown,
  safeFilename,
  type ProfileTask,
  type ResumeContent,
  type ResumeEntry,
} from "./domain";
import "./assets.css";

const TYPES = [
  { value: "resume", label: "Résumé" },
  { value: "bullet", label: "Evidence / bullet bank" },
  { value: "cover-letter", label: "Cover letter" },
  { value: "answer", label: "Application answer" },
  { value: "profile", label: "Profile & website checklist" },
];
const label = (type: string) =>
  TYPES.find((item) => item.value === type)?.label || "Career asset";
const blank = {
  title: "",
  type: "resume",
  versionLabel: "",
  targetRoles: "",
  overleaf: "",
  body: "",
  verified: false,
  impact: "",
  scope: "",
  technologies: "",
  prompt: "",
  tags: "",
  links: [] as string[],
  documentMode: "structured",
  resume: emptyResume(),
  checklist: [] as ProfileTask[],
};

export function AssetsPage() {
  const {
    records,
    preferences,
    create,
    update,
    remove,
    notify,
    pending: pendingCount,
  } = useWorkspace();
  const pending = !!pendingCount;
  const [params, setParams] = useSearchParams();
  const [typeFilter, setTypeFilter] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [form, setForm] = useState(blank);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>(
    {},
  );
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [revisions, setRevisions] = useState<RecordRevision[]>([]);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionId, setRevisionId] = useState("");
  const [printRecord, setPrintRecord] = useState<WorkRecord | null>(null);
  const [fileRefresh, setFileRefresh] = useState(0);
  const assets = records.filter(
    (record) => record.kind === "asset" && !record.deletedAt,
  );
  const evidence = records.filter(
    (record) => record.kind === "achievement" && !record.deletedAt,
  );
  const bullets = assets.filter((record) => field(record, "type") === "bullet");
  const selected = assets.find((record) => record.id === params.get("record"));
  const filtered = assets.filter(
    (record) =>
      (!typeFilter || field(record, "type") === typeFilter) &&
      `${record.title} ${record.body} ${field(record, "targetRoles")} ${record.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const chosenRevision = revisions.find(
    (revision) => revision.id === revisionId,
  );
  const today = localDate(new Date(), preferences.timezone);

  useEffect(() => {
    const finishPrint = () => setPrintRecord(null);
    window.addEventListener("afterprint", finishPrint);
    return () => window.removeEventListener("afterprint", finishPrint);
  }, []);

  useEffect(() => {
    if (editing === undefined) return;
    setForm(
      editing
        ? {
            title: editing.title,
            type: field(editing, "type", "resume"),
            versionLabel: field(editing, "versionLabel"),
            targetRoles: field(editing, "targetRoles"),
            overleaf: field(editing, "overleaf"),
            body: editing.body,
            verified: editing.data.verified === true,
            impact: field(editing, "impact"),
            scope: field(editing, "scope"),
            technologies: field(editing, "technologies"),
            prompt: field(editing, "prompt"),
            tags: editing.tags.join(", "),
            links: editing.links,
            documentMode: field(
              editing,
              "documentMode",
              editing.data.resume ? "structured" : "markdown",
            ),
            resume: resumeContent(editing.data),
            checklist: profileTasks(editing.data),
          }
        : {
            ...blank,
            versionLabel: today,
            overleaf: preferences.overleaf,
            resume: {
              ...emptyResume(),
              name: preferences.displayName,
              website: preferences.website,
            },
          },
    );
  }, [editing]);
  useEffect(() => {
    setAttachments([]);
    setAttachmentUrls({});
    setRevisions([]);
    if (!selected) return;
    let active = true;
    setAttachmentLoading(true);
    void Promise.all([getAttachments(selected.id), getRevisions(selected.id)])
      .then(async ([files, history]) => {
        const urls = await Promise.all(
          files.map(
            async (file) => [file.id, await getAttachmentUrl(file.id)] as const,
          ),
        );
        if (!active) return;
        setAttachments(files);
        setAttachmentUrls(Object.fromEntries(urls));
        setRevisions(history);
        setAttachmentLoading(false);
      })
      .catch((error) => {
        if (active) {
          setAttachmentLoading(false);
          notify(errorMessage(error), "error");
        }
      });
    return () => {
      active = false;
    };
  }, [selected?.id, selected?.version, fileRefresh]);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const { title, body, tags, links, ...data } = form;
      const content =
        data.type === "resume" && data.documentMode === "structured"
          ? resumeMarkdown(data.resume)
          : body;
      const input = {
        title: title.trim(),
        body: content,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        links,
        data: { ...editing?.data, ...data },
      };
      const saved = editing
        ? await update(editing.id, input)
        : await create({ kind: "asset", ...input });
      setEditing(undefined);
      setParams({ record: saved.id });
      notify("Career asset saved with a new revision.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function upload(file: File) {
    if (!selected) return;
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      notify(
        "Choose a PDF exported from Overleaf or your document editor.",
        "error",
      );
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      notify("PDFs must be 10 MB or smaller.", "error");
      return;
    }
    setFileBusy(true);
    try {
      const attachment = await uploadAttachment(selected.id, file);
      await update(selected.id, {
        data: {
          ...selected.data,
          primaryAttachmentId: attachment.id,
          primaryAttachmentName: attachment.filename,
        },
      });
      setFileRefresh((value) => value + 1);
      notify(
        "PDF saved. Earlier files are retained for submitted versions.",
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setFileBusy(false);
    }
  }
  async function duplicate(record: WorkRecord) {
    try {
      const data = {
        ...record.data,
        versionLabel: `${today} variant`,
        primaryAttachmentId: "",
        primaryAttachmentName: "",
      };
      const saved = await create({
        kind: "asset",
        title: `${record.title} — variant`,
        body: record.body,
        tags: record.tags,
        links: [...record.links, record.id],
        data,
      });
      setParams({ record: saved.id });
      setEditing(saved);
      notify("Variant created. Upload its PDF after tailoring it.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function createProfileChecklist() {
    try {
      const saved = await create({
        kind: "asset",
        title: "Make my career profiles current",
        body: "",
        data: {
          type: "profile",
          versionLabel: today,
          checklist: defaultProfileTasks().map((task) => ({
            ...task,
            url: task.text.startsWith("LinkedIn")
              ? preferences.linkedin
              : task.text.startsWith("GitHub")
                ? preferences.github
                : task.text.startsWith("Website")
                  ? preferences.website
                  : task.url,
          })),
        },
      });
      setParams({ record: saved.id });
      notify(
        "Profile checklist ready. Each item has a concrete edit.",
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function toggleProfileTask(record: WorkRecord, task: ProfileTask) {
    try {
      await update(record.id, {
        data: {
          ...record.data,
          checklist: profileTasks(record.data).map((item) =>
            item.id === task.id ? { ...item, done: !item.done } : item,
          ),
        },
      });
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function taskToToday(record: WorkRecord, task: ProfileTask) {
    try {
      await create({
        kind: "action",
        title: task.nextAction || task.text,
        links: [record.id],
        data: {
          status: "todo",
          estimatedMinutes: 15,
          firstStep: task.nextAction || task.text,
          priority: "normal",
        },
      });
      notify("Profile edit added to Today.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  function importEvidence(id: string) {
    const record = evidence.find((item) => item.id === id);
    if (!record) return;
    setForm({
      ...form,
      type: "bullet",
      title: record.title,
      body: [
        field(record, "contribution"),
        field(record, "outcome"),
        record.body,
      ]
        .filter(Boolean)
        .join("\n\n"),
      impact: field(record, "outcome") || field(record, "impact"),
      scope: field(record, "scope"),
      technologies:
        field(record, "technologies") || field(record, "technology"),
      verified: record.data.verified === true,
      links: [...new Set([...form.links, record.id])],
    });
  }
  function editResume(key: keyof ResumeContent, value: string) {
    setForm({ ...form, resume: { ...form.resume, [key]: value } });
  }
  function editEntry(
    section: "experience" | "education" | "projects",
    id: string,
    patch: Partial<ResumeEntry>,
  ) {
    setForm({
      ...form,
      resume: {
        ...form.resume,
        [section]: form.resume[section].map((entry) =>
          entry.id === id ? { ...entry, ...patch } : entry,
        ),
      },
    });
  }
  function addBullet(bullet: WorkRecord) {
    const section = form.resume.experience.length
      ? form.resume.experience
      : [emptyEntry()];
    setForm({
      ...form,
      links: [...new Set([...form.links, bullet.id])],
      resume: {
        ...form.resume,
        experience: section.map((entry, index) =>
          index === 0
            ? { ...entry, bullets: [...entry.bullets, bullet.body] }
            : entry,
        ),
      },
    });
    notify(
      "Bullet added to the first experience entry. Place it with the matching role.",
      "info",
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CAREER / ASSETS"
        title="Put your best work forward."
        description="Real evidence, a résumé that fits, and the exact version you submitted. Keep Overleaf as your layout workspace."
        action={
          <Button onClick={() => setEditing(null)}>
            + Create a career asset
          </Button>
        }
      />
      <div className="asset-profile-strip">
        <a
          href={safeUrl(preferences.website) || "#"}
          target="_blank"
          rel="noreferrer"
        >
          Personal website ↗
        </a>
        <a
          href={safeUrl(preferences.linkedin) || "#"}
          target="_blank"
          rel="noreferrer"
        >
          LinkedIn ↗
        </a>
        <a
          href={safeUrl(preferences.github) || "#"}
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
        <Button
          variant="secondary"
          onClick={() => void createProfileChecklist()}
        >
          Build a profile checklist
        </Button>
      </div>
      <div className="toolbar">
        <Input
          aria-label="Search career assets"
          placeholder="Find a résumé, achievement bullet, or application answer…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="Filter career asset type"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="">All career assets</option>
          {TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <Badge tone="pink">{assets.length} assets</Badge>
      </div>
      <div className={selected ? "split-layout" : "card-grid"}>
        <div className={selected ? "stack" : "card-grid asset-card-grid"}>
          {filtered.map((asset) => (
            <Card
              key={asset.id}
              className={`asset-card ${selected?.id === asset.id ? "is-selected" : ""}`}
            >
              <div className="section-heading">
                <Badge tone="pink">{label(field(asset, "type"))}</Badge>
                {field(asset, "type") === "bullet" && (
                  <Badge tone={asset.data.verified === true ? "lime" : "muted"}>
                    {asset.data.verified === true
                      ? "Evidence checked"
                      : "Draft claim"}
                  </Badge>
                )}
              </div>
              <button
                className="record-title-button"
                onClick={() => setParams({ record: asset.id })}
              >
                {asset.title} ↗
              </button>
              <p className="muted">
                {field(asset, "versionLabel", `Record v${asset.version}`)} ·{" "}
                {niceDate(asset.updatedAt, preferences.timezone)}
              </p>
              <p>
                {field(asset, "targetRoles") ||
                  (field(asset, "type") === "bullet"
                    ? asset.body.slice(0, 170)
                    : "Add target roles, evidence, or profile actions.")}
              </p>
              <div className="section-heading">
                <small className="muted">
                  {asset.links.length} linked records
                </small>
                <Button variant="ghost" onClick={() => setEditing(asset)}>
                  Edit
                </Button>
              </div>
            </Card>
          ))}
          {!filtered.length && (
            <EmptyState
              title={
                assets.length
                  ? "No assets match."
                  : "Turn experience into something you can use."
              }
              description="Create a structured résumé, upload an Overleaf PDF, or turn an achievement into a bullet. Claims start with your real work."
              action={
                <Button onClick={() => setEditing(null)}>
                  Create your first asset
                </Button>
              }
            />
          )}
        </div>
        {selected && (
          <Card className="detail-panel">
            <div className="section-heading">
              <Badge tone="pink">{label(field(selected, "type"))}</Badge>
              <Button variant="ghost" onClick={() => setParams({})}>
                Close
              </Button>
            </div>
            <h2>{selected.title}</h2>
            <p className="muted">
              {field(selected, "versionLabel", `Record v${selected.version}`)} ·
              revision {selected.version} ·{" "}
              {field(selected, "targetRoles", "Target role not specified")}
            </p>
            <div className="inline-actions">
              <Button onClick={() => setEditing(selected)}>Edit asset</Button>
              <Button
                variant="secondary"
                onClick={() => void duplicate(selected)}
              >
                Create a variant
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  downloadFile(
                    selected.body,
                    `${safeFilename(selected.title)}.md`,
                    "text/markdown",
                  )
                }
              >
                Export Markdown
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setRevisionId(revisions[0]?.id || "");
                  setRevisionOpen(true);
                }}
              >
                Revision history
              </Button>
              {field(selected, "type") === "resume" && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPrintRecord(selected);
                    window.setTimeout(() => window.print(), 150);
                  }}
                >
                  Print / save PDF
                </Button>
              )}
              {safeUrl(field(selected, "overleaf")) && (
                <a
                  className="external-link"
                  href={safeUrl(field(selected, "overleaf"))!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Overleaf source ↗
                </a>
              )}
            </div>
            {field(selected, "type") === "bullet" && (
              <>
                <Badge
                  tone={selected.data.verified === true ? "lime" : "orange"}
                >
                  {selected.data.verified === true
                    ? "Evidence checked by you"
                    : "Draft — verify before using"}
                </Badge>
                <dl className="detail-facts">
                  <div>
                    <dt>Impact / measurement</dt>
                    <dd>
                      {field(
                        selected,
                        "impact",
                        "No verified measurement recorded",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Scope & contribution</dt>
                    <dd>{field(selected, "scope", "Not recorded")}</dd>
                  </div>
                  <div>
                    <dt>Technologies</dt>
                    <dd>{field(selected, "technologies", "Not recorded")}</dd>
                  </div>
                </dl>
              </>
            )}
            {field(selected, "prompt") && (
              <div className="next-action-callout">
                <strong>Application prompt</strong>
                <p>{field(selected, "prompt")}</p>
              </div>
            )}
            {field(selected, "type") === "profile" && (
              <div className="asset-profile-tasks">
                {profileTasks(selected.data).map((task) => (
                  <div className="asset-profile-task" key={task.id}>
                    <label
                      className={`checklist-row ${task.done ? "is-done" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={task.done}
                        disabled={pending}
                        onChange={() => void toggleProfileTask(selected, task)}
                      />
                      <strong>{task.text}</strong>
                    </label>
                    <p>
                      {task.nextAction ||
                        "Edit this item to give it a concrete next step."}
                    </p>
                    <div className="inline-actions">
                      <Button
                        variant="ghost"
                        onClick={() => void taskToToday(selected, task)}
                      >
                        Add edit to Today
                      </Button>
                      {safeUrl(task.url) && (
                        <a
                          className="external-link"
                          href={safeUrl(task.url)!}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open destination ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="asset-document-preview">
              <Markdown content={selected.body} />
            </div>
            {["resume", "cover-letter", "answer"].includes(
              field(selected, "type"),
            ) && (
              <section className="stack">
                <div className="section-heading">
                  <h3>PDF versions</h3>
                  <label
                    className={`button button-secondary asset-upload-label ${fileBusy ? "is-disabled" : ""}`}
                  >
                    {fileBusy ? "Uploading…" : "+ Upload PDF"}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={fileBusy || pending}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void upload(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <p className="muted">
                  Export from Overleaf and upload here. The newest PDF is
                  captured when you attach this asset to an opportunity. Earlier
                  PDFs stay available.
                </p>
                {attachmentLoading && (
                  <p role="status">Loading PDF versions…</p>
                )}
                {attachments.map((file) => {
                  const references = records.filter(
                    (record) =>
                      record.kind === "application" &&
                      assetVersions(record.data).some(
                        (version) => version.attachmentId === file.id,
                      ),
                  );
                  return (
                    <div className="asset-file" key={file.id}>
                      <div>
                        <strong>{file.filename}</strong>
                        <small className="muted">
                          {Math.ceil(file.size / 1024)} KB ·{" "}
                          {niceDate(file.createdAt)}{" "}
                          {field(selected, "primaryAttachmentId") === file.id
                            ? "· Current PDF"
                            : ""}
                        </small>
                        {references.length > 0 && (
                          <small className="muted">
                            Preserved for {references.length} application
                            {references.length > 1 ? "s" : ""}
                          </small>
                        )}
                      </div>
                      <div className="inline-actions">
                        {attachmentUrls[file.id] && (
                          <a
                            className="external-link"
                            href={attachmentUrls[file.id]}
                            target="_blank"
                            rel="noreferrer"
                            download={file.filename}
                          >
                            Download / open ↗
                          </a>
                        )}
                        <Button
                          variant="ghost"
                          disabled={
                            fileBusy ||
                            !!references.length ||
                            field(selected, "primaryAttachmentId") === file.id
                          }
                          onClick={async () => {
                            try {
                              await removeAttachment(file.id);
                              setFileRefresh((value) => value + 1);
                              notify("Unreferenced PDF removed.", "info");
                            } catch (error) {
                              notify(errorMessage(error), "error");
                            }
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {attachments.find(
                  (file) => file.id === field(selected, "primaryAttachmentId"),
                ) &&
                  attachmentUrls[field(selected, "primaryAttachmentId")] && (
                    <iframe
                      title={`PDF preview of ${selected.title}`}
                      className="asset-pdf-preview"
                      src={
                        attachmentUrls[field(selected, "primaryAttachmentId")]
                      }
                    />
                  )}
                {!attachmentLoading && !attachments.length && (
                  <p className="muted">
                    No PDF uploaded yet. Your structured or Markdown version is
                    saved above.
                  </p>
                )}
              </section>
            )}
            <h3>Related evidence & applications</h3>
            <div className="linked-record-list">
              {relatedRecords(selected, records).map((record) => (
                <a key={record.id} href={recordUrl(record)}>
                  <Badge tone="muted">{record.kind}</Badge>
                  {record.title} ↗
                </a>
              ))}
            </div>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await remove(selected.id);
                  setParams({});
                  notify(
                    "Asset moved to trash. Captured application versions are retained.",
                    "info",
                  );
                } catch (error) {
                  notify(errorMessage(error), "error");
                }
              }}
            >
              Move to trash
            </Button>
          </Card>
        )}
      </div>
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? "Edit career asset" : "Create a career asset"}
        size="wide"
      >
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Asset title">
              <Input
                autoFocus
                required
                maxLength={180}
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder="Backend résumé — December"
              />
            </Field>
            <Field label="Type">
              <Select
                value={form.type}
                onChange={(event) =>
                  setForm({
                    ...form,
                    type: event.target.value,
                    checklist:
                      event.target.value === "profile" && !form.checklist.length
                        ? defaultProfileTasks()
                        : form.checklist,
                  })
                }
              >
                {TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Version label">
              <Input
                value={form.versionLabel}
                onChange={(event) =>
                  setForm({ ...form, versionLabel: event.target.value })
                }
                placeholder="December 2026 — backend variant"
              />
            </Field>
            <Field label="Target roles / companies">
              <Input
                value={form.targetRoles}
                onChange={(event) =>
                  setForm({ ...form, targetRoles: event.target.value })
                }
              />
            </Field>
          </div>
          {form.type === "resume" && (
            <>
              <Field
                label="Overleaf source link"
                hint="Continue compiling LaTeX in Overleaf, then upload the exported PDF."
              >
                <Input
                  type="url"
                  value={form.overleaf}
                  onChange={(event) =>
                    setForm({ ...form, overleaf: event.target.value })
                  }
                  placeholder="https://www.overleaf.com/project/…"
                />
              </Field>
              <Field label="Editing format">
                <Select
                  value={form.documentMode}
                  onChange={(event) =>
                    setForm({ ...form, documentMode: event.target.value })
                  }
                >
                  <option value="structured">Structured résumé</option>
                  <option value="markdown">
                    Markdown / existing résumé notes
                  </option>
                </Select>
              </Field>
            </>
          )}
          {form.type === "resume" && form.documentMode === "structured" ? (
            <div className="resume-editor stack">
              <h3>Your résumé content</h3>
              <div className="form-grid">
                {(
                  [
                    "name",
                    "headline",
                    "email",
                    "phone",
                    "location",
                    "website",
                  ] as const
                ).map((key) => (
                  <Field
                    key={key}
                    label={key.charAt(0).toUpperCase() + key.slice(1)}
                  >
                    <Input
                      type={
                        key === "email"
                          ? "email"
                          : key === "website"
                            ? "url"
                            : "text"
                      }
                      value={form.resume[key]}
                      onChange={(event) => editResume(key, event.target.value)}
                    />
                  </Field>
                ))}
              </div>
              <Field label="Summary (optional)">
                <Textarea
                  rows={3}
                  value={form.resume.summary}
                  onChange={(event) =>
                    editResume("summary", event.target.value)
                  }
                />
              </Field>
              {(["experience", "education", "projects"] as const).map(
                (section) => (
                  <section className="stack" key={section}>
                    <div className="section-heading">
                      <h3>
                        {section.charAt(0).toUpperCase() + section.slice(1)}
                      </h3>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          setForm({
                            ...form,
                            resume: {
                              ...form.resume,
                              [section]: [
                                ...form.resume[section],
                                emptyEntry(),
                              ],
                            },
                          })
                        }
                      >
                        + Add{" "}
                        {section === "experience"
                          ? "role"
                          : section === "education"
                            ? "education"
                            : "project"}
                      </Button>
                    </div>
                    {form.resume[section].map((entry, index) => (
                      <Card className="resume-entry" key={entry.id}>
                        <div className="section-heading">
                          <strong>Entry {index + 1}</strong>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              setForm({
                                ...form,
                                resume: {
                                  ...form.resume,
                                  [section]: form.resume[section].filter(
                                    (item) => item.id !== entry.id,
                                  ),
                                },
                              })
                            }
                          >
                            Remove entry
                          </Button>
                        </div>
                        <div className="form-grid">
                          <Field
                            label={
                              section === "experience"
                                ? "Role title"
                                : section === "education"
                                  ? "Degree / qualification"
                                  : "Project name"
                            }
                          >
                            <Input
                              value={entry.title}
                              onChange={(event) =>
                                editEntry(section, entry.id, {
                                  title: event.target.value,
                                })
                              }
                            />
                          </Field>
                          <Field
                            label={
                              section === "education"
                                ? "Institution"
                                : "Organisation / context"
                            }
                          >
                            <Input
                              value={entry.organisation}
                              onChange={(event) =>
                                editEntry(section, entry.id, {
                                  organisation: event.target.value,
                                })
                              }
                            />
                          </Field>
                        </div>
                        <Field label="Dates">
                          <Input
                            value={entry.dates}
                            onChange={(event) =>
                              editEntry(section, entry.id, {
                                dates: event.target.value,
                              })
                            }
                            placeholder="February 2026 — present"
                          />
                        </Field>
                        <Field
                          label="Bullets"
                          hint="One bullet per line. Use your actual contribution and verified outcomes."
                        >
                          <Textarea
                            rows={4}
                            value={entry.bullets.join("\n")}
                            onChange={(event) =>
                              editEntry(section, entry.id, {
                                bullets: event.target.value.split("\n"),
                              })
                            }
                          />
                        </Field>
                      </Card>
                    ))}
                  </section>
                ),
              )}
              <Field label="Skills">
                <Textarea
                  rows={2}
                  value={form.resume.skills}
                  onChange={(event) => editResume("skills", event.target.value)}
                />
              </Field>
              {bullets.length > 0 && (
                <details className="asset-bullet-picker">
                  <summary>Reuse a bullet from your evidence bank</summary>
                  <div className="stack">
                    {bullets.map((bullet) => (
                      <div key={bullet.id} className="asset-bullet-item">
                        <p>{bullet.body}</p>
                        <Badge tone={bullet.data.verified ? "lime" : "muted"}>
                          {bullet.data.verified
                            ? "Evidence checked"
                            : "Draft claim"}
                        </Badge>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => addBullet(bullet)}
                        >
                          Add to résumé
                        </Button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <details>
                <summary>Preview portable content</summary>
                <Markdown content={resumeMarkdown(form.resume)} />
              </details>
            </div>
          ) : (
            form.type !== "profile" && (
              <>
                <div className="inline-actions">
                  {form.type === "cover-letter" && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setForm({
                          ...form,
                          body: "Dear [hiring team],\n\n[Why this role and team, using specific company research.]\n\n[Your relevant engineering experience. Support each claim with real evidence.]\n\n[What you would bring to the role and why the next step fits.]\n\nThank you,\n[Your name]",
                        })
                      }
                    >
                      Start a letter template
                    </Button>
                  )}
                  {form.type === "answer" && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setForm({
                          ...form,
                          body: "## Direct answer\n[Answer the actual question.]\n\n## Supporting example\n[Context, your contribution, result, and what you learned.]\n\n## Relevance to this role\n[Connect the example to the job requirements.]",
                        })
                      }
                    >
                      Start an answer template
                    </Button>
                  )}
                </div>
                {form.type === "answer" && (
                  <Field label="Application question / prompt">
                    <Input
                      value={form.prompt}
                      onChange={(event) =>
                        setForm({ ...form, prompt: event.target.value })
                      }
                    />
                  </Field>
                )}
                <Field
                  label={
                    form.type === "bullet"
                      ? "Draft achievement bullet"
                      : "Content"
                  }
                  hint="Markdown supported. Templates contain placeholders, not career claims."
                >
                  <Textarea
                    rows={10}
                    value={form.body}
                    onChange={(event) =>
                      setForm({ ...form, body: event.target.value })
                    }
                  />
                </Field>
              </>
            )
          )}
          {form.type === "bullet" && (
            <>
              <Field label="Start from actual work evidence">
                <Select
                  value=""
                  onChange={(event) => importEvidence(event.target.value)}
                >
                  <option value="">Choose an achievement to reuse…</option>
                  {evidence.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="form-grid">
                <Field label="Impact / measurement and evidence">
                  <Input
                    value={form.impact}
                    onChange={(event) =>
                      setForm({ ...form, impact: event.target.value })
                    }
                  />
                </Field>
                <Field label="Scope / your contribution">
                  <Input
                    value={form.scope}
                    onChange={(event) =>
                      setForm({ ...form, scope: event.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Technologies">
                <Input
                  value={form.technologies}
                  onChange={(event) =>
                    setForm({ ...form, technologies: event.target.value })
                  }
                />
              </Field>
              <label className="checklist-row">
                <input
                  type="checkbox"
                  checked={form.verified}
                  onChange={(event) =>
                    setForm({ ...form, verified: event.target.checked })
                  }
                />
                <span>
                  I have checked these claims against actual evidence.
                </span>
              </label>
            </>
          )}
          {form.type === "profile" && (
            <div className="stack">
              <div className="section-heading">
                <h3>Concrete profile edits</h3>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setForm({
                      ...form,
                      checklist: [
                        ...form.checklist,
                        {
                          id: crypto.randomUUID(),
                          text: "",
                          done: false,
                          nextAction: "",
                          url: "",
                        },
                      ],
                    })
                  }
                >
                  + Add an edit
                </Button>
              </div>
              {form.checklist.map((task) => (
                <Card key={task.id} className="stack">
                  <Field label="Checklist item">
                    <Input
                      value={task.text}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          checklist: form.checklist.map((item) =>
                            item.id === task.id
                              ? { ...item, text: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label="The actual edit to make">
                    <Input
                      value={task.nextAction}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          checklist: form.checklist.map((item) =>
                            item.id === task.id
                              ? { ...item, nextAction: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label="Destination">
                    <Input
                      type="url"
                      value={task.url}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          checklist: form.checklist.map((item) =>
                            item.id === task.id
                              ? { ...item, url: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setForm({
                        ...form,
                        checklist: form.checklist.filter(
                          (item) => item.id !== task.id,
                        ),
                      })
                    }
                  >
                    Remove edit
                  </Button>
                </Card>
              ))}
            </div>
          )}
          <Field label="Tags">
            <Input
              value={form.tags}
              onChange={(event) =>
                setForm({ ...form, tags: event.target.value })
              }
              placeholder="Comma separated"
            />
          </Field>
          <RecordLinks
            value={form.links}
            onChange={(links) => setForm({ ...form, links })}
            excludeId={editing?.id}
          />
          <div className="inline-actions">
            <Button type="submit" disabled={pending || !form.title.trim()}>
              Save career asset
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={revisionOpen}
        onClose={() => setRevisionOpen(false)}
        title="Asset revision history"
        size="wide"
      >
        <div className="stack">
          <Field label="Saved revision">
            <Select
              value={revisionId}
              onChange={(event) => setRevisionId(event.target.value)}
            >
              <option value="">Choose a revision</option>
              {revisions.map((revision) => (
                <option key={revision.id} value={revision.id}>
                  v{revision.version} · {niceDate(revision.createdAt)} ·{" "}
                  {revision.title}
                </option>
              ))}
            </Select>
          </Field>
          {chosenRevision && (
            <>
              <Markdown content={chosenRevision.body} />
              <Button
                disabled={pending}
                onClick={async () => {
                  if (!selected) return;
                  try {
                    await update(selected.id, {
                      title: chosenRevision.title,
                      body: chosenRevision.body,
                      tags: chosenRevision.tags,
                      links: chosenRevision.links,
                      data: chosenRevision.data,
                    });
                    setRevisionOpen(false);
                    notify(
                      "Revision restored as a new version. Application snapshots are retained.",
                      "success",
                    );
                  } catch (error) {
                    notify(errorMessage(error), "error");
                  }
                }}
              >
                Restore this revision
              </Button>
            </>
          )}
          {!revisions.length && (
            <p className="muted">
              Revisions appear after you edit and save this asset.
            </p>
          )}
        </div>
      </Modal>
      {printRecord && (
        <article className="asset-print-root">
          <Markdown content={printRecord.body} />
        </article>
      )}
    </div>
  );
}
