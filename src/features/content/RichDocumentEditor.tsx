import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import {
  GripVertical,
  Check,
  CloudOff,
  LoaderCircle,
  X,
  Link2,
} from "lucide-react";
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
import { useEditMode } from "../../lib/edit-mode";
import { Button, Input } from "../../components/ui";
import { markdownDocument } from "./markdownDocument";
import { contentRecordWriter } from "./recordWriter";
import { Indentation, indentEditor } from "./Indentation";
import { EditorToolbar } from "./EditorToolbar";
import { applyEditorBlock, matchingBlocks } from "./editorCommands";
import "./content.css";
import "./editor.css";

type SlashMenu = {
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
};

function slashMenu(
  editor: Editor,
  container: HTMLElement | null,
): SlashMenu | null {
  const { $from, empty } = editor.state.selection;
  if (
    !empty ||
    !["paragraph", "heading"].includes($from.parent.type.name) ||
    !container
  )
    return null;
  const before = $from.parent.textBetween(0, $from.parentOffset);
  const match = /^\/([\w -]{0,40})$/.exec(before);
  if (!match) return null;
  const caret = editor.view.coordsAtPos($from.pos);
  const rect = container.getBoundingClientRect();
  const availableHeight = Math.min(360, window.innerHeight * 0.45);
  const below = window.innerHeight - caret.bottom;
  return {
    from: $from.start(),
    to: $from.pos,
    query: match[1],
    left: Math.max(
      8,
      Math.min(caret.left - rect.left + container.scrollLeft, rect.width - 288),
    ),
    top:
      (below < availableHeight && caret.top > availableHeight
        ? caret.top - availableHeight - 8
        : caret.bottom + 8) -
      rect.top +
      container.scrollTop,
  };
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
  placeholder = "Write something, or type / for blocks…",
  compact = false,
}: {
  record?: WorkRecord;
  input: RecordInput;
  draftKey: string;
  label?: string;
  initialBody?: string;
  initialDocument?: RichNode;
  allowBlockReordering?: boolean;
  placeholder?: string;
  compact?: boolean;
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
    markdownDocument(initialBody);
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
  const [slash, setSlash] = useState<SlashMenu | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashIndexRef = useRef(slashIndex);
  slashIndexRef.current = slashIndex;
  const menuId = useId();
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const containerRef = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<string | null>(null);
  const [block, setBlock] = useState(0);
  const [picked, setPicked] = useState(false);
  const grabbedDocument = useRef<RichNode | null>(null);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);

  const activeEditor = useRef<Editor | null>(null);
  const editor: Editor | null = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false, underline: false }),
        LinkExtension.configure({
          openOnClick: false,
          autolink: true,
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
        Indentation,
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        Placeholder.configure({
          placeholder,
        }),
      ],
      content: autosave.value,
      editable: editing,
      immediatelyRender: false,
      shouldRerenderOnTransaction: true,
      editorProps: {
        attributes: {
          "aria-label": label,
          role: "textbox",
          "aria-multiline": "true",
          class: "rich-document-prose",
        },
        handleClick: (_view, _pos, event) => {
          const anchor = (event.target as HTMLElement).closest("a");
          if (anchor && !editingRef.current && anchor.href) {
            window.open(anchor.href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
        handlePaste: (_view, event) => {
          const editor = activeEditor.current;
          if (!editingRef.current || editor?.isActive("codeBlock"))
            return false;
          const clipboard = event.clipboardData;
          const text = clipboard?.getData("text/plain") ?? "";
          // Let Tiptap preserve formatted HTML; recognize Markdown from plain-text sources.
          if (
            clipboard?.getData("text/html") ||
            !/^(?:#{1,6} |[-*+] |\d+\. |```|> )/m.test(text)
          )
            return false;
          const document = markdownDocument(text);
          if (!editor || !validRichDocument(document)) return false;
          event.preventDefault();
          editor.commands.insertContent(document.content ?? []);
          return true;
        },
        handleKeyDown: (_view, event): boolean => {
          const editor = activeEditor.current;
          if (!editingRef.current) return false;
          if (
            event.key === "Tab" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            editor
          ) {
            setSlash(null);
            return indentEditor(editor, event.shiftKey ? -1 : 1);
          }
          const shortcut =
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            !event.shiftKey;
          if (
            shortcut &&
            ["b", "i", "u"].includes(event.key.toLowerCase()) &&
            editor
          ) {
            event.preventDefault();
            const chain = editor.chain().focus();
            if (event.key.toLowerCase() === "b") chain.toggleBold().run();
            else if (event.key.toLowerCase() === "i")
              chain.toggleItalic().run();
            else chain.toggleUnderline().run();
            return true;
          }
          if (shortcut && event.key.toLowerCase() === "k") {
            event.preventDefault();
            setLink(String(editor?.getAttributes("link").href ?? ""));
            setLinkError("");
            return true;
          }
          if (shortcut && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void autosave.flush();
            return true;
          }
          const menu = slashRef.current;
          if (menu) {
            const blocks = matchingBlocks(menu.query);
            if (["ArrowDown", "ArrowUp"].includes(event.key) && blocks.length) {
              setSlashIndex(
                (current) =>
                  (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    blocks.length) %
                  blocks.length,
              );
              return true;
            }
            if (event.key === "Enter" && blocks.length) {
              const block = blocks[slashIndexRef.current] ?? blocks[0];
              if (editor)
                applyEditorBlock(
                  editor.chain().focus().deleteRange(menu),
                  block.id,
                );
              setSlash(null);
              return true;
            }
            if (event.key === "Escape") {
              setSlash(null);
              return true;
            }
          }
          return false;
        },
      },
      onUpdate: ({ editor: next }) => {
        autosave.setValue(next.getJSON() as RichNode);
        const menu = slashMenu(next, containerRef.current);
        if (menu?.query !== slashRef.current?.query) setSlashIndex(0);
        setSlash(menu);
      },
      onSelectionUpdate: ({ editor: next }) => {
        setBlock(next.state.selection.$from.index(0));
        const menu = slashMenu(next, containerRef.current);
        if (menu?.query !== slashRef.current?.query) setSlashIndex(0);
        setSlash(menu);
      },
      onBlur: () => {
        void autosave.flush();
      },
    },
    [storageKey],
  );
  activeEditor.current = editor;
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editing, false);
    if (!editing) {
      setSlash(null);
      setLink(null);
    }
  }, [editing, editor]);
  useEffect(() => {
    const dom = containerRef.current?.querySelector<HTMLElement>(".tiptap");
    if (!dom) return;
    if (slash) {
      dom.setAttribute("aria-controls", menuId);
      const blocks = matchingBlocks(slash.query);
      if (blocks[slashIndex])
        dom.setAttribute(
          "aria-activedescendant",
          `${menuId}-${blocks[slashIndex].id}`,
        );
      else dom.removeAttribute("aria-activedescendant");
    } else {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    }
    containerRef.current
      ?.querySelector('[role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [editor, slash, slashIndex, menuId]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const currentDocument = editor.getJSON() as RichNode;
    if (JSON.stringify(currentDocument) !== JSON.stringify(autosave.value))
      editor.commands.setContent(autosave.value, { emitUpdate: false });
  }, [autosave.value, editor]);
  useEffect(() => {
    return () => {
      dragCleanup.current?.();
    };
  }, []);
  if (!editor || editor.isDestroyed) return null;
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
  const text = richPlainText(autosave.value).trim();
  const words = text ? text.split(/\s+/u).length : 0;
  const blocks = slash ? matchingBlocks(slash.query) : [];
  const openLink = () => {
    setLink(String(editor.getAttributes("link").href ?? ""));
    setLinkError("");
    setSlash(null);
  };
  return (
    <div
      ref={containerRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          if (link !== null) {
            setLink(null);
            editor.commands.focus();
          }
        }
      }}
      className={`rich-document ${compact ? "is-compact" : ""} ${editing ? "is-editing" : "is-reading"} ${allowBlockReordering ? "" : "rich-document-no-block-reordering"}`}
    >
      {editing && (
        <EditorToolbar
          editor={editor}
          onLink={openLink}
          container={containerRef.current}
        />
      )}
      {editing && link !== null && (
        <form
          className="rich-link-editor"
          aria-label="Edit link"
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
          <Link2 size={16} />
          <Input
            aria-label="Link address"
            aria-invalid={Boolean(linkError)}
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
          <button
            className="rich-tool"
            type="button"
            aria-label="Cancel link"
            onClick={() => {
              setLink(null);
              editor.commands.focus();
            }}
          >
            <X size={16} />
          </button>
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
        onScroll={() => setSlash(null)}
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
                (
                  containerRef.current?.querySelector(".tiptap")?.children[
                    block
                  ] as HTMLElement | undefined
                )?.offsetTop ?? 8,
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
          id={menuId}
          role="listbox"
          aria-label="Insert block"
          style={{ left: slash.left, top: slash.top }}
        >
          <p className="rich-menu-caption">
            {slash.query ? `Blocks matching “${slash.query}”` : "Turn into"}
          </p>
          {blocks.map(({ id, name, description, icon: Icon }, index) => (
            <button
              key={id}
              id={`${menuId}-${id}`}
              role="option"
              aria-selected={index === slashIndex}
              type="button"
              className="rich-block-option"
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => setSlashIndex(index)}
              onClick={() => {
                applyEditorBlock(editor.chain().focus().deleteRange(slash), id);
                setSlash(null);
              }}
            >
              <span className="rich-block-icon">
                <Icon size={18} />
              </span>
              <span>
                <strong>{name}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
          {!blocks.length && (
            <p className="rich-menu-empty">
              No blocks found. Try “code” or “list”.
            </p>
          )}
          <div className="rich-menu-help">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </div>
        </div>
      )}
      {(editing ||
        autosave.error ||
        autosave.conflict ||
        autosave.state === "Offline—will sync") && (
        <footer className="rich-document-footer">
          <div className="rich-footer-status">
            {(editing ||
              autosave.error ||
              autosave.conflict ||
              autosave.state === "Offline—will sync") && (
              <span
                className={`rich-save-state ${autosave.error ? "has-error" : ""}`}
                role="status"
              >
                {autosave.error ? (
                  <X size={13} />
                ) : autosave.state === "Offline—will sync" ? (
                  <CloudOff size={13} />
                ) : autosave.state === "Saving…" ? (
                  <LoaderCircle size={13} className="rich-save-spinner" />
                ) : (
                  <Check size={13} />
                )}
                {autosave.state}
              </span>
            )}
            {editing && (
              <span className="rich-writing-hint">
                <kbd>/</kbd> for blocks · <kbd>Tab</kbd> to indent
              </span>
            )}
          </div>
          {editing && (
            <span className="rich-word-count">
              {words.toLocaleString()} {words === 1 ? "word" : "words"}
            </span>
          )}
        </footer>
      )}
      {autosave.error && (
        <div className="rich-save-error" role="alert">
          {autosave.error}
          {!autosave.conflict && (
            <Button variant="ghost" onClick={() => void autosave.flush()}>
              Retry save
            </Button>
          )}
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
