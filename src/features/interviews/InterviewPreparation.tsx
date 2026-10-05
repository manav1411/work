import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  interviewPreparation,
  legacyInterviewPreparation,
} from "../../../shared/content";
import { arrayField, field, type WorkRecord } from "../../../shared/model";
import { Badge, Button, Card } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { AutosaveNote } from "../content/AutosaveNote";
import { ContentPanel } from "../content/ContentPanel";
import { contentRecordWriter } from "../content/recordWriter";
import {
  applicationCompany,
  interviewTime,
} from "../search/applicationRecords";
import { StoryContent } from "./StoryBank";

export function InterviewPreparation({
  interview,
  onEditStory,
}: {
  interview: WorkRecord;
  onEditStory: (record?: WorkRecord) => void;
}) {
  const { records, create, update, preferences } = useWorkspace();
  const { editing } = useEditMode();
  const prep = interviewPreparation(records, interview);
  const application = records.find(
    (record) =>
      record.kind === "application" &&
      (record.id === field(interview, "applicationId") ||
        (!field(interview, "applicationId") &&
          interview.links.includes(record.id))),
  );
  const stories = records.filter(
    (record) => record.kind === "story" && !record.deletedAt,
  );
  const selected = prep
    ? arrayField(prep, "storyIds")
    : stories
        .filter((story) => interview.links.includes(story.id))
        .map((story) => story.id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const data = {
    category: "interview-preparation",
    interviewId: interview.id,
    ...(application ? { applicationId: application.id } : {}),
    storyIds: selected,
  };
  const prepRef = useRef(prep);
  prepRef.current = prep;
  const inputRef = useRef({
    kind: "note" as const,
    title: `${interview.title} preparation`,
    body: legacyInterviewPreparation(interview),
    data,
  });
  inputRef.current = {
    kind: "note",
    title: `${interview.title} preparation`,
    body: legacyInterviewPreparation(interview),
    data,
  };
  const write = useMemo(
    () =>
      contentRecordWriter({
        read: () => prepRef.current,
        input: () => inputRef.current,
        create,
        update,
      }),
    [create, update],
  );
  async function toggleStory(id: string) {
    setError("");
    setBusy(true);
    const storyIds = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id];
    try {
      await write({ data: { ...data, storyIds } });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Story selection could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="interview-preparation">
      <header className="interview-preparation-heading">
        <div>
          <p className="eyebrow">Appointment preparation</p>
          <h2>{interview.title}</h2>
          {application && (
            <p>
              {applicationCompany(application, records)} · {application.title}
            </p>
          )}
          <p className="muted">
            {interviewTime(
              interview,
              field(interview, "timezone", preferences.timezone),
            )}
          </p>
          <Badge
            tone={field(interview, "status") === "Cancelled" ? "muted" : "blue"}
          >
            {field(interview, "status", "Scheduled")}
          </Badge>
        </div>
        <Link
          className="button button-secondary"
          to={`/applications?interview=${encodeURIComponent(interview.id)}`}
        >
          Appointment details
        </Link>
      </header>
      <Card className="interview-intro">
        <h3>Things to keep in mind</h3>
        <AutosaveNote
          key={interview.id}
          record={prep}
          input={{
            kind: "note",
            title: `${interview.title} preparation`,
            data,
          }}
          persist={(body, expectedVersion) => write({ body }, expectedVersion)}
          initialBody={legacyInterviewPreparation(interview)}
          draftKey={`interview:${interview.id}`}
          label="Interview preparation"
        />
      </Card>
      <ContentPanel
        context={{
          scope: "interviews",
          interviewId: interview.id,
          ...(application ? { applicationId: application.id } : {}),
        }}
      />
      <section className="interview-selected-stories">
        <header className="content-panel-heading">
          <h3>Stories for this interview</h3>
          {editing && (
            <Button variant="ghost" onClick={() => onEditStory()}>
              Add a story to your bank
            </Button>
          )}
        </header>
        {error && <p role="alert">{error}</p>}
        {editing && stories.length > 0 ? (
          <details className="interview-story-picker">
            <summary>
              Choose from your story bank ({selected.length} selected)
            </summary>
            {stories.map((story) => (
              <label key={story.id}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.includes(story.id)}
                  onChange={() => void toggleStory(story.id)}
                />
                <span>{story.title}</span>
                <small>{story.tags.join(" · ")}</small>
              </label>
            ))}
          </details>
        ) : stories.length === 0 ? (
          <p className="muted">Create a STAR story, then reuse it here.</p>
        ) : null}
        <div className="interview-story-grid">
          {selected.map((id) => {
            const story = stories.find((item) => item.id === id);
            return story ? (
              <Card key={id} className="interview-story-card">
                <StoryContent story={story} />
                {editing && (
                  <Button variant="ghost" onClick={() => onEditStory(story)}>
                    Edit original story
                  </Button>
                )}
              </Card>
            ) : (
              <Card key={id}>
                <p className="muted">This story is no longer available.</p>
                {editing && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void toggleStory(id)}
                  >
                    Delete reference
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </section>
    </section>
  );
}
