import type { ComponentType } from "react";
import type { Editor } from "@tiptap/react";
import * as Popover from "@radix-ui/react-popover";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link2,
  Undo2,
  Redo2,
  List,
  ListOrdered,
  ListTodo,
  Plus,
  ChevronDown,
  IndentIncrease,
  IndentDecrease,
  RemoveFormatting,
  ArrowRightFromLine,
  Trash2,
} from "lucide-react";
import { Select } from "../../components/ui";
import {
  applyEditorBlock,
  currentEditorBlock,
  editorBlocks,
} from "./editorCommands";

function Tool({
  label,
  icon: Icon,
  active,
  disabled,
  action,
}: {
  label: string;
  icon: ComponentType<{ size?: number }>;
  active?: boolean;
  disabled?: boolean;
  action: () => void;
}) {
  return (
    <button
      type="button"
      className="rich-tool"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      <Icon size={17} />
    </button>
  );
}

export function EditorToolbar({
  editor,
  onLink,
  container,
}: {
  editor: Editor;
  onLink: () => void;
  container: HTMLElement | null;
}) {
  const listItem = editor.isActive("taskItem") ? "taskItem" : "listItem";
  return (
    <>
      <div
        className="rich-editor-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        <div className="rich-toolbar-group">
          <Select
            aria-label="Block style"
            className="rich-block-select"
            value={currentEditorBlock(editor)}
            onChange={(event) =>
              applyEditorBlock(editor.chain().focus(), event.target.value)
            }
          >
            {editorBlocks
              .filter(
                (block) => !["horizontalRule", "table"].includes(block.id),
              )
              .map((block) => (
                <option key={block.id} value={block.id}>
                  {block.name}
                </option>
              ))}
            {![1, 2, 3].includes(
              Number(editor.getAttributes("heading").level),
            ) &&
              editor.isActive("heading") && (
                <option value={currentEditorBlock(editor)}>
                  Heading {editor.getAttributes("heading").level}
                </option>
              )}
          </Select>
        </div>
        <div className="rich-toolbar-group">
          <Tool
            label="Bold (⌘/Ctrl+B)"
            icon={Bold}
            active={editor.isActive("bold")}
            action={() => {
              editor.chain().focus().toggleBold().run();
            }}
          />
          <Tool
            label="Italic (⌘/Ctrl+I)"
            icon={Italic}
            active={editor.isActive("italic")}
            action={() => {
              editor.chain().focus().toggleItalic().run();
            }}
          />
          <Tool
            label="Underline (⌘/Ctrl+U)"
            icon={Underline}
            active={editor.isActive("underline")}
            action={() => {
              editor.chain().focus().toggleUnderline().run();
            }}
          />
          <Tool
            label="Strikethrough"
            icon={Strikethrough}
            active={editor.isActive("strike")}
            action={() => {
              editor.chain().focus().toggleStrike().run();
            }}
          />
          <Tool
            label="Inline code"
            icon={Code}
            active={editor.isActive("code")}
            action={() => {
              editor.chain().focus().toggleCode().run();
            }}
          />
          <Tool
            label="Link (⌘/Ctrl+K)"
            icon={Link2}
            active={editor.isActive("link")}
            action={onLink}
          />
        </div>
        <div className="rich-toolbar-group">
          <Tool
            label="Bullet list"
            icon={List}
            active={editor.isActive("bulletList")}
            action={() => {
              editor.chain().focus().toggleBulletList().run();
            }}
          />
          <Tool
            label="Numbered list"
            icon={ListOrdered}
            active={editor.isActive("orderedList")}
            action={() => {
              editor.chain().focus().toggleOrderedList().run();
            }}
          />
          <Tool
            label="Task list"
            icon={ListTodo}
            active={editor.isActive("taskList")}
            action={() => {
              editor.chain().focus().toggleTaskList().run();
            }}
          />
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="rich-tool rich-insert-trigger"
                aria-label="Insert block"
                title="Insert block"
              >
                <Plus size={16} />
                <span>Insert</span>
                <ChevronDown size={12} />
              </button>
            </Popover.Trigger>
            <Popover.Portal container={container}>
              <Popover.Content
                className="rich-insert-menu"
                sideOffset={8}
                align="start"
                collisionPadding={12}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  editor.commands.focus();
                }}
                onKeyDown={(event) => {
                  if (
                    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                  )
                    return;
                  const buttons = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "button",
                    ),
                  );
                  const index = buttons.indexOf(
                    event.target as HTMLButtonElement,
                  );
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : (index +
                            (event.key === "ArrowUp" ? -1 : 1) +
                            buttons.length) %
                          buttons.length;
                  event.preventDefault();
                  buttons[next]?.focus();
                }}
              >
                <p className="rich-menu-caption">Add structure</p>
                {editorBlocks.map(({ id, name, description, icon: Icon }) => (
                  <Popover.Close asChild key={id}>
                    <button
                      type="button"
                      className="rich-block-option"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        applyEditorBlock(editor.chain().focus(), id)
                      }
                    >
                      <span className="rich-block-icon">
                        <Icon size={18} />
                      </span>
                      <span>
                        <strong>{name}</strong>
                        <small>{description}</small>
                      </span>
                    </button>
                  </Popover.Close>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        <div className="rich-toolbar-group rich-toolbar-history">
          <Tool
            label="Clear formatting"
            icon={RemoveFormatting}
            action={() => {
              editor.chain().focus().unsetAllMarks().clearNodes().run();
            }}
          />
          <Tool
            label="Undo"
            icon={Undo2}
            disabled={!editor.can().undo()}
            action={() => {
              editor.chain().focus().undo().run();
            }}
          />
          <Tool
            label="Redo"
            icon={Redo2}
            disabled={!editor.can().redo()}
            action={() => {
              editor.chain().focus().redo().run();
            }}
          />
        </div>
      </div>
      {(editor.isActive("listItem") ||
        editor.isActive("taskItem") ||
        editor.isActive("codeBlock") ||
        editor.isActive("table")) && (
        <div
          className="rich-context-toolbar"
          role="toolbar"
          aria-label="Block formatting"
        >
          {(editor.isActive("listItem") || editor.isActive("taskItem")) && (
            <>
              <Tool
                label="Indent list item"
                icon={IndentIncrease}
                disabled={!editor.can().sinkListItem(listItem)}
                action={() => {
                  editor.chain().focus().sinkListItem(listItem).run();
                }}
              />
              <Tool
                label="Outdent list item"
                icon={IndentDecrease}
                disabled={!editor.can().liftListItem(listItem)}
                action={() => {
                  editor.chain().focus().liftListItem(listItem).run();
                }}
              />
            </>
          )}
          {editor.isActive("codeBlock") && (
            <>
              <span>Language</span>
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
              <Tool
                label="Exit code block"
                icon={ArrowRightFromLine}
                action={() => {
                  editor.chain().focus().exitCode().run();
                }}
              />
            </>
          )}
          {editor.isActive("table") && (
            <>
              {(
                [
                  ["Add row", () => editor.chain().focus().addRowAfter().run()],
                  [
                    "Add column",
                    () => editor.chain().focus().addColumnAfter().run(),
                  ],
                  [
                    "Delete row",
                    () => editor.chain().focus().deleteRow().run(),
                  ],
                  [
                    "Delete column",
                    () => editor.chain().focus().deleteColumn().run(),
                  ],
                  [
                    "Toggle header",
                    () => editor.chain().focus().toggleHeaderRow().run(),
                  ],
                ] as const
              ).map(([label, action]) => (
                <button
                  type="button"
                  key={label}
                  className="rich-context-action"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={action}
                >
                  {label}
                </button>
              ))}
              <Tool
                label="Delete table"
                icon={Trash2}
                action={() => {
                  editor.chain().focus().deleteTable().run();
                }}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
