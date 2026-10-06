import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Placeholder from "@tiptap/extension-placeholder";
import { GripVertical } from "lucide-react";
import { normalizeWebUrl } from "../../../shared/urls";
import type {
  RecordInput,
  RecordPatch,
  WorkRecord,
} from "../../../shared/model";
import {
  richPlainText,
  richDocumentError,
  storedRichDocument,
  validRichDocument,
  type RichNode,
} from "../../../shared/rich-content";
import { useWorkspace } from "../../lib/workspace";
import { useAutosave } from "../../lib/autosave";
import { getRevisions } from "../../lib/api";
import type { RecordRevision } from "../../../shared/model";
import { useEditMode } from "../../lib/edit-mode";
import { Button, Select, Input } from "../../components/ui";
import { markdownDocument } from "./markdownDocument";
import { contentRecordWriter } from "./recordWriter";
import "./content.css";

function commands(editor: Editor) {
  return [
    ["Text", () => editor.chain().focus().setParagraph().run()],
    ["Heading", () => editor.chain().focus().toggleHeading({ level: 2 }).run()],
    ["Bullet list", () => editor.chain().focus().toggleBulletList().run()],
    ["Numbered list", () => editor.chain().focus().toggleOrderedList().run()],
    ["Task list", () => editor.chain().focus().toggleTaskList().run()],
    ["Code", () => editor.chain().focus().toggleCodeBlock().run()],
    ["Quote", () => editor.chain().focus().toggleBlockquote().run()],
    ["Divider", () => editor.chain().focus().setHorizontalRule().run()],
    [
      "Table",
      () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    ],
  ] as const;
}

export function RichDocumentEditor({
  record,
  input,
  draftKey,
  label = "Notes",
  initialBody = "",
  initialDocument,
  persist,
  allowBlockReordering = true,
}: {
  record?: WorkRecord;
  input: RecordInput;
  draftKey: string;
  label?: string;
  initialBody?: string;
  initialDocument?: RichNode;
  allowBlockReordering?: boolean;
  persist?: (
    patch: RecordPatch,
    expectedVersion?: number,
  ) => Promise<WorkRecord>;
}) {
  const { editing } = useEditMode();
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const { user, create, update, refresh, isPending } = useWorkspace();
  const storageKey = `work-rich-draft:${user?.id ?? "anonymous"}:${draftKey}`;
  const server =
    storedRichDocument(record?.data) ??
    initialDocument ??
    markdownDocument(initialBody || record?.body || "");
  const recordRef = useRef(record);
  recordRef.current = record;
  const inputRef = useRef(input);
  inputRef.current = input;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const writer = useMemo(
    () =>
      contentRecordWriter({
        read: () => recordRef.current,
        input: () => inputRef.current,
        create,
        update,
      }),
    [create, update],
  );
  const writerRef = useRef(writer);
  writerRef.current = writer;
  const autosave = useAutosave<RichNode>({
    initial: server,
    version: record?.version,
    storageKey,
    enabled: true,
    pending: record ? isPending(record.id) : false,
    decodeLegacy: (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return undefined;
      const draft = raw as { document?: unknown; version?: unknown };
      if (!draft.document || typeof draft.document !== "object")
        return undefined;
      const document = validRichDocument(draft.document)
        ? draft.document
        : markdownDocument(richPlainText(draft.document as RichNode));
      return {
        value: document,
        ...(typeof draft.version === "number"
          ? { version: draft.version }
          : {}),
      };
    },
    refresh: async () => {
      await refresh();
    },
    validate: richDocumentError,
    persist: async (document, expectedVersion) => {
      const patch: RecordPatch = {
        body: richPlainText(document),
        data: {
          ...inputRef.current.data,
          ...recordRef.current?.data,
          ...(recordRef.current?.data.richContent
            ? {}
            : { legacyBody: recordRef.current?.body ?? initialBody }),
          richContent: { version: 1, document },
        },
      };
      const next = persistRef.current
        ? await persistRef.current(patch, expectedVersion)
        : await writerRef.current(patch, expectedVersion);
      return {
        version: next.version,
        value: document,
        offline: next.id.startsWith("offline-") || isPending(next.id),
      };
    },
  });
  const [linkError, setLinkError] = useState("");
  const [slash, setSlash] = useState<number | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const containerRef = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<string | null>(null);
  const [block, setBlock] = useState(0);
  const [picked, setPicked] = useState(false);
  const grabbedDocument = useRef<RichNode | null>(null);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<RecordRevision[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false, underline: false }),
        LinkExtension.configure({
          openOnClick: false,
          autolink: false,
          defaultProtocol: "https",
          protocols: ["http", "https"],
          isAllowedUri: (url) => {
            try {
              const parsed = new URL(url);
              return (
                url.length <= 2048 &&
                ["http:", "https:"].includes(parsed.protocol) &&
                !parsed.username &&
                !parsed.password
              );
            } catch {
              return false;
            }
          },
        }),
        Underline,
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        Placeholder.configure({
          placeholder: "Write, paste a link, or type / for blocks…",
        }),
      ],
      content: autosave.value,
      editable: editing,
      shouldRerenderOnTransaction: true,
      editorProps: {
        attributes: { "aria-label": label, class: "rich-document-prose" },
        handleClick: (_view, _pos, event) => {
          const anchor = (event.target as HTMLElement).closest("a");
          if (anchor && !editingRef.current && anchor.href) {
            window.open(anchor.href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
        handleKeyDown: (_view, event) => {
          if (event.key === "ArrowDown" && slashRef.current !== null) {
            containerRef.current
              ?.querySelector<HTMLButtonElement>(".rich-slash-menu button")
              ?.focus();
            return true;
          }
          if (event.key === "Escape") {
            setSlash(null);
            setLink(null);
          }
          return false;
        },
      },
      onUpdate: ({ editor: next }) => {
        autosave.setValue(next.getJSON() as RichNode);
        const { $from } = next.state.selection;
        const before = $from.parent.textBetween(0, $from.parentOffset);
        setSlash(before.endsWith("/") ? $from.pos - 1 : null);
      },
      onSelectionUpdate: ({ editor: next }) =>
        setBlock(next.state.selection.$from.index(0)),
    },
    [storageKey],
  );
  useEffect(() => {
    editor?.setEditable(editing);
  }, [editing, editor]);
  useEffect(() => {
    if (!editor) return;
    const currentDocument = editor.getJSON() as RichNode;
    if (JSON.stringify(currentDocument) !== JSON.stringify(autosave.value))
      editor.commands.setContent(autosave.value, { emitUpdate: false });
  }, [autosave.value, editor]);
  useEffect(() => {
    return () => {
      dragCleanup.current?.();
    };
  }, []);
  if (!editor) return null;
  const moveBlock = (from: number, to: number) => {
    const json = editor.getJSON() as RichNode;
    if (!json.content || from === to || to < 0 || to >= json.content.length)
      return;
    const next = [...json.content];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    editor.commands.setContent({ ...json, content: next });
    setBlock(to);
  };
  return (
    <div
      ref={containerRef}
      className={`rich-document ${editing ? "is-editing" : "is-reading"} ${allowBlockReordering ? "" : "rich-document-no-block-reordering"}`}
    >
      {editing &&
        (!editor.state.selection.empty ||
          editor.isActive("codeBlock") ||
          editor.isActive("table")) && (
          <div
            className="rich-selection-toolbar"
            role="toolbar"
            aria-label="Text formatting"
          >
            {(["Bold", "Italic", "Underline"] as const).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={editor.isActive(name.toLowerCase())}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const chain = editor.chain().focus();
                  if (name === "Bold") chain.toggleBold().run();
                  else if (name === "Italic") chain.toggleItalic().run();
                  else chain.toggleUnderline().run();
                }}
              >
                {name[0]}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                setLink(String(editor.getAttributes("link").href ?? ""))
              }
            >
              Link
            </button>
            <button
              type="button"
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .sinkListItem(
                    editor.isActive("taskItem") ? "taskItem" : "listItem",
                  )
                  .run()
              }
            >
              Indent
            </button>
            <button
              type="button"
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .liftListItem(
                    editor.isActive("taskItem") ? "taskItem" : "listItem",
                  )
                  .run()
              }
            >
              Outdent
            </button>
            <button
              type="button"
              aria-label="Undo"
              onClick={() => editor.chain().focus().undo().run()}
            >
              ↶
            </button>
            <button
              type="button"
              aria-label="Redo"
              onClick={() => editor.chain().focus().redo().run()}
            >
              ↷
            </button>
            {editor.isActive("codeBlock") && (
              <Select
                aria-label="Code language"
                value={String(editor.getAttributes("codeBlock").language ?? "")}
                onChange={(event) =>
                  editor
                    .chain()
                    .focus()
                    .updateAttributes("codeBlock", {
                      language: event.target.value,
                    })
                    .run()
                }
              >
                {[
                  "",
                  "python",
                  "javascript",
                  "typescript",
                  "sql",
                  "bash",
                  "java",
                  "cpp",
                  "text",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value || "Plain text"}
                  </option>
                ))}
              </Select>
            )}
            {editor.isActive("table") && (
              <>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().addRowAfter().run()}
                >
                  + Row
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().addColumnAfter().run()}
                >
                  + Column
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().deleteTable().run()}
                >
                  Delete table
                </button>
              </>
            )}
          </div>
        )}
      {link !== null && (
        <form
          className="rich-link-editor"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const url = new URL(normalizeWebUrl(link));
              if (
                url.href.length > 2048 ||
                !["http:", "https:"].includes(url.protocol) ||
                url.username ||
                url.password
              )
                throw new Error();
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: url.href })
                .run();
              setLink(null);
              setLinkError("");
            } catch {
              setLinkError(
                "Enter a valid HTTP or HTTPS link under 2,048 characters.",
              );
            }
          }}
        >
          <Input
            aria-label="Link address"
            autoFocus
            placeholder="example.com"
            value={link}
            onChange={(event) => {
              setLink(event.target.value);
              setLinkError("");
            }}
          />
          {linkError && <span role="alert">{linkError}</span>}
          <Button type="submit">Apply</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              editor.chain().focus().unsetLink().run();
              setLink(null);
            }}
          >
            Remove link
          </Button>
        </form>
      )}
      <div
        className="rich-document-canvas"
        onPointerDown={(event) => {
          if (editing && allowBlockReordering && !picked) {
            const child = (event.target as HTMLElement).closest(".tiptap > *");
            if (child)
              setBlock(Array.from(editor.view.dom.children).indexOf(child));
          }
        }}
        onPointerMove={(event) => {
          if (!editing || !allowBlockReordering || picked) return;
          const child = (event.target as HTMLElement).closest(".tiptap > *");
          if (child)
            setBlock(Array.from(editor.view.dom.children).indexOf(child));
        }}
      >
        {editing && allowBlockReordering && (
          <button
            type="button"
            className={`rich-block-handle ${picked ? "picked" : ""}`}
            aria-label="Arrange block: drag, or Space then arrow keys"
            style={{
              top:
                (editor.view.dom.children[block] as HTMLElement | undefined)
                  ?.offsetTop ?? 8,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              const from = block;
              setPicked(true);
              const release = (up: PointerEvent) => {
                const target = document
                  .elementFromPoint(up.clientX, up.clientY)
                  ?.closest(".tiptap > *");
                const to = target
                  ? Array.from(editor.view.dom.children).indexOf(target)
                  : from;
                moveBlock(from, to);
                setPicked(false);
                document.removeEventListener("pointerup", release);
                document.removeEventListener("pointercancel", cancel);
              };
              const cancel = () => {
                setPicked(false);
                document.removeEventListener("pointerup", release);
                document.removeEventListener("pointercancel", cancel);
              };
              dragCleanup.current = cancel;
              document.addEventListener("pointerup", release);
              document.addEventListener("pointercancel", cancel);
            }}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                grabbedDocument.current = picked
                  ? null
                  : (editor.getJSON() as RichNode);
                setPicked(!picked);
                if (picked) setTimeout(() => void autosave.flush(), 0);
              } else if (event.key === "Escape") {
                dragCleanup.current?.();
                if (grabbedDocument.current)
                  editor.commands.setContent(grabbedDocument.current);
                grabbedDocument.current = null;
                setPicked(false);
              } else if (
                picked &&
                ["ArrowUp", "ArrowDown"].includes(event.key)
              ) {
                event.preventDefault();
                moveBlock(block, block + (event.key === "ArrowUp" ? -1 : 1));
              }
            }}
          >
            <GripVertical size={16} />
          </button>
        )}
        <EditorContent editor={editor} />
      </div>
      {editing && slash !== null && (
        <div
          className="rich-slash-menu"
          role="menu"
          aria-label="Insert block"
          onKeyDown={(event) => {
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            } else if (event.key === "Escape") {
              setSlash(null);
              editor.commands.focus();
            }
          }}
        >
          {commands(editor).map(([name, action]) => (
            <button
              key={name}
              role="menuitem"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .deleteRange({ from: slash, to: slash + 1 })
                  .run();
                action();
                setSlash(null);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {editing && record && (
        <div className="rich-history-tools">
          <Button
            variant="ghost"
            onClick={() => {
              const next = !showHistory;
              setShowHistory(next);
              if (!next || history !== null || historyBusy) return;
              setHistoryBusy(true);
              setHistoryError("");
              void getRevisions(record.id)
                .then(setHistory)
                .catch((failure: unknown) =>
                  setHistoryError(
                    failure instanceof Error
                      ? failure.message
                      : "Earlier content could not be loaded.",
                  ),
                )
                .finally(() => setHistoryBusy(false));
            }}
          >
            {showHistory ? "Hide earlier content" : "Restore earlier content"}
          </Button>
          {showHistory && (
            <div className="rich-history-list">
              {historyBusy && <span>Loading saved content…</span>}
              {historyError && <span role="alert">{historyError}</span>}
              {history?.length === 0 && (
                <span>No earlier content is available.</span>
              )}
              {history?.slice(0, 12).map((revision) => (
                <Button
                  key={revision.id}
                  variant="ghost"
                  onClick={() => {
                    const document =
                      storedRichDocument(revision.data) ??
                      markdownDocument(revision.body);
                    editor.commands.setContent(document);
                    setShowHistory(false);
                  }}
                >
                  Restore from {new Date(revision.createdAt).toLocaleString()}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      {(editing ||
        autosave.error ||
        autosave.conflict ||
        autosave.state === "Offline—will sync") && (
        <div className="rich-save-state" role="status">
          {autosave.state}
          {autosave.error && <span role="alert">{autosave.error}</span>}
        </div>
      )}
      {autosave.conflict && (
        <details className="rich-conflict-review">
          <summary>
            Another session edited this note. Review both copies.
          </summary>
          <div>
            <strong>Saved version</strong>
            <pre>{richPlainText(autosave.savedValue)}</pre>
          </div>
          <div>
            <strong>Your edits</strong>
            <pre>{richPlainText(autosave.value)}</pre>
          </div>
          <Button variant="ghost" onClick={() => void autosave.keepLocal()}>
            Keep my edits
          </Button>
          <Button variant="ghost" onClick={autosave.useSaved}>
            Use saved edits
          </Button>
        </details>
      )}
    </div>
  );
}
