import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";

const HOLD_DURATION = 3000;

export function RadarTab({
  selected,
  onSelect,
  onPing,
}: {
  selected: boolean;
  onSelect: () => void;
  onPing: () => Promise<boolean>;
}) {
  const [holding, setHolding] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pulse = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const pressed = useRef(false);
  const pending = useRef(false);
  const suppressClick = useRef(false);
  const mounted = useRef(true);

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
    pressed.current = false;
    setHolding(false);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      clearTimeout(pulse.current);
    };
  }, []);

  const start = () => {
    if (pressed.current || pending.current) return;
    pressed.current = true;
    suppressClick.current = false;
    setSent(false);
    setHolding(true);
    timer.current = setTimeout(async () => {
      timer.current = undefined;
      suppressClick.current = true;
      pending.current = true;
      setHolding(false);
      setSending(true);
      onSelect();
      try {
        const accepted = await onPing();
        if (mounted.current && accepted) {
          setSent(true);
          clearTimeout(pulse.current);
          pulse.current = setTimeout(() => setSent(false), 1600);
        }
      } finally {
        pending.current = false;
        if (mounted.current) setSending(false);
      }
    }, HOLD_DURATION);
  };

  return (
    <button
      role="tab"
      aria-label="Radar"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      aria-busy={sending}
      aria-describedby="radar-ping-help"
      className={`radar-tab ${selected ? "active" : ""} ${holding ? "radar-tab-holding" : ""} ${sent ? "radar-tab-sent" : ""}`}
      title="Hold for 3 seconds to ping Radar. Keyboard: hold Space."
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        origin.current = { x: event.clientX, y: event.clientY };
        start();
      }}
      onPointerMove={(event) => {
        if (
          origin.current &&
          Math.hypot(
            event.clientX - origin.current.x,
            event.clientY - origin.current.y,
          ) > 10
        )
          cancel();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onContextMenu={(event) => {
        if (pressed.current || suppressClick.current) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === " ") {
          event.preventDefault();
          if (!event.repeat) start();
        }
        if (event.key === "Escape") cancel();
      }}
      onKeyUp={(event) => {
        if (event.key !== " ") return;
        event.preventDefault();
        const completed = suppressClick.current;
        cancel();
        suppressClick.current = false;
        if (!completed) onSelect();
      }}
      onClick={() => {
        cancel();
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onSelect();
      }}
    >
      <Radio size={17} aria-hidden="true" />
      Radar
      {sent && <span className="radar-tab-pulse" aria-hidden="true" />}
      <span className="sr-only" role="status">
        {sending ? "Sending ping…" : sent ? "Ping sent." : ""}
      </span>
    </button>
  );
}
