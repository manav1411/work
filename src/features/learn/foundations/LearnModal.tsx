import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../../../components/ui";

// Native dialog adapter for the source's fullscreen week modal. The browser
// supplies focus trapping and restores focus to the opening control.
export default function LearnModal({
  open,
  title,
  onClose,
  fullscreen = false,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  fullscreen?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`learn-modal ${fullscreen ? "learn-modal-fullscreen" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <Button
          variant="ghost"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </header>
      <div className="learn-modal-body">{open && children}</div>
    </dialog>
  );
}
