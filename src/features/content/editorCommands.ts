import type { ChainedCommands, Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  CodeSquare,
  Quote,
  Minus,
  Table2,
} from "lucide-react";

export const editorBlocks = [
  {
    id: "paragraph",
    name: "Text",
    description: "A simple paragraph",
    icon: Type,
    keywords: "paragraph normal",
  },
  {
    id: "heading1",
    name: "Heading 1",
    description: "A main section",
    icon: Heading1,
    keywords: "title h1",
  },
  {
    id: "heading2",
    name: "Heading 2",
    description: "A smaller section",
    icon: Heading2,
    keywords: "subtitle h2",
  },
  {
    id: "heading3",
    name: "Heading 3",
    description: "A supporting heading",
    icon: Heading3,
    keywords: "subtitle h3",
  },
  {
    id: "bulletList",
    name: "Bullet list",
    description: "Ideas, one at a time",
    icon: List,
    keywords: "unordered bullets",
  },
  {
    id: "orderedList",
    name: "Numbered list",
    description: "Steps in order",
    icon: ListOrdered,
    keywords: "ordered numbers",
  },
  {
    id: "taskList",
    name: "Task list",
    description: "Things to check off",
    icon: ListTodo,
    keywords: "checklist todo tasks",
  },
  {
    id: "codeBlock",
    name: "Code",
    description: "A block for your code",
    icon: CodeSquare,
    keywords: "snippet programming",
  },
  {
    id: "blockquote",
    name: "Quote",
    description: "Make a thought stand out",
    icon: Quote,
    keywords: "blockquote callout",
  },
  {
    id: "horizontalRule",
    name: "Divider",
    description: "A break between sections",
    icon: Minus,
    keywords: "line separator",
  },
  {
    id: "table",
    name: "Table",
    description: "Compare ideas in a grid",
    icon: Table2,
    keywords: "rows columns",
  },
] as const;

export function matchingBlocks(query: string) {
  const words = query.toLowerCase().trim().split(/\s+/);
  return editorBlocks.filter((block) =>
    words.every((word) =>
      `${block.name} ${block.keywords}`.toLowerCase().includes(word),
    ),
  );
}

export function applyEditorBlock(chain: ChainedCommands, id: string) {
  chain.command(({ tr }) => {
    closeHistory(tr);
    return true;
  });
  switch (id) {
    case "paragraph":
      return chain.clearNodes().setParagraph().run();
    case "heading1":
      return chain.clearNodes().setHeading({ level: 1 }).run();
    case "heading2":
      return chain.clearNodes().setHeading({ level: 2 }).run();
    case "heading3":
      return chain.clearNodes().setHeading({ level: 3 }).run();
    case "bulletList":
      return chain.toggleBulletList().run();
    case "orderedList":
      return chain.toggleOrderedList().run();
    case "taskList":
      return chain.toggleTaskList().run();
    case "codeBlock":
      return chain.toggleCodeBlock().run();
    case "blockquote":
      return chain.toggleBlockquote().run();
    case "horizontalRule":
      return chain.setHorizontalRule().run();
    case "table":
      return chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    default:
      return false;
  }
}

export function currentEditorBlock(editor: Editor) {
  for (const type of [
    "taskList",
    "bulletList",
    "orderedList",
    "codeBlock",
    "blockquote",
  ])
    if (editor.isActive(type)) return type;
  if (editor.isActive("heading"))
    return `heading${editor.getAttributes("heading").level}`;
  return "paragraph";
}
