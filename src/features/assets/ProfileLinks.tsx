import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, FileUser, Plus } from "lucide-react";
import { CompanyGlyph } from "../../components/CompanyGlyph";
import { useEditMode } from "../../lib/edit-mode";
import { field, type WorkRecord } from "../../../shared/model";
import { webDestination } from "../../../shared/documents";
import { Button, Card, Input } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { errorMessage } from "../search/domain";
type Link = {
  record?: WorkRecord;
  title: string;
  url: string;
};
export function ProfileLinks() {
  const workspace = useWorkspace();
  const { editing } = useEditMode();
  const [adding, setAdding] = useState(false);
  const links: Link[] = [
    ...workspace.records
      .filter(
        (record) =>
          record.kind === "resource" &&
          record.data.scope === "documents" &&
          record.data.category === "profile-link" &&
          !!record.title.trim() &&
          !!webDestination(field(record, "url")),
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
        <h2>Links</h2>
        {editing && (
          <Button
            variant="secondary"
            disabled={adding}
            onClick={() => setAdding(true)}
          >
            <Plus size={16} />
            Add link
          </Button>
        )}
      </div>
      <div className="document-link-grid">
        {links.map((item, index) => (
          <LinkCard key={item.record!.id} item={item} index={index} />
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
    if (saving.current) return;
    if (!current.title.trim()) {
      setError("Enter a name for this link.");
      return;
    }
    const destination = webDestination(current.url);
    if (!destination) {
      setError("Enter a valid web link.");
      return;
    }
    if (item.record && JSON.stringify(current) === saved.current) return;
    saving.current = true;
    setError("");
    let failed = false;
    try {
      if (item.record) {
        const next = await workspace.update(
          item.record.id,
          {
            title: current.title.trim(),
            data: { ...item.record.data, url: destination },
          },
          version.current,
        );
        version.current = next.version;
      } else {
        await workspace.create({
          kind: "resource",
          title: current.title.trim(),
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
    if (editing && item.record) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveRef.current(), 800);
    }
    return () => clearTimeout(timer.current);
  }, [title, url, editing, item.record?.id]);
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
            placeholder="Link name"
            onChange={(event) => setTitle(event.target.value)}
          />
          <Input
            aria-label={`${title || "New link"} URL`}
            value={url}
            placeholder="example.com"
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => {
              if (item.record) void saveRef.current();
            }}
          />
          <Button
            variant="ghost"
            onClick={() =>
              void (
                item.record
                  ? workspace.remove(item.record.id)
                  : Promise.resolve(onCreated?.())
              ).catch((failure) => setError(errorMessage(failure)))
            }
          >
            {item.record ? "Delete" : "Cancel"}
          </Button>
          {!item.record && (
            <Button variant="secondary" onClick={() => void saveRef.current()}>
              Add link
            </Button>
          )}
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
