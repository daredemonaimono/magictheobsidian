import { addFlip } from "./flip";
import { setImg } from "./imageCache";
import { EventRef, ItemView, Notice, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { CARD_DIR, cardBackImage, cardInfo, refetchCard } from "./cards";
import { Result, buildFilterBar, emptyFilters, searchLocal } from "./search";
import { Settings } from "./settings";
import { manaCost } from "./symbols";
import { localPenButtons, wikiButton } from "./cardEdit";

export const CARDS_VIEW = "mtg-cards";
const PAGE = 60;

// Cards/ のカードの一覧。フィルターで絞り込み、カードごとに Scryfall から情報を取り直せる
export class CardsView extends ItemView {
  private f = emptyFilters();
  private results: Result[] = [];
  private shown = PAGE;
  private seq = 0;
  private head!: HTMLElement;
  private grid!: HTMLElement;
  private refresh = debounce(() => void this.search(), 300, true);

  constructor(leaf: WorkspaceLeaf, private settings: Settings) {
    super(leaf);
  }

  getViewType() {
    return CARDS_VIEW;
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
    root.addClass("mtg-cardsview");
    root.createEl("h2", { text: "Cards" });
    this.head = root.createDiv("mtg-chead");
    buildFilterBar(root, this.f, () => this.refresh());
    this.grid = root.createDiv("mtg-ccgrid");

    // 取り直しや追加・削除のあとに一覧を更新する
    const inDir = (f: { path: string }) => f.path.startsWith(`${CARD_DIR}/`);
    this.registerEvent(this.app.metadataCache.on("changed", (f) => inDir(f) && this.refresh()));
    this.registerEvent((this.app.vault as unknown as { on(n: string, cb: (f: { path: string }) => void): EventRef }).on("create", (f) => inDir(f) && this.refresh()));
    this.registerEvent((this.app.vault as unknown as { on(n: string, cb: (f: { path: string }) => void): EventRef }).on("delete", (f) => inDir(f) && this.refresh()));
    await this.search();
  }

  private async search() {
    const seq = ++this.seq;
    const res = await searchLocal(this.app, this.f);
    if (seq !== this.seq) return;
    this.results = res;
    this.shown = Math.max(this.shown, PAGE);
    this.draw();
  }

  private draw() {
    this.head.setText(`${this.results.length} 枚${this.results.length > this.shown ? ` (先頭 ${this.shown} 枚を表示)` : ""}`);
    this.grid.empty();
    for (const r of this.results.slice(0, this.shown)) {
      const cell = this.grid.createDiv("mtg-cc");
      const img = cell.createEl("img", { attr: { loading: "lazy", alt: r.name } });
      void r.image().then((url) => setImg(img, url));
      const meta = cell.createDiv("mtg-ccmeta");
      const nameEl = meta.createSpan({ text: r.ja ?? r.name, cls: "mtg-ccname" });
      manaCost(meta, r.manaCost);

      const ctl = cell.createDiv("mtg-ctl");
      const file = r.localKey ? cardInfo(this.app, r.localKey)?.file : undefined;
      if (file) void r.image().then((front) => cardBackImage(this.app, file, front).then((back) => addFlip(ctl, img, front, back)));
      const again = ctl.createEl("button", { text: "↻", attr: { "aria-label": "Scryfall から情報を取り直す" } });
      again.onclick = async (e) => {
        e.stopPropagation();
        again.disabled = true;
        cell.addClass("is-busy");
        try {
          await refetchCard(this.app, this.settings, r.localKey!);
          new Notice(`取り直した: ${r.name}`);
        } catch (err) {
          console.error(err);
          new Notice(`取り直せない: ${(err as Error).message}`);
        } finally {
          again.disabled = false;
          cell.removeClass("is-busy");
        }
      };
      // 日本語の設定のときだけ、MTG Wiki のそのカードのページを開くボタン (ページは API で探す)
      if (this.settings.textLang === "ja") wikiButton(ctl, r.name, r.ja);
      // ローカルネーム・ローカルテキスト (設定した言語のカード名・効果テキスト) を手で直す。デッキ画面のプレビューと同じペン
      if (r.localKey) localPenButtons(this.app, this.settings, ctl, r.localKey, () => r.ja, { name: (local) => { r.ja = local; nameEl.setText(local ?? r.name); }, text: () => new Notice("効果テキストを保存した") });
      // クリックでカードのノートを開く
      cell.onclick = () => {
        const f = this.app.vault.getAbstractFileByPath(`${CARD_DIR}/${r.localKey}.md`);
        if (f instanceof TFile) void this.app.workspace.getLeaf(true).openFile(f);
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
