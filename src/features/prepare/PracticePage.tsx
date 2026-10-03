import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Clock3,
  Code2,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import {
  addDays,
  boolField,
  field,
  localDate,
  niceDate,
  numberField,
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
import { roadmapTopics } from "../../content/problems";
import { formatDuration, nextReview, splitTags } from "./helpers";
import "./prepare.css";

interface Problem {
  id: string;
  title: string;
  url: string;
  pattern: string;
  difficulty: string;
  custom?: WorkRecord;
}
const CATALOGUE: Problem[] = roadmapTopics.flatMap((topic) =>
  topic.problems.map((problem) => ({
    id: problem.slug,
    title: problem.name,
    difficulty: problem.difficulty,
    pattern: topic.id,
    url: `https://leetcode.com/problems/${problem.slug}/`,
  })),
);
const INTERVIEW_CHECKS = [
  "Clarified requirements",
  "Explained approach",
  "Analysed complexity",
  "Implemented solution",
  "Tested edge cases",
  "Reflected",
];

export function PracticePage() {
  const { records, preferences } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [pattern, setPattern] = useState(params.get("pattern") ?? "all");
  const [difficulty, setDifficulty] = useState("all");
  const [view, setView] = useState("catalogue");
  const [limit, setLimit] = useState(30);
  const [customEditor, setCustomEditor] = useState<Problem | "new" | null>(
    null,
  );
  const problemRecords = records.filter(
    (record) =>
      record.kind === "topic" && field(record, "category") === "problem",
  );
  const custom: Problem[] = problemRecords
    .filter((record) => boolField(record, "custom"))
    .map((record) => ({
      id: record.id,
      title: record.title,
      url: field(record, "url"),
      pattern: field(record, "pattern", "custom"),
      difficulty: field(record, "difficulty", "Medium"),
      custom: record,
    }));
  const problems = [...CATALOGUE, ...custom];
  const attempts = records.filter((record) => record.kind === "practice");
  const requested = records.find(
    (record) => record.id === params.get("record"),
  );
  const requestedId =
    requested?.kind === "practice"
      ? field(requested, "problemId")
      : requested?.kind === "topic"
        ? field(requested, "problemId", requested.id)
        : params.get("record");
  const selected = problems.find((problem) => problem.id === requestedId);
  const today = localDate(new Date(), preferences.timezone);
  const reviews = problemRecords.filter((record) =>
    field(record, "nextReview"),
  );
  const due = reviews.filter((record) => field(record, "nextReview") <= today);
  const reviewedIds = new Set(
    (view === "due" ? due : reviews).map((record) =>
      field(record, "problemId", record.id),
    ),
  );
  const visible = problems
    .filter(
      (problem) =>
        (pattern === "all" || problem.pattern === pattern) &&
        (difficulty === "all" || problem.difficulty === difficulty) &&
        (view === "catalogue" || reviewedIds.has(problem.id)) &&
        [problem.title, problem.pattern]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      view === "catalogue"
        ? 0
        : field(
            reviews.find((item) => field(item, "problemId", item.id) === a.id),
            "nextReview",
          ).localeCompare(
            field(
              reviews.find(
                (item) => field(item, "problemId", item.id) === b.id,
              ),
              "nextReview",
            ),
          ),
    );
  const independent = attempts.filter(
    (record) => field(record, "outcome") === "Independent",
  ).length;
  const repeated = Object.values(
    attempts.reduce<Record<string, WorkRecord[]>>((groups, record) => {
      (groups[field(record, "problemId")] ??= []).push(record);
      return groups;
    }, {}),
  )
    .filter((group) => group.length > 1)
    .flatMap((group) =>
      group
        .sort((a, b) =>
          field(a, "attemptedAt", a.createdAt).localeCompare(
            field(b, "attemptedAt", b.createdAt),
          ),
        )
        .slice(1),
    );
  useEffect(() => {
    setLimit(30);
  }, [search, pattern, difficulty, view]);
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="PREPARE / PRACTICE"
        title="Think. Solve. Repeat"
        description="Patterns matter. So does explaining them a week later."
        action={
          <Button onClick={() => setCustomEditor("new")}>
            <Plus size={18} /> Custom problem
          </Button>
        }
      />
      <div className="practice-stats">
        <Card>
          <span className="eyebrow">ATTEMPTS RECORDED</span>
          <strong>{attempts.length}</strong>
          <small>{independent} independent attempts</small>
        </Card>
        <Card className="accent-lime">
          <span className="eyebrow">REVIEWS DUE</span>
          <strong>{due.length}</strong>
          <small>Scheduled recall, at your pace</small>
        </Card>
        <Card>
          <span className="eyebrow">REPEAT ATTEMPTS</span>
          <strong>
            {repeated.length
              ? `${Math.round((repeated.filter((record) => field(record, "outcome") === "Independent").length / repeated.length) * 100)}%`
              : "—"}
          </strong>
          <small>{repeated.length} repeats · independent recall</small>
        </Card>
      </div>
      <div className="toolbar">
        <div className="search-input">
          <Search size={18} />
          <Input
            aria-label="Search coding problems"
            placeholder="Search 150 problems + your additions…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          aria-label="Problem pattern"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
        >
          <option value="all">All patterns</option>
          {roadmapTopics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.label}
            </option>
          ))}
          <option value="custom">Custom</option>
          {[...new Set(custom.map((problem) => problem.pattern))]
            .filter(
              (id) =>
                id !== "custom" &&
                !roadmapTopics.some((topic) => topic.id === id),
            )
            .map((id) => (
              <option key={id}>{id}</option>
            ))}
        </Select>
        <Select
          aria-label="Problem difficulty"
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value)}
        >
          <option value="all">All difficulties</option>
          {["Easy", "Medium", "Hard"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
      </div>
      <div className="tab-list" role="tablist" aria-label="Practice view">
        {[
          ["catalogue", "Problem catalogue"],
          ["due", `Due for review (${due.length})`],
          ["scheduled", "All scheduled reviews"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="practice-layout">
        <Card className="problem-list">
          <div className="section-heading">
            <h2>
              {view === "catalogue"
                ? "Choose your next problem"
                : "Your review queue"}
            </h2>
            <Badge tone="blue">{visible.length}</Badge>
          </div>
          {visible.slice(0, limit).map((problem) => {
            const history = attempts.filter(
              (attempt) => field(attempt, "problemId") === problem.id,
            );
            const review = problemRecords.find(
              (record) => field(record, "problemId", record.id) === problem.id,
            );
            return (
              <button
                className={`problem-row ${selected?.id === problem.id ? "selected" : ""}`}
                key={problem.id}
                onClick={() => setParams({ record: problem.id })}
              >
                <Code2 size={18} />
                <span>
                  <strong>{problem.title}</strong>
                  <small>
                    {roadmapTopics.find((topic) => topic.id === problem.pattern)
                      ?.label ?? problem.pattern}
                    {history.length ? ` · ${history.length} attempts` : ""}
                    {field(review, "nextReview")
                      ? ` · review ${niceDate(field(review, "nextReview"))}`
                      : ""}
                  </small>
                </span>
                <Badge
                  tone={
                    problem.difficulty === "Easy"
                      ? "lime"
                      : problem.difficulty === "Hard"
                        ? "pink"
                        : "orange"
                  }
                >
                  {problem.difficulty}
                </Badge>
              </button>
            );
          })}
          {!visible.length && (
            <EmptyState
              title={
                view === "due"
                  ? "No reviews due right now"
                  : "No matching problems"
              }
              description={
                view === "due"
                  ? "Log an attempt to schedule your next recall, or browse your upcoming reviews."
                  : "Try another pattern or add a custom exercise."
              }
            />
          )}
          {visible.length > limit && (
            <Button variant="secondary" onClick={() => setLimit(limit + 30)}>
              Show 30 more
            </Button>
          )}
        </Card>
        {selected ? (
          <ProblemDetail
            key={selected.id}
            problem={selected}
            attempts={attempts.filter(
              (record) => field(record, "problemId") === selected.id,
            )}
            schedule={problemRecords.find(
              (record) => field(record, "problemId", record.id) === selected.id,
            )}
            onEdit={() => setCustomEditor(selected)}
          />
        ) : (
          <Card className="practice-welcome">
            <Code2 size={54} />
            <h2>Find the pattern.</h2>
            <p>
              Pick a problem. Solve in your editor or on LeetCode, then capture
              your reasoning here.
            </p>
            <div className="concept-block">
              <strong>The interview loop</strong>
              <p>
                Clarify → approach → complexity → implement → test → reflect.
              </p>
            </div>
            {preferences.leetcode && (
              <a
                className="text-link"
                href={`https://leetcode.com/u/${preferences.leetcode.replace(/^.*leetcode\.com\/(?:u\/)?/, "").replace(/\/$/, "")}/`}
                target="_blank"
                rel="noreferrer"
              >
                Open your LeetCode profile <ExternalLink size={15} />
              </a>
            )}
            <small className="muted">
              Manual recording is always available. Provider solve counts are
              supplementary.
            </small>
          </Card>
        )}
      </div>
      <CustomProblemEditor
        key={customEditor === "new" ? "new" : (customEditor?.id ?? "closed")}
        problem={customEditor}
        onClose={() => setCustomEditor(null)}
        onSaved={(id) => {
          setCustomEditor(null);
          setParams({ record: id });
        }}
      />
    </div>
  );
}

function ProblemDetail({
  problem,
  attempts,
  schedule,
  onEdit,
}: {
  problem: Problem;
  attempts: WorkRecord[];
  schedule?: WorkRecord;
  onEdit: () => void;
}) {
  const { create, update, remove, notify, preferences } = useWorkspace();
  const navigate = useNavigate();
  const [attemptEditor, setAttemptEditor] = useState<WorkRecord | "new" | null>(
    null,
  );
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [reviewDate, setReviewDate] = useState(field(schedule, "nextReview"));
  const [deleteAttempt, setDeleteAttempt] = useState<WorkRecord | null>(null);
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(
      () => setElapsed((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [running]);
  useEffect(() => {
    setReviewDate(field(schedule, "nextReview"));
  }, [schedule?.version]);
  const history = [...attempts].sort((a, b) =>
    field(b, "attemptedAt", b.createdAt).localeCompare(
      field(a, "attemptedAt", a.createdAt),
    ),
  );
  const url = safeUrl(problem.url);
  async function saveSchedule() {
    try {
      const data = {
        ...schedule?.data,
        category: "problem",
        problemId: problem.id,
        pattern: problem.pattern,
        difficulty: problem.difficulty,
        url: problem.url,
        nextReview: reviewDate,
      };
      if (schedule) await update(schedule.id, { data });
      else await create({ kind: "topic", title: problem.title, data });
      notify("Review schedule updated.", "success");
    } catch (error) {
      notify(String(error), "error");
    }
  }
  async function note() {
    try {
      const result = await create({
        kind: "note",
        title: `${problem.title} · problem reflection`,
        body: `## Pattern and invariant\n\n## Approach\n\n## Complexity\n- Time:\n- Space:\n\n## Mistakes and edge cases\n\n## Explain without looking\n\n[Problem](${problem.url})`,
        links: schedule ? [schedule.id] : [],
        tags: [problem.pattern],
        data: { collection: "Learning" },
      });
      navigate(`/notes?record=${result.id}`);
    } catch (error) {
      notify(String(error), "error");
    }
  }
  return (
    <Card className="problem-detail">
      <div className="section-heading">
        <Badge tone="blue">
          {problem.custom ? "YOUR EXERCISE" : "NEETCODE 150"}
        </Badge>
        {problem.custom && (
          <Button variant="ghost" onClick={onEdit}>
            <Pencil size={16} /> Edit
          </Button>
        )}
      </div>
      <h2>{problem.title}</h2>
      <div className="chips">
        <Badge
          tone={
            problem.difficulty === "Easy"
              ? "lime"
              : problem.difficulty === "Hard"
                ? "pink"
                : "orange"
          }
        >
          {problem.difficulty}
        </Badge>
        <Badge tone="muted">
          {roadmapTopics.find((topic) => topic.id === problem.pattern)?.label ??
            problem.pattern}
        </Badge>
      </div>
      {url && (
        <a
          className="resource-link"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          <span>Open problem</span>
          <ArrowUpRight size={19} />
        </a>
      )}
      <div className="practice-timer">
        <Clock3 size={22} />
        <output aria-live="off">{formatDuration(elapsed)}</output>
        <Button
          variant="ghost"
          aria-label={running ? "Pause practice timer" : "Start practice timer"}
          onClick={() => setRunning(!running)}
        >
          {running ? <Pause size={18} /> : <Play size={18} />}
        </Button>
        <Button
          variant="ghost"
          aria-label="Reset practice timer"
          onClick={() => {
            setRunning(false);
            setElapsed(0);
          }}
        >
          <RotateCcw size={17} />
        </Button>
      </div>
      <div className="inline-actions">
        <Button
          onClick={() => {
            setRunning(false);
            setAttemptEditor("new");
          }}
        >
          <Plus size={17} /> Log attempt
        </Button>
        <Button variant="secondary" onClick={note}>
          Write a reflection note
        </Button>
      </div>
      <div className="review-schedule">
        <h3>Next recall</h3>
        <p className="muted">
          A solve today and independent recall later are different kinds of
          evidence.
        </p>
        <div className="inline-actions">
          <Input
            aria-label="Next problem review"
            type="date"
            value={reviewDate}
            onChange={(event) => setReviewDate(event.target.value)}
          />
          <Button variant="secondary" onClick={saveSchedule}>
            Update schedule
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              setReviewDate(
                addDays(localDate(new Date(), preferences.timezone), 7),
              )
            }
          >
            +7 days
          </Button>
        </div>
      </div>
      <div className="section-heading">
        <h3>Attempt history</h3>
        <Badge tone="muted">{attempts.length}</Badge>
      </div>
      {history.length ? (
        history.map((attempt) => (
          <div key={attempt.id} className="attempt-card">
            <div className="section-heading">
              <strong>
                {field(attempt, "outcome", "Recorded")} ·{" "}
                {numberField(attempt, "minutes")} min
              </strong>
              <div className="inline-actions">
                <Button
                  variant="ghost"
                  aria-label="Edit attempt"
                  onClick={() => setAttemptEditor(attempt)}
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label="Move attempt to Trash"
                  onClick={() => setDeleteAttempt(attempt)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
            <small>
              {niceDate(field(attempt, "attemptedAt", attempt.createdAt))} ·{" "}
              {field(attempt, "language")} · confidence{" "}
              {numberField(attempt, "confidence", 3)}/5
            </small>
            <p>
              {attempt.body ||
                field(attempt, "approach") ||
                "No reflection recorded."}
            </p>
            <details>
              <summary>Approach, complexity and mistakes</summary>
              <p>
                <strong>Approach:</strong>{" "}
                {field(attempt, "approach") || "Not recorded"}
              </p>
              <p>
                <strong>Complexity:</strong>{" "}
                {field(attempt, "complexity") || "Not recorded"}
              </p>
              <p>
                <strong>Hints:</strong>{" "}
                {field(attempt, "hints") || "None recorded"}
              </p>
              <p>
                <strong>Mistakes:</strong>{" "}
                {field(attempt, "mistakes") || "Not recorded"}
              </p>
            </details>
          </div>
        ))
      ) : (
        <EmptyState
          title="Start your history"
          description="Capture your attempt, even when you needed hints or did not finish."
        />
      )}
      <AttemptEditor
        key={attemptEditor === "new" ? "new" : (attemptEditor?.id ?? "closed")}
        value={attemptEditor}
        problem={problem}
        schedule={schedule}
        minutes={Math.max(1, Math.round(elapsed / 60))}
        onClose={() => setAttemptEditor(null)}
        onSaved={() => {
          setAttemptEditor(null);
          setElapsed(0);
        }}
      />
      <Modal
        open={!!deleteAttempt}
        onClose={() => setDeleteAttempt(null)}
        title="Move this attempt to Trash?"
        description="The problem and other attempts stay in your practice history."
      >
        <Button
          variant="danger"
          onClick={async () => {
            if (!deleteAttempt) return;
            try {
              await remove(deleteAttempt.id);
              setDeleteAttempt(null);
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

function AttemptEditor({
  value,
  problem,
  schedule,
  minutes: timerMinutes,
  onClose,
  onSaved,
}: {
  value: WorkRecord | "new" | null;
  problem: Problem;
  schedule?: WorkRecord;
  minutes: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { create, update, notify, preferences } = useWorkspace();
  const attempt = value && value !== "new" ? value : undefined;
  const [language, setLanguage] = useState(
    field(attempt, "language", "Python"),
  );
  const [minutes, setMinutes] = useState(
    numberField(attempt, "minutes", timerMinutes),
  );
  const [outcome, setOutcome] = useState(
    field(attempt, "outcome", "Independent"),
  );
  const [approach, setApproach] = useState(field(attempt, "approach"));
  const [complexity, setComplexity] = useState(field(attempt, "complexity"));
  const [hints, setHints] = useState(field(attempt, "hints"));
  const [mistakes, setMistakes] = useState(field(attempt, "mistakes"));
  const [reflection, setReflection] = useState(attempt?.body ?? "");
  const [confidence, setConfidence] = useState(
    numberField(attempt, "confidence", 3),
  );
  const [checks, setChecks] = useState<string[]>(
    Array.isArray(attempt?.data.checklist)
      ? (attempt.data.checklist as string[])
      : [],
  );
  const [links, setLinks] = useState(attempt?.links ?? []);
  const [date, setDate] = useState(
    field(attempt, "attemptedAt", new Date().toISOString()).slice(0, 10),
  );
  const [reviewDate, setReviewDate] = useState(
    nextReview(
      localDate(new Date(), preferences.timezone),
      confidence,
      numberField(schedule, "recallStreak"),
    ),
  );
  const [saving, setSaving] = useState(false);
  async function save() {
    if (minutes < 0 || !Number.isFinite(minutes) || !date) {
      notify("Add a valid attempt date and non-negative duration.", "error");
      return;
    }
    setSaving(true);
    try {
      const input = {
        title: `${problem.title} · ${outcome.toLowerCase()} attempt`,
        body: reflection,
        links,
        tags: [problem.pattern],
        data: {
          ...attempt?.data,
          problemId: problem.id,
          problemTitle: problem.title,
          pattern: problem.pattern,
          difficulty: problem.difficulty,
          language,
          minutes,
          outcome,
          approach,
          complexity,
          hints,
          mistakes,
          confidence,
          checklist: checks,
          attemptedAt: date,
          nextReview: reviewDate,
        },
      };
      if (attempt) await update(attempt.id, input);
      else await create({ kind: "practice", ...input });
      const data = {
        ...schedule?.data,
        category: "problem",
        problemId: problem.id,
        pattern: problem.pattern,
        difficulty: problem.difficulty,
        url: problem.url,
        nextReview: reviewDate,
        lastPractised: date,
        recallStreak:
          outcome === "Independent" && confidence >= 4
            ? numberField(schedule, "recallStreak") + 1
            : 0,
      };
      try {
        if (schedule) await update(schedule.id, { data });
        else await create({ kind: "topic", title: problem.title, data });
        notify("Attempt recorded. Your next recall is scheduled.", "success");
      } catch {
        notify(
          "Your attempt was saved, but the review schedule needs attention. Use Update schedule on this problem to retry.",
          "error",
        );
      }
      onSaved();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save attempt.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={attempt ? "Edit attempt" : "Log your attempt"}
      description={problem.title}
      size="wide"
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Attempt date">
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field label="Language">
            <Input
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            />
          </Field>
          <Field label="Minutes spent">
            <Input
              type="number"
              min="0"
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </Field>
          <Field label="Outcome">
            <Select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
            >
              {[
                "Independent",
                "Hinted",
                "Reviewed solution",
                "Did not finish",
              ].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Approach and invariant">
          <Textarea
            value={approach}
            onChange={(event) => setApproach(event.target.value)}
            placeholder="Explain the reasoning you would say out loud."
            rows={3}
          />
        </Field>
        <Field label="Time and space complexity">
          <Input
            value={complexity}
            onChange={(event) => setComplexity(event.target.value)}
            placeholder="O(n) time, O(n) space because…"
          />
        </Field>
        <div className="form-grid">
          <Field label="Hints / help used">
            <Textarea
              value={hints}
              onChange={(event) => setHints(event.target.value)}
              rows={2}
            />
          </Field>
          <Field label="Mistakes and edge cases">
            <Textarea
              value={mistakes}
              onChange={(event) => setMistakes(event.target.value)}
              rows={2}
            />
          </Field>
        </div>
        <Field label="Reflection">
          <Textarea
            value={reflection}
            onChange={(event) => setReflection(event.target.value)}
            rows={3}
            placeholder="What would make your next attempt better?"
          />
        </Field>
        <div className="form-grid">
          <Field label="Confidence at explaining">
            <Select
              value={confidence}
              onChange={(event) => {
                const next = Number(event.target.value);
                setConfidence(next);
                setReviewDate(
                  nextReview(date, next, numberField(schedule, "recallStreak")),
                );
              }}
            >
              {[1, 2, 3, 4, 5].map((item) => (
                <option key={item} value={item}>
                  {item} / 5{" "}
                  {item === 1
                    ? "— need to relearn"
                    : item === 5
                      ? "— can teach it"
                      : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next review" hint="Suggested interval; always editable">
            <Input
              aria-label="Next review"
              type="date"
              value={reviewDate}
              onChange={(event) => setReviewDate(event.target.value)}
            />
          </Field>
        </div>
        <div className="checklist">
          {INTERVIEW_CHECKS.map((check) => (
            <label key={check}>
              <input
                type="checkbox"
                checked={checks.includes(check)}
                onChange={(event) =>
                  setChecks((current) =>
                    event.target.checked
                      ? [...current, check]
                      : current.filter((item) => item !== check),
                  )
                }
              />
              {check}
            </label>
          ))}
        </div>
        <Field label="Linked notes / evidence">
          <RecordLinks
            value={links}
            onChange={setLinks}
            excludeId={attempt?.id}
          />
        </Field>
        <Button onClick={save} disabled={saving}>
          Save attempt + review
        </Button>
      </div>
    </Modal>
  );
}

function CustomProblemEditor({
  problem,
  onClose,
  onSaved,
}: {
  problem: Problem | "new" | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { create, update, notify } = useWorkspace();
  const existing = problem && problem !== "new" ? problem : undefined;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [pattern, setPattern] = useState(existing?.pattern ?? "custom");
  const [difficulty, setDifficulty] = useState(
    existing?.difficulty ?? "Medium",
  );
  const [body, setBody] = useState(existing?.custom?.body ?? "");
  const [tags, setTags] = useState(existing?.custom?.tags.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!title.trim() || (url && !safeUrl(url))) {
      notify("Add a title and valid problem URL.", "error");
      return;
    }
    setSaving(true);
    try {
      const input = {
        title,
        body,
        tags: splitTags(tags),
        data: {
          ...existing?.custom?.data,
          category: "problem",
          custom: true,
          url,
          pattern,
          difficulty,
        },
      };
      const result = existing?.custom
        ? await update(existing.custom.id, input)
        : await create({ kind: "topic", ...input });
      onSaved(result.id);
    } catch (error) {
      notify(String(error), "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={!!problem}
      onClose={onClose}
      title={existing ? "Edit your problem" : "Add a custom problem"}
    >
      <div className="stack">
        <Field label="Problem title">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="External URL (optional)">
          <Input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Pattern">
            <Input
              aria-label="Pattern"
              list="problem-patterns"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
            />
            <datalist id="problem-patterns">
              {roadmapTopics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.label}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label="Difficulty">
            <Select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
            >
              {["Easy", "Medium", "Hard"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Description / exercise">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
          />
        </Field>
        <Field label="Tags">
          <Input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </Field>
        <Button onClick={save} disabled={saving}>
          Save problem
        </Button>
      </div>
    </Modal>
  );
}
