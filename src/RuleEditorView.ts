import { ItemView, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { addAbility, addNode, blankRule, connect, moveNode, problems, removeAbility, removeNode, setArg, setAs, setIf, setUnsupported } from "./battle/editor";
import { AbilityKind, CardRule } from "./battle/node";
import { allConditions, allNodes, getNode } from "./battle/registry";
import { writeRule } from "./battle/ruleMd";

export const RULE_EDITOR_VIEW = "mtg-rule-editor";

export type LoadResult = { rule: CardRule } | { error: string };
export interface EditorActions {
  load(card: string): Promise<LoadResult>;
  save(card: string, md: string): Promise<"created" | "updated" | "same">; // 履歴を残してから書く (saveRule)
}

const KIND_LABEL: Record<AbilityKind, string> = { spell: "呪文能力", activated: "起動型能力", triggered: "誘発型能力", static: "常在型能力" };
const SVG = "http://www.w3.org/2000/svg";

// ノード設定画面。能力ごとの列に、ノードのカードが実行順に並ぶ。パレットから追加 (ドラッグかクリック)、カードの見出しのドラッグで並べ替え、
// 出力の点から入力の点へドラッグでつなぐ。変更は画面の中だけで、「保存」を押したときにシステムが履歴を残して md を書く。
// 組み替えの計算は battle/editor.ts (純粋なロジック、テスト済み)。ここは描くだけ。
// 入力欄の変更では画面を描き直さない (描き直すと、直後に押そうとしたボタンが消えて、クリックが無効になる)。赤い表示や保存ボタンだけをその場で更新する
export class RuleEditorView extends ItemView {
  private card = "";
  private rule: CardRule | null = null;
  private saved = ""; // 最後に保存 (または読み込み) したときのルール (JSON)
  private error = "";
  private showMd = false;
  private lane = 0; // パレットのクリックで追加する先の能力
  private headTitle: HTMLElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private revertBtn: HTMLButtonElement | null = null;
  private probEl: HTMLElement | null = null;
  private nodeEls = new Map<string, HTMLElement>();
  private refSels: { el: HTMLSelectElement; a: number; n: number; k: string }[] = []; // つなぐ先の選択欄 (as が変わったら、選択肢だけ直す)
  private busy = false; // 保存中
  private mainEl: HTMLElement | null = null;
  private svgEl: SVGElement | null = null;

  constructor(leaf: WorkspaceLeaf, private actions: EditorActions) {
    super(leaf);
  }

  getViewType() {
    return RULE_EDITOR_VIEW;
  }
  getDisplayText() {
    return this.card ? `ノード: ${this.card}` : "ノード設定";
  }
  getIcon() {
    return "workflow";
  }
  // 未保存の編集 (draft) も持つ。タブを動かしたり、再起動したりしても消えない
  getState() {
    return { card: this.card, draft: this.dirty() ? this.rule : undefined };
  }
  async setState(state: { card?: string; draft?: CardRule }, result: ViewStateResult) {
    this.card = state?.card ?? "";
    await super.setState(state, result);
    await this.reload();
    if (state?.draft) {
      this.rule = state.draft;
      this.paint();
    }
  }
  async onOpen() {
    this.contentEl.addClass("mtg-ed");
    this.paint();
  }
  async onClose() {
    if (this.dirty()) new Notice(`${this.card}: 保存していない変更があったまま閉じた (変更は保存されていない)`);
    this.contentEl.empty();
  }
  onResize() {
    if (this.rule && this.mainEl && this.svgEl) this.drawLines(this.mainEl, this.svgEl, this.rule);
  }

  private async reload() {
    const r = this.card ? await this.actions.load(this.card) : { error: "カードが指定されていない" };
    if ("error" in r) {
      this.error = r.error;
      this.rule = null;
    } else {
      this.error = "";
      this.rule = r.rule;
      this.saved = JSON.stringify(r.rule);
    }
    this.lane = 0;
    this.paint();
  }

  private dirty() {
    return !!this.rule && JSON.stringify(this.rule) !== this.saved;
  }

  // 構造が変わる操作 (ノードの追加・削除・並べ替え・接続・as の付け替え): 描き直す
  private change(next: CardRule) {
    this.rule = next;
    this.paint();
  }

  // 引数の入力: 描き直さずに、赤い表示と保存ボタンだけを更新する
  private quiet(next: CardRule) {
    this.rule = next;
    this.status();
  }

  private status() {
    const rule = this.rule;
    if (!rule) return;
    const ps = problems(rule);
    this.headTitle?.setText(`${this.dirty() ? "● " : ""}${this.card}`);
    if (this.saveBtn) this.saveBtn.disabled = this.busy || !this.dirty() || ps.length > 0;
    if (this.revertBtn) this.revertBtn.disabled = this.busy || !this.dirty();
    const bad = new Set(ps.filter((p) => p.node !== null).map((p) => `${p.ability}:${p.node}`));
    this.nodeEls.forEach((el, key) => el.toggleClass("bad", bad.has(key)));
    if (this.probEl) {
      this.probEl.empty();
      for (const p of ps) this.probEl.createDiv({ text: `${KIND_LABEL[rule.abilities[p.ability].kind]} ${(p.node ?? 0) + 1} 番目: ${p.message}` });
    }
  }

  private async persist() {
    const rule = this.rule;
    if (!rule || this.busy) return;
    const ps = problems(rule);
    if (ps.length) return void new Notice(`保存できない: 赤いノードを直してください (${ps.length} 件)`);
    this.busy = true;
    this.status();
    try {
      const r = await this.actions.save(this.card, writeRule(rule));
      this.saved = JSON.stringify(rule); // 書いた内容を基準にする (保存中に編集が入っていたら、dirty のまま残る)
      new Notice(r === "same" ? `${this.card}: 変更なし` : `${this.card}: 保存した (前の内容は履歴に残した)`);
    } catch (e) {
      new Notice(`${this.card}: 保存に失敗した: ${(e as Error).message}`);
    }
    this.busy = false;
    this.status();
  }

  private paint() {
    const root = this.contentEl;
    const keep = this.mainEl;
    const scroll = keep ? { top: keep.scrollTop, left: keep.scrollLeft } : { top: 0, left: 0 };
    root.empty();
    this.nodeEls.clear();
    this.refSels = [];
    this.headTitle = this.saveBtn = this.revertBtn = this.probEl = this.mainEl = null;
    this.svgEl = null;
    const head = root.createDiv("mtg-ed-head");
    this.headTitle = head.createEl("strong", { text: this.card || "(カード未指定)" });
    if (!this.rule) {
      root.createEl("p", { text: this.error, cls: "mtg-ed-error" });
      if (this.card) {
        root.createEl("button", { text: "空のルールから作る(保存すると、いまの md は履歴に残る)" }).onclick = () => {
          this.rule = blankRule(this.card);
          this.paint();
        };
      }
      return;
    }
    const rule = this.rule;

    this.saveBtn = head.createEl("button", { text: "保存", cls: "mod-cta" });
    this.saveBtn.onclick = () => void this.persist();
    this.revertBtn = head.createEl("button", { text: "元に戻す" });
    this.revertBtn.onclick = () => void this.reload();
    head.createEl("button", { text: this.showMd ? "md を隠す" : "md を見る" }).onclick = () => {
      this.showMd = !this.showMd;
      this.paint();
    };
    this.probEl = root.createDiv("mtg-ed-problems");

    const body = root.createDiv("mtg-ed-body");
    const main = body.createDiv("mtg-ed-main");
    this.mainEl = main;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "mtg-ed-svg");
    main.appendChild(svg);
    this.svgEl = svg;

    rule.abilities.forEach((ab, a) => {
      const lane = main.createDiv({ cls: `mtg-ed-lane${a === this.lane ? " sel" : ""}` });
      const lh = lane.createDiv("mtg-ed-lanehead");
      lh.createEl("strong", { text: KIND_LABEL[ab.kind] });
      lh.createSpan({ text: a === this.lane ? "(パレットのクリックで追加する先)" : "(見出しをクリックで追加先にする)", cls: "setting-item-description" });
      lh.onclick = () => {
        if (this.lane !== a) {
          this.lane = a;
          this.paint();
        }
      };
      lh.createEl("button", { text: "能力を消す" }).onclick = (e) => {
        e.stopPropagation();
        this.lane = 0;
        this.change(removeAbility(this.rule!, a));
      };
      const row = lane.createDiv("mtg-ed-row");
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const id = e.dataTransfer?.getData("text/mtg-node");
        if (id) this.change(addNode(this.rule!, a, id));
      });
      if (!ab.body.length) row.createSpan({ text: "ここにパレットからノードをドラッグして追加", cls: "setting-item-description" });
      ab.body.forEach((call, n) => {
        if (n) row.createSpan({ text: "→", cls: "mtg-ed-arrow" });
        const def = getNode(call.node);
        const card = row.createDiv("mtg-ed-node");
        this.nodeEls.set(`${a}:${n}`, card);
        card.addEventListener("dragover", (e) => e.preventDefault());
        card.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = e.dataTransfer?.getData("text/mtg-node");
          const mv = e.dataTransfer?.getData("text/mtg-move");
          if (id) this.change(addNode(this.rule!, a, id, n));
          else if (mv) {
            const [fa, fn] = mv.split(":").map(Number);
            if (fa === a && fn !== n) this.change(moveNode(this.rule!, a, fn, n));
          }
        });
        const nh = card.createDiv("mtg-ed-nodehead");
        nh.draggable = true;
        nh.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/mtg-move", `${a}:${n}`));
        nh.createSpan({ text: def ? def.title : `未知: ${call.node}`, cls: "mtg-ed-title" });
        nh.createSpan({ text: call.node, cls: "setting-item-description" });
        nh.createEl("button", { text: "✕" }).onclick = (e) => {
          e.stopPropagation();
          this.change(removeNode(this.rule!, a, n));
        };
        if (!def) return;
        if (Object.keys(def.outputs).length || call.as) {
          const ar = card.createDiv("mtg-ed-param");
          ar.createSpan({ text: "as" });
          const input = ar.createEl("input", { type: "text", value: call.as ?? "", placeholder: "名前" });
          input.onchange = () => {
            this.rule = setAs(this.rule!, a, n, input.value.trim() || undefined);
            this.refreshRefs();
            this.status();
          };
          if (Object.keys(def.outputs).length) {
            // 出力の点: ここから、後ろのノードの入力の点へドラッグしてつなぐ
            const out = ar.createSpan({ cls: "mtg-ed-port out" });
            out.draggable = true;
            out.dataset.out = `${a}:${n}`;
            out.title = "ここから、つなぎたい入力の点へドラッグ";
            out.addEventListener("dragstart", (e) => {
              e.stopPropagation();
              e.dataTransfer?.setData("text/mtg-port", `${a}:${n}`);
            });
          }
        }
        // 条件: このノードは、その条件のときだけ実行する (「〜なら」「代わりに」)
        const cr = card.createDiv("mtg-ed-param");
        cr.createSpan({ text: "条件", cls: "mtg-ed-label" });
        const cs = cr.createEl("select");
        cs.createEl("option", { text: "(条件なし)", value: "" });
        const opts = allConditions().flatMap((c) => [{ v: c.id, t: c.title }, { v: `!${c.id}`, t: `${c.title}ではない` }]);
        if (call.if && !opts.some((o) => o.v === call.if)) opts.push({ v: call.if, t: call.if });
        for (const o of opts) cs.createEl("option", { text: o.t, value: o.v });
        cs.value = call.if ?? "";
        cs.onchange = () => this.quiet(setIf(this.rule!, a, n, cs.value || undefined));
        for (const [k, p] of Object.entries(def.params)) {
          const pr = card.createDiv("mtg-ed-param");
          const v = call.args[k];
          if (p.type === "ref") {
            const port = pr.createSpan({ cls: "mtg-ed-port in" });
            port.dataset.in = `${a}:${n}:${k}`;
            port.addEventListener("dragover", (e) => e.preventDefault());
            port.addEventListener("drop", (e) => {
              const from = e.dataTransfer?.getData("text/mtg-port");
              if (!from) return; // パレットや並べ替えのドロップは、カードに任せる
              e.preventDefault();
              e.stopPropagation();
              const [fa, fn] = from.split(":").map(Number);
              if (fa !== a || fn >= n) return void new Notice("つなげるのは、同じ能力の、前のノードからだけ");
              this.change(connect(this.rule!, a, fn, n, k));
            });
          }
          pr.createSpan({ text: `${k}${p.required ? " *" : ""}`, cls: "mtg-ed-label" });
          if (p.type === "ref") {
            const sel = pr.createEl("select");
            this.refSels.push({ el: sel, a, n, k });
            this.fillRefSel(sel, a, n, k);
            sel.onchange = () => this.change(setArg(this.rule!, a, n, k, sel.value ? { ref: sel.value } : undefined));
          } else if (p.choices) {
            const sel = pr.createEl("select");
            if (!p.required) sel.createEl("option", { text: "(未指定)", value: "" });
            for (const c of p.choices) sel.createEl("option", { text: c, value: c });
            sel.value = typeof v === "string" ? v : "";
            sel.onchange = () => this.quiet(setArg(this.rule!, a, n, k, sel.value || undefined));
          } else if (p.type === "boolean" && !p.required) {
            // 任意の真偽は3択: 指定なし / はい / いいえ (チェックボックスだと、外すだけで false を書いてしまい、「攻撃中でない」の絞り込みになる)
            const sel = pr.createEl("select");
            for (const [val, text] of [["", "(未指定)"], ["true", "はい"], ["false", "いいえ"]]) sel.createEl("option", { text, value: val });
            sel.value = typeof v === "boolean" ? String(v) : "";
            sel.onchange = () => this.quiet(setArg(this.rule!, a, n, k, sel.value === "" ? undefined : sel.value === "true"));
          } else if (p.type === "boolean") {
            const cb = pr.createEl("input", { type: "checkbox" });
            cb.checked = v === true;
            cb.onchange = () => this.quiet(setArg(this.rule!, a, n, k, cb.checked));
          } else if (p.type === "number") {
            const num = pr.createEl("input", { type: "number", value: typeof v === "number" ? String(v) : "", attr: { step: "1", ...(p.min !== undefined ? { min: String(p.min) } : {}) } });
            num.onchange = () => this.quiet(setArg(this.rule!, a, n, k, num.value === "" ? undefined : Number(num.value)));
          } else {
            const txt = pr.createEl("input", { type: "text", value: typeof v === "string" ? v : "" });
            txt.onchange = () => this.quiet(setArg(this.rule!, a, n, k, txt.value.trim() === "" ? undefined : txt.value));
          }
        }
        card.createDiv({ text: def.summary, cls: "setting-item-description mtg-ed-sum" });
      });
    });

    // 能力の追加
    const addRow = main.createDiv("mtg-ed-addrow");
    const kinds = addRow.createEl("select");
    for (const [k, label] of Object.entries(KIND_LABEL)) kinds.createEl("option", { text: label, value: k });
    addRow.createEl("button", { text: "能力を追加" }).onclick = () => {
      this.lane = this.rule!.abilities.length;
      this.change(addAbility(this.rule!, kinds.value as AbilityKind));
    };

    // ノードで表せない部分のメモ
    const note = main.createDiv("mtg-ed-note");
    note.createEl("strong", { text: "未対応(ノードで表せない部分。1行ずつ)" });
    const area = note.createEl("textarea", { attr: { rows: "3" } });
    area.value = (rule.unsupported ?? []).join("\n");
    area.style.width = "100%";
    area.onchange = () => this.quiet(setUnsupported(this.rule!, area.value.split("\n")));

    if (this.showMd) main.createEl("pre", { text: writeRule(rule), cls: "mtg-ed-md" });

    // パレット: 登録されているノード。クリックで選んだ能力の最後に追加、ドラッグで好きな位置へ
    const pal = body.createDiv("mtg-ed-palette");
    pal.createEl("strong", { text: "ノード" });
    for (const def of allNodes()) {
      const item = pal.createDiv("mtg-ed-pal-item");
      item.draggable = true;
      item.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/mtg-node", def.id));
      item.createEl("div", { text: def.title, cls: "mtg-ed-title" });
      item.createEl("div", { text: `${def.id} — ${def.summary}`, cls: "setting-item-description" });
      item.onclick = () => {
        const cur = this.rule!;
        if (!cur.abilities.length) return void new Notice("先に「能力を追加」してください");
        this.change(addNode(cur, Math.min(this.lane, cur.abilities.length - 1), def.id));
      };
    }

    this.status();
    // 接続の線: 描き終わったあとの位置から引く
    requestAnimationFrame(() => {
      main.scrollTop = scroll.top;
      main.scrollLeft = scroll.left;
      this.drawLines(main, svg, rule);
    });
  }

  // つなぐ先の選択肢: 前のノードの as。いまの値が一覧に無ければ (赤く出るように) 足す
  private fillRefSel(sel: HTMLSelectElement, a: number, n: number, k: string) {
    const body = this.rule!.abilities[a].body;
    const v = body[n].args[k];
    sel.empty();
    sel.createEl("option", { text: "(未接続)", value: "" });
    const names = body.slice(0, n).map((c) => c.as).filter((x): x is string => !!x);
    if (typeof v === "object" && !names.includes(v.ref)) names.push(v.ref);
    for (const nm of names) sel.createEl("option", { text: `$${nm}`, value: nm });
    sel.value = typeof v === "object" ? v.ref : "";
  }

  // as の付け替えのあと: 描き直さずに、選択肢と線だけ直す
  private refreshRefs() {
    for (const r of this.refSels) this.fillRefSel(r.el, r.a, r.n, r.k);
    if (this.rule && this.mainEl && this.svgEl) this.drawLines(this.mainEl, this.svgEl, this.rule);
  }

  private drawLines(main: HTMLElement, svg: SVGElement, rule: CardRule) {
    svg.empty();
    svg.setAttribute("width", String(main.scrollWidth));
    svg.setAttribute("height", String(main.scrollHeight));
    const o = main.getBoundingClientRect();
    const mid = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - o.left + main.scrollLeft + r.width / 2, y: r.top - o.top + main.scrollTop + r.height / 2 };
    };
    rule.abilities.forEach((ab, a) => {
      ab.body.forEach((call, n) => {
        for (const [k, v] of Object.entries(call.args)) {
          if (typeof v !== "object") continue;
          const src = ab.body.findIndex((c, i) => i < n && c.as === v.ref);
          const from = src >= 0 ? main.querySelector(`[data-out="${a}:${src}"]`) : null;
          const to = main.querySelector(`[data-in="${a}:${n}:${k}"]`);
          if (!from || !to) continue;
          const p1 = mid(from);
          const p2 = mid(to);
          const path = document.createElementNS(SVG, "path");
          path.setAttribute("d", `M${p1.x},${p1.y} C${p1.x + 60},${p1.y} ${p2.x - 60},${p2.y} ${p2.x},${p2.y}`);
          path.setAttribute("class", "mtg-ed-line");
          svg.appendChild(path);
        }
      });
    });
  }
}
