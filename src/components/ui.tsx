import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Check, Link2, Plus, Search, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { KIND_LABELS } from "../../shared/model";
import { useWorkspace } from "../lib/workspace";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props} />;
}
export function Badge({
  tone = "muted",
  children,
  className = "",
}: {
  tone?:
    | "blue"
    | "pink"
    | "lime"
    | "orange"
    | "muted"
    | "ink"
    | "green"
    | "red"
    | "aqua";
  children: ReactNode;
  className?: string;
}) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>;
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>
          {title}
          <span className="heading-dot">.</span>
        </h1>
        {description && <p className="page-description">{description}</p>}
        {children}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </header>
  );
}
export function Field({
  label,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  const generated = useId();
  let controlId: string | undefined;
  const content = Children.map(children, (child) => {
    if (
      !isValidElement<{ id?: string; "aria-describedby"?: string }>(child) ||
      controlId
    )
      return child;
    if (
      ![Input, Textarea, Select, "input", "textarea", "select"].includes(
        child.type as typeof Input,
      )
    )
      return child;
    controlId = child.props.id || generated;
    return cloneElement(child, {
      id: controlId,
      ...(hint
        ? {
            "aria-describedby": [
              child.props["aria-describedby"],
              `${generated}-hint`,
            ]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
    });
  });
  return (
    <div
      className={`field ${className}`}
      {...(!controlId
        ? { role: "group", "aria-labelledby": `${generated}-label` }
        : {})}
    >
      {controlId ? (
        <label className="field-label" htmlFor={controlId}>
          {label}
        </label>
      ) : (
        <span className="field-label" id={`${generated}-label`}>
          {label}
        </span>
      )}
      {content}
      {hint && (
        <span className="field-hint" id={`${generated}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
  return <input ref={ref} className={`input ${className}`} {...props} />;
});
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = "", ...props }, ref) {
  return (
    <textarea ref={ref} className={`input textarea ${className}`} {...props} />
  );
});
export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input select ${className}`} {...props} />;
}
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon ?? <Plus size={26} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "default" | "wide" | "large";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal modal-${size}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-content">
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p className="muted">{description}</p>}
          </div>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </Button>
        </header>
        {open && children}
      </div>
    </dialog>
  );
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content || "*Nothing written yet. Make a little room for a thought.*"}
      </ReactMarkdown>
    </div>
  );
}

export function RecordLinks({
  value,
  onChange,
  excludeId,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  excludeId?: string;
}) {
  const { records } = useWorkspace();
  const [query, setQuery] = useState("");
  return (
    <details className="record-links-picker">
      <summary>
        <Link2 size={15} />
        Related records {value.length > 0 && <Badge>{value.length}</Badge>}
      </summary>
      <div className="record-links-options">
        <div className="input-with-icon">
          <Search size={16} />
          <Input
            placeholder="Find a record"
            aria-label="Find related record"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {records
          .filter(
            (record) =>
              record.id !== excludeId &&
              record.title.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 300)
          .map((record) => (
            <label className="record-link-option" key={record.id}>
              <input
                type="checkbox"
                checked={value.includes(record.id)}
                onChange={() =>
                  onChange(
                    value.includes(record.id)
                      ? value.filter((id) => id !== record.id)
                      : [...value, record.id],
                  )
                }
              />
              <span>{record.title}</span>
              <small>{KIND_LABELS[record.kind]}</small>
            </label>
          ))}
        {records.length === 0 && (
          <p className="muted">Related items appear as you add them.</p>
        )}
      </div>
    </details>
  );
}

export function SaveState({
  state,
}: {
  state: "saved" | "saving" | "draft" | "error";
}) {
  return (
    <span className={`save-state save-state-${state}`} aria-live="polite">
      {state === "saved" && <Check size={13} />}
      {state === "saved"
        ? "Saved"
        : state === "saving"
          ? "Saving…"
          : state === "draft"
            ? "Draft on this device"
            : "Save needs attention"}
    </span>
  );
}
