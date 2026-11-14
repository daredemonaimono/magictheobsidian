import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import { Label, getLang, pick, t } from "./i18n";
import { ACTIONS, CONDITIONS, Def } from "./node/actions";
import { DEFAULT_KIND, KINDS, defaultTiming, kindOf } from "./node/kinds";
import { ArtPickModal } from "./ArtPickModal";
import { CardSearchModal } from "./CardSearchModal";
import { CardData, Print } from "./node/card";
import { CARD_TYPES } from "./node/cardtypes";
import { ComposeResult } from "./ai/compose";
import { auditAbility, auditCard } from "./node/audit";
import { frameKinds, layerKeyFor, loyaltyBadge } from "./frames";
import { frameEra } from "./node/frame";
import { moveItem } from "./node/order";
import { abilityLabel, candidates, hasSource, mergeCandidates } from "./node/split";
import { Call, NodeData, defaults } from "./node/md";
import { Callable } from "./node/params";
import { KEYWORDS, TARGETS } from "./node/slots";
import { ScryCard, artOf, cardsOf, fromScryfall } from "./node/scryfall";
import { validate } from "./node/validate";

export const NODE_EDITOR_VIEW = "mtg-node-editor";

export interface NodeStore {
  cards(): Promise<CardData[]>; // カード (Cards/)。ノードは、カードのノートの中に、コードブロックで入る
  saveCard(c: CardData): Promise<void>;
  compose(card: CardData, ability: NodeData): Promise<ComposeResult>; // AI に、能力 1 つを組ませる
  search(query: string): Promise<ScryCard[]>; // Scryfall を名前で探す
  art(id: string, url: string): Promise<string>; // 絵をローカルに保存して、画面に出せるパスを返す (保存済みなら、取りに行かない)
  prints(oracleId: string): Promise<Print[]>; // 版違い (同じカードの、すべての印刷)
  arts(scryfallId: string): Promise<ScryCard[]>; // 別の版 (同じカードの、すべての印刷。絵つき)
  addCard(c: CardData): Promise<CardData>; // Cards/ に保存する (同じ名前が、すでにあれば、それを返す)
}

const nodeLbl = (id: string): Label => ({ ja: id, en: id });
const ABILITY_DND = "application/x-mtg-ability"; // 能力のドラッグ (部品のドラッグ text/plain とは、別)
const blank = (): NodeData => ({ name: "", kind: DEFAULT_KIND, timing: defaultTiming(DEFAULT_KIND), steps: [] });
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

  // 探して選んだカードを、取り込む (日本語・版違いも)。Cards/ に保存する (保存済みなら、上書きしない)
  private importFound = async (found: ScryCard): Promise<CardData> => {
    const got = await this.withPrints(await this.withJapanese(fromScryfall(found, getLang() === "ja"), found), found);
    return this.store.addCard(got);
  };

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

  // 画面に出す能力の名前 (いまの言語。原文からできて、名前を書き換えていない能力は、いまの言語の原文)
  private label(a: NodeData): string {
    return abilityLabel(this.card, a, getLang()) || "—";
  }

  private onlyReview = false; // 「カードを開く」の検索を、要確認のカード (ルールなし・組みかけ・抜けの疑い) だけにする
  private picked = new Set<string>(); // 合体のために、チェックを入れた原文の行 (source)
  // 登録してあるカードか (トークンの引数の確認用)
  private hasCard = (name: string, filter?: string): boolean => {
    const c = this.cards.get(name);
    return !!c && (filter !== "token" || !!c.token);
  };

  private shows: (() => void)[] = []; // 検索欄の一覧を、描き直す関数 (部品を置くたびに、設定済みのものを外す)

  redraw() {
    this.shows = [];
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-ne");
    const d = this.data;
    const c = this.card;
    const again = () => this.redraw();

    // 左: カードを開く / 新規 → カードの枠 (線だけ) → その下に検索欄
    const left = root.createDiv("mtg-ne-left");
    const top = left.createDiv("mtg-ne-row");
    top.createEl("button", { text: t("newCard") }).onclick = () => {
      new CardSearchModal(this.app, (q) => this.store.search(q), async (found) => {
        this.card = await this.importFound(found);
        this.sel = 0;
        this.picked.clear();
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
      const hits = [...this.cards.values()].filter((x) => !this.onlyReview || auditCard(x, this.hasCard).needsReview).filter((x) => !q || `${x.name} ${x.nameJa ?? ""}`.toLowerCase().includes(q)).sort((x, y) => x.name.localeCompare(y.name)).slice(0, 50);
      for (const x of hits) {
        const row = found.createDiv({ cls: "mtg-ne-item" });
        // 状態は、名前の文字の色だけで示す: 全くなし (ルールなし) = 赤 / 一部抜け (組みかけ・抜けの疑い) = 黄 / 完成 = そのまま。詳しい内容は、カーソルを合わせたとき (title)
        const au = auditCard(x, this.hasCard);
        row.createSpan({ text: getLang() === "ja" && x.nameJa ? `${x.nameJa} (${x.name})` : x.name, cls: au.noRules ? "mtg-ne-review" : au.needsReview ? "mtg-ne-review-part" : "" });
        const why = [au.noRules ? t("tagNoRules") : "", au.problemCount ? t("tagProblems", au.problemCount) : "", au.gapCount ? t("tagGaps", au.gapCount) : ""].filter(Boolean).join(" ・ ");
        if (why) row.title = why;
        row.onmousedown = (e) => {
          e.preventDefault(); // 欄の焦点が外れて、一覧が消える前に開く
          this.card = structuredClone(x);
            this.sel = 0;
        this.picked.clear();
          again();
        };
      }
    };
    openIn.onfocus = showCards;
    openIn.oninput = showCards;
    openIn.onblur = () => found.empty();
    // 検索の右: 「ルールなし」だけに絞る (能力が 1 つも無い、まだ組んでいないカード)
    const noRules = top.createEl("button", { cls: "mtg-ne-filter", attr: { title: t("noRulesTip"), "aria-label": t("noRulesTip") } });
    setIcon(noRules, "file-warning"); // アイコン: 注意のしるしつきのファイル (要確認のカード)
    noRules.toggleClass("is-on", this.onlyReview);
    noRules.onclick = () => {
      this.onlyReview = !this.onlyReview;
      noRules.toggleClass("is-on", this.onlyReview);
      openIn.focus(); // 絞った一覧を、すぐ出す
      showCards();
    };

    // カードの枠: 時代 (旧枠・8 版枠・新枠 = 主な版の発売日) と言語で、フォントが決まる (styles.css の --mtg-font-*)
    // mtg-color-*: 組み込みの枠の色 (W U B R G M C A L) / mtg-legendary: 伝説 (金の二重の縁・冠) / mtg-planeswalker: プレインズウォーカー (暗い金属の枠)
    const kinds = frameKinds(c);
    const frame = left.createDiv(`mtg-ne-card mtg-frame-${frameEra(c)} mtg-lang-${getLang()} mtg-color-${layerKeyFor(c)}${kinds.legendary ? " mtg-legendary" : ""}${kinds.planeswalker ? " mtg-planeswalker" : ""}`);
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
    // 絵を押すと、別のイラストを選べる (取り込んだカードだけ)。選ぶと、絵と主な版が変わる (保存は、保存ボタン)
    if (c.scryfall) {
      art.addClass("is-pickable");
      art.title = t("artPick");
      art.onclick = async () => {
        let arts: ScryCard[] = [];
        try { arts = await this.store.arts(c.scryfall!); } catch (e) { new Notice(t("importFail", (e as Error).message)); return; }
        new ArtPickModal(this.app, c.nameJa && getLang() === "ja" ? c.nameJa : c.name, arts, (a) => {
          const src = artOf(a);
          if (!src) return;
          c.scryfall = a.id;
          c.art = src;
          this.update();
          this.redraw();
        }).open();
      };
    }
    // タイプ行 (「クリーチャー — サイ」): 取り込んだカードは、その文字。取り込み前は、カードタイプの選択欄
    const typeLine = ja ? c.typeLineJa || c.typeLine : c.typeLine;
    if (typeLine) {
      const bar = frame.createDiv("mtg-ne-card-type mtg-ne-card-namebar");
      bar.createSpan({ text: typeLine });
      if (c.loyalty) bar.createSpan({ text: t("loyaltyShort", c.loyalty), cls: "mtg-ne-pl" }); // プレインズウォーカーの、初期の忠誠度
    }
    else {
      const typeSel = frame.createEl("select", { cls: "mtg-ne-card-type" });
      typeSel.createEl("option", { text: t("none"), value: "" });
      for (const ty of CARD_TYPES) typeSel.createEl("option", { text: pick(ty.label), value: ty.id }).selected = ty.id === c.type;
      typeSel.onchange = () => { c.type = typeSel.value || undefined; this.update(); };
    }
    // 能力のドラッグ: 左の一覧の行、または、中央の板の見出しを、ほかの能力の位置へ落とすと、入れ替わる (選択中の能力は、そのまま)
    const dnd = (source: HTMLElement, target: HTMLElement, i: number) => {
      source.ondragstart = (e) => { e.dataTransfer?.setData(ABILITY_DND, String(i)); };
      target.ondragover = (e) => { if (e.dataTransfer?.types.includes(ABILITY_DND)) { e.preventDefault(); target.addClass("is-drop"); } };
      target.ondragleave = () => target.removeClass("is-drop");
      target.ondrop = (e) => {
        target.removeClass("is-drop");
        if (!e.dataTransfer?.types.includes(ABILITY_DND)) return;
        e.preventDefault();
        const cur = c.abilities[this.sel];
        if (moveItem(c.abilities, Number(e.dataTransfer.getData(ABILITY_DND)), i)) { this.sel = Math.max(0, c.abilities.indexOf(cur)); again(); }
      };
    };
    const text = frame.createDiv("mtg-ne-card-text");
    // 忠誠度能力の行の先頭に、コストの印 (+2 / 0 / −5)
    const loyBadge = (row: HTMLElement, a: NodeData) => {
      if (a.loyalty === undefined) return;
      const b = loyaltyBadge(a.loyalty);
      row.prepend(createSpan({ text: b.text, cls: `mtg-ne-loy is-${b.kind}` }));
    };
    c.abilities.forEach((a, i) => {
      if (i !== this.sel) {
        const row = text.createDiv({ text: this.label(a), cls: "mtg-ne-ability" });
        loyBadge(row, a);
        row.draggable = true;
        dnd(row, row, i);
        row.onclick = () => { this.sel = i; again(); };
        return;
      }
      const row = text.createDiv("mtg-ne-ability is-on");
      loyBadge(row, a);
      row.onmousedown = (e) => { row.draggable = e.target === row; }; // 名前の入力欄の中は、文字の選択 (ドラッグしない)
      dnd(row, row, i);
      // 長い原文も見えるように、折り返す欄 (名前に、改行は入れられない)
      const nameIn = row.createEl("textarea", { cls: "mtg-ne-name" });
      nameIn.value = this.label(a) === "—" ? "" : this.label(a);
      nameIn.rows = 1;
      nameIn.placeholder = t("name");
      nameIn.onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };
      nameIn.oninput = () => { a.name = nameIn.value.replace(/[\r\n]+/g, " "); this.update(); };
      row.createEl("button", { text: "✕", cls: "mtg-ne-x" }).onclick = () => { c.abilities.splice(i, 1); this.sel = Math.max(0, i - 1); again(); };
    });
    // 右下の、初期の忠誠度のタグ (306.5a)。まだ取り込んでいないカードは、「?」(取り込み直すと、入る)
    if (kinds.planeswalker) frame.createDiv({ text: c.loyalty ?? "?", cls: "mtg-ne-loyalty-total", attr: { title: t("loyaltyShort", c.loyalty ?? "?") } });
    left.createEl("button", { text: t("addAbility"), cls: "mtg-ne-new" }).onclick = () => { c.abilities.push(blank()); this.sel = c.abilities.length - 1; again(); };

    // 中: 盤面 (チップ・問題・保存)
    const mid = root.createDiv("mtg-ne-mid");
    if (c.text) {
      // 原文: 1 行ずつ、能力の候補 (カード名・コスト・タイプ行は、左のカードの枠に出す)。押すと、その能力ができる。候補が無ければ、枠も出さない
      let ref: HTMLElement | undefined;
      let mergeBar: HTMLElement | undefined;
      const rows = candidates(c, getLang()).filter((x) => !c.abilities.some((a) => hasSource(a, x.node.source)));
      this.picked = new Set([...this.picked].filter((p) => rows.some((x) => x.node.source === p))); // もう候補でないものは、外す
      const showMerge = () => {
        mergeBar?.empty();
        if (this.picked.size < 2 || !mergeBar) return;
        mergeBar.createEl("button", { text: t("mergeBtn", this.picked.size), cls: "mod-cta" }).onclick = () => {
          const chosen = rows.filter((x) => this.picked.has(x.node.source!));
          const blankOnly = c.abilities.length === 1 && !c.abilities[0].name && !c.abilities[0].steps.length;
          if (blankOnly) c.abilities[0] = mergeCandidates(chosen);
          else c.abilities.push(mergeCandidates(chosen));
          this.sel = blankOnly ? 0 : c.abilities.length - 1;
          this.picked.clear();
          again();
        };
      };
      for (const cand of candidates(c, getLang())) {
        // できているか: 原文の行 (source) で見る。source を持たない古い能力は、名前で見て、source を足す
        const at = c.abilities.findIndex((a) => (a.source ? hasSource(a, cand.node.source) : [cand.node.name, ...cand.alt].includes(a.name)));
        if (at >= 0 && !c.abilities[at].source) c.abilities[at].source = cand.node.source;
        if (at >= 0) continue; // できている能力は、候補から外す
        if (!ref) {
          ref = mid.createDiv("mtg-ne-ref-text");
          mergeBar = ref.createDiv("mtg-ne-merge");
        }
        const row = ref.createDiv({ cls: "mtg-ne-cand" });
        // チェックを入れた行を、まとめて 1 つの能力にできる (複数行で 1 つの能力のカードのため)
        const cb = row.createEl("input", { type: "checkbox", cls: "mtg-ne-cand-check" });
        cb.checked = this.picked.has(cand.node.source!);
        cb.onclick = (e) => e.stopPropagation();
        cb.onchange = () => { if (cb.checked) this.picked.add(cand.node.source!); else this.picked.delete(cand.node.source!); showMerge(); };
        row.createSpan({ text: cand.line });
        row.onclick = () => {
          this.picked.delete(cand.node.source!);
          const blankOnly = c.abilities.length === 1 && !c.abilities[0].name && !c.abilities[0].steps.length;
          if (blankOnly) c.abilities[0] = structuredClone(cand.node);
          else c.abilities.push(structuredClone(cand.node));
          this.sel = blankOnly ? 0 : c.abilities.length - 1;
          again();
        };
      }
      showMerge();
    }
    // 盤面: すべての能力を、1 つずつの板にして並べる。押した板が、選択中になり、左の検索欄が、その能力のものに切り替わる
    c.abilities.forEach((a, i) => {
      const board = mid.createDiv("mtg-ne-board");
      board.style.setProperty("--kind-color", `var(--color-${kindOf(a.kind)?.color ?? "base-50"})`); // 種類の色
      board.toggleClass("is-sel", i === this.sel);
      const head = board.createDiv("mtg-ne-board-head");
      head.draggable = true;
      dnd(head, board, i);
      head.createSpan({ text: pick(kindOf(a.kind)?.label ?? nodeLbl(a.kind)), cls: "mtg-ne-pl" }); // 種類は、見出しの先頭
      head.createSpan({ text: this.label(a), cls: "mtg-ne-act" });
      // AI ボタン (見出しの右端): 原文の行から、種類・タイミング・手順を、AI が組み直す
      const ai = head.createEl("button", { text: t("aiButton"), cls: "mtg-ne-ai", attr: { title: t("aiTip") } });
      ai.draggable = false;
      ai.onclick = async (e) => {
        e.stopPropagation();
        ai.disabled = true;
        ai.setText("…");
        try {
          const r = await this.store.compose(c, a);
          if (!r.node) { new Notice(t("aiFailed", r.problems.join(" / ")), 12000); }
          else {
            // 組んだ中身に差し替える (名前・原文は、そのまま)
            for (const k of ["kind", "timing", "loyalty", "cost", "condition", "target", "targetArgs", "alsoTargets", "keyword", "steps"] as const) delete (a as unknown as Record<string, unknown>)[k];
            Object.assign(a, { ...r.node, name: a.name, ...(a.source ? { source: a.source } : {}) });
            this.sel = i;
            new Notice(t("aiDone", r.tries) + (r.note ? `\n${r.note}` : ""), r.note ? 12000 : 4000);
          }
        } catch (err) {
          new Notice((err as Error).message, 10000);
        }
        again();
      };
      const box = board.createDiv("mtg-ne-chips");
      box.dataset.i = String(i);
      const choose = () => { if (this.sel !== i) { this.sel = i; again(); } };
      head.onclick = choose;
      box.onclick = (e) => { if (e.target === box) choose(); };
      box.ondragover = (e) => e.preventDefault();
      box.ondrop = (e) => {
        if (e.dataTransfer?.types.includes(ABILITY_DND)) return; // 能力のドラッグは、板が受ける
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
      kindSel.onchange = () => { d.kind = kindSel.value; d.timing = defaultTiming(d.kind); d.loyalty = undefined; again(); };

      if (d.kind === "keyword") {
        // キーワード能力: キーワードを選ぶだけ
        this.palette(panel, t("keyword"), KEYWORDS.map((k) => ({ slot: "keyword", id: k.id, label: k.label, cr: k.cr })));
      } else {
        if (d.kind === "activated") this.palette(panel, t("cost"), ACTIONS.filter((x) => x.cost).map((x) => ({ slot: "cost", id: x.id, label: x.label, cr: x.cr }))); // 起動型のコスト ({T}・マナ・ライフ・追放)
        this.palette(panel, t("timing"), (kindOf(d.kind)?.timings ?? []).map((x) => ({ slot: "timing", id: x.id, label: x.label, cr: x.cr })));
        this.palette(panel, t("target"), TARGETS.map((x) => ({ slot: "target", id: x.id, label: x.label, cr: x.cr })));
        this.palette(panel, t("alsoTarget"), TARGETS.filter((x) => x.targets).map((x) => ({ slot: "alsoTarget", id: x.id, label: x.label, cr: x.cr }))); // 「target A and target B」の B
        this.palette(panel, t("condition"), CONDITIONS.map((x) => ({ slot: "condition", id: x.id, label: x.label, cr: x.cr })));
        this.palette(panel, t("effect"), [
          ...ACTIONS.filter((x) => !x.cost || d.timing === "alternative-cost").map((x) => ({ slot: "step", id: x.id, label: x.label, cr: x.cr })), // コストの動作は、代替コストのタイミングのときだけ (起動型は、「コスト」の欄)
          // カウンターの引用: 「カウンターを置く」を、その種類 (+1/+1・-1/-1・忠誠) で置く
          ...(ACTIONS.find((a) => a.id === "add-counter")!.params[0].choices ?? []).filter((ch) => ch.id !== "other").map((ch) => ({ slot: "step", id: "add-counter", args: { kind: ch.id }, label: { ja: `${ch.label.ja}カウンターを置く`, en: `Put ${ch.label.en} counters` }, cr: "122.1" })),
          // キーワードの引用: 「キーワード能力を与える」を、そのキーワードで置く。
        // 一覧に出すのは、使い回せる部品 (動作・キーワード) だけ。同じカードの能力 (カード専用) は、出さない
          ...KEYWORDS.map((k) => ({ slot: "step", id: "grant-keyword", args: { keyword: k.id }, label: k.label, cr: k.cr })),
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
      case "alsoTarget": return false; // 同じ対象を、何度でも (対象 2・対象 3 …)
      case "cost": return !!d.cost?.some((c) => c.id === it.id);
      case "node": return d.steps.some((s) => s.node && s.id === it.id);
      // 動作: 同じ動作 (引数つきの項目は、その引数も同じ。キーワードは、選んだ中に入っているか)
      default: return d.steps.some((s) => !s.node && s.id === it.id && Object.entries(it.args ?? {}).every(([k, v]) => (s.args[k] ?? "").split("|").includes(v)));
    }
  }

  // 部品を盤面に置く (タイミング・対象・条件・キーワードは、置き換え。効果は、後ろに足す)
  private apply(it: Item) {
    const d = this.data;
    if (!d || this.isUsed(it)) return;
    if (it.slot === "timing") { d.timing = it.id; d.loyalty = it.id === "loyalty" ? d.loyalty ?? "0" : undefined; }
    else if (it.slot === "target") {
      d.target = it.id;
      const td = TARGETS.find((x) => x.id === it.id);
      d.targetArgs = td?.params.length ? defaults(td) : undefined; // 「各〜」は、引数の初期値を入れる
    }
    else if (it.slot === "keyword") {
      // キーワードを選ぶと、その定義 (動作) が、手順に入る
      d.keyword = it.id;
      d.steps = structuredClone(KEYWORDS.find((k) => k.id === it.id)?.steps ?? []).map((x) => ({ node: false as const, ...x }));
    }
    else if (it.slot === "condition") { const c = CONDITIONS.find((x) => x.id === it.id); if (c) d.condition = { id: c.id, args: defaults(c) }; }
    else if (it.slot === "alsoTarget") { const td = TARGETS.find((x) => x.id === it.id); if (td) (d.alsoTargets ??= []).push({ id: td.id, args: td.params.length ? defaults(td) : {} }); }
    else if (it.slot === "cost") { const a = ACTIONS.find((x) => x.id === it.id); if (a) (d.cost ??= []).push({ id: a.id, args: defaults(a) }); }
    else if (it.slot === "node") d.steps.push({ node: true, id: it.id });
    else { const a = ACTIONS.find((x) => x.id === it.id); if (a) d.steps.push({ node: false, id: a.id, args: { ...defaults(a), ...it.args } }); }
    this.update();
  }

  // 引数の入力欄 (数 = 数字の欄 / 選択 = プルダウン。値は id)
  private params(parent: HTMLElement, c: Call, defs: Callable[], changed = () => this.update()) {
    for (const p of defs.find((x) => x.id === c.id)?.params ?? []) {
      parent.createSpan({ text: pick(p.label), cls: "mtg-ne-pl" });
      const v = c.args[p.id] ?? p.default;
      if (p.type === "choice") {
        const sel = parent.createEl("select");
        for (const ch of p.choices!) sel.createEl("option", { text: pick(ch.label), value: ch.id }).selected = ch.id === v;
        sel.onchange = () => { c.args[p.id] = sel.value; changed(); };
      } else if (p.type === "card") {
        // 登録してあるカード (トークン) から選ぶ。ここで選んだカードを、手順が指す
        const sel = parent.createEl("select");
        sel.createEl("option", { text: t("pickToken"), value: "" }).selected = !v;
        const list = [...this.cards.values()].filter((x) => p.filter !== "token" || x.token).map((x) => x.name).sort();
        if (v && !list.includes(v)) list.push(v); // 見つからない名前も、そのまま出す (検証が知らせる)
        for (const n of list) sel.createEl("option", { text: n, value: n }).selected = n === v;
        sel.createEl("option", { text: t("findToken"), value: "__find__" }); // 登録していないトークンは、ここから探して、登録する (いまのカードは、そのまま)
        if (!list.length) sel.title = t("noTokens");
        sel.onchange = () => {
          if (sel.value !== "__find__") { c.args[p.id] = sel.value; changed(); return; }
          sel.value = v;
          new CardSearchModal(this.app, (q) => this.store.search(q), async (found) => {
            const added = await this.importFound(found);
            await this.refreshKnown();
            c.args[p.id] = added.name;
            this.redraw();
          }, "token").open();
        };
      } else if (p.type === "mana") {
        const inp = parent.createEl("input", { type: "text", value: v, cls: "mtg-ne-num" });
        inp.style.width = "90px";
        inp.title = "{2}{R}・{C}{C}{C}";
        inp.oninput = () => { c.args[p.id] = inp.value.trim(); changed(); };
      } else if (p.type === "multi") {
        // 複数選ぶ: 開くと、チェックの一覧
        const on = new Set(v.split("|").filter(Boolean));
        const box = parent.createEl("details", { cls: "mtg-ne-multi" });
        // 閉じていても、何を選んだか分かるように、選んだものの名前を出す (数だけでは、確かめられない)
        const shown = () => { const n = p.choices!.filter((x) => on.has(x.id)).map((x) => pick(x.label)); return n.length <= 3 ? n.join("・") : `${n.slice(0, 3).join("・")} +${n.length - 3}`; };
        const sum = box.createEl("summary", { text: shown() });
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
            sum.setText(shown());
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
    const chip = (text: string, cls: string, o: { call?: Call; defs?: Callable[]; remove?: () => void; move?: (by: number) => void; extra?: (c: HTMLElement) => void } = {}) => {
      const c = box.createDiv(`mtg-ne-chip ${cls}`).createSpan();
      c.createSpan({ text });
      o.extra?.(c);
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
    // 忠誠度のコスト: +N = 忠誠カウンターを置く / -N = 取り除く (606.4)。消すと、タイミングも、初期に戻る
    if (d.loyalty !== undefined) {
      chip(t("loyaltyCost"), "is-keyword", {
        extra: (c) => { const inp = c.createEl("input", { type: "text", value: d.loyalty, cls: "mtg-ne-num" }); inp.title = t("loyaltyTip"); inp.oninput = () => { d.loyalty = inp.value.trim(); quiet(); }; },
        remove: () => { d.loyalty = undefined; if (d.timing === "loyalty") d.timing = defaultTiming(d.kind); this.update(); },
      });
    }
    // 起動型のコスト ({T}・マナ・ライフなど): 忠誠度のコストの次
    (d.cost ?? []).forEach((c, i) => {
      const def = ACTIONS.find((x) => x.id === c.id);
      chip(pick(def?.label ?? nodeLbl(c.id)), "is-keyword", { call: c, defs: ACTIONS, remove: () => { d.cost!.splice(i, 1); if (!d.cost!.length) d.cost = undefined; this.update(); } });
    });
    const tm = kindOf(d.kind)?.timings.find((x) => x.id === d.timing);
    if (tm) chip(pick(tm.label), "");
    const tg = TARGETS.find((x) => x.id === d.target);
    if (tg) {
      if (tg.params.length) d.targetArgs ??= defaults(tg);
      chip(pick(tg.label), "", { call: tg.params.length ? { id: tg.id, args: d.targetArgs! } : undefined, defs: TARGETS, remove: () => { d.target = undefined; d.targetArgs = undefined; this.update(); } });
    }
    // もう 1 つ以降の対象 (対象 2・対象 3): 対象を取るものだけ
    (d.alsoTargets ?? []).forEach((c, i) => {
      const td = TARGETS.find((x) => x.id === c.id);
      chip(`${t("targetN", i + 2)} ${pick(td?.label ?? nodeLbl(c.id))}`, "", { call: td?.params.length ? c : undefined, defs: TARGETS, remove: () => { d.alsoTargets!.splice(i, 1); if (!d.alsoTargets!.length) d.alsoTargets = undefined; this.update(); } });
    });
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
    const own = this.data ? validate(this.data, (n) => this.card.abilities.find((a) => a.name === n), this.hasCard) : [];
    const c = this.card;
    const bad = /[\\/:*?"<>|[\]#^]/;
    const card = [
      ...(!c.name.trim() || bad.test(c.name) ? [t("badCardName")] : []),
      ...c.abilities.flatMap((a, i) => (i !== this.sel && validate(a, (n) => this.card.abilities.find((a) => a.name === n), this.hasCard).length ? [t("abilityProblem", a.name || "—")] : [])),
    ];
    if (redrawChips) {
      root.querySelectorAll<HTMLElement>(".mtg-ne-chips").forEach((box) => { box.empty(); this.chips(box, c.abilities[Number(box.dataset.i)]); });
      root.querySelectorAll<HTMLElement>(".mtg-ne-board-head").forEach((head, i) => {
        const a = c.abilities[i];
        head.children[0]?.setText(pick(kindOf(a.kind)?.label ?? nodeLbl(a.kind)));
        head.children[1]?.setText(this.label(a));
        (head.parentElement as HTMLElement).style.setProperty("--kind-color", `var(--color-${kindOf(a.kind)?.color ?? "base-50"})`);
      });
      this.shows.forEach((f) => f());
    }
    const box = root.querySelector(".mtg-ne-problems");
    if (box) {
      box.empty();
      for (const p of [...own, ...card]) box.createDiv({ text: `・${p}`, cls: "mtg-ne-problem" });
      // 抜けの疑い (原文に、組まれていない部分がありそう): すべての能力。保存は、止めない
      for (const a of c.abilities) for (const g of auditAbility(c, a, this.hasCard).gaps) box.createDiv({ text: `・${this.label(a)}: ${g}`, cls: "mtg-ne-gap" });
    }
    // 途中でも、保存できる: 止めるのは、カード名 (ファイル名) が使えないときだけ。能力の問題は、知らせるだけ
    const nameBad = !c.name.trim() || bad.test(c.name);
    const save = root.querySelector<HTMLButtonElement>(".mtg-ne-save-card");
    if (save) {
      save.disabled = nameBad;
      save.setText(own.length > 0 || card.length > (nameBad ? 1 : 0) ? t("saveCardDraft") : t("saveCard"));
    }
  }
}
