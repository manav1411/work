import { Extension, type Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";

const indentTypes = ["paragraph", "heading", "blockquote"];
const maxIndent = 6;

export const Indentation = Extension.create({
  name: "blockIndentation",
  addGlobalAttributes() {
    return [
      {
        types: indentTypes,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) =>
              Math.min(
                maxIndent,
                Math.max(0, Math.trunc(Number(element.dataset.indent)) || 0),
              ),
            renderHTML: ({ indent }) =>
              indent
                ? {
                    "data-indent": indent,
                    style: `margin-left: ${indent * 24}px`,
                  }
                : {},
          },
        },
      },
    ];
  },
});

export function indentEditor(editor: Editor, direction: 1 | -1) {
  if (editor.isActive("table")) return false; // Keep native Tab navigation between cells.
  const { state } = editor;
  const { from, to, $from, $to, empty } = state.selection;
  if (editor.isActive("codeBlock")) {
    const start = $from.start();
    if ($from.parent !== $to.parent) return false;
    const text = $from.parent.textContent;
    const lineStart = text.slice(0, from - start).lastIndexOf("\n") + 1;
    const transaction = state.tr;
    if (direction > 0 && empty) transaction.insertText("  ", from);
    else {
      // Apply edits back to front so the original line positions stay valid.
      const lastLineEnd =
        to > from && text[to - start - 1] === "\n"
          ? to - start - 1
          : to - start;
      const offsets = [lineStart];
      for (let index = lineStart; index < lastLineEnd; index++)
        if (text[index] === "\n") offsets.push(index + 1);
      for (const offset of offsets.reverse()) {
        if (direction > 0) transaction.insertText("  ", start + offset);
        else {
          const spaces =
            /^ {1,2}|^\t/.exec(text.slice(offset))?.[0].length ?? 0;
          if (spaces)
            transaction.delete(start + offset, start + offset + spaces);
        }
      }
      transaction.setSelection(
        TextSelection.create(
          transaction.doc,
          transaction.mapping.map(from),
          transaction.mapping.map(to),
        ),
      );
    }
    if (transaction.docChanged)
      editor.view.dispatch(transaction.scrollIntoView());
    return true;
  }
  if (editor.isActive("listItem") || editor.isActive("taskItem")) {
    const type = editor.isActive("taskItem") ? "taskItem" : "listItem";
    const chain = editor.chain().focus();
    if (direction > 0) chain.sinkListItem(type).run();
    else chain.liftListItem(type).run();
    return true;
  }
  const transaction = state.tr;
  state.doc.nodesBetween(from, to, (node, position, parent) => {
    if (parent?.type.name !== "doc") return false;
    if (indentTypes.includes(node.type.name)) {
      const current = Number(node.attrs.indent ?? 0);
      const index = transaction.doc.resolve(position).index(0);
      const previous = index > 0 ? transaction.doc.child(index - 1) : undefined;
      const ceiling = Math.min(
        maxIndent,
        Number(previous?.attrs.indent ?? 0) + 1,
      );
      // A block can be one level deeper than its predecessor. Repeated Tab is a no-op at that level.
      if (direction > 0 && current >= ceiling) return false;
      const indent = Math.max(0, current + direction);
      if (indent !== node.attrs.indent)
        transaction.setNodeMarkup(position, undefined, {
          ...node.attrs,
          indent,
        });
    }
    return false;
  });
  if (transaction.docChanged)
    editor.view.dispatch(transaction.scrollIntoView());
  return true;
}
