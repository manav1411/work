import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import {
  addDays,
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
import {
  LEARNING_TOPICS,
  TRACKS,
  type LearningTopic,
} from "../../content/learning";
import "./prepare.css";

type TopicView = LearningTopic & { record?: WorkRecord };
function topicView(record: WorkRecord): TopicView {
  return {
    id: record.id,
    title: record.title,
    track: field(record, "track", "custom"),
    summary: record.body,
    exercise: field(record, "exercise"),
    recall: field(record, "recall"),
    prerequisites: field(record, "prerequisites"),
    resource: field(record, "resource"),
    url: field(record, "url"),
    record,
  };
}

export function LearnPage() {
  const { records, preferences } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [track, setTrack] = useState("dsa");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TopicView | "new" | null>(null);
  const custom = records.filter(
    (record) =>
      record.kind === "topic" && field(record, "category") === "learning",
  );
  const topics: TopicView[] = useMemo(
    () => [
      ...LEARNING_TOPICS.map((seed) => {
        const override = custom.find(
          (record) => field(record, "seedId") === seed.id,
        );
        return override
          ? {
              ...seed,
              ...topicView(override),
              id: seed.id,
              patterns: seed.patterns,
              week: seed.week,
            }
          : seed;
      }),
      ...custom.filter((record) => !field(record, "seedId")).map(topicView),
    ],
    [custom],
  );
  const progress = records.filter(
    (record) =>
      record.kind === "progress" && field(record, "category") === "learning",
  );
  const requested = params.get("record");
  const requestedProgress = progress.find((record) => record.id === requested);
  const requestedTopic = topics.find(
    (topic) =>
      topic.id === requested ||
      topic.record?.id === requested ||
      topic.id === field(requestedProgress, "topicId"),
  );
  useEffect(() => {
    if (requestedTopic) setTrack(requestedTopic.track);
  }, [requestedTopic?.track]);
  const visible = topics.filter(
    (topic) =>
      topic.track === track &&
      [topic.title, topic.summary]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selected = requestedTopic ?? visible[0];
  const tracks = [
    ...TRACKS,
    ...[...new Set(custom.map((record) => field(record, "track")))]
      .filter((id) => id && !TRACKS.some((item) => item.id === id))
      .map((id) => ({
        id,
        title: id,
        description: "Your own learning track.",
        accent: "blue",
      })),
  ];
  const completed = topics.filter((topic) =>
    progress.some(
      (item) =>
        field(item, "topicId") === topic.id &&
        boolField(item, "exerciseCompleted") &&
        boolField(item, "explained"),
    ),
  ).length;
  const due = progress.filter(
    (item) =>
      field(item, "nextReview") &&
      field(item, "nextReview") <= localDate(new Date(), preferences.timezone),
  ).length;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="PREPARE / LEARN"
        title="Make it click"
        description="Useful foundations. Small exercises. Proof that you understand."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus size={18} /> Add a topic
          </Button>
        }
      />
      <div className="learning-banner">
        <div>
          <BookOpen size={28} />
          <h2>Understand it. Build it. Explain it.</h2>
          <p>
            Every topic is open. Move at your own pace and connect what you
            learn to work you can show.
          </p>
        </div>
        <div className="learning-counts">
          <strong>
            {completed}
            <small>topics with evidence</small>
          </strong>
          <strong>
            {due}
            <small>reviews due</small>
          </strong>
        </div>
      </div>
      <div className="track-tabs" role="tablist" aria-label="Learning tracks">
        {tracks.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={track === item.id}
            className={track === item.id ? "active" : ""}
            onClick={() => {
              setTrack(item.id);
              setParams({});
            }}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="search-input">
          <Search size={18} />
          <Input
            aria-label="Search learning topics"
            placeholder="Find a topic in this track…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="muted">
          {tracks.find((item) => item.id === track)?.description}
        </span>
      </div>
      <div className="learning-layout">
        <div className="topic-list">
          {visible.map((topic) => {
            const evidence = progress.find(
              (item) => field(item, "topicId") === topic.id,
            );
            return (
              <button
                key={topic.id}
                className={`topic-row ${selected?.id === topic.id ? "selected" : ""}`}
                onClick={() => setParams({ record: topic.id })}
              >
                <span className="topic-number">
                  {boolField(evidence, "exerciseCompleted") &&
                  boolField(evidence, "explained") ? (
                    <Check size={19} />
                  ) : topic.week ? (
                    `${topic.week}`.padStart(2, "0")
                  ) : (
                    <BookOpen size={17} />
                  )}
                </span>
                <span>
                  <strong>{topic.title}</strong>
                  <small>
                    {field(evidence, "nextReview")
                      ? `Review ${niceDate(field(evidence, "nextReview"))}`
                      : evidence
                        ? "In progress"
                        : "Ready when you are"}
                  </small>
                </span>
                <ArrowRight size={17} />
              </button>
            );
          })}
          {!visible.length && (
            <EmptyState
              title="No matching topics"
              description="Try a different search or add your own."
            />
          )}
        </div>
        {selected && (
          <LearningDetail
            key={selected.id}
            topic={selected}
            progress={progress.find(
              (item) => field(item, "topicId") === selected.id,
            )}
            onEdit={() => setEditing(selected)}
          />
        )}
      </div>
      <TopicEditor
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={(id) => {
          setEditing(null);
          setParams({ record: id });
        }}
        tracks={tracks}
      />
    </div>
  );
}

function LearningDetail({
  topic,
  progress,
  onEdit,
}: {
  topic: TopicView;
  progress?: WorkRecord;
  onEdit: () => void;
}) {
  const { create, update, notify, preferences } = useWorkspace();
  const [reflection, setReflection] = useState(progress?.body ?? "");
  const [explanation, setExplanation] = useState(
    field(progress, "explanation"),
  );
  const [example, setExample] = useState(field(progress, "example"));
  const [exerciseCompleted, setExerciseCompleted] = useState(
    boolField(progress, "exerciseCompleted"),
  );
  const [explained, setExplained] = useState(boolField(progress, "explained"));
  const [recall, setRecall] = useState(
    field(progress, "recallResult", "Not attempted"),
  );
  const [nextReviewDate, setNextReviewDate] = useState(
    field(
      progress,
      "nextReview",
      addDays(localDate(new Date(), preferences.timezone), 7),
    ),
  );
  const [links, setLinks] = useState(progress?.links ?? []);
  const [saving, setSaving] = useState(false);
  async function save(createAction = false) {
    if (saving) return;
    setSaving(true);
    try {
      const input = {
        title: `${topic.title} · learning evidence`,
        body: reflection,
        links,
        data: {
          ...progress?.data,
          category: "learning",
          topicId: topic.id,
          track: topic.track,
          explanation,
          example,
          exerciseCompleted,
          explained,
          recallResult: recall,
          nextReview: nextReviewDate,
          lastReviewed: localDate(new Date(), preferences.timezone),
        },
      };
      const result = progress
        ? await update(progress.id, input)
        : await create({ kind: "progress", ...input });
      if (createAction)
        await create({
          kind: "action",
          title: `Practise: ${topic.title}`,
          body: topic.exercise,
          links: [result.id, ...links],
          data: {
            status: "todo",
            estimatedMinutes: 30,
            firstStep: topic.exercise,
            dueDate: nextReviewDate,
            priority: "normal",
            category: "learning",
          },
        });
      notify(
        createAction
          ? "Evidence saved and a practice action added to Today."
          : "Learning evidence saved.",
        "success",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not save learning evidence.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }
  const url = safeUrl(topic.url);
  return (
    <Card className="learning-detail">
      <div className="section-heading">
        <Badge tone="blue">
          {topic.week ? `WEEK ${topic.week}` : "FOUNDATIONS"}
        </Badge>
        <Button variant="ghost" onClick={onEdit}>
          <Pencil size={16} /> Edit topic
        </Button>
      </div>
      <h2>{topic.title}</h2>
      <p className="topic-summary">{topic.summary}</p>
      <div className="concept-block">
        <span className="eyebrow">BEFORE YOU START</span>
        <p>
          {topic.prerequisites ||
            "Add prerequisites that help you get started."}
        </p>
      </div>
      {url && (
        <a
          className="resource-link"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          <BookOpen size={19} />
          <span>{topic.resource || "Open learning resource"}</span>
          <ExternalLink size={17} />
        </a>
      )}
      <div className="exercise-block">
        <Badge tone="lime">BUILD SOMETHING</Badge>
        <h3>Your exercise</h3>
        <p>
          {topic.exercise ||
            "Choose a small exercise and add it to this topic."}
        </p>
      </div>
      <div className="concept-block">
        <span className="eyebrow">RECALL WITHOUT LOOKING</span>
        <p>
          {topic.recall || "Explain the concept, a tradeoff and an example."}
        </p>
      </div>
      {topic.patterns?.length ? (
        <div className="chips">
          {topic.patterns.map((pattern) => (
            <Link
              key={pattern}
              className="pattern-link"
              to={`/practice?pattern=${pattern}`}
            >
              {pattern.replace(/-/g, " ")} <ArrowRight size={13} />
            </Link>
          ))}
        </div>
      ) : null}
      <h3>Your evidence of understanding</h3>
      <div className="checklist">
        <label>
          <input
            type="checkbox"
            checked={exerciseCompleted}
            onChange={(event) => setExerciseCompleted(event.target.checked)}
          />{" "}
          I completed the exercise
        </label>
        <label>
          <input
            type="checkbox"
            checked={explained}
            onChange={(event) => setExplained(event.target.checked)}
          />{" "}
          I can explain the idea without reading
        </label>
      </div>
      <Field label="Explain it in your own words">
        <Textarea
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          placeholder="What is the central idea? What tradeoff matters?"
          rows={3}
        />
      </Field>
      <Field label="Exercise result and reflection">
        <Textarea
          value={reflection}
          onChange={(event) => setReflection(event.target.value)}
          placeholder="What did you build? What worked? What would you change?"
          rows={3}
        />
      </Field>
      <Field label="A real example / evidence link">
        <Textarea
          value={example}
          onChange={(event) => setExample(event.target.value)}
          placeholder="Connect this to a project or something you worked on."
          rows={2}
        />
      </Field>
      <div className="form-grid">
        <Field label="Last recall">
          <Select
            value={recall}
            onChange={(event) => setRecall(event.target.value)}
          >
            {[
              "Not attempted",
              "Needed notes",
              "Explained with gaps",
              "Explained independently",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
        </Field>
        <Field label="Next review">
          <Input
            type="date"
            value={nextReviewDate}
            onChange={(event) => setNextReviewDate(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Connected notes and work">
        <RecordLinks
          value={links}
          onChange={setLinks}
          excludeId={progress?.id}
        />
      </Field>
      <div className="inline-actions">
        <Button onClick={() => save()} disabled={saving}>
          Save evidence
        </Button>
        <Button
          variant="secondary"
          onClick={() => save(true)}
          disabled={saving}
        >
          Save + add a practice action
        </Button>
      </div>
    </Card>
  );
}

function TopicEditor({
  value,
  onClose,
  onSaved,
  tracks,
}: {
  value: TopicView | "new" | null;
  onClose: () => void;
  onSaved: (id: string) => void;
  tracks: { id: string; title: string }[];
}) {
  const { create, update, notify } = useWorkspace();
  const topic = value && value !== "new" ? value : undefined;
  const [title, setTitle] = useState(topic?.title ?? "");
  const [track, setTrack] = useState(topic?.track ?? "dsa");
  const [newTrack, setNewTrack] = useState("");
  const [summary, setSummary] = useState(topic?.summary ?? "");
  const [exercise, setExercise] = useState(topic?.exercise ?? "");
  const [recall, setRecall] = useState(topic?.recall ?? "");
  const [prerequisites, setPrerequisites] = useState(
    topic?.prerequisites ?? "",
  );
  const [url, setUrl] = useState(topic?.url ?? "");
  const [resource, setResource] = useState(topic?.resource ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!title.trim() || (url && !safeUrl(url))) {
      notify("Add a title and a valid resource URL.", "error");
      return;
    }
    setSaving(true);
    try {
      const input = {
        title: title.trim(),
        body: summary,
        data: {
          ...topic?.record?.data,
          category: "learning",
          track: track === "__new" ? newTrack.trim() || "My track" : track,
          exercise,
          recall,
          prerequisites,
          url,
          resource,
          ...(!topic?.record && topic ? { seedId: topic.id } : {}),
        },
      };
      const result = topic?.record
        ? await update(topic.record.id, input)
        : await create({ kind: "topic", ...input });
      onSaved(topic?.id ?? result.id);
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
      title={topic ? "Edit learning topic" : "Add a learning topic"}
      size="wide"
    >
      <div className="stack">
        <Field label="Topic title">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Track">
            <Select
              value={track}
              onChange={(event) => setTrack(event.target.value)}
            >
              {tracks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
              <option value="__new">Create a new track</option>
            </Select>
          </Field>
          {track === "__new" && (
            <Field label="New track name">
              <Input
                value={newTrack}
                onChange={(event) => setNewTrack(event.target.value)}
              />
            </Field>
          )}
        </div>
        <Field label="Explanation / summary">
          <Textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
          />
        </Field>
        <Field label="Prerequisites">
          <Input
            value={prerequisites}
            onChange={(event) => setPrerequisites(event.target.value)}
          />
        </Field>
        <Field label="Small exercise">
          <Textarea
            value={exercise}
            onChange={(event) => setExercise(event.target.value)}
            rows={3}
          />
        </Field>
        <Field label="Recall question">
          <Input
            value={recall}
            onChange={(event) => setRecall(event.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Resource title">
            <Input
              value={resource}
              onChange={(event) => setResource(event.target.value)}
            />
          </Field>
          <Field label="Resource URL">
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
        </div>
        <Button onClick={save} disabled={saving}>
          Save topic
        </Button>
      </div>
    </Modal>
  );
}
