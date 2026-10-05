import { useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus } from "lucide-react";
import {
  contentMatches,
  orderedRecords,
  type ContentContext,
} from "../../../shared/content";
import {
  field,
  safeUrl,
  type RecordInput,
  type WorkRecord,
} from "../../../shared/model";
import { Button, Card, Field, Input, Modal } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { CompanyGlyph } from "../../components/CompanyGlyph";
import { AutosaveNote } from "./AutosaveNote";
import { DeleteControl } from "./DeleteControl";
import "./content.css";

export interface SeedResource {
  id: string;
  title: string;
  url: string;
  body?: string;
}
export function ContentPanel({
  context,
  seeds = [],
}: {
  context: ContentContext;
  seeds?: SeedResource[];
}) {
  const { records, create, update, remove, notify } = useWorkspace();
  const { editing } = useEditMode();
  const [editor, setEditor] = useState<{
    kind: "resource" | "note";
    record?: WorkRecord;
    seed?: SeedResource;
  } | null>(null);
  const [error, setError] = useState("");
  const scoped = records.filter((record) => contentMatches(record, context));
  const sections = orderedRecords(
    scoped.filter(
      (record) =>
        record.kind === "note" && record.data.category === "content-section",
    ),
  );
  const storedResources = scoped.filter(
    (record) =>
      record.kind === "resource" && record.data.category === "content-resource",
  );
  const resources: Array<{
    id: string;
    title: string;
    url: string;
    body: string;
    record?: WorkRecord;
    seed?: SeedResource;
    order: number;
  }> = [
    ...seeds.flatMap((seed, index) => {
      const override = storedResources.find(
        (record) => field(record, "seedResourceId") === seed.id,
      );
      return override?.data.hidden
        ? []
        : [
            {
              id: seed.id,
              title: override?.title ?? seed.title,
              body: override?.body ?? seed.body ?? "",
              url: override ? field(override, "url") : seed.url,
              record: override,
              seed,
              order:
                typeof override?.data.order === "number"
                  ? override.data.order
                  : index,
            },
          ];
    }),
    ...storedResources
      .filter(
        (record) => !field(record, "seedResourceId") && !record.data.hidden,
      )
      .map((record, index) => ({
        id: record.id,
        title: record.title,
        body: record.body,
        url: field(record, "url"),
        record,
        order:
          typeof record.data.order === "number"
            ? record.data.order
            : seeds.length + index,
      })),
  ].sort((a, b) => a.order - b.order);
  const perform = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Change could not be saved.",
      );
    }
  };
  const resourceInput = (
    item: (typeof resources)[number],
    position: number,
  ): RecordInput => ({
    kind: "resource",
    title: item.title,
    body: item.body,
    data: {
      category: "content-resource",
      ...context,
      url: item.url,
      ...(item.seed ? { seedResourceId: item.seed.id } : {}),
      order: position,
    },
  });
  const reorderResources = async (index: number, offset: number) => {
    const next = [...resources];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    for (const [position, item] of next.entries()) {
      const input = resourceInput(item, position);
      if (item.record)
        await update(item.record.id, {
          data: { ...item.record.data, ...input.data },
        });
      else await create(input);
    }
  };
  const reorderSections = async (index: number, offset: number) => {
    const next = [...sections];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    for (const [order, item] of next.entries())
      await update(item.id, { data: { ...item.data, order } });
  };
  if (!editing && resources.length === 0 && sections.length === 0) return null;
  return (
    <div className="content-panel">
      <header className="content-panel-heading">
        <h3>Resources & notes</h3>
        {editing && (
          <div className="inline-actions">
            <Button
              variant="secondary"
              onClick={() => setEditor({ kind: "resource" })}
            >
              <Plus size={15} />
              Add resource
            </Button>
            <Button variant="ghost" onClick={() => setEditor({ kind: "note" })}>
              <Plus size={15} />
              Add notes section
            </Button>
          </div>
        )}
      </header>
      {error && (
        <p role="alert" className="content-save-error">
          {error}
        </p>
      )}
      <div className="content-resource-grid">
        {resources.map((item, index) => (
          <Card
            key={item.id}
            className={`content-resource-card action-card content-tone-${index % 4}`}
          >
            <a
              className="card-hit-target"
              href={safeUrl(item.url) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong>
                <CompanyGlyph
                  name={item.title}
                  url={item.url}
                  technology={
                    item.record ? field(item.record, "technology") : undefined
                  }
                />
                {item.title}
              </strong>
              <ExternalLink size={18} />
            </a>
            {editing && (
              <div className="content-item-actions">
                <Button
                  variant="ghost"
                  aria-label={`Edit ${item.title}`}
                  onClick={() =>
                    setEditor({
                      kind: "resource",
                      record: item.record,
                      seed: item.seed,
                    })
                  }
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Move ${item.title} up`}
                  disabled={index === 0}
                  onClick={() =>
                    void perform(() => reorderResources(index, -1))
                  }
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Move ${item.title} down`}
                  disabled={index === resources.length - 1}
                  onClick={() => void perform(() => reorderResources(index, 1))}
                >
                  <ArrowDown size={14} />
                </Button>
                <DeleteControl
                  label="Delete resource"
                  onDelete={async () => {
                    if (item.seed) {
                      if (item.record)
                        await update(item.record.id, {
                          data: { ...item.record.data, hidden: true },
                        });
                      else {
                        const input = resourceInput(item, index);
                        await create({
                          ...input,
                          data: { ...input.data, hidden: true },
                        });
                      }
                    } else if (item.record) await remove(item.record.id);
                    notify("Resource deleted.");
                  }}
                />
              </div>
            )}
          </Card>
        ))}
      </div>
      {sections.map((section, index) => (
        <Card key={section.id} className="content-section-card">
          <header className="content-section-heading">
            <h3>{section.title}</h3>
            {editing && (
              <div className="content-item-actions">
                <Button
                  variant="ghost"
                  aria-label={`Rename ${section.title}`}
                  onClick={() => setEditor({ kind: "note", record: section })}
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={`Move ${section.title} up`}
                  onClick={() => void perform(() => reorderSections(index, -1))}
                >
                  <ArrowUp size={15} />
                </Button>
                <Button
                  variant="ghost"
                  disabled={index === sections.length - 1}
                  aria-label={`Move ${section.title} down`}
                  onClick={() => void perform(() => reorderSections(index, 1))}
                >
                  <ArrowDown size={15} />
                </Button>
                <DeleteControl
                  label="Delete section"
                  onDelete={() => remove(section.id)}
                />
              </div>
            )}
          </header>
          <AutosaveNote
            record={section}
            input={{ kind: "note", title: section.title, data: section.data }}
            draftKey={`section:${section.id}`}
            label={section.title}
          />
        </Card>
      ))}
      {editor && (
        <ContentEditor
          key={editor.record?.id ?? editor.seed?.id ?? editor.kind}
          context={context}
          kind={editor.kind}
          record={editor.record}
          seed={editor.seed}
          nextOrder={
            editor.kind === "note" ? sections.length : resources.length
          }
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
function ContentEditor({
  context,
  kind,
  record,
  seed,
  nextOrder,
  onClose,
}: {
  context: ContentContext;
  kind: "resource" | "note";
  record?: WorkRecord;
  seed?: SeedResource;
  nextOrder: number;
  onClose: () => void;
}) {
  const { create, update } = useWorkspace();
  const [title, setTitle] = useState(record?.title ?? seed?.title ?? "");
  const [url, setUrl] = useState(
    record ? field(record, "url") : (seed?.url ?? ""),
  );
  const [body] = useState(record?.body ?? seed?.body ?? "");
  const [technology, setTechnology] = useState(
    record ? field(record, "technology") : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={
        record || seed
          ? `Edit ${kind === "note" ? "section name" : "resource"}`
          : `Add ${kind === "note" ? "notes section" : "resource"}`
      }
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!title.trim() || (kind === "resource" && !safeUrl(url))) {
            setError("Enter a name and a valid HTTP or HTTPS URL.");
            return;
          }
          setBusy(true);
          setError("");
          const data = {
            ...record?.data,
            ...context,
            category: kind === "note" ? "content-section" : "content-resource",
            order: record?.data.order ?? nextOrder,
            ...(kind === "resource"
              ? {
                  url: safeUrl(url),
                  technology: technology.trim(),
                  ...(seed ? { seedResourceId: seed.id } : {}),
                }
              : {}),
          };
          try {
            if (record)
              await update(record.id, {
                title: title.trim(),
                ...(kind === "resource" ? { body } : {}),
                data,
              });
            else await create({ kind, title: title.trim(), body, data });
            onClose();
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Content could not be saved.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Name">
          <Input
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        {kind === "resource" && (
          <>
            <Field label="Link">
              <Input
                required
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
            <Field label="Technology glyph (optional)">
              <Input
                maxLength={100}
                placeholder="Python, React, PostgreSQL…"
                value={technology}
                onChange={(event) => setTechnology(event.target.value)}
              />
            </Field>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="inline-actions">
          <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
