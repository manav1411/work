import { useRef, useState, useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import {
  field,
  type WorkRecord,
  type RecordPatch,
} from "../../../shared/model";
import { contentRecordWriter } from "../content/recordWriter";
import {
  Badge,
  Button,
  Card,
  Input,
  Markdown,
  Select,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { DeleteControl } from "../content/DeleteControl";
import { InlineTitle } from "../content/InlineTitle";
import { SortableList } from "../content/SortableList";
import { reorderRecords } from "../content/reorderRecords";
import { orderedRecords } from "../../../shared/content";
import { storyMatches } from "./domain";

function StoryField({
  story,
  name,
  write,
}: {
  story: WorkRecord;
  name: string;
  write: (patch: RecordPatch) => Promise<WorkRecord>;
}) {
  const { editing } = useEditMode();
  const { user } = useWorkspace();
  const initial =
    name === "lessons"
      ? [
          field(story, "lessons") || field(story, "reflection"),
          story.data.otherNotesMigrated ? "" : story.body,
        ]
          .filter(Boolean)
          .join("\n\n")
      : field(story, name);
  const draftKey = `work-content-draft:${user?.id ?? "anonymous"}:story:${story.id}:${name}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? initial;
    } catch {
      return initial;
    }
  });
  const [error, setError] = useState("");
  const [review, setReview] = useState(text !== initial);
  const blocked = useRef(text !== initial);
  const saving = useRef(false);
  const saved = useRef(initial),
    latest = useRef(text),
    base = useRef(story),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  base.current = story;
  latest.current = text;
  const save = async () => {
    clearTimeout(timer.current);
    const value = latest.current;
    if (value === saved.current || blocked.current || saving.current) return;
    saving.current = true;
    try {
      await write({
        data: {
          [name]: value,
          ...(name === "lessons" ? { otherNotesMigrated: true } : {}),
        },
      });
      saved.current = value;
      if (latest.current === value) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* Optional storage. */
        }
      }
      setError("");
    } catch (failure) {
      blocked.current = true;
      setReview(true);
      setError(
        failure instanceof Error
          ? failure.message
          : "Draft could not be saved.",
      );
    } finally {
      saving.current = false;
      if (!blocked.current && latest.current !== saved.current)
        timer.current = setTimeout(() => void saveRef.current(), 800);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (saving.current || initial === saved.current) return;
    if (latest.current !== saved.current) {
      blocked.current = true;
      setReview(true);
      setError("Saved story changed. Review your local text before saving.");
    } else {
      saved.current = initial;
      latest.current = initial;
      setText(initial);
    }
  }, [initial]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      void saveRef.current();
    },
    [],
  );
  return (
    <section className="inline-star-field">
      <h4>{name[0].toUpperCase() + name.slice(1)}</h4>
      {editing ? (
        <textarea
          aria-label={name[0].toUpperCase() + name.slice(1)}
          className="inline-star-text"
          rows={Math.min(12, Math.max(2, text.split("\n").length))}
          value={text}
          placeholder={
            name === "lessons" ? "What you learned…" : `Write the ${name}…`
          }
          onBlur={() => void save()}
          onChange={(event) => {
            latest.current = event.target.value;
            setText(event.target.value);
            try {
              localStorage.setItem(draftKey, event.target.value);
            } catch {
              /* Optional storage. */
            }
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void saveRef.current(), 800);
          }}
        />
      ) : text ? (
        <Markdown content={text} />
      ) : (
        <p className="muted">—</p>
      )}
      {(error || review) && (
        <p role="alert">
          {error || "Recovered draft — review before saving."}
          <details>
            <summary>Compare saved text</summary>
            <Markdown content={initial} />
          </details>
          <Button
            variant="ghost"
            onClick={() => {
              blocked.current = false;
              setReview(false);
              setError("");
              void save();
            }}
          >
            Keep reviewed draft
          </Button>
        </p>
      )}
    </section>
  );
}

function InlineStoryCard({
  story,
  handle,
  autoFocus,
}: {
  story: WorkRecord;
  handle: React.ReactNode;
  autoFocus: boolean;
}) {
  const { create, update, remove } = useWorkspace();
  const { editing } = useEditMode();
  const ref = useRef(story);
  ref.current = story;
  const write = useMemo(
    () =>
      contentRecordWriter({
        read: () => ref.current,
        input: () => ({
          kind: "story",
          title: ref.current.title,
          tags: ref.current.tags,
          data: ref.current.data,
        }),
        create,
        update,
      }),
    [create, update],
  );
  return (
    <Card className="interview-story-card">
      <header className="content-section-heading">
        <h3>
          {handle}
          <InlineTitle
            label="Story title"
            value={story.title}
            autoFocus={autoFocus}
            onSave={(title) => write({ title })}
          />
        </h3>
        {editing && (
          <DeleteControl
            label="Delete story"
            onDelete={() => remove(story.id)}
          />
        )}
      </header>
      {story.tags.length > 0 && (
        <div className="interview-story-tags">
          {story.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      )}
      {editing && <StoryCompetencies story={story} write={write} />}
      {["situation", "task", "action", "result", "lessons"].map((name) => (
        <StoryField key={name} story={story} name={name} write={write} />
      ))}
    </Card>
  );
}

function StoryCompetencies({
  story,
  write,
}: {
  story: WorkRecord;
  write: (patch: RecordPatch) => Promise<WorkRecord>;
}) {
  const [value, setValue] = useState(story.tags.join(", "));
  const saved = useRef(story.tags.join(", "));
  useEffect(() => {
    const next = story.tags.join(", ");
    if (next !== saved.current) {
      saved.current = next;
      setValue(next);
    }
  }, [story.tags]);
  return (
    <label className="interview-story-competencies">
      <span>Competencies</span>
      <Input
        aria-label="Story competencies"
        placeholder="e.g. communication, ownership"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          const tags = [
            ...new Set(
              value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ];
          const next = tags.join(", ");
          if (next === saved.current) return;
          void write({ tags }).then(() => {
            saved.current = next;
          });
        }}
      />
      <small>Separate competencies with commas.</small>
    </label>
  );
}

export function StoryBank({
  onEdit: _onEdit,
}: {
  onEdit?: (record?: WorkRecord) => void;
}) {
  const workspace = useWorkspace();
  const { records, create, notify } = workspace;
  const { editing } = useEditMode();
  const [query, setQuery] = useState(""),
    [tag, setTag] = useState(""),
    [newId, setNewId] = useState("");
  const stories = orderedRecords(
    records.filter((record) => storyMatches(record, query, tag)),
  );
  const tags = [
    ...new Set(
      records
        .filter((record) => record.kind === "story")
        .flatMap((record) => record.tags),
    ),
  ].sort();
  return (
    <section className="interview-story-bank">
      <header className="content-panel-heading">
        <h2>Story bank</h2>
        {editing && (
          <Button
            onClick={async () => {
              try {
                const record = await create({
                  kind: "story",
                  title: "Untitled",
                  tags: [],
                  data: {
                    situation: "",
                    task: "",
                    action: "",
                    result: "",
                    lessons: "",
                    order: stories.length,
                  },
                });
                setNewId(record.id);
              } catch (failure) {
                notify(
                  failure instanceof Error
                    ? failure.message
                    : "Story could not be created.",
                  "error",
                );
              }
            }}
          >
            <Plus size={16} />
            Add STAR story
          </Button>
        )}
      </header>
      <div className="interview-story-filters">
        <Input
          aria-label="Search stories"
          placeholder="Search stories"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="Filter story competency"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
        >
          <option value="">All competencies</option>
          {tags.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
      </div>
      <SortableList
        className="interview-story-grid"
        items={stories}
        onReorder={async (ids) => {
          await reorderRecords(
            ids.map((id) => stories.find((item) => item.id === id)!),
            workspace,
          );
        }}
      >
        {(story, handle) => (
          <InlineStoryCard
            story={story}
            handle={handle}
            autoFocus={story.id === newId}
          />
        )}
      </SortableList>
      {!stories.length && (
        <p className="muted">
          {query || tag
            ? "No matching stories."
            : "Your stories will appear here."}
        </p>
      )}
    </section>
  );
}
export function StoryContent({
  story,
}: {
  story: WorkRecord;
  onOpen?: () => void;
}) {
  return (
    <div className="interview-story-content">
      <h3>{story.title}</h3>
      {["situation", "task", "action", "result", "lessons"].map((key) => (
        <section key={key}>
          <h4>{key[0].toUpperCase() + key.slice(1)}</h4>
          <Markdown
            content={
              field(story, key) ||
              (key === "lessons" ? field(story, "reflection") : "")
            }
          />
        </section>
      ))}
      {story.body && <Markdown content={story.body} />}
    </div>
  );
}
