import {
  useId,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";
import "./notes.css";

/** Short, plain-text notes keep their existing storage and grow with the writing. */
export function NoteInput({
  value,
  className = "",
  rows = 3,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const resize = () => {
      if (!field.getClientRects().length) return;
      field.style.height = "auto";
      const height = Math.min(320, field.scrollHeight + 2);
      field.style.height = `${height}px`;
      field.style.overflowY = field.scrollHeight > 320 ? "auto" : "hidden";
    };
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== field.clientWidth) {
        width = field.clientWidth;
        resize();
      }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [value, rows]);
  const words = value.trim() ? value.trim().split(/\s+/u).length : 0;
  return (
    <div className="work-note-input">
      <textarea
        {...props}
        ref={ref}
        value={value}
        rows={rows}
        className={`input textarea work-note-text ${className}`}
        aria-describedby={[props["aria-describedby"], hintId]
          .filter(Boolean)
          .join(" ")}
      />
      <div id={hintId} className="work-note-input-footer">
        <span>
          {words.toLocaleString()} {words === 1 ? "word" : "words"}
        </span>
        {props.maxLength && (
          <span>
            {value.length.toLocaleString()} / {props.maxLength.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
