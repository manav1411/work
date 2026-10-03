import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Bookmark,
  CheckSquare,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  boolField,
  field,
  localDate,
  niceDate,
  safeUrl,
  type WorkRecord,
} from "../../../shared/model";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  RecordLinks,
  Select,
  Textarea,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { CURATED_RESOURCES } from "../../content/learning";
import "./prepare.css";

interface ResourceView {
  id: string;
  title: string;
  category: string;
  url: string;
  body: string;
  record?: WorkRecord;
}
const GUIDANCE = [
  {
    id: "target",
    title: "Choose roles deliberately",
    description: "A role shortlist with concrete reasons and gaps.",
    checks: [
      "Write the engineering work you want to do",
      "Find roles in Australia and the US",
      "Save each job description and date checked",
      "Compare required skills against your evidence",
      "Record employer-stated work-authorisation wording",
      "Choose one research question and contact",
    ],
  },
  {
    id: "apply",
    title: "Before submitting an application",
    description: "Make the relevant evidence easy to see.",
    checks: [
      "Read the requirements and deadline",
      "Select supported, role-relevant résumé bullets",
      "Check contact details and links",
      "Use a clear filename for the exact PDF",
      "Link the submitted version to the application",
      "Record submission and follow-up date",
    ],
  },
  {
    id: "interview",
    title: "Prepare for this interview",
    description: "Use the actual role and stage to focus your effort.",
    checks: [
      "Confirm type, timezone, duration and meeting details",
      "Read the job description and company notes",
      "Choose two stories with clear contribution and outcomes",
      "Prepare a project explanation and tradeoffs",
      "Practise a relevant weak area",
      "Write questions about team scope and growth",
      "Capture observations and a next action afterwards",
    ],
  },
  {
    id: "impact",
    title: "Capture work you can show",
    description: "Build evidence while the detail is still fresh.",
    checks: [
      "Describe the problem and why it mattered",
      "Separate your contribution from the team outcome",
      "Record the engineering decisions and tradeoffs",
      "Add measurements or mark unknowns honestly",
      "Link feedback, a demonstration or permitted evidence",
      "Turn the achievement into a story and résumé draft",
    ],
  },
  {
    id: "rotation",
    title: "Make the rotation conversation useful",
    description: "Compare learning depth and engineering ownership.",
    checks: [
      "List the work you want exposure to",
      "Compare backend, security and frontend options",
      "Ask about ownership, mentoring and feedback",
      "Define one demonstrable outcome for the rotation",
      "Write questions for your manager or mentor",
      "Set a review date before February 2027",
    ],
  },
  {
    id: "relocation",
    title: "Research a US path",
    description: "Replace assumptions with sourced questions.",
    checks: [
      "Describe the Australian role / direct US / internal path",
      "Save employer-stated mobility or vacancy information",
      "Record source, date, confidence and unresolved questions",
      "Record your own work-authorisation circumstances",
      "Consult current official information and qualified advice where needed",
      "Compare timing, engineering scope and personal priorities",
    ],
  },
  {
    id: "offer",
    title: "Ask useful offer questions",
    description: "Preserve unknown terms until confirmed.",
    checks: [
      "Confirm team, responsibilities and manager",
      "Ask about mentoring and the first six months",
      "Break compensation into components and currencies",
      "Confirm location, working arrangement and start date",
      "Record mobility claims with sources",
      "List non-negotiables and unresolved questions",
      "Save the decision deadline and compare roll-off options",
    ],
  },
  {
    id: "new-role",
    title: "Start the next chapter well",
    description: "Learn the system, people and expectations.",
    checks: [
      "Agree first-month expectations with your manager",
      "Map the service and development workflow",
      "Meet relevant partners and ask about failure modes",
      "Ship a small, reviewed change",
      "Create a feedback and learning routine",
      "Record useful engineering evidence without sensitive material",
    ],
  },
];

export function ResourcesPage() {
  const { records, create, update, remove, notify, preferences } =
    useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const openedRecord = useRef("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [editor, setEditor] = useState<ResourceView | "new" | null>(null);
  const [deleting, setDeleting] = useState<WorkRecord | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const saved = records.filter((record) => record.kind === "resource");
  const fromRecord = (record: WorkRecord): ResourceView => ({
    id: record.id,
    title: record.title,
    body: record.body,
    category: field(record, "category", "My resources"),
    url: field(record, "url"),
    record,
  });
  const resources: ResourceView[] = [
    ...CURATED_RESOURCES.map((item) => {
      const own = saved.find((record) => field(record, "seedId") === item.id);
      return own ? { ...fromRecord(own), id: item.id } : item;
    }),
    ...saved.filter((record) => !field(record, "seedId")).map(fromRecord),
  ];
  const requestedId = params.get("record");
  useEffect(() => {
    if (!requestedId || openedRecord.current === requestedId) return;
    const requested = resources.find(
      (item) => item.record?.id === requestedId || item.id === requestedId,
    );
    if (requested) {
      openedRecord.current = requestedId;
      setEditor(requested);
    }
  }, [requestedId, resources]);
  const categories = [
    ...new Set(resources.map((item) => item.category)),
  ].sort();
  const visible = resources.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      (!savedOnly || item.record) &&
      [item.title, item.body, item.category]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  async function bookmark(item: ResourceView) {
    setSaving(item.id);
    try {
      if (item.record)
        await update(item.record.id, {
          data: {
            ...item.record.data,
            pinned: !boolField(item.record, "pinned"),
          },
        });
      else
        await create({
          kind: "resource",
          title: item.title,
          body: item.body,
          data: {
            seedId: item.id,
            category: item.category,
            url: item.url,
            pinned: true,
            applicability: "Review for my current goals",
            nextAction: "",
            lastChecked: "",
          },
        });
      notify("Resource saved to your workspace.", "success");
    } catch (error) {
      notify(String(error), "error");
    } finally {
      setSaving(null);
    }
  }
  async function checklist(item: (typeof GUIDANCE)[number]) {
    setSaving(item.id);
    try {
      const note = await create({
        kind: "note",
        title: item.title,
        body: `${item.description}\n\n${item.checks.map((check) => `- [ ] ${check}`).join("\n")}\n\n## My context\n\n## Source / date checked\n\n## Next action\n`,
        tags: ["career-guidance"],
        data: { collection: "Career guidance", guidanceId: item.id },
      });
      navigate(`/notes?record=${note.id}`);
    } catch (error) {
      notify(String(error), "error");
    } finally {
      setSaving(null);
    }
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="LIBRARY / RESOURCES"
        title="Good links. Real action"
        description="A useful starting point, plus a library you can make your own."
        action={
          <Button onClick={() => setEditor("new")}>
            <Plus size={18} /> Add resource
          </Button>
        }
      />
      <div className="toolbar">
        <div className="search-input">
          <Search size={18} />
          <Input
            aria-label="Search resources"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a guide, reference or career checklist…"
          />
        </div>
        <Select
          aria-label="Resource category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={savedOnly}
            onChange={(event) => setSavedOnly(event.target.checked)}
          />{" "}
          My saved resources
        </label>
      </div>
      <div className="resource-grid">
        {visible.map((item) => {
          const url = safeUrl(item.url);
          return (
            <Card key={item.id} className="resource-card">
              <div className="section-heading">
                <Badge
                  tone={
                    item.category === "DSA"
                      ? "blue"
                      : item.category === "Security"
                        ? "lime"
                        : item.category === "Job search"
                          ? "orange"
                          : "pink"
                  }
                >
                  {item.category}
                </Badge>
                <div className="inline-actions">
                  <Button
                    variant="ghost"
                    aria-label={
                      item.record ? "Toggle pinned resource" : "Save resource"
                    }
                    disabled={saving === item.id}
                    onClick={() => bookmark(item)}
                  >
                    <Bookmark
                      size={17}
                      fill={
                        boolField(item.record, "pinned")
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Edit ${item.title}`}
                    onClick={() => setEditor(item)}
                  >
                    <Pencil size={16} />
                  </Button>
                  {item.record && (
                    <Button
                      variant="ghost"
                      aria-label={`Move ${item.title} to Trash`}
                      onClick={() => setDeleting(item.record!)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
              </div>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
              {field(item.record, "applicability") && (
                <small>
                  <strong>For me:</strong> {field(item.record, "applicability")}
                </small>
              )}
              {field(item.record, "nextAction") && (
                <small>
                  <strong>Next:</strong> {field(item.record, "nextAction")}
                </small>
              )}
              <div className="resource-card-footer">
                {url && (
                  <a
                    className="text-link"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open resource <ExternalLink size={15} />
                  </a>
                )}
                <small className="muted">
                  {field(item.record, "lastChecked")
                    ? `Checked ${niceDate(field(item.record, "lastChecked"))}`
                    : "Check applicability before relying on it"}
                </small>
              </div>
            </Card>
          );
        })}
      </div>
      {!visible.length && (
        <EmptyState
          title="No matching resources"
          description="Try another filter or add your own link."
          action={
            <Button onClick={() => setEditor("new")}>Add resource</Button>
          }
        />
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">CAREER GUIDANCE</span>
          <h2>A checklist with somewhere to go.</h2>
        </div>
      </div>
      <div className="guidance-grid">
        {GUIDANCE.filter((item) =>
          [item.title, item.description, ...item.checks]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
        ).map((item) => (
          <Card key={item.id} className="guidance-card">
            <CheckSquare size={26} />
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <details>
              <summary>{item.checks.length} practical steps</summary>
              <ul>
                {item.checks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            </details>
            <Button
              variant="secondary"
              onClick={() => checklist(item)}
              disabled={saving === item.id}
            >
              Use as a note
            </Button>
          </Card>
        ))}
      </div>
      <ResourceEditor
        key={editor === "new" ? "new" : (editor?.id ?? "closed")}
        value={editor}
        categories={categories}
        today={localDate(new Date(), preferences.timezone)}
        onClose={() => {
          setEditor(null);
          if (requestedId) setParams({});
        }}
      />
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Move this saved resource to Trash?"
        description="Curated reference links will remain available. Your saved notes are recoverable in Settings."
      >
        <Button
          variant="danger"
          onClick={async () => {
            if (!deleting) return;
            try {
              await remove(deleting.id);
              setDeleting(null);
            } catch (error) {
              notify(String(error), "error");
            }
          }}
        >
          Move to Trash
        </Button>
      </Modal>
    </div>
  );
}

function ResourceEditor({
  value,
  categories,
  today,
  onClose,
}: {
  value: ResourceView | "new" | null;
  categories: string[];
  today: string;
  onClose: () => void;
}) {
  const { create, update, notify } = useWorkspace();
  const resource = value && value !== "new" ? value : undefined;
  const [title, setTitle] = useState(resource?.title ?? "");
  const [url, setUrl] = useState(resource?.url ?? "");
  const [body, setBody] = useState(resource?.body ?? "");
  const [category, setCategory] = useState(
    resource?.category ?? "My resources",
  );
  const [applicability, setApplicability] = useState(
    field(resource?.record, "applicability"),
  );
  const [nextAction, setNextAction] = useState(
    field(resource?.record, "nextAction"),
  );
  const [lastChecked, setLastChecked] = useState(
    field(resource?.record, "lastChecked"),
  );
  const [links, setLinks] = useState(resource?.record?.links ?? []);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!title.trim() || !safeUrl(url)) {
      notify("Add a title and valid http(s) resource URL.", "error");
      return;
    }
    setSaving(true);
    try {
      const input = {
        title: title.trim(),
        body,
        links,
        data: {
          ...resource?.record?.data,
          category,
          url,
          applicability,
          nextAction,
          lastChecked,
          ...(!resource?.record && resource ? { seedId: resource.id } : {}),
        },
      };
      if (resource?.record) await update(resource.record.id, input);
      else await create({ kind: "resource", ...input });
      onClose();
      notify("Resource saved.", "success");
    } catch (error) {
      notify(String(error), "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={resource ? "Edit resource" : "Add a resource"}
      size="wide"
    >
      <div className="stack">
        <Field label="Title">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="URL">
          <Input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Field label="Category">
          <Input
            list="resource-categories"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
          <datalist id="resource-categories">
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </datalist>
        </Field>
        <Field label="Notes / what this helps with">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
          />
        </Field>
        <Field label="Applicability to my role and goals">
          <Input
            value={applicability}
            onChange={(event) => setApplicability(event.target.value)}
          />
        </Field>
        <Field label="Concrete next action">
          <Input
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
          />
        </Field>
        <div className="inline-actions">
          <Field label="Source last checked">
            <Input
              type="date"
              value={lastChecked}
              onChange={(event) => setLastChecked(event.target.value)}
            />
          </Field>
          <Button variant="secondary" onClick={() => setLastChecked(today)}>
            Checked today
          </Button>
        </div>
        <Field label="Connected topics, notes and goals">
          <RecordLinks
            value={links}
            onChange={setLinks}
            excludeId={resource?.record?.id}
          />
        </Field>
        <Button onClick={save} disabled={saving}>
          Save resource
        </Button>
      </div>
    </Modal>
  );
}
