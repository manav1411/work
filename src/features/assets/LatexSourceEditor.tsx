import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { MergeView } from "@codemirror/merge";

export default function LatexSourceEditor({
  value,
  onChange,
  readOnly,
  original,
  line,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  original?: string;
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
        color: "var(--muted)",
        borderColor: "var(--line)",
      },
      ".cm-content": { caretColor: "var(--ink)" },
    });
    const extensions = [
      basicSetup,
      StreamLanguage.define(stex),
      EditorView.lineWrapping,
      theme,
    ];
    if (original !== undefined) {
      const merge = new MergeView({
        a: {
          doc: original,
          extensions: [
            ...extensions,
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
          ],
        },
        b: {
          doc: value,
          extensions: [
            ...extensions,
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
            EditorView.updateListener.of((update) => {
              if (update.docChanged)
                callback.current(update.state.doc.toString());
            }),
          ],
        },
        parent: host.current,
        highlightChanges: true,
        gutter: true,
        revertControls: readOnly ? undefined : "a-to-b",
        renderRevertControl: () => {
          const button = document.createElement("button");
          button.textContent = "→";
          button.title = "Copy this change into working source";
          button.setAttribute("aria-label", button.title);
          return button;
        },
      });
      editor.current = merge.b;
      return () => {
        editor.current = undefined;
        merge.destroy();
      };
    }
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
  }, [readOnly, original]);
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
