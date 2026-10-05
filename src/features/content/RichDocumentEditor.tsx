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
  storedRichDocument,
  validRichDocument,
  type RichNode,
} from "../../../shared/rich-content";
import { useWorkspace } from "../../lib/workspace";
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
}: {
  record?: WorkRecord;
  input: RecordInput;
  draftKey: string;
  label?: string;
  initialBody?: string;
  initialDocument?: RichNode;
  persist?: (
    patch: RecordPatch,
    expectedVersion?: number,
  ) => Promise<WorkRecord>;
}) {
  const { editing } = useEditMode();
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const { user, create, update, refresh, pending } = useWorkspace();
  const storageKey = `work-rich-draft:${user?.id ?? "anonymous"}:${draftKey}`;
  const server =
    storedRichDocument(record?.data) ??
    initialDocument ??
    markdownDocument(initialBody || record?.body || "");
  const serverString = JSON.stringify(server);
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
  const initial = useRef<{
    document: RichNode;
    recovered: boolean;
    version?: number;
  } | null>(null);
  if (!initial.current) {
    let document = server,
      recovered = false,
      version = record?.version;
    try {
      const draft = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (draft && validRichDocument(draft.document)) {
        document = draft.document;
        recovered = JSON.stringify(document) !== serverString;
        version = draft.version;
      }
    } catch {
      /* Bad optional local draft cannot enter editor schema. */
    }
    initial.current = { document, recovered, version };
  }
  const saved = useRef(serverString);
  const baseVersion = useRef(initial.current.version);
  const current = useRef(initial.current.document);
  const blocked = useRef(initial.current.recovered);
  const saving = useRef(false);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState(
    initial.current.recovered
      ? "Recovered draft — review before saving"
      : "Saved",
  );
  const [error, setError] = useState("");
  const [review, setReview] = useState(initial.current.recovered);
  const [slash, setSlash] = useState<number | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const containerRef = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<string | null>(null);
  const [block, setBlock] = useState(0);
  const [picked, setPicked] = useState(false);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const grabbedDocument = useRef<RichNode | null>(null);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const flush = async () => {
    clearTimeout(timer.current);
    const document = current.current,
      snapshot = JSON.stringify(document);
    if (
      snapshot === saved.current ||
      blocked.current ||
      saving.current ||
      pickedRef.current
    )
      return;
    saving.current = true;
    if (alive.current) setStatus("Saving…");
    try {
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
        ? await persistRef.current(patch, baseVersion.current)
        : await writerRef.current(patch, baseVersion.current);
      baseVersion.current = next.version;
      saved.current = snapshot;
      if (JSON.stringify(current.current) === snapshot) {
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Optional storage. */
        }
      }
      if (alive.current) {
        setError("");
        setStatus(
          next.id.startsWith("offline-") || pending
            ? "Saved on device"
            : "Saved",
        );
      }
    } catch (failure) {
      blocked.current = true;
      if (alive.current) {
        setReview(true);
        setStatus("Draft retained");
        setError(
          failure instanceof Error
            ? failure.message
            : "Changes could not be saved.",
        );
      }
    } finally {
      saving.current = false;
      if (!blocked.current && JSON.stringify(current.current) !== saved.current)
        timer.current = setTimeout(() => void flushRef.current(), 800);
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
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
      content: initial.current.document,
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
        current.current = next.getJSON() as RichNode;
        const dirty = JSON.stringify(current.current) !== saved.current;
        try {
          if (!dirty) localStorage.removeItem(storageKey);
          else
            localStorage.setItem(
              storageKey,
              JSON.stringify({
                version: baseVersion.current,
                document: current.current,
              }),
            );
        } catch {
          /* Draft remains in editor. */
        }
        setStatus(
          blocked.current
            ? "Draft retained — review required"
            : dirty
              ? "Unsaved"
              : "Saved",
        );
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void flushRef.current(), 800);
        const { $from } = next.state.selection;
        const before = $from.parent.textBetween(0, $from.parentOffset);
        setSlash(before.endsWith("/") ? $from.pos - 1 : null);
      },
      onBlur: () => {
        void flushRef.current();
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
    if (saving.current) return;
    if (serverString === saved.current) {
      if (!blocked.current) baseVersion.current = record?.version;
      return;
    }
    if (JSON.stringify(current.current) !== saved.current) {
      blocked.current = true;
      setReview(true);
      setError(
        "Saved content changed in another session. Compare it before keeping your draft.",
      );
      return;
    }
    saved.current = serverString;
    current.current = server;
    baseVersion.current = record?.version;
    editor?.commands.setContent(server, { emitUpdate: false });
  }, [serverString, record?.version, editor]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      dragCleanup.current?.();
      clearTimeout(timer.current);
      void flushRef.current();
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
      className={`rich-document ${editing ? "is-editing" : "is-reading"}`}
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
            } catch {
              setError("Enter a valid HTTP or HTTPS link.");
            }
          }}
        >
          <Input
            aria-label="Link address"
            autoFocus
            placeholder="example.com"
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
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
          if (editing && !picked) {
            const child = (event.target as HTMLElement).closest(".tiptap > *");
            if (child)
              setBlock(Array.from(editor.view.dom.children).indexOf(child));
          }
        }}
        onPointerMove={(event) => {
          if (!editing || picked) return;
          const child = (event.target as HTMLElement).closest(".tiptap > *");
          if (child)
            setBlock(Array.from(editor.view.dom.children).indexOf(child));
        }}
      >
        {editing && (
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
                if (picked) setTimeout(() => void flushRef.current(), 0);
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
      {(editing || review || error) && (
        <div className="rich-save-state" role="status">
          {status}
          {error && <span role="alert">{error}</span>}
          {review && (
            <>
              <details>
                <summary>Compare saved content</summary>
                <pre>{richPlainText(server)}</pre>
              </details>
              <Button variant="ghost" onClick={() => void refresh()}>
                Load latest saved version
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  blocked.current = false;
                  baseVersion.current = recordRef.current?.version;
                  setReview(false);
                  setError("");
                  void flushRef.current();
                }}
              >
                Keep reviewed draft
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
