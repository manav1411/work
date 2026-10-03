import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import {
  field,
  numberField,
  recordUrl,
  type WorkRecord,
} from "../../../shared/model";
import {
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Select,
  Textarea,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";

export function FocusPage() {
  const { records, create, update, notify, preferences, mode, user } =
    useWorkspace();
  const [params] = useSearchParams();
  const [actionId, setActionId] = useState(params.get("action") ?? "");
  const [minutes, setMinutes] = useState(
    Math.max(2, Math.min(120, Number(params.get("minutes")) || 15)),
  );
  const [notes, setNotes] = useState(
    () =>
      localStorage.getItem(`work-focus-draft:${mode}:${user?.id}:new`) ?? "",
  );
  const [completeAction, setCompleteAction] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const action = records.find(
    (record) => record.id === actionId && record.kind === "action",
  );
  const session = records
    .filter(
      (record) =>
        record.kind === "focus" && field(record, "status") !== "completed",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const active = session && field(session, "status") === "active";
  const started = session ? Date.parse(field(session, "startedAt")) : 0;
  const elapsed = session
    ? numberField(session, "elapsedSeconds") +
      (active && Number.isFinite(started)
        ? Math.max(0, Math.floor((now - started) / 1000))
        : 0)
    : 0;
  const duration = session
    ? numberField(session, "targetMinutes", minutes)
    : minutes;
  const remaining = Math.max(0, duration * 60 - elapsed);
  const chosenAction =
    records.find((record) => record.id === field(session, "actionId")) ??
    action;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const draftKey = `work-focus-draft:${mode}:${user?.id}:${session?.id ?? "new"}`;
  useEffect(() => {
    if (session) setNotes(localStorage.getItem(draftKey) ?? session.body);
  }, [session?.id]);
  const changeNotes = (value: string) => {
    setNotes(value);
    try {
      localStorage.setItem(draftKey, value);
    } catch {
      notify(
        "Device storage is full. Save your session notes before leaving.",
        "error",
      );
    }
  };
  const save = async (status: string) => {
    setBusy(true);
    try {
      if (!session) {
        const created = await create({
          kind: "focus",
          title: action?.title ?? "A little focused work",
          body: notes,
          links: action ? [action.id] : [],
          data: {
            actionId,
            status: "active",
            targetMinutes: minutes,
            elapsedSeconds: 0,
            startedAt: new Date().toISOString(),
          },
        });
        if (action)
          await update(action.id, {
            data: { ...action.data, status: "doing" },
          });
        setNotes(created.body);
        localStorage.removeItem(`work-focus-draft:${mode}:${user?.id}:new`);
      } else {
        await update(session.id, {
          body: notes,
          data: {
            ...session.data,
            status,
            elapsedSeconds: elapsed,
            startedAt: status === "active" ? new Date().toISOString() : "",
            completedAt: status === "completed" ? new Date().toISOString() : "",
          },
        });
        localStorage.removeItem(draftKey);
        if (status === "completed") {
          if (completeAction && chosenAction?.kind === "action")
            await update(chosenAction.id, {
              data: {
                ...chosenAction.data,
                status: "done",
                completedAt: new Date().toISOString(),
              },
            });
          setNotes("");
          setCompleteAction(false);
          notify("Work saved. You can pick it up from here.");
        }
      }
      setNow(Date.now());
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save your session.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const history = records
    .filter(
      (record) =>
        record.kind === "focus" && field(record, "status") === "completed",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="page-stack focus-page">
      <PageHeader
        eyebrow="MAKE A LITTLE ROOM"
        title="One thing at a time"
        description="A small stretch of attention. A place to leave your thoughts."
        action={
          <Link className="text-link" to="/today">
            <ArrowLeft size={16} />
            Back to Today
          </Link>
        }
      />
      <div className="focus-layout">
        <Card className="focus-timer-card">
          <div className="section-kicker">
            <span className={active ? "status-dot" : ""} />
            {active
              ? "IN PROGRESS"
              : session
                ? "PAUSED · YOUR WORK IS SAFE"
                : "YOUR SPACE TO FOCUS"}
          </div>
          <div
            className="focus-time"
            role="timer"
            aria-label={`${Math.floor(remaining / 60)} minutes and ${remaining % 60} seconds remaining`}
          >
            {Math.floor(remaining / 60)
              .toString()
              .padStart(2, "0")}
            <span>:</span>
            {(remaining % 60).toString().padStart(2, "0")}
          </div>
          <p>
            {remaining === 0 && session
              ? "Your time is up. Finish a thought, then choose what’s next."
              : "Start small. Keep a useful next step close."}
          </p>
          {!session && (
            <div className="time-options">
              {[5, 15, 30, 60].map((value) => (
                <button
                  key={value}
                  className={minutes === value ? "selected" : ""}
                  onClick={() => setMinutes(value)}
                >
                  {value} min
                </button>
              ))}
            </div>
          )}
          <div className="focus-controls">
            {active ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void save("paused")}
              >
                <Pause size={17} />
                Pause
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void save("active")}>
                <Play size={17} fill="currentColor" />
                {session ? "Keep going" : "Start a little focus"}
              </Button>
            )}
            {session && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void save("completed")}
              >
                <Check size={17} />
                Done for now
              </Button>
            )}
          </div>
          {session && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={completeAction}
                onChange={(event) => setCompleteAction(event.target.checked)}
              />
              I finished the linked action
            </label>
          )}
          <div className="focus-elapsed">
            <Clock3 size={14} />
            {Math.floor(elapsed / 60)} minutes of work, preserved
          </div>
        </Card>
        <div className="stack">
          <Card>
            <div className="section-heading">
              <h2>Keep it concrete</h2>
              <Badge tone="lime">Next step</Badge>
            </div>
            {chosenAction ? (
              <>
                <h3>{chosenAction.title}</h3>
                <p className="first-step-callout">
                  {field(chosenAction, "firstStep") ||
                    chosenAction.body ||
                    "Start with one sentence. Then decide what follows."}
                </p>
                <div className="related-links">
                  {chosenAction.links
                    .map((id) => records.find((record) => record.id === id))
                    .filter((record): record is WorkRecord => Boolean(record))
                    .map((record) => (
                      <Link key={record.id} to={recordUrl(record)}>
                        {record.title}
                        <ArrowRight size={14} />
                      </Link>
                    ))}
                </div>
              </>
            ) : (
              <>
                <p className="muted">
                  Choose a next action, or use this time for any worthwhile
                  work.
                </p>
                <Select
                  aria-label="Action to focus on"
                  value={actionId}
                  disabled={Boolean(session)}
                  onChange={(event) => setActionId(event.target.value)}
                >
                  <option value="">Open focus session</option>
                  {records
                    .filter(
                      (record) =>
                        record.kind === "action" &&
                        field(record, "status") !== "done",
                    )
                    .map((record) => (
                      <option key={record.id} value={record.id}>
                        {record.title}
                      </option>
                    ))}
                </Select>
              </>
            )}
          </Card>
          <Card>
            <Field
              label="Your thinking, as you go"
              hint="Drafts recover on this device. Synced when you pause, finish or save."
            >
              <Textarea
                rows={8}
                value={notes}
                onChange={(event) => changeNotes(event.target.value)}
                placeholder="What did you try? What helped? Where will you pick it up?"
              />
            </Field>
            {session && (
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await update(session.id, { body: notes });
                    notify("Session notes saved.");
                  } catch (error) {
                    notify(String(error), "error");
                  }
                }}
              >
                <Check size={15} />
                Save these thoughts
              </Button>
            )}
          </Card>
        </div>
      </div>
      {history.length > 0 && (
        <section>
          <div className="section-heading">
            <h2>Your recent sessions</h2>
            <RotateCcw size={18} />
          </div>
          <div className="card-grid">
            {history.slice(0, 6).map((record) => (
              <Card key={record.id}>
                <Badge>
                  {Math.floor(numberField(record, "elapsedSeconds") / 60)} min
                </Badge>
                <h3>{record.title}</h3>
                <p className="muted">
                  {new Intl.DateTimeFormat("en-AU", {
                    dateStyle: "medium",
                    timeZone: preferences.timezone,
                  }).format(new Date(record.updatedAt))}
                </p>
                {record.body && <p>{record.body.slice(0, 180)}</p>}
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
