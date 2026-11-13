import { ItemView, WorkspaceLeaf } from "obsidian";
import { Label, getLang, pick, t } from "./i18n";
import { ACTIONS, CONDITIONS, Def } from "./node/actions";
import { KINDS, kindOf } from "./node/kinds";
import { CardSearchModal } from "./CardSearchModal";
import { CardData, Print } from "./node/card";
import { CARD_TYPES } from "./node/cardtypes";
import { candidates } from "./node/split";
import { Call, NodeData, defaults } from "./node/md";
import { KEYWORDS, TARGETS } from "./node/slots";
import { ScryCard, cardsOf, fromScryfall } from "./node/scryfall";
import { validate } from "./node/validate";

export const NODE_EDITOR_VIEW = "mtg-node-editor";

export interface NodeStore {
  cards(): Promise<CardData[]>; // カード (Cards/)。ノードは、カードのノートの中に、コードブロックで入る
  saveCard(c: CardData): Promise<void>;
  search(query: string): Promise<ScryCard[]>; // Scryfall を名前で探す
  art(id: string, url: string): Promise<string>; // 絵をローカルに保存して、画面に出せるパスを返す (保存済みなら、取りに行かない)
  prints(oracleId: string): Promise<Print[]>; // 版違い (同じカードの、すべての印刷)
  addCard(c: CardData): Promise<CardData>; // Cards/ に保存する (同じ名前が、すでにあれば、それを返す)
}

const nodeLbl = (id: string): Label => ({ ja: id, en: id });
const blank = (): NodeData => ({ name: "", kind: KINDS[0].id, timing: KINDS[0].timings[0].id, steps: [] });
interface Item { slot: string; id: string; label: Label; cr: string; args?: Record<string, string> }

// ノードを作る画面。左: 仮のカードの枠 (線だけ。能力 = カードの中のノード) と、その下の検索欄 / 中: 部品を矢羽根のチップで並べる盤面。
// カード (Cards/<名前>.md) の中に、能力のノードが、コードブロックで入る。ノードの置き場は、カードのノートだけ。
// 内部は id。画面に出す文字は、設定の言語 (redraw で、言語を切り替えたときに、描き直す)
const newCard = (): CardData => ({ name: "", abilities: [] });
export class NodeEditorView extends ItemView {
  private card: CardData = newCard();
  private sel = 0; // 編集している能力
  private get data(): NodeData | undefined { // 能力が無いとき (まだ選んでいない) は、無い
    return this.card.abilities[this.sel];
  }
  private cards = new Map<string, CardData>();
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
    this.cards = new Map((await this.store.cards()).map((c) => [c.name, c]));
  }

  // 版違い (すべての印刷) も、同時に取る。デッキで、版を選ぶときのため。取れなくても、取り込みは続ける
  private async withPrints(got: CardData, found: ScryCard): Promise<CardData> {
    if (!found.oracle_id) return got;
    try {
      const prints = await this.store.prints(found.oracle_id);
      return prints.length ? { ...got, prints } : got;
    } catch {
      return got;
    }
  }

  // マナ・コスト ({4}{B}) を、Scryfall のマナ・シンボルのアイコンで出す ({W/U} → WU.svg)。取れないときは、文字のまま
  private manaIcons(parent: HTMLElement, mana: string) {
    const box = parent.createSpan("mtg-mana");
    for (const part of mana.split(/(\{[^}]+\})/).filter(Boolean)) {
      const m = /^\{([^}]+)\}$/.exec(part);
      if (m) box.createEl("img", { cls: "mtg-mana-icon", attr: { src: `https://svgs.scryfall.io/card-symbols/${m[1].replace("/", "")}.svg`, alt: part } });
      else box.createSpan({ text: part });
    }
  }

  // 設定が日本語で、日本語の印刷がまだ無いとき (英語名で探したとき): 同じカードの日本語版を探して、日本語の名前・原文を足す
  private async withJapanese(got: CardData, found: ScryCard): Promise<CardData> {
    if (getLang() !== "ja" || got.textJa || !found.oracle_id) return got;
    try {
      const ja = cardsOf({ object: "list", data: await this.store.search(`oracleid:${found.oracle_id} lang:ja`), id: "", name: "" })[0];
      if (!ja) return got;
      const { nameJa, textJa, typeLineJa } = fromScryfall(ja, true);
      return { ...got, ...(nameJa ? { nameJa } : {}), ...(textJa ? { textJa } : {}), ...(typeLineJa ? { typeLineJa } : {}) };
    } catch {
      return got; // 日本語版が無くても、英語で取り込める
    }
  }

  private shows: (() => void)[] = []; // 検索欄の一覧を、描き直す関数 (部品を置くたびに、設定済みのものを外す)

  redraw() {
    this.shows = [];
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-ne");
    const d = this.data;
    const c = this.card;
    const again = () => this.redraw();
    const names = c.abilities.filter((_, i) => i !== this.sel).map((a) => a.name).filter(Boolean); // 呼べるノード = 同じカードの、ほかの能力

    // 左: カードを開く / 新規 → カードの枠 (線だけ) → その下に検索欄
    const left = root.createDiv("mtg-ne-left");
    const top = left.createDiv("mtg-ne-row");
    top.createEl("button", { text: t("newCard") }).onclick = () => {
      new CardSearchModal(this.app, (q) => this.store.search(q), async (found) => {
        this.card = await this.store.addCard(await this.withPrints(await this.withJapanese(fromScryfall(found, getLang() === "ja"), found), found));
        this.sel = 0;
        await this.refreshKnown();
        this.redraw();
      }).open();
    };
    // カードを開く: 検索できる (カード名・日本語名)。カードが増えても探せる
    const openBox = top.createDiv("mtg-ne-open");
    const openIn = openBox.createEl("input", { type: "text" });
    openIn.placeholder = t("openCard");
    const found = openBox.createDiv("mtg-ne-open-list");
    const showCards = () => {
      found.empty();
      const q = openIn.value.trim().toLowerCase();
      const hits = [...this.cards.values()].filter((x) => !q || `${x.name} ${x.nameJa ?? ""}`.toLowerCase().includes(q)).sort((x, y) => x.name.localeCompare(y.name)).slice(0, 50);
      for (const x of hits) {
        const row = found.createDiv({ text: getLang() === "ja" && x.nameJa ? `${x.nameJa} (${x.name})` : x.name, cls: "mtg-ne-item" });
        row.onmousedown = (e) => {
          e.preventDefault(); // 欄の焦点が外れて、一覧が消える前に開く
          this.card = structuredClone(x);
            this.sel = 0;
          again();
        };
      }
    };
    openIn.onfocus = showCards;
    openIn.oninput = showCards;
    openIn.onblur = () => found.empty();

    const frame = left.createDiv("mtg-ne-card");
    // カード名とマナ・コスト (アイコン): 取り込んだカードは、名前 (設定が日本語なら日本語名) と、右にコスト。取り込み前は、名前の入力欄
    const ja = getLang() === "ja";
    if (c.name) {
      const nameBar = frame.createDiv("mtg-ne-card-name mtg-ne-card-namebar");
      nameBar.createSpan({ text: ja ? c.nameJa || c.name : c.name, cls: "mtg-ne-card-nametext" });
      if (c.mana) this.manaIcons(nameBar, c.mana);
    } else {
      const cardName = frame.createEl("input", { type: "text", value: c.name, cls: "mtg-ne-card-name" });
      cardName.placeholder = t("cardName");
      cardName.oninput = () => { c.name = cardName.value; this.update(); };
    }
    const art = frame.createDiv("mtg-ne-card-art"); // 絵 (取り込みで入る)
    // ローカルに保存した絵を出す (まだ無ければ、ここで保存する)。取れなければ、URL のまま
    if (c.art && c.scryfall) void this.store.art(c.scryfall, c.art).then((src) => (art.style.backgroundImage = `url("${src}")`)).catch(() => (art.style.backgroundImage = `url("${c.art}")`));
    else if (c.art) art.style.backgroundImage = `url("${c.art}")`;
    // タイプ行 (「クリーチャー — サイ」): 取り込んだカードは、その文字。取り込み前は、カードタイプの選択欄
    const typeLine = ja ? c.typeLineJa || c.typeLine : c.typeLine;
    if (typeLine) frame.createDiv({ text: typeLine, cls: "mtg-ne-card-type" });
    else {
      const typeSel = frame.createEl("select", { cls: "mtg-ne-card-type" });
      typeSel.createEl("option", { text: t("none"), value: "" });
      for (const ty of CARD_TYPES) typeSel.createEl("option", { text: pick(ty.label), value: ty.id }).selected = ty.id === c.type;
      typeSel.onchange = () => { c.type = typeSel.value || undefined; this.update(); };
    }
    const text = frame.createDiv("mtg-ne-card-text");
    c.abilities.forEach((a, i) => {
      if (i !== this.sel) {
        const row = text.createDiv({ text: a.name || "—", cls: "mtg-ne-ability" });
        row.onclick = () => { this.sel = i; again(); };
        return;
      }
      const row = text.createDiv("mtg-ne-ability is-on");
      // 長い原文も見えるように、折り返す欄 (名前に、改行は入れられない)
      const nameIn = row.createEl("textarea", { cls: "mtg-ne-name" });
      nameIn.value = a.name;
      nameIn.rows = 1;
      nameIn.placeholder = t("name");
      nameIn.onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };
      nameIn.oninput = () => { a.name = nameIn.value.replace(/[\r\n]+/g, " "); this.update(); };
      row.createEl("button", { text: "✕", cls: "mtg-ne-x" }).onclick = () => { c.abilities.splice(i, 1); this.sel = Math.max(0, i - 1); again(); };
    });
    frame.createEl("button", { text: t("addAbility"), cls: "mtg-ne-new" }).onclick = () => { c.abilities.push(blank()); this.sel = c.abilities.length - 1; again(); };

    // 中: 盤面 (チップ・問題・保存)
    const mid = root.createDiv("mtg-ne-mid");
    if (c.text) {
      // 原文: 1 行ずつ、能力の候補 (カード名・コスト・タイプ行は、左のカードの枠に出す)。押すと、その能力ができる。候補が無ければ、枠も出さない
      let ref: HTMLElement | undefined;
      for (const cand of candidates(c, getLang())) {
        // できているか: 原文の行 (source) で見る。source を持たない古い能力は、名前で見て、source を足す
        const at = c.abilities.findIndex((a) => (a.source ? a.source === cand.node.source : [cand.node.name, ...cand.alt].includes(a.name)));
        if (at >= 0 && !c.abilities[at].source) c.abilities[at].source = cand.node.source;
        if (at >= 0) continue; // できている能力は、候補から外す
        ref ??= mid.createDiv("mtg-ne-ref-text");
        const row = ref.createDiv({ cls: "mtg-ne-cand" });
        row.createSpan({ text: cand.line });
        row.onclick = () => {
          const blankOnly = c.abilities.length === 1 && !c.abilities[0].name && !c.abilities[0].steps.length;
          if (blankOnly) c.abilities[0] = structuredClone(cand.node);
          else c.abilities.push(structuredClone(cand.node));
          this.sel = blankOnly ? 0 : c.abilities.length - 1;
          again();
        };
      }
    }
    // 盤面: すべての能力を、1 つずつの板にして並べる。押した板が、選択中になり、左の検索欄が、その能力のものに切り替わる
    c.abilities.forEach((a, i) => {
      const board = mid.createDiv("mtg-ne-board");
      board.style.setProperty("--kind-color", `var(--color-${kindOf(a.kind)?.color ?? "base-50"})`); // 種類の色
      board.toggleClass("is-sel", i === this.sel);
      const head = board.createDiv("mtg-ne-board-head");
      head.createSpan({ text: a.name || "—", cls: "mtg-ne-act" });
      head.createSpan({ text: pick(kindOf(a.kind)?.label ?? nodeLbl(a.kind)), cls: "mtg-ne-pl" });
      const box = board.createDiv("mtg-ne-chips");
      box.dataset.i = String(i);
      const choose = () => { if (this.sel !== i) { this.sel = i; again(); } };
      head.onclick = choose;
      box.onclick = (e) => { if (e.target === box) choose(); };
      box.ondragover = (e) => e.preventDefault();
      box.ondrop = (e) => {
        e.preventDefault();
        const changed = this.sel !== i;
        this.sel = i;
        try { this.apply(JSON.parse(e.dataTransfer?.getData("text/plain") ?? "")); } catch { /* 部品ではないものは無視 */ }
        if (changed) again();
      };
    });
    mid.createDiv("mtg-ne-problems");
    mid.createEl("button", { text: t("saveCard"), cls: "mtg-ne-save-card mod-cta" }).onclick = async () => {
      await this.store.saveCard(c);
      await this.refreshKnown();
      again();
    };

    // 右: 検索欄だけ (ここでは作らない)。見つけた部品を、中央の盤面へドラッグ (またはクリック) して組む
    if (d) {
      const panel = left.createDiv("mtg-ne-panel");
      panel.style.setProperty("--kind-color", `var(--color-${kindOf(d.kind)?.color ?? "base-50"})`);
      const kindSel = panel.createEl("select", { cls: "mtg-ne-kind" });
      for (const k of KINDS) kindSel.createEl("option", { text: pick(k.label), value: k.id }).selected = k.id === d.kind;
      kindSel.onchange = () => { d.kind = kindSel.value; d.timing = kindOf(d.kind)!.timings[0].id; again(); };

      if (d.kind === "keyword") {
        // キーワード能力: キーワードを選ぶだけ
        this.palette(panel, t("keyword"), KEYWORDS.map((k) => ({ slot: "keyword", id: k.id, label: k.label, cr: k.cr })));
      } else {
        this.palette(panel, t("timing"), (kindOf(d.kind)?.timings ?? []).map((x) => ({ slot: "timing", id: x.id, label: x.label, cr: x.cr })));
        this.palette(panel, t("target"), TARGETS.map((x) => ({ slot: "target", id: x.id, label: x.label, cr: x.cr })));
        this.palette(panel, t("condition"), CONDITIONS.map((x) => ({ slot: "condition", id: x.id, label: x.label, cr: x.cr })));
        this.palette(panel, t("effect"), [
          ...ACTIONS.map((x) => ({ slot: "step", id: x.id, label: x.label, cr: x.cr })),
          // キーワードの引用: 「キーワード能力を与える」を、そのキーワードで置く
          ...KEYWORDS.map((k) => ({ slot: "step", id: "grant-keyword", args: { keyword: k.id }, label: k.label, cr: k.cr })),
          ...names.map((n) => ({ slot: "node", id: n, label: nodeLbl(n), cr: "" })),
        ]);
      }

    }
    this.update();
  }

  // 検索欄 + 部品の一覧 (打つと絞られる。ドラッグ、またはクリックで、盤面に置く)
  private palette(parent: HTMLElement, title: string, items: Item[]) {
    parent.createDiv({ text: title, cls: "mtg-ne-h" });
    const input = parent.createEl("input", { type: "text", cls: "mtg-ne-search" });
    input.placeholder = `▼ ${t("search")}`;
    const list = parent.createDiv("mtg-ne-list");
    const show = () => {
      list.empty();
      const q = input.value.trim().toLowerCase();
      for (const it of items) {
        if (this.isUsed(it)) continue;
        const text = pick(it.label);
        if (q && !`${it.label.ja} ${it.label.en}`.toLowerCase().includes(q)) continue;
        const row = list.createDiv({ text: it.cr ? `${text} (CR ${it.cr})` : text, cls: "mtg-ne-item" });
        row.draggable = true;
        row.ondragstart = (e) => e.dataTransfer?.setData("text/plain", JSON.stringify(it));
        row.onclick = () => this.apply(it);
      }
    };
    input.oninput = show;
    this.shows.push(show);
    show();
  }

  // その部品は、いまの能力に、もう設定されているか (設定済みのものは、一覧に出さず、置けない)
  private isUsed(it: Item): boolean {
    const d = this.data;
    if (!d) return true;
    switch (it.slot) {
      case "timing": return d.timing === it.id;
      case "target": return d.target === it.id;
      case "keyword": return d.keyword === it.id;
      case "condition": return d.condition?.id === it.id;
      case "node": return d.steps.some((s) => s.node && s.id === it.id);
      default: return d.steps.some((s) => !s.node && s.id === it.id && (it.args?.keyword === undefined || (s.args.keyword ?? "").split("|").includes(it.args.keyword)));
    }
  }

  // 部品を盤面に置く (タイミング・対象・条件・キーワードは、置き換え。効果は、後ろに足す)
  private apply(it: Item) {
    const d = this.data;
    if (!d || this.isUsed(it)) return;
    if (it.slot === "timing") d.timing = it.id;
    else if (it.slot === "target") d.target = it.id;
    else if (it.slot === "keyword") {
      // キーワードを選ぶと、その定義 (動作) が、手順に入る
      d.keyword = it.id;
      d.steps = structuredClone(KEYWORDS.find((k) => k.id === it.id)?.steps ?? []).map((x) => ({ node: false as const, ...x }));
    }
    else if (it.slot === "condition") { const c = CONDITIONS.find((x) => x.id === it.id); if (c) d.condition = { id: c.id, args: defaults(c) }; }
    else if (it.slot === "node") d.steps.push({ node: true, id: it.id });
    else { const a = ACTIONS.find((x) => x.id === it.id); if (a) d.steps.push({ node: false, id: a.id, args: { ...defaults(a), ...it.args } }); }
    this.update();
  }

  // 引数の入力欄 (数 = 数字の欄 / 選択 = プルダウン。値は id)
  private params(parent: HTMLElement, c: Call, defs: Def[], changed = () => this.update()) {
    for (const p of defs.find((x) => x.id === c.id)?.params ?? []) {
      parent.createSpan({ text: pick(p.label), cls: "mtg-ne-pl" });
      const v = c.args[p.id] ?? p.default;
      if (p.type === "choice") {
        const sel = parent.createEl("select");
        for (const ch of p.choices!) sel.createEl("option", { text: pick(ch.label), value: ch.id }).selected = ch.id === v;
        sel.onchange = () => { c.args[p.id] = sel.value; changed(); };
      } else if (p.type === "multi") {
        // 複数選ぶ: 開くと、チェックの一覧
        const on = new Set(v.split("|").filter(Boolean));
        const box = parent.createEl("details", { cls: "mtg-ne-multi" });
        const sum = box.createEl("summary", { text: String(on.size) });
        // 選択肢が増えても探せるように、検索欄で絞れる (一覧は、スクロール)
        const find = box.createEl("input", { type: "text", cls: "mtg-ne-multi-find" });
        find.placeholder = t("search");
        const list = box.createDiv("mtg-ne-multi-list");
        find.oninput = () => {
          const q = find.value.trim().toLowerCase();
          list.querySelectorAll<HTMLElement>(".mtg-ne-multi-row").forEach((r) => r.toggleClass("is-hidden", !!q && !(r.dataset.q ?? "").includes(q)));
        };
        for (const ch of p.choices!) {
          const row = list.createEl("label", { cls: "mtg-ne-multi-row" });
          row.dataset.q = `${ch.label.ja} ${ch.label.en}`.toLowerCase();
          const cb = row.createEl("input", { type: "checkbox" });
          cb.checked = on.has(ch.id);
          row.createSpan({ text: pick(ch.label) });
          cb.onchange = () => {
            if (cb.checked) on.add(ch.id); else on.delete(ch.id);
            c.args[p.id] = p.choices!.filter((x) => on.has(x.id)).map((x) => x.id).join("|");
            sum.setText(String(on.size));
            changed();
          };
        }
      } else {
        const inp = parent.createEl("input", { type: "text", value: v, cls: "mtg-ne-num" });
        inp.oninput = () => { c.args[p.id] = inp.value; changed(); };
      }
    }
  }

  // 矢羽根のチップ。部品の並び: キーワード > タイミング > 対象 > 条件 > 効果…。引数は、チップの中で直す。✕ で外す
  private chips(box: HTMLElement, d: NodeData) {
    const quiet = () => this.update(false); // 引数の入力中は、チップを描き直さない (入力欄の焦点が外れるため)
    const chip = (text: string, cls: string, o: { call?: Call; defs?: Def[]; remove?: () => void; move?: (by: number) => void } = {}) => {
      const c = box.createDiv(`mtg-ne-chip ${cls}`).createSpan();
      c.createSpan({ text });
      if (o.call) this.params(c, o.call, o.defs!, quiet);
      if (o.move) {
        c.createEl("button", { text: "◀", cls: "mtg-ne-x" }).onclick = () => o.move!(-1);
        c.createEl("button", { text: "▶", cls: "mtg-ne-x" }).onclick = () => o.move!(1);
      }
      if (o.remove) c.createEl("button", { text: "✕", cls: "mtg-ne-x" }).onclick = o.remove;
    };
    const kw = KEYWORDS.find((k) => k.id === d.keyword);
    if (kw) chip(pick(kw.label), "is-keyword", { remove: () => { d.keyword = undefined; this.update(); } });
    if (d.kind === "keyword") return;
    const tm = kindOf(d.kind)?.timings.find((x) => x.id === d.timing);
    if (tm) chip(pick(tm.label), "");
    const tg = TARGETS.find((x) => x.id === d.target);
    if (tg) chip(pick(tg.label), "", { remove: () => { d.target = undefined; this.update(); } });
    if (d.condition) chip(pick(CONDITIONS.find((x) => x.id === d.condition!.id)?.label ?? nodeLbl(d.condition.id)), "", { call: d.condition, defs: CONDITIONS, remove: () => { d.condition = undefined; this.update(); } });
    d.steps.forEach((s, i) => {
      const move = (by: number) => { const j = i + by; if (j < 0 || j >= d.steps.length) return; [d.steps[i], d.steps[j]] = [d.steps[j], d.steps[i]]; this.update(); };
      const remove = () => { d.steps.splice(i, 1); this.update(); };
      if (s.node) chip(`[[${s.id}]]`, "is-effect", { move, remove });
      else chip(pick(ACTIONS.find((x) => x.id === s.id)?.label ?? nodeLbl(s.id)), "is-effect", { call: s, defs: ACTIONS, move, remove });
    });
    if (!box.children.length) box.createDiv({ text: "…", cls: "mtg-ne-dim" });
  }

  // 盤面・問題・保存ボタンを、入力のたびに更新する (画面全体は作り直さない)
  private update(redrawChips = true) {
    const root = this.contentEl;
    const own = this.data ? validate(this.data, (n) => this.card.abilities.find((a) => a.name === n)) : [];
    const c = this.card;
    const bad = /[\\/:*?"<>|[\]#^]/;
    const card = [
      ...(!c.name.trim() || bad.test(c.name) ? [t("badCardName")] : []),
      ...c.abilities.flatMap((a, i) => (i !== this.sel && validate(a, (n) => this.card.abilities.find((a) => a.name === n)).length ? [t("abilityProblem", a.name || "—")] : [])),
    ];
    if (redrawChips) {
      root.querySelectorAll<HTMLElement>(".mtg-ne-chips").forEach((box) => { box.empty(); this.chips(box, c.abilities[Number(box.dataset.i)]); });
      root.querySelectorAll<HTMLElement>(".mtg-ne-board-head").forEach((head, i) => {
        const a = c.abilities[i];
        head.children[0]?.setText(a.name || "—");
        head.children[1]?.setText(pick(kindOf(a.kind)?.label ?? nodeLbl(a.kind)));
        (head.parentElement as HTMLElement).style.setProperty("--kind-color", `var(--color-${kindOf(a.kind)?.color ?? "base-50"})`);
      });
      this.shows.forEach((f) => f());
    }
    const box = root.querySelector(".mtg-ne-problems");
    if (box) {
      box.empty();
      for (const p of [...own, ...card]) box.createDiv({ text: `・${p}`, cls: "mtg-ne-problem" });
    }
    const disable = (sel: string, v: boolean) => { const b = root.querySelector<HTMLButtonElement>(sel); if (b) b.disabled = v; };
    disable(".mtg-ne-save-card", own.length > 0 || card.length > 0);
  }
}
