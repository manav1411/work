import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addDays,
  field,
  localDate,
  niceDate,
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
  Textarea,
} from "../../components/ui";
import { downloadFile } from "../../lib/api";
import { agendaItems, weeklyStats, weekStart } from "../home/domain";
import { errorMessage, relatedRecords } from "../search/domain";
import { useSavingWorkspace } from "../search/useSaving";
import "./career.css";

const PROMPTS = [
  {
    key: "completed",
    label: "What meaningful work did you complete?",
    hint: "Capture outcomes, not just activity.",
  },
  {
    key: "difficulties",
    label: "What was difficult to start?",
    hint: "Notice friction. Choose a smaller first step next time.",
  },
  {
    key: "feedback",
    label: "What feedback or learning mattered?",
    hint: "Use actual observations from work, practice, and conversations.",
  },
  {
    key: "upcoming",
    label: "What commitments are coming up?",
    hint: "Interviews, deadlines, follow-ups, reviews, and life commitments.",
  },
  {
    key: "priorities",
    label: "What are next week’s priorities?",
    hint: "One concrete action per line. These can become linked tasks.",
  },
] as const;
const blank = {
  title: "",
  body: "",
  weekOf: "",
  completed: "",
  difficulties: "",
  feedback: "",
  upcoming: "",
  priorities: "",
  learningCommitment: "",
  networkingCommitment: "",
  evidenceCommitment: "",
  links: [] as string[],
};

export function ReviewPage() {
  const {
    records,
    preferences,
    create,
    update,
    remove,
    savePreferences,
    notify,
    pending,
  } = useSavingWorkspace();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<WorkRecord | null | undefined>();
  const [form, setForm] = useState(blank);
  const [commitmentsOpen, setCommitmentsOpen] = useState(false);
  const [commitments, setCommitments] = useState({
    weeklyHours: preferences.weeklyHours,
    weeklyApplications: preferences.weeklyApplications,
    weeklyPractice: preferences.weeklyPractice,
  });
  const [smaller, setSmaller] = useState<WorkRecord | null>(null);
  const [smallerForm, setSmallerForm] = useState({
    title: "",
    firstStep: "",
    estimatedMinutes: 5,
  });
  const today = localDate(new Date(), preferences.timezone);
  const thisWeek = weekStart(today);
  const nextWeek = addDays(thisWeek, 7);
  const stats = weeklyStats(records, preferences.timezone);
  const reviews = records
    .filter((record) => record.kind === "review" && !record.deletedAt)
    .sort((a, b) =>
      field(b, "weekOf", b.createdAt).localeCompare(
        field(a, "weekOf", a.createdAt),
      ),
    );
  const selected = reviews.find((record) => record.id === params.get("record"));
  const carry = records.filter(
    (record) =>
      record.kind === "action" &&
      field(record, "status", "todo") !== "done" &&
      (!field(record, "dueDate") || field(record, "dueDate") < nextWeek),
  );
  const submitted = records.filter(
    (record) => record.kind === "application" && !!field(record, "submittedAt"),
  );
  const reachedInterview = submitted.filter(
    (record) =>
      ["Interview", "Offer", "Accepted"].includes(field(record, "stage")) ||
      (Array.isArray(record.data.history) &&
        record.data.history.some(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            (event as { stage?: string }).stage === "Interview",
        )) ||
      records.some(
        (interview) =>
          interview.kind === "interview" && interview.links.includes(record.id),
      ),
  );
  const responded = submitted.filter((record) =>
    ["Assessment", "Interview", "Offer", "Accepted", "Rejected"].includes(
      field(record, "stage"),
    ),
  );
  const networking = records
    .filter((record) => record.kind === "contact")
    .reduce(
      (total, record) =>
        total +
        (Array.isArray(record.data.conversations)
          ? record.data.conversations.filter(
              (entry) =>
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as { date?: string }).date === "string" &&
                (entry as { date: string }).date >= thisWeek &&
                (entry as { date: string }).date <= today,
            ).length
          : 0),
      0,
    );
  const learned = records.filter(
    (record) =>
      record.kind === "progress" &&
      record.createdAt.slice(0, 10) >= thisWeek &&
      record.createdAt.slice(0, 10) <= today,
  ).length;

  useEffect(() => {
    if (editing === undefined) return;
    setForm(
      editing
        ? {
            ...blank,
            title: editing.title,
            body: editing.body,
            links: editing.links,
            weekOf: field(
              editing,
              "weekOf",
              weekStart(editing.createdAt.slice(0, 10)),
            ),
            completed: field(editing, "completed"),
            difficulties: field(editing, "difficulties"),
            feedback: field(editing, "feedback"),
            upcoming: field(editing, "upcoming"),
            priorities: field(editing, "priorities"),
            learningCommitment: field(editing, "learningCommitment"),
            networkingCommitment: field(editing, "networkingCommitment"),
            evidenceCommitment: field(editing, "evidenceCommitment"),
          }
        : {
            ...blank,
            title: `Week of ${niceDate(thisWeek)}`,
            weekOf: thisWeek,
          },
    );
  }, [editing]);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const { title, body, links, ...data } = form;
      const input = {
        title: title.trim(),
        body,
        links,
        data: {
          ...editing?.data,
          ...data,
          weekOf: weekStart(data.weekOf),
          ...(!editing && data.weekOf === thisWeek
            ? {
                metrics: { ...stats, networking, learning: learned },
                metricsCapturedAt: new Date().toISOString(),
              }
            : {}),
        },
      };
      const saved = editing
        ? await update(editing.id, input)
        : await create({ kind: "review", ...input });
      setEditing(undefined);
      setParams({ record: saved.id });
      notify(
        "Weekly review saved. Choose the priorities worth carrying forward.",
        "success",
      );
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function priorityAction(record: WorkRecord, title: string) {
    if (
      records.some(
        (action) =>
          action.kind === "action" &&
          action.links.includes(record.id) &&
          action.title === title,
      )
    ) {
      notify("This priority already has a linked action.", "info");
      return;
    }
    try {
      await create({
        kind: "action",
        title,
        links: [record.id, ...record.links],
        data: {
          status: "todo",
          estimatedMinutes: 15,
          dueDate: addDays(field(record, "weekOf", thisWeek), 7),
          firstStep:
            "Open the weekly review and take the smallest useful first step.",
          priority: "high",
          category: "weekly-review",
        },
      });
      notify("Priority added to the next week on Today.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function carryForward(record: WorkRecord) {
    try {
      await update(record.id, {
        data: {
          ...record.data,
          dueDate: nextWeek,
          carriedForwardAt: new Date().toISOString(),
        },
      });
      notify(`Moved to the week of ${niceDate(nextWeek)}.`, "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  async function saveSmaller(event: FormEvent) {
    event.preventDefault();
    if (!smaller) return;
    try {
      await update(smaller.id, {
        title: smallerForm.title.trim(),
        data: {
          ...smaller.data,
          firstStep: smallerForm.firstStep,
          estimatedMinutes: smallerForm.estimatedMinutes,
        },
      });
      setSmaller(null);
      notify("Action made smaller. Start with the first step.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }
  const reviewMarkdown = (record: WorkRecord) =>
    `# ${record.title}\n\n${PROMPTS.map((prompt) => `## ${prompt.label}\n\n${field(record, prompt.key)}`).join("\n\n")}\n\n${record.body}`;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="REVIEW / WEEKLY RESET"
        title="Keep what works. Change what doesn’t"
        description="A short, honest check-in turns recorded activity into next week’s useful priorities."
        action={
          <Button onClick={() => setEditing(null)}>
            + Write a weekly review
          </Button>
        }
      />
      <div className="section-heading">
        <Badge tone="aqua">Week of {niceDate(thisWeek)}</Badge>
        <Button
          variant="secondary"
          onClick={() => {
            setCommitments({
              weeklyHours: preferences.weeklyHours,
              weeklyApplications: preferences.weeklyApplications,
              weeklyPractice: preferences.weeklyPractice,
            });
            setCommitmentsOpen(true);
          }}
        >
          Edit weekly commitments
        </Button>
      </div>
      <div className="stat-grid">
        {[
          { label: "Actions completed", value: stats.actions },
          { label: "Practice attempts recorded", value: stats.practice },
          { label: "Applications submitted", value: stats.applications },
          { label: "Evidence captured", value: stats.evidence },
          { label: "Focus minutes completed", value: stats.minutes },
        ].map((stat) => (
          <Card key={stat.label}>
            <small className="muted">{stat.label}</small>
            <h2>{stat.value}</h2>
          </Card>
        ))}
      </div>
      <Card className="review-summary">
        <h3>Your recorded mix</h3>
        <p>
          {learned} learning entries, {stats.practice} practice attempts,{" "}
          {stats.applications} submissions, {networking} conversations, and{" "}
          {stats.evidence} work-evidence entries this week.
        </p>
        <p className="muted">
          Your editable commitments: {preferences.weeklyHours} hours,{" "}
          {preferences.weeklyApplications} applications, and{" "}
          {preferences.weeklyPractice} practice sessions. These are planning
          choices, not prerequisites or scores.
        </p>
      </Card>
      <div className="form-grid">
        <Card className="stack">
          <h3>Application outcomes recorded</h3>
          <p>
            {submitted.length} submitted opportunities · {responded.length} with
            a recorded response or outcome · {reachedInterview.length} reached
            an interview.
          </p>
          <p className="muted">
            {submitted.length
              ? `${Math.round((responded.length / submitted.length) * 100)}% have a recorded response/outcome; ${Math.round((reachedInterview.length / submitted.length) * 100)}% reached interview.`
              : "Conversion rates appear once you record submissions."}{" "}
            Saved research targets are excluded; this only describes your
            recorded pipeline.
          </p>
        </Card>
        <Card className="stack">
          <h3>Upcoming commitments</h3>
          {agendaItems(records, preferences.timezone)
            .slice(0, 5)
            .map((item) => (
              <a
                className="external-link"
                key={item.id}
                href={recordUrl(item.record)}
              >
                {niceDate(item.date, preferences.timezone)} · {item.kind}:{" "}
                {item.title} ↗
              </a>
            ))}
          {!agendaItems(records, preferences.timezone).length && (
            <p className="muted">
              No recorded commitments in the next two weeks.
            </p>
          )}
        </Card>
      </div>
      <div className="section-heading">
        <div>
          <h2>Carry forward deliberately</h2>
          <p className="muted">
            Keep, shrink, or drop unfinished actions. Nothing is rescheduled
            automatically.
          </p>
        </div>
        <Badge tone="orange">{carry.length} open actions</Badge>
      </div>
      <Card>
        {carry.slice(0, 20).map((action) => (
          <div className="review-carry-row" key={action.id}>
            <div>
              <a className="external-link" href={recordUrl(action)}>
                {action.title} ↗
              </a>
              <p className="muted">
                {field(action, "dueDate")
                  ? `Due ${niceDate(field(action, "dueDate"))}`
                  : "Unscheduled"}{" "}
                · {field(action, "firstStep", "Add a first step")}
              </p>
            </div>
            <div className="inline-actions">
              <Button
                variant="secondary"
                disabled={!!pending}
                onClick={() => void carryForward(action)}
              >
                Next week
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSmaller(action);
                  setSmallerForm({
                    title: action.title,
                    firstStep: field(action, "firstStep"),
                    estimatedMinutes: 5,
                  });
                }}
              >
                Make smaller
              </Button>
              <Button
                variant="ghost"
                disabled={!!pending}
                onClick={async () => {
                  try {
                    await remove(action.id);
                    notify(
                      "Dropped deliberately. Action moved to recoverable trash.",
                      "info",
                    );
                  } catch (error) {
                    notify(errorMessage(error), "error");
                  }
                }}
              >
                Drop
              </Button>
            </div>
          </div>
        ))}
        {!carry.length && (
          <p className="muted">
            No unfinished actions to carry forward. Choose fresh priorities in
            your review.
          </p>
        )}
        {carry.length > 20 && (
          <p className="muted">
            Showing the first 20. Open Today for your complete queue.
          </p>
        )}
      </Card>
      <div className="section-heading">
        <h2>Your reviews</h2>
        <Badge tone="blue">{reviews.length} saved</Badge>
      </div>
      <div className="card-grid">
        {reviews.map((review) => (
          <Card className="stack" key={review.id}>
            <Badge tone="aqua">
              Week of{" "}
              {niceDate(field(review, "weekOf", review.createdAt.slice(0, 10)))}
            </Badge>
            <button
              className="record-title-button"
              onClick={() => setParams({ record: review.id })}
            >
              {review.title} ↗
            </button>
            <p className="preserve-lines">
              {field(
                review,
                "priorities",
                "Add next priorities when you are ready.",
              )}
            </p>
            <Button variant="ghost" onClick={() => setEditing(review)}>
              Edit review
            </Button>
          </Card>
        ))}
        {!reviews.length && (
          <EmptyState
            title="Take ten minutes to reset."
            description="Notice useful progress, what was hard to start, and the one or two actions that would make next week better."
            action={
              <Button onClick={() => setEditing(null)}>
                Write your first review
              </Button>
            }
          />
        )}
      </div>
      {selected && (
        <Card className="detail-panel">
          <div className="section-heading">
            <Badge tone="aqua">WEEKLY REVIEW</Badge>
            <Button variant="ghost" onClick={() => setParams({})}>
              Close
            </Button>
          </div>
          <h2>{selected.title}</h2>
          <div className="review-prompt-grid">
            {PROMPTS.filter((prompt) => prompt.key !== "priorities").map(
              (prompt) => (
                <section key={prompt.key}>
                  <h3>{prompt.label}</h3>
                  <p className="preserve-lines">
                    {field(selected, prompt.key, "Not recorded")}
                  </p>
                </section>
              ),
            )}
          </div>
          <h3>Next priorities</h3>
          <div className="stack">
            {field(selected, "priorities")
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((priority, index) => (
                <div className="review-carry-row" key={`${priority}-${index}`}>
                  <span>{priority}</span>
                  <Button
                    variant="secondary"
                    disabled={
                      !!pending ||
                      records.some(
                        (action) =>
                          action.kind === "action" &&
                          action.links.includes(selected.id) &&
                          action.title === priority,
                      )
                    }
                    onClick={() => void priorityAction(selected, priority)}
                  >
                    {records.some(
                      (action) =>
                        action.kind === "action" &&
                        action.links.includes(selected.id) &&
                        action.title === priority,
                    )
                      ? "Action created"
                      : "Make a next-week action"}
                  </Button>
                </div>
              ))}
          </div>
          <dl className="detail-facts">
            {[
              ["learningCommitment", "Learning commitment"],
              ["networkingCommitment", "Networking commitment"],
              ["evidenceCommitment", "Work-evidence commitment"],
            ].map(([key, title]) => (
              <div key={key}>
                <dt>{title}</dt>
                <dd>{field(selected, key, "Not set")}</dd>
              </div>
            ))}
          </dl>
          <Markdown content={selected.body} />
          <h3>Connected work & planned actions</h3>
          <div className="linked-record-list">
            {relatedRecords(selected, records).map((record) => (
              <a key={record.id} href={recordUrl(record)}>
                <Badge tone="muted">{record.kind}</Badge>
                {record.title} ↗
              </a>
            ))}
          </div>
          <div className="inline-actions">
            <Button onClick={() => setEditing(selected)}>Edit review</Button>
            <Button
              variant="secondary"
              onClick={() =>
                downloadFile(
                  reviewMarkdown(selected),
                  `weekly-review-${field(selected, "weekOf", selected.createdAt.slice(0, 10))}.md`,
                  "text/markdown",
                )
              }
            >
              Export Markdown
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await remove(selected.id);
                  setParams({});
                  notify("Review moved to trash.", "info");
                } catch (error) {
                  notify(errorMessage(error), "error");
                }
              }}
            >
              Move to trash
            </Button>
          </div>
        </Card>
      )}
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? "Edit weekly review" : "A small weekly reset"}
        size="wide"
      >
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Review title">
              <Input
                autoFocus
                required
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </Field>
            <Field
              label="Week beginning"
              hint="Saved as the Monday of the selected week."
            >
              <Input
                type="date"
                required
                value={form.weekOf}
                onChange={(event) =>
                  setForm({ ...form, weekOf: event.target.value })
                }
              />
            </Field>
          </div>
          {PROMPTS.map((prompt) => (
            <Field key={prompt.key} label={prompt.label} hint={prompt.hint}>
              <Textarea
                rows={3}
                value={form[prompt.key]}
                onChange={(event) =>
                  setForm({ ...form, [prompt.key]: event.target.value })
                }
              />
            </Field>
          ))}
          <div className="form-grid">
            <Field label="Learning commitment">
              <Input
                value={form.learningCommitment}
                onChange={(event) =>
                  setForm({ ...form, learningCommitment: event.target.value })
                }
                placeholder="A small topic or exercise"
              />
            </Field>
            <Field label="Networking commitment">
              <Input
                value={form.networkingCommitment}
                onChange={(event) =>
                  setForm({ ...form, networkingCommitment: event.target.value })
                }
                placeholder="One useful conversation or follow-up"
              />
            </Field>
            <Field label="Work-evidence commitment">
              <Input
                value={form.evidenceCommitment}
                onChange={(event) =>
                  setForm({ ...form, evidenceCommitment: event.target.value })
                }
                placeholder="Capture one real contribution"
              />
            </Field>
          </div>
          <Field label="Additional notes">
            <Textarea
              rows={3}
              value={form.body}
              onChange={(event) =>
                setForm({ ...form, body: event.target.value })
              }
            />
          </Field>
          <RecordLinks
            value={form.links}
            onChange={(links) => setForm({ ...form, links })}
            excludeId={editing?.id}
          />
          <div className="inline-actions">
            <Button type="submit" disabled={!!pending || !form.title.trim()}>
              Save review
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
        open={commitmentsOpen}
        onClose={() => setCommitmentsOpen(false)}
        title="Choose a sustainable week"
      >
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await savePreferences(commitments);
              setCommitmentsOpen(false);
              notify("Weekly commitments updated.", "success");
            } catch (error) {
              notify(errorMessage(error), "error");
            }
          }}
        >
          {[
            ["weeklyHours", "Available hours"],
            ["weeklyApplications", "Application target"],
            ["weeklyPractice", "Practice-session target"],
          ].map(([key, title]) => (
            <Field key={key} label={title}>
              <Input
                type="number"
                min={0}
                max={key === "weeklyHours" ? 80 : 50}
                value={commitments[key as keyof typeof commitments]}
                onChange={(event) =>
                  setCommitments({
                    ...commitments,
                    [key]: Number(event.target.value),
                  })
                }
              />
            </Field>
          ))}
          <Button type="submit" disabled={!!pending}>
            Save commitments
          </Button>
        </form>
      </Modal>
      <Modal
        open={!!smaller}
        onClose={() => setSmaller(null)}
        title="Make starting easier"
      >
        <form className="stack" onSubmit={saveSmaller}>
          <Field label="A smaller action">
            <Input
              autoFocus
              required
              value={smallerForm.title}
              onChange={(event) =>
                setSmallerForm({ ...smallerForm, title: event.target.value })
              }
            />
          </Field>
          <Field label="The first physical step">
            <Input
              value={smallerForm.firstStep}
              onChange={(event) =>
                setSmallerForm({
                  ...smallerForm,
                  firstStep: event.target.value,
                })
              }
              placeholder="Open the file and write one sentence"
            />
          </Field>
          <Field label="Minutes">
            <Input
              type="number"
              min={1}
              max={120}
              value={smallerForm.estimatedMinutes}
              onChange={(event) =>
                setSmallerForm({
                  ...smallerForm,
                  estimatedMinutes: Number(event.target.value),
                })
              }
            />
          </Field>
          <Button
            type="submit"
            disabled={!!pending || !smallerForm.title.trim()}
          >
            Save smaller action
          </Button>
        </form>
      </Modal>
    </div>
  );
}
