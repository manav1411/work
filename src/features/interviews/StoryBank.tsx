import { useRef, useState, useEffect, useMemo } from "react";
import { ChevronDown, Plus } from "lucide-react";
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
import { useAutosave } from "../../lib/autosave";
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
  expanded,
}: {
  story: WorkRecord;
  name: string;
  write: (patch: RecordPatch) => Promise<WorkRecord>;
  expanded: boolean;
}) {
  const { editing } = useEditMode();
  const { user, isPending, refresh } = useWorkspace();
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
  const draft = useAutosave({
    initial,
    version: story.version,
    storageKey: draftKey,
    pending: isPending(story.id),
    refresh,
    decodeLegacy: (raw) =>
      typeof raw === "string" ? { value: raw } : undefined,
    persist: async (text) => {
      // The writer serializes the five STAR fields on one record and rebases
      // each partial field patch on the latest captured record version.
      const saved = await write({
        data: {
          [name]: text,
          ...(name === "lessons" ? { otherNotesMigrated: true } : {}),
        },
      });
      return {
        version: saved.version,
        value:
          name === "lessons"
            ? field(saved, "lessons") || field(saved, "reflection")
            : field(saved, name),
        offline: isPending(saved.id),
      };
    },
  });
  const text = draft.value;
  return (
    <section className="inline-star-field" data-field={name}>
      <h4>{name[0].toUpperCase() + name.slice(1)}</h4>
      <div className="inline-star-field-content" hidden={!expanded}>
        {editing ? (
          <textarea
            aria-label={name[0].toUpperCase() + name.slice(1)}
            className="inline-star-text"
            rows={Math.min(12, Math.max(2, text.split("\n").length))}
            value={text}
            placeholder={
              name === "lessons" ? "What you learned…" : `Write the ${name}…`
            }
            onBlur={() => void draft.flush()}
            onChange={(event) => {
              draft.setValue(event.target.value);
            }}
          />
        ) : text ? (
          <Markdown content={text} />
        ) : (
          <p className="muted">—</p>
        )}
      </div>
      {draft.state !== "Saved" && !draft.conflict && (
        <small className="muted" role="status">
          {draft.state}
        </small>
      )}
      {draft.conflict && (
        <div className="form-error" role="alert">
          <p>{draft.error || "This story changed elsewhere."}</p>
          <details>
            <summary>Compare saved text</summary>
            <Markdown content={initial} />
          </details>
          <Button variant="ghost" onClick={() => void draft.keepLocal()}>
            Keep my changes
          </Button>
          <Button variant="ghost" onClick={draft.useSaved}>
            Use saved version
          </Button>
        </div>
      )}
      {draft.error && !draft.conflict && (
        <p className="form-error" role="alert">
          {draft.error}
          <Button variant="ghost" onClick={() => void draft.flush()}>
            Retry
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
  const [expanded, setExpanded] = useState(false);
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
            version={story.version}
            draftKey={`story-title:${story.id}`}
            autoFocus={autoFocus}
            onSave={(title, version) => write({ title }, version)}
          />
        </h3>
        <div className="interview-story-header-actions">
          {editing && (
            <DeleteControl
              label="Delete story"
              onDelete={() => remove(story.id)}
            />
          )}
          <Button
            variant="ghost"
            className="icon-button interview-story-toggle"
            aria-label={`${expanded ? "Collapse" : "Expand"} STAR story ${story.title}`}
            aria-expanded={expanded}
            aria-controls={`star-story-content-${story.id}`}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown size={18} />
          </Button>
        </div>
      </header>
      <div className="interview-story-tags">
        <span className="interview-story-competency-label">Competencies</span>
        {story.tags.length > 0 ? (
          story.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
        ) : (
          <span className="muted">—</span>
        )}
      </div>
      {editing && <StoryCompetencies story={story} write={write} />}
      <div
        id={`star-story-content-${story.id}`}
        className="interview-story-fields"
      >
        {["situation", "task", "action", "result", "lessons"].map((name) => (
          <StoryField
            key={name}
            story={story}
            name={name}
            write={write}
            expanded={expanded}
          />
        ))}
      </div>
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
          className="story-competency-filter"
          contentClassName="story-competency-options"
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
