import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { searchCards } from "./scryfall";
import { DeckView } from "./DeckView";
import { Result, buildFilterBar, emptyFilters, isEmpty, scryfallQuery, scryfallResult, searchLocal } from "./search";
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

// 右サイドバーのカード一覧。クリックで「追加先」のデッキ/コレクションに1枚追加、Shift+クリックで1枚削除
export class CardListView extends ItemView {
  private f = emptyFilters();
  private timer?: number;
  private seq = 0;
  private results: Result[] = [];
  private shown = PAGE;
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
    this.targetEl?.setText(t ? `追加先: ${t.getDisplayText()}` : "追加先なし (デッキ画面を開く)");
  }

  // 条件が空なら Cards/ の全カード。Cards/ に無ければ Scryfall を検索する
  private async search() {
    const seq = ++this.seq;
    let res = await searchLocal(this.app, this.f);
    if (seq !== this.seq) return;
    if (!res.length && !isEmpty(this.f)) {
      this.status.setText("Cards に無いので Scryfall を検索中…");
      try {
        res = (await searchCards(scryfallQuery(this.f))).map((c) => scryfallResult(this.app, this.settings, c));
      } catch (e) {
        this.status.setText(`検索失敗: ${(e as Error).message}`);
        return;
      }
      if (seq !== this.seq) return;
      this.status.setText(`Scryfall ${res.length} 件`);
    } else {
      this.status.setText(`Cards 内 ${res.length} 件`);
    }
    this.results = res;
    this.shown = PAGE;
    this.draw();
  }

  private draw() {
    this.grid.empty();
    for (const r of this.results.slice(0, this.shown)) {
      const cell = this.grid.createDiv("mtg-lcell");
      cell.setAttr("aria-label", r.ja && r.ja !== r.name ? `${r.name} (${r.ja})` : r.name);
      cell.style.setProperty("--mtg-color", colorOf(r.colors));
      // 見えている行の分だけ読み込む (loading=lazy)。設定でオフにできる
      if (this.settings.listArt && r.art) cell.createEl("img", { cls: "mtg-lart", attr: { src: r.art, loading: "lazy", alt: "" } });
      cell.createSpan({ text: String(r.cmc), cls: "mtg-lcost" });
      cell.createSpan({ text: r.ja ?? r.name, cls: "mtg-lname" });
      cell.onmouseenter = () => this.getTarget()?.previewResult(r);
      cell.onclick = (e) => {
        const t = this.getTarget();
        if (!t) return void new Notice("デッキ画面を開く");
        void (e.shiftKey ? t.removeCard(r) : t.addCard(r));
      };
    }
    if (this.results.length > this.shown) {
      this.grid.createEl("button", { text: `さらに表示 (残り ${this.results.length - this.shown})`, cls: "mtg-lmore" }).onclick = () => {
        this.shown += PAGE;
        this.draw();
      };
    }
  }
}
