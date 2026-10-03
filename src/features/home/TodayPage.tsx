import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowRight,
  Bookmark,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Coffee,
  Flag,
  MoreHorizontal,
  Play,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import {
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
  Modal,
  PageHeader,
  RecordLinks,
  Select,
  Textarea,
} from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { agendaItems, rankedActions, weeklyStats } from "./domain";

export function TodayPage() {
  const {
    records,
    preferences,
    create,
    update,
    remove,
    initialize,
    notify,
    pending,
  } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const openedId = useRef("");
  const [minutes, setMinutes] = useState(15);
  const [energy, setEnergy] = useState("Ready");
  const [editor, setEditor] = useState<WorkRecord | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    body: "",
    firstStep: "",
    dueDate: "",
    estimatedMinutes: 15,
    priority: "normal",
    pinned: false,
    links: [] as string[],
  });
  const today = localDate(new Date(), preferences.timezone);
  const actions = rankedActions(
    records,
    energy === "Low battery" ? Math.min(minutes, 15) : minutes,
    today,
  );
  const chosen = actions[0];
  const stats = weeklyStats(records, preferences.timezone);
  const agenda = agendaItems(records, preferences.timezone);
  const open = (record: WorkRecord | "new") => {
    setEditor(record);
    setForm(
      record === "new"
        ? {
            title: "",
            body: "",
            firstStep: "",
            dueDate: "",
            estimatedMinutes: 15,
            priority: "normal",
            pinned: false,
            links: [],
          }
        : {
            title: record.title,
            body: record.body,
            firstStep: field(record, "firstStep"),
            dueDate: field(record, "dueDate"),
            estimatedMinutes: numberField(record, "estimatedMinutes", 15),
            priority: field(record, "priority", "normal"),
            pinned: record.data.pinned === true,
            links: record.links,
          },
    );
  };
  const save = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const data = {
        ...(editor && editor !== "new" ? editor.data : {}),
        firstStep: form.firstStep,
        dueDate: form.dueDate,
        estimatedMinutes: form.estimatedMinutes,
        priority: form.priority,
        pinned: form.pinned,
        status:
          editor && editor !== "new" ? field(editor, "status", "todo") : "todo",
      };
      const input = {
        title: form.title.trim(),
        body: form.body,
        data,
        links: form.links,
      };
      if (editor === "new") await create({ kind: "action", ...input });
      else if (editor) await update(editor.id, input);
      setEditor(null);
      notify("A little clarity. A useful next step.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save this action.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const complete = async (record: WorkRecord) => {
    try {
      await update(record.id, {
        data: {
          ...record.data,
          status: "done",
          completedAt: new Date().toISOString(),
        },
      });
      notify("One useful thing, done.");
    } catch (error) {
      notify(String(error), "error");
    }
  };
  const completed = records.filter(
    (record) => record.kind === "action" && field(record, "status") === "done",
  );
  useEffect(() => {
    const id = params.get("record") ?? "";
    if (!id) {
      openedId.current = "";
      return;
    }
    const record = records.find(
      (item) => item.id === id && item.kind === "action",
    );
    if (record && openedId.current !== id) {
      openedId.current = id;
      open(record);
    }
  }, [params, records]);
  const day = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: preferences.timezone,
  }).format(new Date());
  return (
    <div className="page-stack today-page">
      <PageHeader
        eyebrow={day}
        title={`Hey, ${preferences.displayName || "you"}`}
        description="Good things happen one small move at a time."
        action={
          <Button variant="secondary" onClick={() => open("new")}>
            <Plus size={17} />
            Add an action
          </Button>
        }
      />
      {pending > 0 && (
        <div className="notice notice-warning">
          <Clock3 size={17} />
          {pending} change{pending === 1 ? "" : "s"} saved on this device,
          waiting to sync.
        </div>
      )}
      {records.length === 0 ? (
        <Card className="welcome-card">
          <Sparkles size={38} />
          <h2>Make room for your next chapter.</h2>
          <p>
            A private home for your ideas, preparation, applications, and the
            work you're proud of. Start with a few useful templates and your
            career direction.
          </p>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await initialize();
              } catch (error) {
                notify(String(error), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Set up my workspace
            <ArrowRight size={17} />
          </Button>
          <Link to="/settings/import-export">
            Or bring in your existing notes
            <ChevronRight size={16} />
          </Link>
        </Card>
      ) : (
        <>
          <div className="today-top-grid">
            <section className="next-move-card">
              <div className="hero-top">
                <span className="hero-kicker">
                  <span className="status-dot" />
                  YOUR NEXT MOVE
                </span>
                <ArrowDownRight size={30} />
              </div>
              <div className="time-options" aria-label="Time available">
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
              {chosen ? (
                <>
                  <h2>{chosen.record.title}</h2>
                  <p className="hero-first-step">
                    {field(
                      chosen.record,
                      "firstStep",
                      chosen.record.body ||
                        "Take one small step. Save your thinking as you go.",
                    )}
                  </p>
                  <div className="hero-reason">
                    <Sparkles size={14} />
                    {chosen.reason}
                  </div>
                  <div className="hero-bottom">
                    <Button
                      onClick={() =>
                        navigate(
                          `/focus?action=${chosen.record.id}&minutes=${minutes}`,
                        )
                      }
                    >
                      <Play size={17} fill="currentColor" />
                      Let's do this
                      <ArrowRight size={18} />
                    </Button>
                    <button
                      className="hero-edit"
                      onClick={() => open(chosen.record)}
                    >
                      Make it smaller
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>
                    A clean slate.
                    <br />
                    What’s next?
                  </h2>
                  <p className="hero-first-step">
                    Your queue is clear. Capture something worth working on, or
                    take a well-earned pause.
                  </p>
                  <Button onClick={() => open("new")}>
                    <Plus size={17} />
                    Choose a next move
                  </Button>
                </>
              )}
              <div className="hero-doodle" aria-hidden="true">
                <span>↗</span>
                <i />
              </div>
            </section>
            <Card className="chapter-card">
              <div className="section-kicker">
                <Flag size={15} />
                THE BIGGER PICTURE
              </div>
              <span className="chapter-sticker" aria-hidden="true">
                NEXT
                <br />
                CHAPTER
              </span>
              <h2>
                Good work.
                <br /> New possibilities.
              </h2>
              <p>
                Software engineering. Big tech. A life chapter worth choosing.
              </p>
              <div className="chapter-deadline">
                <CalendarDays size={17} />
                <div>
                  <strong>February 2027</strong>
                  <span>Your next-chapter decision</span>
                </div>
              </div>
              <Link className="text-link" to="/career">
                See your direction
                <ArrowRight size={17} />
              </Link>
            </Card>
          </div>
          <div className="today-bottom-grid">
            <section>
              <div className="section-heading">
                <h2>A little momentum</h2>
                <span className="muted">This week</span>
              </div>
              <div className="momentum-grid">
                {[
                  {
                    number: stats.actions,
                    label: "Actions finished",
                    icon: Check,
                    tone: "lime",
                  },
                  {
                    number: stats.practice,
                    label: "Practice attempts",
                    icon: Play,
                    tone: "blue",
                  },
                  {
                    number: stats.applications,
                    label: "Applications sent",
                    icon: ArrowRight,
                    tone: "pink",
                  },
                  {
                    number: stats.evidence,
                    label: "Wins captured",
                    icon: Bookmark,
                    tone: "orange",
                  },
                ].map((item) => (
                  <div
                    className={`momentum-stat momentum-${item.tone}`}
                    key={item.label}
                  >
                    <item.icon size={17} />
                    <strong>{item.number}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </section>
            <Card className="energy-card">
              <Coffee size={26} />
              <div>
                <strong>Meet yourself where you are.</strong>
                <p>Small moves count. Choose what fits.</p>
                <div
                  className="segmented-control"
                  aria-label="Energy available"
                >
                  {["Low battery", "Ready", "In the zone"].map((value) => (
                    <button
                      className={energy === value ? "active" : ""}
                      key={value}
                      onClick={() => setEnergy(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          </div>
          <div className="today-content-grid">
            <section>
              <div className="section-heading">
                <h2>
                  On your list<Badge>{actions.length}</Badge>
                </h2>
                <button className="text-button" onClick={() => open("new")}>
                  <Plus size={16} />
                  Add
                </button>
              </div>
              <div className="action-list">
                {actions.slice(0, 8).map(({ record }) => (
                  <div className="action-row" key={record.id}>
                    <button
                      className="action-check"
                      aria-label={`Complete ${record.title}`}
                      onClick={() => void complete(record)}
                    >
                      <Check size={15} />
                    </button>
                    <button
                      className="action-row-content"
                      onClick={() =>
                        navigate(
                          `/focus?action=${record.id}&minutes=${minutes}`,
                        )
                      }
                    >
                      <strong>{record.title}</strong>
                      <span>
                        {field(record, "firstStep") || record.body.slice(0, 90)}
                      </span>
                    </button>
                    <span className="action-time">
                      <Clock3 size={13} />
                      {numberField(record, "estimatedMinutes", 15)}m
                    </span>
                    <Button
                      variant="ghost"
                      className="icon-button"
                      aria-label={`Edit ${record.title}`}
                      onClick={() => open(record)}
                    >
                      <MoreHorizontal size={19} />
                    </Button>
                  </div>
                ))}
                {actions.length === 0 && (
                  <EmptyState
                    title="All clear for now"
                    description="Keep a next step close, or make room for a break."
                  />
                )}
              </div>
              {completed.length > 0 && (
                <details className="completed-list">
                  <summary>
                    <Check size={14} />
                    {completed.length} completed action
                    {completed.length === 1 ? "" : "s"}
                  </summary>
                  {completed
                    .slice(-8)
                    .reverse()
                    .map((record) => (
                      <div className="completed-row" key={record.id}>
                        <span>{record.title}</span>
                        <button
                          className="text-button"
                          onClick={() =>
                            void update(record.id, {
                              data: {
                                ...record.data,
                                status: "todo",
                                completedAt: "",
                              },
                            })
                          }
                        >
                          Reopen
                        </button>
                      </div>
                    ))}
                </details>
              )}
            </section>
            <section>
              <div className="section-heading">
                <h2>Coming up</h2>
                <CalendarDays size={18} />
              </div>
              <Card className="agenda-card">
                {agenda.length ? (
                  agenda.slice(0, 5).map((item) => (
                    <Link
                      className="agenda-row"
                      to={recordUrl(item.record)}
                      key={item.id}
                    >
                      <span className="agenda-date">
                        {niceDate(item.date, preferences.timezone)}
                      </span>
                      <span>
                        <small>{item.kind}</small>
                        <strong>{item.title}</strong>
                      </span>
                      <ChevronRight size={16} />
                    </Link>
                  ))
                ) : (
                  <div className="agenda-empty">
                    <CalendarDays size={28} />
                    <strong>A little breathing room.</strong>
                    <p>
                      Your upcoming interviews, deadlines, and follow-ups will
                      land here.
                    </p>
                  </div>
                )}
              </Card>
              <Link to="/review" className="weekly-prompt">
                <span>
                  <strong>Make a little space to reflect.</strong>
                  <small>Your weekly review brings it all together.</small>
                </span>
                <ArrowRight size={21} />
              </Link>
            </section>
          </div>
        </>
      )}
      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={
          editor === "new"
            ? "One useful next step"
            : "Make this action work for you"
        }
      >
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label="What would you like to do?">
            <Input
              autoFocus
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
              required
              placeholder="Write one résumé bullet"
            />
          </Field>
          <Field label="The smallest first step">
            <Input
              value={form.firstStep}
              onChange={(event) =>
                setForm({ ...form, firstStep: event.target.value })
              }
              placeholder="Open the draft and write one sentence"
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={form.body}
              onChange={(event) =>
                setForm({ ...form, body: event.target.value })
              }
              rows={3}
            />
          </Field>
          <div className="form-grid">
            <Field label="Minutes">
              <Input
                type="number"
                min="2"
                max="240"
                value={form.estimatedMinutes}
                onChange={(event) =>
                  setForm({
                    ...form,
                    estimatedMinutes: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Due date">
              <Input
                type="date"
                value={form.dueDate}
                onChange={(event) =>
                  setForm({ ...form, dueDate: event.target.value })
                }
              />
            </Field>
            <Field label="Priority">
              <Select
                value={form.priority}
                onChange={(event) =>
                  setForm({ ...form, priority: event.target.value })
                }
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="low">Low</option>
              </Select>
            </Field>
          </div>
          <RecordLinks
            value={form.links}
            onChange={(links) => setForm({ ...form, links })}
            excludeId={editor && editor !== "new" ? editor.id : undefined}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(event) =>
                setForm({ ...form, pinned: event.target.checked })
              }
            />
            Pin as my next move
          </label>
          <div className="modal-actions">
            {editor && editor !== "new" && (
              <Button
                variant="ghost"
                type="button"
                onClick={async () => {
                  await remove(editor.id);
                  setEditor(null);
                  notify("Moved to trash.");
                }}
              >
                <X size={15} />
                Move to trash
              </Button>
            )}
            <Button type="submit" disabled={busy || !form.title.trim()}>
              {busy ? "Saving…" : "Save next step"}
              <ArrowRight size={16} />
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
