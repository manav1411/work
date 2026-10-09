import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags } from "@lezer/highlight";

const latexHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.tagName, tags.keyword, tags.macroName],
    color: "var(--link-colour)",
  },
  { tag: [tags.atom, tags.number, tags.bool], color: "var(--latex-atom)" },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "var(--latex-string)",
  },
  {
    tag: [tags.standard(tags.variableName), tags.special(tags.variableName)],
    color: "var(--latex-atom)",
  },
  { tag: tags.bracket, color: "var(--ink)" },
  { tag: tags.comment, color: "var(--muted)" },
  { tag: tags.invalid, color: "var(--latex-error)" },
]);

export default function LatexSourceEditor({
  value,
  onChange,
  readOnly,
  line,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  line?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>(undefined);
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const theme = EditorView.theme({
      "&": {
        height: "100%",
        backgroundColor: "var(--paper)",
        color: "var(--ink)",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "monospace",
        fontSize: "13px",
      },
      ".cm-gutters": {
        backgroundColor: "var(--surface-tint)",
        color: "color-mix(in srgb, var(--muted) 85%, var(--ink))",
        borderColor: "var(--line)",
      },
      ".cm-content": { caretColor: "var(--ink)" },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--ink) 3%, var(--paper))",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--surface-tint)",
        color: "var(--ink)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "color-mix(in srgb, var(--blue) 15%, var(--paper))",
      },
    });
    const extensions = [
      basicSetup,
      StreamLanguage.define(stex),
      syntaxHighlighting(latexHighlightStyle),
      EditorView.lineWrapping,
      theme,
    ];
    const view = new EditorView({
      doc: value,
      extensions: [
        ...extensions,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callback.current(update.state.doc.toString());
        }),
      ],
      parent: host.current,
    });
    editor.current = view;
    return () => {
      editor.current = undefined;
      view.destroy();
    };
    // External source changes are synchronized without resetting the cursor.
  }, [readOnly]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);
  useEffect(() => {
    const view = editor.current;
    if (view && line) {
      const target = view.state.doc.line(
        Math.min(Math.max(1, line), view.state.doc.lines),
      );
      view.dispatch({
        selection: { anchor: target.from },
        effects: EditorView.scrollIntoView(target.from, { y: "center" }),
      });
      view.focus();
    }
  }, [line]);
  return (
    <div
      className="latex-source-editor"
      ref={host}
      aria-label="LaTeX source editor"
    />
  );
}
