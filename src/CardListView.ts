import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { searchCards } from "./scryfall";
import { DeckView } from "./DeckView";
import { Result, buildFilterBar, emptyFilters, isEmpty, scryfallQuery, scryfallResult, searchLocal } from "./search";
import { Settings } from "./settings";

export const CARDLIST_VIEW = "mtg-cardlist";
const PAGE = 60;

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
      const img = cell.createEl("img", { attr: { loading: "lazy", alt: r.name } });
      void r.image().then((url) => url && img.setAttr("src", url));
      cell.createDiv({ text: r.ja ?? r.name, cls: "mtg-lname" });
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
