import { ItemView, WorkspaceLeaf } from "obsidian";
import { ACTIONS, CONDITIONS, Def } from "./node/actions";
import { KINDS, kindOf } from "./node/kinds";
import { Call, NodeData, defaults, toMd } from "./node/md";
import { validate } from "./node/validate";

export const NODE_EDITOR_VIEW = "mtg-node-editor";

export interface NodeStore {
  all(): Promise<NodeData[]>; // いま保存されているノード
  save(n: NodeData): Promise<void>;
}

const blank = (): NodeData => ({ name: "", kind: KINDS[0].id, timing: KINDS[0].timings[0].id, steps: [] });

// ノードを作る画面。種類・タイミングは総合ルール (kinds.ts)、動作・条件は actions.ts から選ぶ。問題があると、保存できない。
export class NodeEditorView extends ItemView {
  private data: NodeData = blank();
  private known = new Map<string, NodeData>();
  constructor(leaf: WorkspaceLeaf, private store: NodeStore) {
    super(leaf);
  }
  getViewType() {
    return NODE_EDITOR_VIEW;
  }
  getDisplayText() {
    return "ノードを作る";
  }
  getIcon() {
    return "blocks";
  }
  async onOpen() {
    await this.refreshKnown();
    this.render();
  }
  private async refreshKnown() {
    this.known = new Map((await this.store.all()).map((n) => [n.name, n]));
  }

  private render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-ne");
    const d = this.data;
    const rerender = () => this.render();

    // 上: 既存のノードを開く / 新規
    const top = root.createDiv("mtg-ne-row");
    const pick = top.createEl("select");
    pick.createEl("option", { text: "既存のノードを開く…", value: "" });
    for (const n of [...this.known.keys()].sort()) pick.createEl("option", { text: n, value: n });
    pick.onchange = () => {
      const n = this.known.get(pick.value);
      if (n) { this.data = structuredClone(n); rerender(); }
    };
    top.createEl("button", { text: "新規" }).onclick = () => { this.data = blank(); rerender(); };

    // 名前・種類・タイミング
    const name = root.createDiv("mtg-ne-row");
    name.createSpan({ text: "名前" });
    const nameIn = name.createEl("input", { type: "text", value: d.name });
    nameIn.oninput = () => { d.name = nameIn.value; this.update(); };
    const kind = root.createDiv("mtg-ne-row");
    kind.createSpan({ text: "種類" });
    const kindSel = kind.createEl("select");
    for (const k of KINDS) kindSel.createEl("option", { text: `${k.id} (CR ${k.cr})`, value: k.id }).selected = k.id === d.kind;
    kindSel.onchange = () => { d.kind = kindSel.value; d.timing = kindOf(d.kind)!.timings[0].id; rerender(); };
    kind.createSpan({ text: "タイミング" });
    const timSel = kind.createEl("select");
    for (const t of kindOf(d.kind)?.timings ?? []) timSel.createEl("option", { text: `${t.id} (CR ${t.cr})`, value: t.id }).selected = t.id === d.timing;
    timSel.onchange = () => { d.timing = timSel.value; this.update(); };

    // 条件
    const cond = root.createDiv("mtg-ne-block");
    cond.createDiv({ text: "条件 (任意)", cls: "mtg-ne-h" });
    const condSel = cond.createEl("select");
    condSel.createEl("option", { text: "なし", value: "" });
    for (const c of CONDITIONS) condSel.createEl("option", { text: `${c.id} (CR ${c.cr})`, value: c.id }).selected = c.id === d.condition?.id;
    condSel.onchange = () => { const c = CONDITIONS.find((x) => x.id === condSel.value); d.condition = c ? { id: c.id, args: defaults(c) } : undefined; rerender(); };
    if (d.condition) this.params(cond, d.condition, CONDITIONS);

    // 手順
    const steps = root.createDiv("mtg-ne-block");
    steps.createDiv({ text: "手順 (上から順に行う)", cls: "mtg-ne-h" });
    d.steps.forEach((s, i) => {
      const row = steps.createDiv("mtg-ne-step");
      if (s.node) row.createSpan({ text: `[[${s.id}]]`, cls: "mtg-ne-ref" });
      else {
        row.createSpan({ text: s.id, cls: "mtg-ne-act" });
        this.params(row, s, ACTIONS);
      }
      const move = (by: number) => { const j = i + by; if (j < 0 || j >= d.steps.length) return; [d.steps[i], d.steps[j]] = [d.steps[j], d.steps[i]]; rerender(); };
      row.createEl("button", { text: "↑" }).onclick = () => move(-1);
      row.createEl("button", { text: "↓" }).onclick = () => move(1);
      row.createEl("button", { text: "✕" }).onclick = () => { d.steps.splice(i, 1); rerender(); };
    });
    const add = steps.createEl("select");
    add.createEl("option", { text: "+ 動作を足す…", value: "" });
    for (const a of ACTIONS) add.createEl("option", { text: `${a.id} (CR ${a.cr}) ${a.help}`, value: a.id });
    add.onchange = () => { const a = ACTIONS.find((x) => x.id === add.value); if (a) { d.steps.push({ node: false, id: a.id, args: defaults(a) }); rerender(); } };
    const call = steps.createEl("select");
    call.createEl("option", { text: "+ 別のノードを呼ぶ…", value: "" });
    for (const n of [...this.known.keys()].sort()) call.createEl("option", { text: n, value: n });
    call.onchange = () => { if (call.value) { d.steps.push({ node: true, id: call.value }); rerender(); } };

    // 問題・プレビュー・保存
    root.createDiv("mtg-ne-problems");
    root.createEl("pre", { cls: "mtg-ne-preview" });
    const save = root.createEl("button", { text: "保存", cls: "mtg-ne-save mod-cta" });
    save.onclick = async () => {
      await this.store.save(d);
      await this.refreshKnown();
      rerender();
    };
    this.update();
  }

  // 引数の入力欄 (数 = 数字の欄 / 選択 = プルダウン)
  private params(parent: HTMLElement, c: Call, defs: Def[]) {
    const def = defs.find((x) => x.id === c.id);
    for (const p of def?.params ?? []) {
      parent.createSpan({ text: p.label, cls: "mtg-ne-pl" });
      const v = c.args[p.label] ?? p.default;
      if (p.type === "choice") {
        const sel = parent.createEl("select");
        for (const ch of p.choices!) sel.createEl("option", { text: ch, value: ch }).selected = ch === v;
        sel.onchange = () => { c.args[p.label] = sel.value; this.update(); };
      } else {
        const inp = parent.createEl("input", { type: "text", value: v, cls: "mtg-ne-num" });
        inp.oninput = () => { c.args[p.label] = inp.value; this.update(); };
      }
    }
  }

  // 問題とプレビューと保存ボタンを、入力のたびに更新する (画面全体は作り直さない)
  private update() {
    const root = this.contentEl;
    const problems = validate(this.data, (n) => this.known.get(n));
    const box = root.querySelector(".mtg-ne-problems");
    if (box) {
      box.empty();
      for (const p of problems) box.createDiv({ text: `・${p}`, cls: "mtg-ne-problem" });
    }
    const pre = root.querySelector(".mtg-ne-preview");
    if (pre) pre.setText(toMd(this.data));
    const save = root.querySelector<HTMLButtonElement>(".mtg-ne-save");
    if (save) save.disabled = problems.length > 0;
  }
}
