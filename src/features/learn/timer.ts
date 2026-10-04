export interface TimerState {
  phase: "work" | "break";
  workMinutes: number;
  breakMinutes: number;
  remainingMs: number;
  endsAt: number | null;
}
export const freshTimer = (): TimerState => ({
  phase: "work",
  workMinutes: 25,
  breakMinutes: 5,
  remainingMs: 25 * 60_000,
  endsAt: null,
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
    (raw.endsAt !== null &&
      (typeof raw.endsAt !== "number" || !Number.isFinite(raw.endsAt)))
  )
    return freshTimer();
  const state = raw as unknown as TimerState;
  return state.endsAt !== null && timerRemaining(state, at) === 0
    ? { ...state, remainingMs: 0, endsAt: null }
    : state;
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
