import { useState, type FormEvent } from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
} from "../../components/ui";
import { useSavingWorkspace as useWorkspace } from "../search/useSaving";
import { errorMessage } from "../search/domain";
import {
  documentUrl,
  getDocumentLinks,
  type DocumentType,
} from "./documentLinks";
import "./documents.css";

export { getDocumentLinks } from "./documentLinks";

const DOCUMENTS = [
  { type: "resume" as const, key: "resume" as const, title: "Résumé" },
  {
    type: "letter" as const,
    key: "coverLetter" as const,
    title: "Cover letter",
  },
];

export function AssetsPage() {
  const { records, preferences, create, update, pending } = useWorkspace();
  const documents = getDocumentLinks(records, preferences);
  const [editing, setEditing] = useState<DocumentType | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const chosen = DOCUMENTS.find((item) => item.type === editing);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    const destination = documentUrl(url);
    if (url.trim() && !destination) {
      setError("Use an Overleaf project or read-only document link.");
      return;
    }
    setError("");
    const existing = documents[chosen.key].record;
    try {
      const data = {
        ...existing?.data,
        type: chosen.type,
        sourceUrl: destination,
        overleaf: destination,
        documentDefault: true,
      };
      if (existing) await update(existing.id, { data });
      else await create({ kind: "asset", title: chosen.title, data });
      setEditing(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <div className="page-stack documents-page">
      <PageHeader title="Documents" />
      <div className="document-grid">
        {DOCUMENTS.map((item) => {
          const destination = documents[item.key].url;
          return (
            <Card
              key={item.type}
              className={`document-card document-${item.type}`}
            >
              <div className="document-art" aria-hidden="true">
                <div className="document-paper">
                  <FileText size={38} strokeWidth={1.6} />
                  <i />
                  <i />
                  <i />
                </div>
                <span className="document-star">✦</span>
              </div>
              <h2>{item.title}</h2>
              <div className="document-actions">
                {destination ? (
                  <a
                    className="button button-secondary"
                    href={destination}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Overleaf <ArrowUpRight size={17} />
                  </a>
                ) : (
                  <span className="muted">No link yet</span>
                )}
                <Button
                  variant="ghost"
                  aria-label={`Edit ${item.title.toLowerCase()} link`}
                  onClick={() => {
                    setEditing(item.type);
                    setUrl(destination);
                    setError("");
                  }}
                >
                  {destination ? "Edit link" : "Add link"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      <Modal
        open={!!chosen}
        onClose={() => setEditing(null)}
        title={`${chosen?.title || "Document"} link`}
      >
        <form className="stack" onSubmit={(event) => void save(event)}>
          <Field label="Overleaf URL">
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.overleaf.com/project/…"
              autoFocus
              maxLength={2048}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="inline-actions">
            <Button type="submit" disabled={!!pending}>
              {pending ? "Saving…" : "Save link"}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
