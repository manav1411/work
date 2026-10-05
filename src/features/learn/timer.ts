export interface TimerState {
  phase: "work" | "break";
  workMinutes: number;
  breakMinutes: number;
  remainingMs: number;
  endsAt: number | null;
  alerting: boolean;
}
export const freshTimer = (): TimerState => ({
  phase: "work",
  workMinutes: 25,
  breakMinutes: 5,
  remainingMs: 25 * 60_000,
  endsAt: null,
  alerting: false,
});
export function timerRemaining(state: TimerState, at = Date.now()): number {
  return Math.max(
    0,
    state.endsAt === null ? state.remainingMs : state.endsAt - at,
  );
}
export function restoredTimer(value: unknown, at = Date.now()): TimerState {
  if (!value || typeof value !== "object") return freshTimer();
  const raw = value as Record<string, unknown>;
  if (
    !["work", "break"].includes(String(raw.phase)) ||
    !Number.isInteger(raw.workMinutes) ||
    Number(raw.workMinutes) < 1 ||
    Number(raw.workMinutes) > 120 ||
    !Number.isInteger(raw.breakMinutes) ||
    Number(raw.breakMinutes) < 1 ||
    Number(raw.breakMinutes) > 60 ||
    typeof raw.remainingMs !== "number" ||
    !Number.isFinite(raw.remainingMs) ||
    raw.remainingMs < 0 ||
    raw.remainingMs > 120 * 60_000 ||
    (raw.alerting !== undefined && typeof raw.alerting !== "boolean") ||
    (raw.endsAt !== null &&
      (typeof raw.endsAt !== "number" || !Number.isFinite(raw.endsAt)))
  )
    return freshTimer();
  const state = {
    ...raw,
    alerting: raw.alerting === true,
  } as unknown as TimerState;
  if (state.endsAt !== null && timerRemaining(state, at) === 0)
    return advancedTimer(state, at);
  // Older versions paused the timer at zero instead of moving to the next phase.
  if (state.endsAt === null && state.remainingMs === 0)
    return beginNextPhase(state, at);
  return state;
}
export function pausedTimer(state: TimerState, at = Date.now()): TimerState {
  return { ...state, remainingMs: timerRemaining(state, at), endsAt: null };
}
export function startedTimer(state: TimerState, at = Date.now()): TimerState {
  const remainingMs =
    timerRemaining(state, at) ||
    (state.phase === "work" ? state.workMinutes : state.breakMinutes) * 60_000;
  return { ...state, remainingMs, endsAt: at + remainingMs };
}

function durationFor(state: TimerState, phase: TimerState["phase"]): number {
  return (phase === "work" ? state.workMinutes : state.breakMinutes) * 60_000;
}

function otherPhase(phase: TimerState["phase"]): TimerState["phase"] {
  return phase === "work" ? "break" : "work";
}

function beginNextPhase(state: TimerState, at: number): TimerState {
  const phase = otherPhase(state.phase);
  const duration = durationFor(state, phase);
  return {
    ...state,
    phase,
    remainingMs: duration,
    endsAt: at + duration,
    alerting: true,
  };
}

/** Advances an expired running timer while preserving its phase boundaries. */
export function advancedTimer(state: TimerState, at = Date.now()): TimerState {
  if (state.endsAt === null || state.endsAt > at) return state;

  const firstPhase = otherPhase(state.phase);
  const cycleDuration =
    durationFor(state, firstPhase) + durationFor(state, state.phase);
  const elapsed = at - state.endsAt;
  const cycles = Math.floor(elapsed / cycleDuration);
  let phase = firstPhase;
  let phaseStartedAt = state.endsAt + cycles * cycleDuration;
  const elapsedInPhase = at - phaseStartedAt;
  const firstDuration = durationFor(state, phase);

  // At an exact phase boundary, begin the next phase immediately.
  if (elapsedInPhase >= firstDuration) {
    phase = state.phase;
    phaseStartedAt += firstDuration;
  }

  const duration = durationFor(state, phase);
  const endsAt = phaseStartedAt + duration;
  return {
    ...state,
    phase,
    remainingMs: endsAt - at,
    endsAt,
    alerting: true,
  };
}
