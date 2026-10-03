import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  field,
  localDate,
  niceDate,
  recordUrl,
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
  Markdown,
  Modal,
  PageHeader,
  RecordLinks,
  Select,
  Textarea,
} from "../../components/ui";
import { useSavingWorkspace as useWorkspace } from "./useSaving";
import {
  CAREER_PATHS,
  errorMessage,
  pathLabel,
  relatedRecords,
} from "./domain";
import "./search.css";

interface Conversation {
  id: string;
  date: string;
  summary: string;
}
const conversations = (record: WorkRecord): Conversation[] =>
  Array.isArray(record.data.conversations)
    ? record.data.conversations.filter(
        (entry): entry is Conversation =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Conversation).summary === "string" &&
          typeof (entry as Conversation).date === "string",
      )
    : [];
const blank = {
  title: "",
  body: "",
  companyId: "",
  role: "",
  relationship: "New connection",
  met: "",
  email: "",
  url: "",
  lastContact: "",
  followUp: "",
  referralStatus: "Not requested",
  path: "australia-transfer",
  nextAction: "",
  tags: "",
  links: [] as string[],
};

export function NetworkPage() {
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
  const [query, setQuery] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [form, setForm] = useState(blank);
  const [conversationFor, setConversationFor] = useState<WorkRecord | null>(
    null,
  );
  const [conversation, setConversation] = useState({
    date: localDate(new Date(), preferences.timezone),
    summary: "",
    followUp: "",
  });
  const [draft, setDraft] = useState("");
  const [eventModal, setEventModal] = useState(false);
  const [eventForm, setEventForm] = useState({
    title: "",
    url: "",
    date: "",
    location: "",
    body: "",
  });
  const contacts = records.filter(
    (record) => record.kind === "contact" && !record.deletedAt,
  );
  const companies = records.filter(
    (record) => record.kind === "company" && !record.deletedAt,
  );
  const events = records.filter(
    (record) =>
      record.kind === "resource" &&
      record.data.category === "networking" &&
      !record.deletedAt,
  );
  const selected = contacts.find(
    (record) => record.id === params.get("record"),
  );
  const today = localDate(new Date(), preferences.timezone);
  const companyName = (record: WorkRecord) =>
    companies.find((company) => company.id === field(record, "companyId"))
      ?.title || "Company not set";
  const filtered = contacts.filter(
    (record) =>
      `${record.title} ${companyName(record)} ${field(record, "role")} ${record.body}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!dueOnly ||
        (field(record, "followUp") && field(record, "followUp") <= today)),
  );

  useEffect(() => {
    if (editing === undefined) return;
    setForm(
      editing
        ? {
            title: editing.title,
            body: editing.body,
            companyId: field(editing, "companyId"),
            role: field(editing, "role"),
            relationship: field(editing, "relationship", "New connection"),
            met: field(editing, "met"),
            email: field(editing, "email"),
            url: field(editing, "url"),
            lastContact: field(editing, "lastContact"),
            followUp: field(editing, "followUp"),
            referralStatus: field(editing, "referralStatus", "Not requested"),
            path: field(editing, "path", "australia-transfer"),
            nextAction: field(editing, "nextAction"),
            tags: editing.tags.join(", "),
            links: editing.links,
          }
        : blank,
    );
  }, [editing]);
  useEffect(() => {
    setDraft(field(selected, "outreachDraft"));
  }, [selected?.id, selected?.version]);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const { title, body, tags, links, ...data } = form;
      const input = {
        title: title.trim(),
        body,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        links: [
          ...new Set([...links, ...(data.companyId ? [data.companyId] : [])]),
        ],
        data: { ...editing?.data, ...data },
      };
      const saved = editing
        ? await update(editing.id, input)
        : await create({ kind: "contact", ...input });
      setEditing(undefined);
      setParams({ record: saved.id });
      notify("Contact saved.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function saveConversation(event: FormEvent) {
    event.preventDefault();
    if (!conversationFor) return;
    try {
      await update(conversationFor.id, {
        data: {
          ...conversationFor.data,
          lastContact: conversation.date,
          followUp: conversation.followUp || field(conversationFor, "followUp"),
          conversations: [
            ...conversations(conversationFor),
            {
              id: crypto.randomUUID(),
              date: conversation.date,
              summary: conversation.summary.trim(),
            },
          ],
        },
      });
      setConversationFor(null);
      notify(
        "Conversation captured. The follow-up is on your agenda.",
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function addAction(record: WorkRecord) {
    try {
      await create({
        kind: "action",
        title: field(record, "nextAction", `Follow up with ${record.title}`),
        links: [record.id, ...record.links],
        data: {
          status: "todo",
          estimatedMinutes: 10,
          dueDate: field(record, "followUp"),
          firstStep:
            "Open the contact, review your last conversation, and draft the message.",
          priority: "normal",
        },
      });
      notify("Follow-up added to Today.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function saveDraft() {
    if (!selected) return;
    try {
      await update(selected.id, {
        data: { ...selected.data, outreachDraft: draft },
      });
      notify(
        "Draft saved. Open the destination to send it yourself.",
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function saveEvent(event: FormEvent) {
    event.preventDefault();
    try {
      await create({
        kind: "resource",
        title: eventForm.title.trim(),
        body: eventForm.body,
        tags: ["networking"],
        data: {
          category: "networking",
          type: "event",
          url: eventForm.url,
          dueDate: eventForm.date,
          date: eventForm.date,
          location: eventForm.location,
        },
      });
      setEventModal(false);
      setEventForm({ title: "", url: "", date: "", location: "", body: "" });
      notify("Event or community saved to your resource library.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="SEARCH / NETWORK"
        title="Good people. Real conversations."
        description="Remember the context, keep your promises, and make thoughtful follow-ups easier to start."
        action={
          <Button onClick={() => setEditing(null)}>+ Add a contact</Button>
        }
      />
      <div className="toolbar">
        <Input
          aria-label="Search contacts"
          placeholder="Find a person, company, or conversation…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant={dueOnly ? "primary" : "secondary"}
          onClick={() => setDueOnly(!dueOnly)}
        >
          {dueOnly ? "Showing due follow-ups" : "Show due follow-ups"}
        </Button>
        <Badge tone="pink">
          {
            contacts.filter(
              (record) =>
                field(record, "followUp") && field(record, "followUp") <= today,
            ).length
          }{" "}
          due
        </Badge>
      </div>
      <div className={selected ? "split-layout" : "card-grid"}>
        <div className={selected ? "stack" : "card-grid search-card-grid"}>
          {filtered.map((contact) => (
            <Card
              key={contact.id}
              className={`contact-card ${selected?.id === contact.id ? "is-selected" : ""}`}
            >
              <div className="section-heading">
                <Badge tone="blue">
                  {field(contact, "relationship", "Connection")}
                </Badge>
                {field(contact, "followUp") && (
                  <Badge
                    tone={
                      field(contact, "followUp") <= today ? "pink" : "muted"
                    }
                  >
                    Follow up {niceDate(field(contact, "followUp"))}
                  </Badge>
                )}
              </div>
              <button
                className="record-title-button"
                onClick={() => setParams({ record: contact.id })}
              >
                {contact.title} ↗
              </button>
              <p>
                {field(contact, "role")}
                <span className="muted">
                  {field(contact, "role") ? " · " : ""}
                  {companyName(contact)}
                </span>
              </p>
              <p className="muted">
                {field(
                  contact,
                  "met",
                  "Add how you met and what you discussed.",
                )}
              </p>
              <p>
                {field(
                  contact,
                  "nextAction",
                  "Keep the next conversation useful.",
                )}
              </p>
              <div className="section-heading">
                <small className="muted">
                  Last contact: {niceDate(field(contact, "lastContact"))}
                </small>
                <Button variant="ghost" onClick={() => setEditing(contact)}>
                  Edit
                </Button>
              </div>
            </Card>
          ))}
          {!filtered.length && (
            <EmptyState
              title={
                contacts.length
                  ? "No matching contacts."
                  : "Start with a conversation."
              }
              description="Add a mentor, recruiter, colleague, or mock-interview partner. Record context before reaching out."
              action={
                <Button onClick={() => setEditing(null)}>
                  Add your first contact
                </Button>
              }
            />
          )}
        </div>
        {selected && (
          <Card className="detail-panel">
            <div className="section-heading">
              <Badge tone="pink">CONTACT WORKBENCH</Badge>
              <Button variant="ghost" onClick={() => setParams({})}>
                Close
              </Button>
            </div>
            <h2>{selected.title}</h2>
            <p>
              {field(selected, "role")} · {companyName(selected)}
            </p>
            <dl className="detail-facts">
              <div>
                <dt>Relationship</dt>
                <dd>{field(selected, "relationship", "New connection")}</dd>
              </div>
              <div>
                <dt>Referral</dt>
                <dd>{field(selected, "referralStatus", "Not requested")}</dd>
              </div>
              <div>
                <dt>Last contact</dt>
                <dd>{niceDate(field(selected, "lastContact"))}</dd>
              </div>
              <div>
                <dt>Follow-up</dt>
                <dd>{niceDate(field(selected, "followUp"))}</dd>
              </div>
              <div>
                <dt>Where you met</dt>
                <dd>{field(selected, "met", "Not recorded")}</dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd>{pathLabel(field(selected, "path"))}</dd>
              </div>
            </dl>
            <Markdown content={selected.body} />
            <div className="next-action-callout">
              <strong>Next action</strong>
              <p>
                {field(
                  selected,
                  "nextAction",
                  "Choose a useful follow-up in Edit contact.",
                )}
              </p>
            </div>
            <div className="inline-actions">
              <Button
                onClick={() => {
                  setConversation({
                    date: today,
                    summary: "",
                    followUp: field(selected, "followUp"),
                  });
                  setConversationFor(selected);
                }}
              >
                Log a conversation
              </Button>
              <Button variant="secondary" onClick={() => setEditing(selected)}>
                Edit contact
              </Button>
              <Button variant="ghost" onClick={() => void addAction(selected)}>
                Add follow-up to Today
              </Button>
            </div>
            <h3>Conversation history</h3>
            <div className="conversation-log">
              {conversations(selected)
                .slice()
                .reverse()
                .map((entry) => (
                  <article className="conversation-entry" key={entry.id}>
                    <Badge tone="muted">{niceDate(entry.date)}</Badge>
                    <p>{entry.summary}</p>
                  </article>
                ))}
              {!conversations(selected).length && (
                <p className="muted">
                  Log the useful details after your next conversation.
                </p>
              )}
            </div>
            <h3>Draft your follow-up</h3>
            <div className="inline-actions">
              <Button
                variant="ghost"
                onClick={() =>
                  setDraft(
                    `Hi ${selected.title.split(" ")[0]},\n\nThanks for ${field(selected, "met") ? "our conversation" : "connecting"}. [Add a specific detail you appreciated.]\n\n[One clear question or next step, with context.]\n\nThanks,\n${preferences.displayName || "Your name"}`,
                  )
                }
              >
                Thank-you template
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  setDraft(
                    `Hi ${selected.title.split(" ")[0]},\n\nI'm exploring software engineering opportunities at ${companyName(selected)}. [Explain why this team and role fit your actual experience.]\n\nWould you be comfortable sharing advice on [specific role or question]? [Include a vacancy link if asking about a referral.]\n\nThanks,\n${preferences.displayName || "Your name"}`,
                  )
                }
              >
                Advice / referral template
              </Button>
            </div>
            <Textarea
              aria-label="Outreach draft"
              className="outreach-draft"
              rows={7}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="inline-actions">
              <Button onClick={() => void saveDraft()} disabled={pending}>
                Save draft
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(draft);
                    notify("Draft copied.", "success");
                  } catch {
                    notify("Select and copy the draft manually.", "info");
                  }
                }}
              >
                Copy draft
              </Button>
              {field(selected, "email") && (
                <a
                  className="external-link"
                  href={`mailto:${encodeURIComponent(field(selected, "email"))}?body=${encodeURIComponent(draft)}`}
                >
                  Open email app ↗
                </a>
              )}
              {safeUrl(field(selected, "url")) && (
                <a
                  className="external-link"
                  href={safeUrl(field(selected, "url"))!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open profile ↗
                </a>
              )}
            </div>
            <small className="muted">
              You review and send the message in its external destination.
            </small>
            <h3>Connected opportunities & research</h3>
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
                  notify("Contact moved to trash.", "info");
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
      <div className="section-heading">
        <div>
          <h2>Events & communities</h2>
          <p className="muted">
            Meetups, mentors, communities, and mock-interview opportunities you
            choose.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEventModal(true)}>
          + Save an event / resource
        </Button>
      </div>
      <div className="card-grid">
        {events.map((event) => (
          <Card key={event.id}>
            <Badge tone="orange">
              {field(event, "date")
                ? niceDate(field(event, "date"))
                : "Community / resource"}
            </Badge>
            <h3>{event.title}</h3>
            <p className="muted">{field(event, "location")}</p>
            <Markdown content={event.body} />
            <div className="inline-actions">
              {safeUrl(field(event, "url")) && (
                <a
                  className="external-link"
                  href={safeUrl(field(event, "url"))!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open resource ↗
                </a>
              )}
              <a href={recordUrl(event)}>Edit in Resources ↗</a>
            </div>
          </Card>
        ))}
        {!events.length && (
          <p className="muted">
            Save an event or community when you find one worth your time.
          </p>
        )}
      </div>
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? "Edit contact" : "Add a contact"}
        size="wide"
      >
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Name">
              <Input
                autoFocus
                required
                maxLength={180}
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </Field>
            <Field label="Role">
              <Input
                value={form.role}
                onChange={(event) =>
                  setForm({ ...form, role: event.target.value })
                }
              />
            </Field>
            <Field label="Company">
              <Select
                value={form.companyId}
                onChange={(event) =>
                  setForm({ ...form, companyId: event.target.value })
                }
              >
                <option value="">Not linked yet</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Relationship">
              <Select
                value={form.relationship}
                onChange={(event) =>
                  setForm({ ...form, relationship: event.target.value })
                }
              >
                {[
                  "New connection",
                  "Colleague",
                  "Recruiter",
                  "Mentor",
                  "Mock-interview partner",
                  "Friend / alumni",
                  "Other",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </Field>
            <Field label="Profile / external destination">
              <Input
                type="url"
                value={form.url}
                onChange={(event) =>
                  setForm({ ...form, url: event.target.value })
                }
                placeholder="https://…"
              />
            </Field>
            <Field label="Last contacted">
              <Input
                type="date"
                value={form.lastContact}
                onChange={(event) =>
                  setForm({ ...form, lastContact: event.target.value })
                }
              />
            </Field>
            <Field label="Follow-up date">
              <Input
                type="date"
                value={form.followUp}
                onChange={(event) =>
                  setForm({ ...form, followUp: event.target.value })
                }
              />
            </Field>
            <Field label="Referral status">
              <Select
                value={form.referralStatus}
                onChange={(event) =>
                  setForm({ ...form, referralStatus: event.target.value })
                }
              >
                {[
                  "Not requested",
                  "Considering",
                  "Requested",
                  "Agreed",
                  "Submitted",
                  "Declined",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </Field>
            <Field label="Career path">
              <Select
                value={form.path}
                onChange={(event) =>
                  setForm({ ...form, path: event.target.value })
                }
              >
                {CAREER_PATHS.map((path) => (
                  <option key={path.value} value={path.value}>
                    {path.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Where you met / context">
            <Input
              value={form.met}
              onChange={(event) =>
                setForm({ ...form, met: event.target.value })
              }
            />
          </Field>
          <Field label="Private notes">
            <Textarea
              rows={5}
              value={form.body}
              onChange={(event) =>
                setForm({ ...form, body: event.target.value })
              }
            />
          </Field>
          <Field label="Next action">
            <Input
              value={form.nextAction}
              onChange={(event) =>
                setForm({ ...form, nextAction: event.target.value })
              }
            />
          </Field>
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
              Save contact
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
        open={!!conversationFor}
        onClose={() => setConversationFor(null)}
        title={`Conversation with ${conversationFor?.title || "contact"}`}
      >
        <form className="stack" onSubmit={saveConversation}>
          <Field label="Date">
            <Input
              type="date"
              required
              value={conversation.date}
              onChange={(event) =>
                setConversation({ ...conversation, date: event.target.value })
              }
            />
          </Field>
          <Field
            label="What did you discuss?"
            hint="Capture useful context, advice, commitments, and the next question."
          >
            <Textarea
              autoFocus
              required
              rows={6}
              value={conversation.summary}
              onChange={(event) =>
                setConversation({
                  ...conversation,
                  summary: event.target.value,
                })
              }
            />
          </Field>
          <Field label="Next follow-up">
            <Input
              type="date"
              value={conversation.followUp}
              onChange={(event) =>
                setConversation({
                  ...conversation,
                  followUp: event.target.value,
                })
              }
            />
          </Field>
          <Button
            type="submit"
            disabled={pending || !conversation.summary.trim()}
          >
            Save conversation
          </Button>
        </form>
      </Modal>
      <Modal
        open={eventModal}
        onClose={() => setEventModal(false)}
        title="Save an event or community"
      >
        <form className="stack" onSubmit={saveEvent}>
          <Field label="Title">
            <Input
              autoFocus
              required
              value={eventForm.title}
              onChange={(event) =>
                setEventForm({ ...eventForm, title: event.target.value })
              }
            />
          </Field>
          <Field label="URL">
            <Input
              type="url"
              value={eventForm.url}
              onChange={(event) =>
                setEventForm({ ...eventForm, url: event.target.value })
              }
            />
          </Field>
          <div className="form-grid">
            <Field label="Date (optional)">
              <Input
                type="date"
                value={eventForm.date}
                onChange={(event) =>
                  setEventForm({ ...eventForm, date: event.target.value })
                }
              />
            </Field>
            <Field label="Location / online">
              <Input
                value={eventForm.location}
                onChange={(event) =>
                  setEventForm({ ...eventForm, location: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Why attend / useful context">
            <Textarea
              rows={4}
              value={eventForm.body}
              onChange={(event) =>
                setEventForm({ ...eventForm, body: event.target.value })
              }
            />
          </Field>
          <Button type="submit" disabled={pending || !eventForm.title.trim()}>
            Save resource
          </Button>
        </form>
      </Modal>
    </div>
  );
}
