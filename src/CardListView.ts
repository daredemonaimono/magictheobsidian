import { EventRef, ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { cardInfo } from "./cards";
import { searchCards } from "./scryfall";
import { DeckView } from "./DeckView";
import { Result, buildFilterBar, emptyFilters, isEmpty, localResult, scryfallQuery, scryfallResult, searchLocal } from "./search";
import { Settings } from "./settings";

export const CARDLIST_VIEW = "mtg-cardlist";
const PAGE = 60;

export const COLOR_HEX: Record<string, string> = { W: "#e6dca8", U: "#4a90d9", B: "#7a6a86", R: "#d9534a", G: "#4a9a5b" };

// 無色は灰色、多色は色を並べたグラデーション
const colorOf = (colors: string[]) => {
  const hex = colors.map((c) => COLOR_HEX[c]).filter(Boolean);
  if (!hex.length) return "#8a8f98";
  return hex.length === 1 ? hex[0] : `linear-gradient(${hex.join(", ")})`;
};

interface Row {
  r: Result;
  n?: number; // デッキ内の枚数
  tag?: string;
}

// 右サイドバー。デッキ画面を開いている間だけ出る。
// 条件が空: いまデッキに入っているカード (表示だけ)。条件あり: 検索結果 (デッキ内のカードも含む) で、クリックで1枚追加 / Shift+クリックで1枚削除
export class CardListView extends ItemView {
  private f = emptyFilters();
  private timer?: number;
  private seq = 0;
  private results: Result[] = [];
  private shown = PAGE;
  private lastTarget?: DeckView;
  private targetEl!: HTMLElement;
  private status!: HTMLElement;
  private grid!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private settings: Settings, private getTarget: () => DeckView | undefined) {
    super(leaf);
  }

  getViewType() {
    return CARDLIST_VIEW;
  }
  getDisplayText() {
    return "Cards";
  }
  getIcon() {
    return "layout-grid";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-cardlist");
    this.targetEl = root.createDiv("mtg-ltarget");
    buildFilterBar(root, this.f, () => {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.search(), 250);
    });
    this.status = root.createDiv("mtg-status");
    this.grid = root.createDiv("mtg-lgrid");
    // デッキが変わったら (追加・削除・枚数) 一覧も更新する
    this.registerEvent((this.app.workspace as unknown as { on(n: string, cb: () => void): EventRef }).on("mtg-deck-changed", () => this.draw()));
    this.updateTarget();
    await this.search();
  }

  async onClose() {
    window.clearTimeout(this.timer);
  }

  refresh() {
    this.draw();
  }

  updateTarget() {
    const t = this.getTarget();
    // 追加先が変わったら、表示 (デッキ内のカード・選べるカード) を更新する
    if (t !== this.lastTarget) {
      this.lastTarget = t;
      if (this.grid) this.draw();
    }
    this.targetEl?.setText(t ? `追加先: ${t.getDisplayText()}` : "追加先なし (デッキ画面を開く)");
  }

  // 条件があるときだけ検索する。Cards/ に無ければ Scryfall を検索する
  private async search() {
    const seq = ++this.seq;
    if (isEmpty(this.f)) {
      this.results = [];
      return this.draw();
    }
    let res = await searchLocal(this.app, this.f);
    if (seq !== this.seq) return;
    if (!res.length) {
      this.status.setText("Cards に無いので Scryfall を検索中…");
      try {
        res = (await searchCards(scryfallQuery(this.f))).map((c) => scryfallResult(this.app, this.settings, c));
      } catch (e) {
        this.status.setText(`検索失敗: ${(e as Error).message}`);
        return;
      }
      if (seq !== this.seq) return;
    }
    this.results = res;
    this.shown = PAGE;
    this.draw();
  }

  private deckRows(): Row[] {
    const t = this.getTarget();
    const tag = { commander: "👑", main: undefined, side: "サイド" };
    const rows: Row[] = [];
    for (const c of t?.deckCards() ?? []) {
      const info = cardInfo(this.app, c.key);
      if (info) rows.push({ r: localResult(this.app, info), n: c.n, tag: tag[c.board] });
    }
    return rows;
  }

  private draw() {
    if (!this.grid) return;
    const target = this.getTarget();
    const deckMode = isEmpty(this.f);
    const rows: Row[] = deckMode
      ? this.deckRows()
      : this.results.slice(0, this.shown).map((r) => ({ r, n: (r.localKey && target?.countOf(r.localKey)) || undefined }));
    this.status.setText(
      deckMode
        ? `デッキ内 ${rows.reduce((a, x) => a + (x.n ?? 0), 0)} 枚 (検索・フィルターで探して追加)`
        : `${this.results.length} 件${this.results.length > this.shown ? ` (先頭 ${this.shown} 件)` : ""}`,
    );

    this.grid.empty();
    for (const { r, n, tag } of rows) {
      const cell = this.grid.createDiv("mtg-lcell");
      cell.setAttr("aria-label", r.ja && r.ja !== r.name ? `${r.name} (${r.ja})` : r.name);
      cell.style.setProperty("--mtg-color", colorOf(r.colors));
      const banned = !deckMode && !!target && !target.allows(r);
      cell.toggleClass("is-banned", banned);
      cell.toggleClass("is-static", deckMode); // デッキ内の一覧は表示だけ
      if (banned) cell.setAttr("aria-label", `${r.ja ?? r.name} (このフォーマットでは使えない)`);
      // 見えている行の分だけ読み込む (loading=lazy)。設定でオフにできる
      if (this.settings.listArt && r.art) cell.createEl("img", { cls: "mtg-lart", attr: { src: r.art, loading: "lazy", alt: "" } });
      cell.createSpan({ text: String(r.cmc), cls: "mtg-lcost" });
      cell.createSpan({ text: r.ja ?? r.name, cls: "mtg-lname" });
      if (tag) cell.createSpan({ text: tag, cls: "mtg-ltag" });
      if (n) cell.createSpan({ text: `${n}×`, cls: "mtg-lcount" });
      cell.onmouseenter = () => target?.previewResult(r);
      if (deckMode) continue;
      cell.onclick = (e) => {
        const t = this.getTarget();
        if (!t) return void new Notice("デッキ画面を開く");
        if (!e.shiftKey && !t.allows(r)) return void new Notice(`${r.name} はこのフォーマットでは使えない`);
        void (e.shiftKey ? t.removeCard(r) : t.addCard(r));
      };
    }
    if (!deckMode && this.results.length > this.shown) {
      this.grid.createEl("button", { text: `さらに表示 (残り ${this.results.length - this.shown})`, cls: "mtg-lmore" }).onclick = () => {
        this.shown += PAGE;
        this.draw();
      };
    }
  }
}
