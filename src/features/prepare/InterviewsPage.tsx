import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Download,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  arrayField,
  boolField,
  field,
  localDate,
  niceDate,
  numberField,
  recordUrl,
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
import { downloadFile } from "../../lib/api";
import { useWorkspace } from "../../lib/workspace";
import { MOCK_RUBRICS, STORY_PROMPTS } from "../../content/templates";
import {
  calendarFile,
  isoToZonedInput,
  splitTags,
  zonedDateTimeToISO,
} from "./helpers";
import "./prepare.css";

const PREP_CHECKS = [
  "Read the role description",
  "Review company research",
  "Choose relevant stories",
  "Explain one project",
  "Practise the weakest area",
  "Prepare questions to ask",
  "Check time, timezone and meeting details",
];

export function InterviewsPage() {
  const { records, preferences } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState("events");
  const [editor, setEditor] = useState<{
    kind: "event" | "story" | "mock";
    record?: WorkRecord;
    links?: string[];
  } | null>(null);
  const [search, setSearch] = useState("");
  const openedApplication = useRef("");
  const applicationId = params.get("application");
  useEffect(() => {
    if (
      !applicationId ||
      openedApplication.current === applicationId ||
      !records.some(
        (record) =>
          record.kind === "application" && record.id === applicationId,
      )
    )
      return;
    openedApplication.current = applicationId;
    setTab("events");
    setEditor({ kind: "event", links: [applicationId] });
  }, [applicationId, records]);
  const events = records.filter(
    (record) => record.kind === "interview" && !boolField(record, "isMock"),
  );
  const mocks = records.filter(
    (record) => record.kind === "interview" && boolField(record, "isMock"),
  );
  const stories = records.filter((record) => record.kind === "story");
  const selected = records.find(
    (record) =>
      record.id === params.get("record") &&
      ["interview", "story"].includes(record.kind),
  );
  useEffect(() => {
    if (selected)
      setTab(
        selected.kind === "story"
          ? "stories"
          : boolField(selected, "isMock")
            ? "mocks"
            : "events",
      );
  }, [selected?.id]);
  const source =
    tab === "events" ? events : tab === "stories" ? stories : mocks;
  const visible = source
    .filter((record) =>
      [record.title, record.body, ...record.tags]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      tab === "events"
        ? field(a, "startsAt").localeCompare(field(b, "startsAt"))
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  const next = [...events]
    .filter(
      (record) =>
        field(record, "startsAt") > new Date().toISOString() &&
        field(record, "status", "Scheduled") === "Scheduled",
    )
    .sort((a, b) =>
      field(a, "startsAt").localeCompare(field(b, "startsAt")),
    )[0];
  const kind =
    tab === "events" ? "event" : tab === "stories" ? "story" : "mock";
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="PREPARE / INTERVIEWS"
        title="Walk in ready"
        description="Your research, stories and practice. Together when you need them."
        action={
          <Button onClick={() => setEditor({ kind })}>
            <Plus size={18} />{" "}
            {tab === "events"
              ? "Schedule interview"
              : tab === "stories"
                ? "Add a story"
                : "Log a mock"}
          </Button>
        }
      />
      {next && (
        <div className="next-interview">
          <CalendarDays size={28} />
          <div>
            <span className="eyebrow">COMING UP</span>
            <h2>{next.title}</h2>
            <p>{displayInterviewTime(next, preferences.timezone)}</p>
          </div>
          <Button onClick={() => setParams({ record: next.id })}>
            Open preparation <ArrowRight size={17} />
          </Button>
        </div>
      )}
      <div className="tab-list" role="tablist" aria-label="Interview area">
        {[
          ["events", `Interviews (${events.length})`],
          ["stories", `Story bank (${stories.length})`],
          ["mocks", `Mocks & feedback (${mocks.length})`],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setParams({});
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <Input
        aria-label="Search interviews and stories"
        placeholder={
          tab === "stories"
            ? "Search stories, competency tags and evidence…"
            : "Search interviews…"
        }
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="interview-layout">
        <div className="stack">
          {visible.length ? (
            visible.map((record) => (
              <button
                className={`interview-row ${selected?.id === record.id ? "selected" : ""}`}
                key={record.id}
                onClick={() => setParams({ record: record.id })}
              >
                <span>
                  {tab === "stories" ? (
                    <MessageSquare size={21} />
                  ) : (
                    <CalendarDays size={21} />
                  )}
                </span>
                <div>
                  <strong>{record.title}</strong>
                  <small>
                    {record.kind === "story"
                      ? record.tags.join(" · ") || "Add competency tags"
                      : boolField(record, "isMock")
                        ? `${field(record, "type")} · ${niceDate(record.createdAt)}`
                        : displayInterviewTime(record, preferences.timezone)}
                  </small>
                  <p>
                    {record.kind === "story"
                      ? field(record, "result").slice(0, 110)
                      : field(record, "status", "Scheduled")}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <Card>
              <EmptyState
                title={
                  tab === "stories"
                    ? "Your experience is the material"
                    : tab === "mocks"
                      ? "Practise with a purpose"
                      : "Give your next interview a home"
                }
                description={
                  tab === "stories"
                    ? "Capture a concrete story, your contribution and what you learned."
                    : tab === "mocks"
                      ? "Record observations and turn feedback into a small next action."
                      : "Connect the role, company research, stories and questions."
                }
                action={
                  <Button onClick={() => setEditor({ kind })}>
                    Create your first {kind}
                  </Button>
                }
              />
            </Card>
          )}
        </div>
        {selected ? (
          selected.kind === "story" ? (
            <StoryDetail
              record={selected}
              onEdit={() => setEditor({ kind: "story", record: selected })}
            />
          ) : (
            <InterviewDetail
              key={`${selected.id}:${selected.version}`}
              record={selected}
              onEdit={() =>
                setEditor({
                  kind: boolField(selected, "isMock") ? "mock" : "event",
                  record: selected,
                })
              }
              onRemoved={() => setParams({})}
            />
          )
        ) : (
          <Card className="interview-welcome">
            <MessageSquare size={48} />
            <h2>
              {tab === "stories"
                ? "Make your contribution clear."
                : tab === "mocks"
                  ? "Observation → next action."
                  : "A calm place to prepare."}
            </h2>
            <p>
              {tab === "stories"
                ? "Situation, task, action, result and reflection. Keep the evidence close."
                : tab === "mocks"
                  ? "Score concrete behaviours. Write what happened and choose what to practise next."
                  : "Choose an interview to see the role, research, stories and preparation checklist."}
            </p>
            {tab === "stories" && (
              <div className="chips">
                {STORY_PROMPTS.map((prompt) => (
                  <Badge key={prompt} tone="muted">
                    {prompt}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
      {editor &&
        (editor.kind === "story" ? (
          <StoryEditor
            key={editor.record?.id ?? "new-story"}
            record={editor.record}
            onClose={() => setEditor(null)}
            onSaved={(id) => {
              setEditor(null);
              setParams({ record: id });
            }}
          />
        ) : editor.kind === "mock" ? (
          <MockEditor
            key={editor.record?.id ?? "new-mock"}
            record={editor.record}
            onClose={() => setEditor(null)}
            onSaved={(id) => {
              setEditor(null);
              setParams({ record: id });
            }}
          />
        ) : (
          <EventEditor
            key={editor.record?.id ?? "new-event"}
            record={editor.record}
            defaultLinks={editor.links}
            onClose={() => setEditor(null)}
            onSaved={(id) => {
              setEditor(null);
              setParams({ record: id });
            }}
          />
        ))}
    </div>
  );
}

function displayInterviewTime(record: WorkRecord, timezone: string): string {
  const value = field(record, "startsAt");
  if (!value || Number.isNaN(new Date(value).getTime())) return "Time not set";
  return `${new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value))} · ${timezone}`;
}

function InterviewDetail({
  record,
  onEdit,
  onRemoved,
}: {
  record: WorkRecord;
  onEdit: () => void;
  onRemoved: () => void;
}) {
  const { records, update, create, remove, notify, preferences } =
    useWorkspace();
  const isMock = boolField(record, "isMock");
  const [checks, setChecks] = useState(arrayField(record, "checklist"));
  const [questions, setQuestions] = useState(field(record, "questions"));
  const [reflection, setReflection] = useState(field(record, "reflection"));
  const [feedback, setFeedback] = useState(field(record, "feedback"));
  const [action, setAction] = useState("");
  const [due, setDue] = useState(localDate(new Date(), preferences.timezone));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const linked = records.filter((item) => record.links.includes(item.id));
  const relatedIds = new Set([
    ...record.links,
    ...linked.flatMap((item) => item.links),
  ]);
  const related = records.filter(
    (item) => item.id !== record.id && relatedIds.has(item.id),
  );
  const rubric =
    MOCK_RUBRICS[field(record, "type", "Coding")] ?? MOCK_RUBRICS.Coding;
  async function save() {
    setSaving(true);
    try {
      await update(record.id, {
        data: {
          ...record.data,
          checklist: checks,
          questions,
          reflection,
          feedback,
        },
      });
      notify("Preparation and reflection saved.", "success");
    } catch (error) {
      notify(String(error), "error");
    } finally {
      setSaving(false);
    }
  }
  async function feedbackAction() {
    if (!action.trim()) return;
    setSaving(true);
    try {
      await create({
        kind: "action",
        title: action.trim(),
        body: feedback || reflection,
        links: [record.id],
        data: {
          status: "todo",
          firstStep: action.trim(),
          estimatedMinutes: 15,
          dueDate: due,
          priority: "high",
          category: "interview",
        },
      });
      setAction("");
      notify("Feedback turned into an action on Today.", "success");
    } catch (error) {
      notify(String(error), "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card className="interview-detail">
      <div className="section-heading">
        <Badge tone={isMock ? "pink" : "blue"}>
          {isMock ? "MOCK SESSION" : field(record, "type", "Interview")}
        </Badge>
        <div className="inline-actions">
          <Button variant="ghost" onClick={onEdit}>
            <Pencil size={16} /> Edit
          </Button>
          <Button
            variant="ghost"
            aria-label="Move interview to Trash"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </div>
      <h2>{record.title}</h2>
      <p>{displayInterviewTime(record, preferences.timezone)}</p>
      {field(record, "timezone") &&
        field(record, "timezone") !== preferences.timezone && (
          <p className="muted">
            Interviewer timezone:{" "}
            {displayInterviewTime(record, field(record, "timezone"))}
          </p>
        )}
      <div className="chips">
        <Badge tone="muted">{field(record, "status", "Scheduled")}</Badge>
        <Badge tone="muted">
          {numberField(record, "durationMinutes", 45)} min
        </Badge>
      </div>
      {field(record, "participants") && (
        <p>
          <strong>With:</strong> {field(record, "participants")}
        </p>
      )}
      {record.body && <Markdown content={record.body} />}
      {!isMock && field(record, "startsAt") && (
        <Button
          variant="secondary"
          onClick={() => {
            try {
              downloadFile(
                calendarFile(
                  record.title,
                  field(record, "startsAt"),
                  numberField(record, "durationMinutes", 45),
                  record.body,
                ),
                "interview.ics",
                "text/calendar",
              );
            } catch (error) {
              notify(String(error), "error");
            }
          }}
        >
          <Download size={16} /> Add to calendar
        </Button>
      )}
      {related.length > 0 && (
        <div className="prep-context">
          <h3>Your preparation view</h3>
          {related.map((item) => (
            <details key={item.id} open={item.kind === "application"}>
              <summary>
                {item.title} <span className="muted">· {item.kind}</span>
              </summary>
              {item.kind === "story" ? (
                <>
                  <p>
                    <strong>Action:</strong> {field(item, "action")}
                  </p>
                  <p>
                    <strong>Result:</strong> {field(item, "result")}
                  </p>
                </>
              ) : (
                <Markdown
                  content={
                    item.body ||
                    field(item, "jobDescription") ||
                    "Add context to this record."
                  }
                />
              )}
              <Link className="text-link" to={recordUrl(item)}>
                Open {item.kind} <ArrowRight size={14} />
              </Link>
            </details>
          ))}
        </div>
      )}
      {!isMock ? (
        <>
          <h3>Preparation checklist</h3>
          <div className="checklist">
            {PREP_CHECKS.map((check) => (
              <label key={check}>
                <input
                  type="checkbox"
                  checked={checks.includes(check)}
                  onChange={(event) =>
                    setChecks((items) =>
                      event.target.checked
                        ? [...items, check]
                        : items.filter((item) => item !== check),
                    )
                  }
                />
                {check}
              </label>
            ))}
          </div>
          <Field label="Questions to ask">
            <Textarea
              value={questions}
              onChange={(event) => setQuestions(event.target.value)}
              rows={3}
              placeholder="How does this team measure impact? What would the first six months involve?"
            />
          </Field>
        </>
      ) : (
        <div className="mock-rubric">
          <h3>Observed behaviours</h3>
          {rubric.map((criterion, index) => (
            <div key={criterion}>
              <span>{criterion}</span>
              <Badge tone="muted">
                {String(
                  (record.data.scores as Record<string, unknown> | undefined)?.[
                    String(index)
                  ] ?? "—",
                )}{" "}
                / 5
              </Badge>
            </div>
          ))}
        </div>
      )}
      <Field
        label={
          isMock ? "Concrete feedback" : "Interview observations / feedback"
        }
      >
        <Textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          rows={3}
          placeholder="What happened? Record specific behaviour and examples."
        />
      </Field>
      <Field label="Reflection">
        <Textarea
          value={reflection}
          onChange={(event) => setReflection(event.target.value)}
          rows={3}
          placeholder="What went well? What would you change? What did you learn about the role?"
        />
      </Field>
      <Button onClick={save} disabled={saving}>
        <Check size={16} /> Save preparation / reflection
      </Button>
      <div className="feedback-action">
        <h3>Make the next step small.</h3>
        <Field label="Action from feedback">
          <Input
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="Explain a sliding-window invariant in 15 minutes"
          />
        </Field>
        <div className="inline-actions">
          <Input
            aria-label="Feedback action due date"
            type="date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
          <Button onClick={feedbackAction} disabled={!action.trim() || saving}>
            Add to Today <ArrowRight size={16} />
          </Button>
        </div>
      </div>
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Move this interview to Trash?"
      >
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await remove(record.id);
              setDeleting(false);
              onRemoved();
            } catch (error) {
              notify(String(error), "error");
            }
          }}
        >
          Move to Trash
        </Button>
      </Modal>
    </Card>
  );
}

function StoryDetail({
  record,
  onEdit,
}: {
  record: WorkRecord;
  onEdit: () => void;
}) {
  const { records } = useWorkspace();
  return (
    <Card className="story-detail">
      <div className="section-heading">
        <Badge tone="pink">YOUR STORY</Badge>
        <Button variant="ghost" onClick={onEdit}>
          <Pencil size={16} /> Edit story
        </Button>
      </div>
      <h2>{record.title}</h2>
      <div className="chips">
        {record.tags.map((tag) => (
          <Badge key={tag} tone="muted">
            {tag}
          </Badge>
        ))}
      </div>
      {[
        ["situation", "S", "Situation"],
        ["task", "T", "Task"],
        ["action", "A", "Action"],
        ["result", "R", "Result"],
        ["reflection", "↗", "Reflection"],
      ].map(([key, letter, label]) => (
        <div key={key} className="star-section">
          <span>{letter}</span>
          <div>
            <h3>{label}</h3>
            <p>{field(record, key) || "Add a concrete detail here."}</p>
          </div>
        </div>
      ))}
      {record.body && <Markdown content={record.body} />}
      <h3>Supporting evidence</h3>
      {record.links.length ? (
        <div className="stack">
          {records
            .filter((item) => record.links.includes(item.id))
            .map((item) => (
              <Link key={item.id} className="text-link" to={recordUrl(item)}>
                {item.title} <ArrowRight size={14} />
              </Link>
            ))}
        </div>
      ) : (
        <p className="muted">
          Connect a work achievement, project or note when you edit this story.
        </p>
      )}
    </Card>
  );
}

function StoryEditor({
  record,
  onClose,
  onSaved,
}: {
  record?: WorkRecord;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { create, update, notify } = useWorkspace();
  const [title, setTitle] = useState(record?.title ?? "");
  const [tags, setTags] = useState(record?.tags.join(", ") ?? "");
  const [body, setBody] = useState(record?.body ?? "");
  const [links, setLinks] = useState(record?.links ?? []);
  const [values, setValues] = useState(
    Object.fromEntries(
      ["situation", "task", "action", "result", "reflection"].map((key) => [
        key,
        field(record, key),
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!title.trim()) {
      notify("Give your story a title.", "error");
      return;
    }
    setSaving(true);
    try {
      const input = {
        title: title.trim(),
        body,
        tags: splitTags(tags),
        links,
        data: { ...record?.data, ...values },
      };
      const result = record
        ? await update(record.id, input)
        : await create({ kind: "story", ...input });
      onSaved(result.id);
    } catch (error) {
      notify(String(error), "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={record ? "Edit behavioural story" : "Add a behavioural story"}
      description="Use a real example. Make your personal contribution and supported outcome clear."
      size="wide"
    >
      <div className="stack">
        <Field label="Story title">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Resolving a production issue across two teams"
          />
        </Field>
        <Field label="Competency tags">
          <Input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="ownership, collaboration, learning"
          />
        </Field>
        {[
          ["situation", "Situation — concise context"],
          ["task", "Task — your responsibility"],
          ["action", "Action — what you personally did and why"],
          ["result", "Result — outcome and supporting evidence"],
          ["reflection", "Reflection — what you learned or would change"],
        ].map(([key, label]) => (
          <Field key={key} label={label}>
            <Textarea
              value={values[key]}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
              rows={key === "action" ? 4 : 2}
            />
          </Field>
        ))}
        <Field label="Extra notes / variations">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
          />
        </Field>
        <Field label="Supporting work evidence, projects and notes">
          <RecordLinks
            value={links}
            onChange={setLinks}
            excludeId={record?.id}
          />
        </Field>
        <Button onClick={save} disabled={saving}>
          Save story
        </Button>
      </div>
    </Modal>
  );
}

function EventEditor({
  record,
  defaultLinks = [],
  onClose,
  onSaved,
}: {
  record?: WorkRecord;
  defaultLinks?: string[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { create, update, notify, preferences, records } = useWorkspace();
  const application = records.find(
    (item) => defaultLinks.includes(item.id) && item.kind === "application",
  );
  const [title, setTitle] = useState(
    record?.title ?? (application ? `${application.title} — interview` : ""),
  );
  const [timezone, setTimezone] = useState(
    field(record, "timezone", preferences.timezone),
  );
  const [time, setTime] = useState(
    isoToZonedInput(field(record, "startsAt"), timezone),
  );
  const [type, setType] = useState(field(record, "type", "Coding"));
  const [duration, setDuration] = useState(
    numberField(record, "durationMinutes", 45),
  );
  const [participants, setParticipants] = useState(
    field(record, "participants"),
  );
  const [status, setStatus] = useState(field(record, "status", "Scheduled"));
  const [body, setBody] = useState(record?.body ?? "");
  const [links, setLinks] = useState(record?.links ?? defaultLinks);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (!title.trim() || !time || duration <= 0) {
      setError("Add a title, local date/time and positive duration.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const startsAt = zonedDateTimeToISO(time, timezone);
      const input = {
        title: title.trim(),
        body,
        links,
        data: {
          ...record?.data,
          startsAt,
          timezone,
          type,
          durationMinutes: duration,
          participants,
          status,
          isMock: false,
        },
      };
      const result = record
        ? await update(record.id, input)
        : await create({ kind: "interview", ...input });
      onSaved(result.id);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save interview.",
      );
      notify("Interview was not saved. Check the form.", "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={record ? "Edit interview" : "Schedule interview"}
      size="wide"
    >
      <div className="stack">
        <Field label="Interview title">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Google — first technical interview"
          />
        </Field>
        <div className="form-grid">
          <Field label="Date and local time">
            <Input
              type="datetime-local"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
          <Field label="Timezone" hint="IANA name, e.g. Australia/Melbourne">
            <Input
              aria-label="Timezone"
              list="interview-timezones"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
            <datalist id="interview-timezones">
              {[
                "Australia/Melbourne",
                "Australia/Sydney",
                "America/Los_Angeles",
                "America/New_York",
                "Europe/London",
                "UTC",
              ].map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </datalist>
          </Field>
          <Field label="Type">
            <Select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {[
                "Recruiter",
                "Coding",
                "Behavioural",
                "System design",
                "Debugging",
                "Fundamentals",
                "Hiring manager",
                "Other",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </Field>
          <Field label="Duration (minutes)">
            <Input
              type="number"
              min="1"
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </Field>
        </div>
        <Field label="Participants / interviewer">
          <Input
            value={participants}
            onChange={(event) => setParticipants(event.target.value)}
          />
        </Field>
        <Field label="Status">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {["Scheduled", "Completed", "Cancelled", "Rescheduling"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </Select>
        </Field>
        <Field label="Meeting details / notes">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
          />
        </Field>
        <Field label="Related application, company, stories and projects">
          <RecordLinks
            value={links}
            onChange={setLinks}
            excludeId={record?.id}
          />
        </Field>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <Button onClick={save} disabled={saving}>
          Save interview
        </Button>
      </div>
    </Modal>
  );
}

function MockEditor({
  record,
  onClose,
  onSaved,
}: {
  record?: WorkRecord;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { create, update, notify, preferences } = useWorkspace();
  const [title, setTitle] = useState(record?.title ?? "");
  const [type, setType] = useState(field(record, "type", "Coding"));
  const [duration, setDuration] = useState(
    numberField(record, "durationMinutes", 45),
  );
  const [partner, setPartner] = useState(field(record, "participants"));
  const [feedback, setFeedback] = useState(field(record, "feedback"));
  const [reflection, setReflection] = useState(field(record, "reflection"));
  const [body, setBody] = useState(record?.body ?? "");
  const [links, setLinks] = useState(record?.links ?? []);
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries((record?.data.scores as object) ?? {}).map(
        ([key, value]) => [key, String(value)],
      ),
    ),
  );
  const [date, setDate] = useState(
    field(
      record,
      "startsAt",
      localDate(new Date(), preferences.timezone),
    ).slice(0, 10),
  );
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!title.trim() || !date || !Number.isFinite(duration) || duration <= 0) {
      notify(
        "Add a title, valid date and positive duration for your mock session.",
        "error",
      );
      return;
    }
    setSaving(true);
    try {
      const input = {
        title: title.trim(),
        body,
        links,
        tags: [type],
        data: {
          ...record?.data,
          isMock: true,
          type,
          durationMinutes: duration,
          participants: partner,
          status: "Completed",
          startsAt: zonedDateTimeToISO(`${date}T12:00`, preferences.timezone),
          timezone: preferences.timezone,
          feedback,
          reflection,
          scores,
        },
      };
      const result = record
        ? await update(record.id, input)
        : await create({ kind: "interview", ...input });
      onSaved(result.id);
    } catch (error) {
      notify(String(error), "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={record ? "Edit mock feedback" : "Log a mock session"}
      description="Score only what you observed. Leave untested behaviours blank."
      size="wide"
    >
      <div className="stack">
        <Field label="Session title">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="45-minute coding mock — sliding window"
          />
        </Field>
        <div className="form-grid">
          <Field label="Type">
            <Select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setScores({});
              }}
            >
              {Object.keys(MOCK_RUBRICS).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field label="Minutes">
            <Input
              type="number"
              min="1"
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </Field>
          <Field label="Partner / interviewer">
            <Input
              value={partner}
              onChange={(event) => setPartner(event.target.value)}
              placeholder="Self-review or partner name"
            />
          </Field>
        </div>
        <Field label="Prompt / exercise">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
          />
        </Field>
        <div className="mock-rubric">
          {(MOCK_RUBRICS[type] ?? MOCK_RUBRICS.Coding).map(
            (criterion, index) => (
              <div key={criterion}>
                <label htmlFor={`rubric-${index}`}>{criterion}</label>
                <Select
                  id={`rubric-${index}`}
                  value={scores[String(index)] ?? ""}
                  onChange={(event) =>
                    setScores((current) => ({
                      ...current,
                      [String(index)]: event.target.value,
                    }))
                  }
                >
                  <option value="">Not observed</option>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
              </div>
            ),
          )}
        </div>
        <Field label="Concrete observations / feedback">
          <Textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            rows={3}
          />
        </Field>
        <Field label="Reflection">
          <Textarea
            value={reflection}
            onChange={(event) => setReflection(event.target.value)}
            rows={3}
          />
        </Field>
        <Field label="Relevant role, problems, stories and projects">
          <RecordLinks
            value={links}
            onChange={setLinks}
            excludeId={record?.id}
          />
        </Field>
        <Button onClick={save} disabled={saving}>
          Save mock feedback
        </Button>
      </div>
    </Modal>
  );
}
