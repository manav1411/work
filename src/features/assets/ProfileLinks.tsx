import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, FileUser, Plus } from "lucide-react";
import { CompanyGlyph } from "../../components/CompanyGlyph";
import { useEditMode } from "../../lib/edit-mode";
import { field, type WorkRecord } from "../../../shared/model";
import { webDestination } from "../../../shared/documents";
import { Button, Card, Input } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { errorMessage } from "../search/domain";
type ProfileKey = "linkedin" | "github" | "website";
type Link = {
  key?: ProfileKey;
  record?: WorkRecord;
  title: string;
  url: string;
};
export function ProfileLinks() {
  const workspace = useWorkspace();
  const { editing } = useEditMode();
  const [adding, setAdding] = useState(false);
  const links: Link[] = [
    ...[
      { key: "linkedin" as const, title: "LinkedIn" },
      { key: "github" as const, title: "GitHub" },
      { key: "website" as const, title: "Website" },
    ].map((item) => ({ ...item, url: workspace.preferences[item.key] })),
    ...workspace.records
      .filter(
        (record) =>
          record.kind === "resource" &&
          !record.deletedAt &&
          record.data.scope === "documents" &&
          record.data.category === "profile-link",
      )
      .map((record) => ({
        record,
        title: record.title,
        url: field(record, "url"),
      })),
  ];
  return (
    <section className="document-profile-links">
      <div className="document-section-heading">
        <h2>External links</h2>
        {editing && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={16} />
            Add link
          </Button>
        )}
      </div>
      <div className="document-link-grid">
        {links.map((item, index) => (
          <LinkCard
            key={item.key || item.record!.id}
            item={item}
            index={index}
          />
        ))}
        {adding && editing && (
          <LinkCard
            item={{ title: "", url: "" }}
            index={links.length}
            onCreated={() => setAdding(false)}
          />
        )}
      </div>
    </section>
  );
}
function LinkCard({
  item,
  index,
  onCreated,
}: {
  item: Link;
  index: number;
  onCreated?: () => void;
}) {
  const workspace = useWorkspace();
  const { editing } = useEditMode();
  const [title, setTitle] = useState(item.title);
  const [url, setUrl] = useState(item.url);
  const [error, setError] = useState("");
  const live = useRef({ title, url });
  live.current = { title, url };
  const saved = useRef(JSON.stringify(live.current));
  const version = useRef(item.record?.version);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  saveRef.current = async () => {
    const current = { ...live.current };
    if (JSON.stringify(current) === saved.current || saving.current) return;
    const destination = webDestination(current.url);
    if (!destination) {
      if (current.url) setError("Enter a valid web link.");
      return;
    }
    saving.current = true;
    setError("");
    let failed = false;
    try {
      if (item.key)
        await workspace.savePreferences({ [item.key]: destination });
      else if (item.record) {
        const next = await workspace.update(
          item.record.id,
          {
            title: current.title.trim() || "Untitled link",
            data: { ...item.record.data, url: destination },
          },
          version.current,
        );
        version.current = next.version;
      } else {
        await workspace.create({
          kind: "resource",
          title: current.title.trim() || "Untitled link",
          data: {
            scope: "documents",
            category: "profile-link",
            url: destination,
          },
        });
        onCreated?.();
      }
      saved.current = JSON.stringify(current);
      if (live.current.url === current.url) {
        setUrl(destination);
        live.current.url = destination;
        saved.current = JSON.stringify({ ...current, url: destination });
      }
    } catch (failure) {
      failed = true;
      setError(errorMessage(failure));
    } finally {
      saving.current = false;
      if (JSON.stringify(live.current) !== saved.current && !failed)
        timer.current = setTimeout(() => void saveRef.current(), 800);
    }
  };
  useEffect(() => {
    if (editing) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveRef.current(), 800);
    }
    return () => clearTimeout(timer.current);
  }, [title, url, editing]);
  const destination = webDestination(url);
  const personal =
    destination &&
    new URL(destination).hostname.replace(/^www\./, "") === "manavdodia.com";
  return (
    <Card
      className={`document-link-card action-card document-link-${index % 4}`}
    >
      {editing ? (
        <div className="document-link-inline">
          <Input
            aria-label="Link name"
            value={title}
            readOnly={!!item.key}
            placeholder="Link name"
            onChange={(event) => setTitle(event.target.value)}
          />
          <Input
            aria-label={`${title || "New link"} URL`}
            value={url}
            placeholder="example.com"
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => void saveRef.current()}
          />
          <Button
            variant="ghost"
            onClick={() =>
              void (
                item.key
                  ? workspace.savePreferences({ [item.key]: "" })
                  : item.record
                    ? workspace.remove(item.record.id)
                    : Promise.resolve(onCreated?.())
              ).catch((failure) => setError(errorMessage(failure)))
            }
          >
            Delete
          </Button>
        </div>
      ) : destination ? (
        <a
          className="document-link-primary card-hit-target"
          href={destination}
          target="_blank"
          rel="noopener noreferrer"
        >
          {personal ? (
            <FileUser size={20} />
          ) : (
            <CompanyGlyph name={title} url={destination} />
          )}
          <strong>{title}</strong>
          <ArrowUpRight size={16} />
        </a>
      ) : (
        <span className="document-link-primary">
          <CompanyGlyph name={title} />
          <strong>{title}</strong>
        </span>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
          <Button variant="ghost" onClick={() => void saveRef.current()}>
            Retry
          </Button>
        </p>
      )}
    </Card>
  );
}
