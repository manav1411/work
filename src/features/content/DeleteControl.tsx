import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../../components/ui";

export function DeleteControl({
  label = "Delete",
  onDelete,
  disabled = false,
}: {
  label?: string;
  onDelete: () => Promise<void>;
  disabled?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="content-delete-control">
      {confirm ? (
        <>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onDelete();
                setConfirm(false);
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : "Could not delete.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Removing…" : `Confirm ${label.toLowerCase()}`}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          disabled={disabled}
          aria-label={label}
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={15} />
          {label}
        </Button>
      )}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
