let context: AudioContext | null = null;
let alarmInterval: number | null = null;
let toneIndex = 0;

function getContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  try {
    context ??= new window.AudioContext();
    return context;
  } catch {
    return null;
  }
}

/** Call from a user gesture so later timer alerts can play under autoplay rules. */
export function unlockPomodoroAudio(): void {
  const audio = getContext();
  if (audio?.state === "suspended") void audio.resume().catch(() => undefined);
}

function playTone(): void {
  const audio = getContext();
  if (!audio) return;
  if (audio.state === "suspended") {
    void audio.resume().catch(() => undefined);
    return;
  }

  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  oscillator.type = "sine";
  oscillator.frequency.value = toneIndex++ % 2 === 0 ? 740 : 880;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.25);
}

export function startPomodoroAlarm(): void {
  if (alarmInterval !== null) return;
  toneIndex = 0;
  playTone();
  alarmInterval = window.setInterval(playTone, 700);
}

export function stopPomodoroAlarm(): void {
  if (alarmInterval !== null) window.clearInterval(alarmInterval);
  alarmInterval = null;
}
