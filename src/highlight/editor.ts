import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { FENCE_CLOSE, FENCE_OPEN, tokenize } from "./tokens";

// 編集表示 (ライブ・プレビュー / ソース): ```mtg-node ブロックの中を、色分けする (閲覧表示は、Prism: main.ts)
const marks: Record<string, Decoration> = {};
const mark = (cls: string) => (marks[cls] ??= Decoration.mark({ class: `mtg-tok ${cls}` }));

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let inBlock = false;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (!inBlock) { inBlock = FENCE_OPEN.test(line.text); continue; }
    if (FENCE_CLOSE.test(line.text)) { inBlock = false; continue; }
    for (const t of tokenize(line.text)) b.add(line.from + t.from, line.from + t.to, mark(t.cls));
  }
  return b.finish();
}

export const mtgNodeEditorHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = build(u.view); }
  },
  { decorations: (v) => v.decorations },
);
