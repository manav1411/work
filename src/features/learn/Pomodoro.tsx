import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  BellRing,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  VolumeX,
} from "lucide-react";
import { Button, Field, Input } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import {
  freshTimer,
  pausedTimer,
  restoredTimer,
  advancedTimer,
  startedTimer,
  timerRemaining,
  type TimerState,
} from "./timer";
import {
  startPomodoroAlarm,
  stopPomodoroAlarm,
  unlockPomodoroAudio,
} from "./pomodoro-audio";

interface TimerStore {
  state: TimerState;
  listeners: Set<() => void>;
}
const timers = new Map<string, TimerStore>();
function storeFor(key: string): TimerStore {
  const previous = timers.get(key);
  if (previous) return previous;
  let state = freshTimer();
  try {
    state = restoredTimer(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    /* Device storage is optional. */
  }
  const store = { state, listeners: new Set<() => void>() };
  timers.set(key, store);
  return store;
}
function commit(key: string, store: TimerStore, state: TimerState) {
  store.state = state;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* Timer still works without storage. */
  }
  for (const listener of store.listeners) listener();
}

export function Pomodoro() {
  const { user, mode } = useWorkspace();
  const key = `work-pomodoro:${mode}:${user?.id ?? "local"}`;
  const store = storeFor(key);
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    [store],
  );
  const state = useSyncExternalStore(subscribe, () => store.state);
  const [now, setNow] = useState(Date.now);
  const [editing, setEditing] = useState(false);
  const [workMinutes, setWorkMinutes] = useState(state.workMinutes.toString());
  const [breakMinutes, setBreakMinutes] = useState(
    state.breakMinutes.toString(),
  );
  useEffect(() => {
    if (state.endsAt === null) return;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      if (timerRemaining(store.state, at) === 0)
        commit(key, store, advancedTimer(store.state, at));
    };
    tick();
    const interval = window.setInterval(tick, 500);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [state.endsAt, key, store]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== key) return;
      try {
        store.state = restoredTimer(JSON.parse(event.newValue ?? "null"));
        for (const listener of store.listeners) listener();
      } catch {
        /* Ignore malformed cross-tab state. */
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key, store]);
  useEffect(() => {
    if (state.alerting) startPomodoroAlarm();
    else stopPomodoroAlarm();
  }, [state.alerting]);
  const remaining = timerRemaining(state, now);
  const seconds = Math.ceil(remaining / 1000);
  const label = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const duration =
    (state.phase === "work" ? state.workMinutes : state.breakMinutes) * 60_000;
  const changePhase = (phase: TimerState["phase"]) =>
    commit(key, store, {
      ...state,
      phase,
      endsAt: null,
      remainingMs:
        (phase === "work" ? state.workMinutes : state.breakMinutes) * 60_000,
    });
  const validDurations =
    Number.isInteger(Number(workMinutes)) &&
    Number(workMinutes) >= 1 &&
    Number(workMinutes) <= 120 &&
    Number.isInteger(Number(breakMinutes)) &&
    Number(breakMinutes) >= 1 &&
    Number(breakMinutes) <= 60;
  return (
    <div className="learn-pomodoro">
      <div className="learn-timer-clock" aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="17" />
          <circle
            cx="20"
            cy="20"
            r="17"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 * (1 - Math.min(1, remaining / duration))}
          />
        </svg>
      </div>
      <div className="learn-timer-main">
        <div className="learn-timer-phase">
          <button
            aria-pressed={state.phase === "work"}
            onClick={() => changePhase("work")}
          >
            Pomodoro
          </button>
          <button
            aria-pressed={state.phase === "break"}
            onClick={() => changePhase("break")}
          >
            Break
          </button>
        </div>
        <output
          aria-label={`${state.phase === "work" ? "Pomodoro" : "Break"} time remaining`}
        >
          {label}
        </output>
      </div>
      <div className="learn-timer-controls">
        <Button
          variant="secondary"
          className="icon-button"
          aria-label={state.endsAt === null ? "Start timer" : "Pause timer"}
          onClick={() => {
            setNow(Date.now());
            if (state.endsAt === null) unlockPomodoroAudio();
            commit(
              key,
              store,
              state.endsAt === null ? startedTimer(state) : pausedTimer(state),
            );
          }}
        >
          {state.endsAt === null ? <Play size={16} /> : <Pause size={16} />}
        </Button>
        <Button
          variant="ghost"
          className="icon-button"
          aria-label="Reset timer"
          onClick={() => changePhase(state.phase)}
        >
          <RotateCcw size={16} />
        </Button>
        <Button
          variant="ghost"
          className="icon-button"
          aria-label="Timer settings"
          aria-expanded={editing}
          onClick={() => {
            setWorkMinutes(state.workMinutes.toString());
            setBreakMinutes(state.breakMinutes.toString());
            setEditing(!editing);
          }}
        >
          <Settings2 size={16} />
        </Button>
      </div>
      {state.alerting && (
        <div className="learn-timer-alarm" role="alert">
          <span className="learn-timer-alarm-copy">
            <BellRing size={15} aria-hidden="true" />
            {state.phase === "break"
              ? "Focus complete — break time."
              : "Break complete — focus time."}
          </span>
          <Button
            variant="secondary"
            className="learn-timer-dismiss"
            aria-label="Turn off timer alert"
            onClick={() => {
              stopPomodoroAlarm();
              commit(key, store, { ...store.state, alerting: false });
            }}
          >
            <VolumeX size={14} aria-hidden="true" />
            Turn off sound
          </Button>
        </div>
      )}
      {editing && (
        <form
          className="learn-timer-settings"
          onSubmit={(event) => {
            event.preventDefault();
            if (!validDurations) return;
            commit(key, store, {
              ...state,
              workMinutes: Number(workMinutes),
              breakMinutes: Number(breakMinutes),
              endsAt: null,
              remainingMs:
                Number(state.phase === "work" ? workMinutes : breakMinutes) *
                60_000,
            });
            setEditing(false);
          }}
        >
          <Field label="Work minutes">
            <Input
              type="number"
              min={1}
              max={120}
              value={workMinutes}
              onChange={(event) => setWorkMinutes(event.target.value)}
            />
          </Field>
          <Field label="Break minutes">
            <Input
              type="number"
              min={1}
              max={60}
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!validDurations}>
            Save
          </Button>
        </form>
      )}
    </div>
  );
}
