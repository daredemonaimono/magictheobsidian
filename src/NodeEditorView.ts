import { ItemView, WorkspaceLeaf } from "obsidian";
import { pick, t } from "./i18n";
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
// 内部は id。画面に出す文字は、設定の言語 (redraw で、言語を切り替えたときに、描き直す)
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
    return t("title");
  }
  getIcon() {
    return "blocks";
  }
  async onOpen() {
    await this.refreshKnown();
    this.redraw();
  }
  private async refreshKnown() {
    this.known = new Map((await this.store.all()).map((n) => [n.name, n]));
  }

  redraw() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-ne");
    const d = this.data;
    const again = () => this.redraw();
    const option = (sel: HTMLSelectElement, value: string, text: string, selected = false) => { sel.createEl("option", { text, value }).selected = selected; };

    // 上: 既存のノードを開く / 新規
    const top = root.createDiv("mtg-ne-row");
    const pickSel = top.createEl("select");
    option(pickSel, "", t("openExisting"));
    for (const n of [...this.known.keys()].sort()) option(pickSel, n, n);
    pickSel.onchange = () => {
      const n = this.known.get(pickSel.value);
      if (n) { this.data = structuredClone(n); again(); }
    };
    top.createEl("button", { text: t("newNode") }).onclick = () => { this.data = blank(); again(); };

    // 名前・種類・タイミング
    const name = root.createDiv("mtg-ne-row");
    name.createSpan({ text: t("name") });
    const nameIn = name.createEl("input", { type: "text", value: d.name });
    nameIn.oninput = () => { d.name = nameIn.value; this.update(); };
    const kind = root.createDiv("mtg-ne-row");
    kind.createSpan({ text: t("kind") });
    const kindSel = kind.createEl("select");
    for (const k of KINDS) option(kindSel, k.id, `${pick(k.label)} (CR ${k.cr})`, k.id === d.kind);
    kindSel.onchange = () => { d.kind = kindSel.value; d.timing = kindOf(d.kind)!.timings[0].id; again(); };
    kind.createSpan({ text: t("timing") });
    const timSel = kind.createEl("select");
    for (const tm of kindOf(d.kind)?.timings ?? []) option(timSel, tm.id, `${pick(tm.label)} (CR ${tm.cr})`, tm.id === d.timing);
    timSel.onchange = () => { d.timing = timSel.value; this.update(); };

    // 条件
    const cond = root.createDiv("mtg-ne-block");
    cond.createDiv({ text: t("conditionOpt"), cls: "mtg-ne-h" });
    const condSel = cond.createEl("select");
    option(condSel, "", t("none"));
    for (const c of CONDITIONS) option(condSel, c.id, `${pick(c.label)} (CR ${c.cr})`, c.id === d.condition?.id);
    condSel.onchange = () => { const c = CONDITIONS.find((x) => x.id === condSel.value); d.condition = c ? { id: c.id, args: defaults(c) } : undefined; again(); };
    if (d.condition) this.params(cond, d.condition, CONDITIONS);

    // 手順
    const steps = root.createDiv("mtg-ne-block");
    steps.createDiv({ text: t("stepsHint"), cls: "mtg-ne-h" });
    d.steps.forEach((s, i) => {
      const row = steps.createDiv("mtg-ne-step");
      if (s.node) row.createSpan({ text: `[[${s.id}]]`, cls: "mtg-ne-ref" });
      else {
        row.createSpan({ text: pick(ACTIONS.find((a) => a.id === s.id)?.label ?? { ja: s.id, en: s.id }), cls: "mtg-ne-act" });
        this.params(row, s, ACTIONS);
      }
      const move = (by: number) => { const j = i + by; if (j < 0 || j >= d.steps.length) return; [d.steps[i], d.steps[j]] = [d.steps[j], d.steps[i]]; again(); };
      row.createEl("button", { text: "↑" }).onclick = () => move(-1);
      row.createEl("button", { text: "↓" }).onclick = () => move(1);
      row.createEl("button", { text: "✕" }).onclick = () => { d.steps.splice(i, 1); again(); };
    });
    const add = steps.createEl("select");
    option(add, "", t("addAction"));
    for (const a of ACTIONS) option(add, a.id, `${pick(a.label)} (CR ${a.cr}) ${pick(a.help)}`);
    add.onchange = () => { const a = ACTIONS.find((x) => x.id === add.value); if (a) { d.steps.push({ node: false, id: a.id, args: defaults(a) }); again(); } };
    const call = steps.createEl("select");
    option(call, "", t("callNode"));
    for (const n of [...this.known.keys()].sort()) option(call, n, n);
    call.onchange = () => { if (call.value) { d.steps.push({ node: true, id: call.value }); again(); } };

    // 問題・プレビュー・保存
    root.createDiv("mtg-ne-problems");
    root.createEl("pre", { cls: "mtg-ne-preview" });
    const save = root.createEl("button", { text: t("save"), cls: "mtg-ne-save mod-cta" });
    save.onclick = async () => {
      await this.store.save(d);
      await this.refreshKnown();
      again();
    };
    this.update();
  }

  // 引数の入力欄 (数 = 数字の欄 / 選択 = プルダウン。値は id)
  private params(parent: HTMLElement, c: Call, defs: Def[]) {
    for (const p of defs.find((x) => x.id === c.id)?.params ?? []) {
      parent.createSpan({ text: pick(p.label), cls: "mtg-ne-pl" });
      const v = c.args[p.id] ?? p.default;
      if (p.type === "choice") {
        const sel = parent.createEl("select");
        for (const ch of p.choices!) sel.createEl("option", { text: pick(ch.label), value: ch.id }).selected = ch.id === v;
        sel.onchange = () => { c.args[p.id] = sel.value; this.update(); };
      } else {
        const inp = parent.createEl("input", { type: "text", value: v, cls: "mtg-ne-num" });
        inp.oninput = () => { c.args[p.id] = inp.value; this.update(); };
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
    root.querySelector(".mtg-ne-preview")?.setText(toMd(this.data));
    const save = root.querySelector<HTMLButtonElement>(".mtg-ne-save");
    if (save) save.disabled = problems.length > 0;
  }
}
