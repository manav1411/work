import { useState } from "react";
import { Copy, Pencil, Plus } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Markdown,
  Modal,
  Select,
  Textarea,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { splitTags } from "../prepare/helpers";
import { DeleteControl } from "../content/DeleteControl";
import { storyMatches } from "./domain";

export function StoryBank({
  onEdit,
}: {
  onEdit: (record?: WorkRecord) => void;
}) {
  const { records, create, remove, notify } = useWorkspace();
  const { editing } = useEditMode();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [duplicating, setDuplicating] = useState("");
  const stories = records.filter((record) => storyMatches(record, query, tag));
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
        <div>
          <p className="eyebrow">Situation · Task · Action · Result</p>
          <h2>Story bank</h2>
        </div>
        {editing && (
          <Button onClick={() => onEdit()}>
            <Plus size={16} />
            Add STAR story
          </Button>
        )}
      </header>
      <div className="interview-story-filters">
        <Input
          aria-label="Search stories"
          placeholder="Search your stories"
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
      {stories.length ? (
        <div className="interview-story-grid">
          {stories.map((story, index) => (
            <Card
              key={story.id}
              className={`interview-story-card application-row-action content-tone-${index % 4}`}
              onClick={(event) => {
                if (
                  (event.target as HTMLElement).closest(
                    "button,a,input,select,textarea",
                  ) ||
                  window.getSelection()?.toString()
                )
                  return;
                onEdit(story);
              }}
            >
              <StoryContent story={story} onOpen={() => onEdit(story)} />
              {editing && (
                <div className="content-item-actions">
                  <Button variant="ghost" onClick={() => onEdit(story)}>
                    <Pencil size={15} />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!!duplicating}
                    onClick={async () => {
                      setDuplicating(story.id);
                      try {
                        await create({
                          kind: "story",
                          title: `${story.title} (copy)`,
                          body: story.body,
                          tags: story.tags,
                          links: [],
                          data: { ...story.data },
                        });
                        notify("Story duplicated.");
                      } catch (failure) {
                        notify(
                          failure instanceof Error
                            ? failure.message
                            : "Story could not be duplicated.",
                          "error",
                        );
                      } finally {
                        setDuplicating("");
                      }
                    }}
                  >
                    <Copy size={15} />
                    Duplicate
                  </Button>
                  <DeleteControl
                    label="Delete story"
                    onDelete={() => remove(story.id)}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            query || tag
              ? "No matching stories"
              : "Make room for your experience"
          }
          description={
            query || tag
              ? "Try another phrase or competency."
              : "Build a few reusable stories about ownership, conflict, collaboration, and what you learned."
          }
        />
      )}
    </section>
  );
}
export function StoryContent({
  story,
  onOpen,
}: {
  story: WorkRecord;
  onOpen?: () => void;
}) {
  return (
    <div className="interview-story-content">
      <h3>
        {onOpen ? (
          <button className="story-open" onClick={onOpen}>
            {story.title}
          </button>
        ) : (
          story.title
        )}
      </h3>
      {story.tags.length > 0 && (
        <div className="interview-story-tags">
          {story.tags.map((tag) => (
            <Badge key={tag} tone="blue">
              {tag}
            </Badge>
          ))}
        </div>
      )}
      {["situation", "task", "action", "result", "lessons"].map(
        (key) =>
          (field(story, key) ||
            (key === "lessons" && field(story, "reflection"))) && (
            <section key={key}>
              <h4>
                {key === "lessons"
                  ? "Lessons"
                  : key[0].toUpperCase() + key.slice(1)}
              </h4>
              <Markdown
                content={
                  field(story, key) ||
                  (key === "lessons" ? field(story, "reflection") : "")
                }
              />
            </section>
          ),
      )}
      {story.body && <Markdown content={story.body} />}
    </div>
  );
}
export function StoryEditor({
  record,
  onClose,
}: {
  record?: WorkRecord;
  onClose: () => void;
}) {
  const { editing } = useEditMode();
  const { create, update } = useWorkspace();
  const [title, setTitle] = useState(record?.title ?? "");
  const [tags, setTags] = useState(record?.tags.join(", ") ?? "");
  const [body, setBody] = useState(record?.body ?? "");
  const [fields, setFields] = useState(
    Object.fromEntries(
      ["situation", "task", "action", "result", "lessons"].map((key) => [
        key,
        field(record, key) ||
          (key === "lessons" ? field(record, "reflection") : ""),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!editing)
    return record ? (
      <Modal open onClose={onClose} title={record.title} size="wide">
        <StoryContent story={record} />
      </Modal>
    ) : null;
  return (
    <Modal
      open
      onClose={onClose}
      title={record ? "Edit STAR story" : "Add STAR story"}
      size="wide"
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const input = {
              title: title.trim(),
              body,
              tags: splitTags(tags),
              data: { ...record?.data, ...fields },
            };
            if (record) await update(record.id, input);
            else await create({ kind: "story", ...input });
            onClose();
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Story could not be saved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Story title">
          <Input
            autoFocus
            required
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field
          label="Competencies"
          hint="Comma-separated: ownership, conflict, collaboration, ambiguity…"
        >
          <Input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </Field>
        {Object.keys(fields).map((key) => (
          <Field
            key={key}
            label={
              key[0].toUpperCase() +
              key.slice(1) +
              (key === "lessons" ? " (optional)" : "")
            }
          >
            <Textarea
              rows={key === "action" ? 5 : 3}
              value={fields[key]}
              onChange={(event) =>
                setFields({ ...fields, [key]: event.target.value })
              }
            />
          </Field>
        ))}
        <Field label="Other notes (optional)">
          <Textarea
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        {error && <p role="alert">{error}</p>}
        <div className="inline-actions">
          <Button disabled={busy || !title.trim()}>
            {busy ? "Saving…" : "Save story"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
