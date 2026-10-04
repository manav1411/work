import { useState, type FormEvent } from "react";
import { ArrowUpRight, Link2, Plus } from "lucide-react";
import { field, type WorkRecord } from "../../../shared/model";
import { webDestination } from "../../../shared/documents";
import { Button, Card, Field, Input, Modal } from "../../components/ui";
import { useSavingWorkspace as useWorkspace } from "../search/useSaving";
import { errorMessage } from "../search/domain";

const BUILT_INS = [
  { key: "linkedin" as const, title: "LinkedIn" },
  { key: "github" as const, title: "GitHub" },
  { key: "website" as const, title: "Website" },
];
type ProfileKey = (typeof BUILT_INS)[number]["key"];
type EditingLink = {
  key?: ProfileKey;
  record?: WorkRecord;
  title: string;
  url: string;
};

export function ProfileLinks() {
  const {
    records,
    preferences,
    create,
    update,
    remove,
    restore,
    savePreferences,
    pending,
  } = useWorkspace();
  const [editing, setEditing] = useState<EditingLink>();
  const [deleting, setDeleting] = useState<EditingLink>();
  const [removed, setRemoved] = useState<EditingLink>();
  const [error, setError] = useState("");
  const links = records.filter(
    (item) =>
      item.kind === "resource" &&
      item.data.scope === "documents" &&
      item.data.category === "profile-link",
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const destination = webDestination(editing.url);
    if ((!editing.key || editing.url.trim()) && !destination) {
      setError("Use an HTTP or HTTPS link without embedded credentials.");
      return;
    }
    setError("");
    try {
      if (editing.key) await savePreferences({ [editing.key]: destination });
      else {
        const data = {
          ...editing.record?.data,
          scope: "documents",
          category: "profile-link",
          url: destination,
        };
        if (editing.record)
          await update(editing.record.id, {
            title: editing.title.trim(),
            data,
          });
        else
          await create({ kind: "resource", title: editing.title.trim(), data });
      }
      setEditing(undefined);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  async function deleteLink() {
    if (!deleting) return;
    setError("");
    try {
      if (deleting.key) await savePreferences({ [deleting.key]: "" });
      else if (deleting.record) await remove(deleting.record.id);
      setRemoved(deleting);
      setDeleting(undefined);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  const cards: EditingLink[] = [
    ...BUILT_INS.map((item) => ({
      ...item,
      url: webDestination(preferences[item.key]),
    })),
    ...links.map((record) => ({
      record,
      title: record.title,
      url: webDestination(field(record, "url")),
    })),
  ];
  return (
    <section
      className="document-profile-links"
      aria-labelledby="profile-links-title"
    >
      <div className="document-section-heading">
        <div>
          <h2 id="profile-links-title">Your links</h2>
          <p className="muted">
            Your profiles and useful destinations, together.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setEditing({ title: "", url: "" });
            setError("");
          }}
        >
          <Plus size={17} /> Add link
        </Button>
      </div>
      {removed && (
        <div className="document-recovery-notice" role="status">
          <span>{removed.title} removed.</span>
          <Button
            variant="ghost"
            disabled={!!pending}
            onClick={() => {
              setError("");
              void (
                removed.key
                  ? savePreferences({ [removed.key]: removed.url })
                  : removed.record
                    ? restore(removed.record.id)
                    : Promise.resolve()
              )
                .then(() => setRemoved(undefined))
                .catch((failure) => setError(errorMessage(failure)));
            }}
          >
            Undo
          </Button>
        </div>
      )}
      {error && !editing && !deleting && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="document-link-grid">
        {cards.map((item, index) => (
          <Card
            key={item.key || item.record?.id}
            className={`document-link-card document-link-${index % 4}`}
          >
            <Link2 size={21} />
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                {item.title} <ArrowUpRight size={17} />
              </a>
            ) : (
              <strong>{item.title}</strong>
            )}
            <div className="inline-actions">
              <Button
                variant="ghost"
                aria-label={`${item.url ? "Edit" : "Add"} ${item.title} link`}
                onClick={() => {
                  setEditing(item);
                  setError("");
                }}
              >
                {item.url ? "Edit" : "Add link"}
              </Button>
              {item.url && (
                <Button
                  variant="ghost"
                  aria-label={`Delete ${item.title} link`}
                  onClick={() => {
                    setDeleting(item);
                    setError("");
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Modal
        open={!!editing}
        onClose={() => {
          if (!pending) setEditing(undefined);
        }}
        title={
          editing?.key
            ? `${editing.title} link`
            : editing?.record
              ? "Edit link"
              : "Add link"
        }
      >
        <form className="stack" onSubmit={(event) => void save(event)}>
          {!editing?.key && (
            <Field label="Name">
              <Input
                autoFocus
                required
                maxLength={240}
                value={editing?.title || ""}
                onChange={(event) =>
                  setEditing(
                    (value) => value && { ...value, title: event.target.value },
                  )
                }
              />
            </Field>
          )}
          <Field label="URL">
            <Input
              autoFocus={!!editing?.key}
              required={!editing?.key}
              type="url"
              maxLength={2048}
              placeholder="https://…"
              value={editing?.url || ""}
              onChange={(event) =>
                setEditing(
                  (value) => value && { ...value, url: event.target.value },
                )
              }
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={!!pending}>
            {pending ? "Saving…" : "Save link"}
          </Button>
        </form>
      </Modal>
      <Modal
        open={!!deleting}
        onClose={() => {
          if (!pending) setDeleting(undefined);
        }}
        title={`Delete ${deleting?.title || "link"}?`}
      >
        <p>You can undo this after deleting.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <Button
            variant="danger"
            disabled={!!pending}
            onClick={() => void deleteLink()}
          >
            Delete link
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(undefined)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </section>
  );
}
