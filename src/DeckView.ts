import { App, ItemView, Modal, Notice, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { cardImage, cardInfo, cardText, deckVerdicts, oracleEnglish, printingImage, readPrintings, updateLegality } from "./cards";
import { LEGAL_FORMATS, formatOf } from "./rules";
import { ImportModal, resolveDeck } from "./import";
import { Settings } from "./settings";
import { Board, Deck, parseDeck, writeDeck } from "./deck";
import { Printing, printingImageUrl, searchCards } from "./scryfall";
import { Filters, Meta, Result, buildFilterBar, emptyFilters, isEmpty, scryfallQuery, scryfallResult, searchLocal } from "./search";

export const DECK_VIEW = "mtg-deck";

// Land を先に判定する (Artifact Land は土地として扱う)
const TYPE_CHECK = ["Land", "Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment"];
const GROUP_ORDER = ["Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle", "Land", "Other"];
const MAX_RESULTS = 40;

export class DeckView extends ItemView {
  private path = "";
  private deck: Deck = { main: new Map(), side: new Map() };
  private board: Board = "main";
  protected meta = new Map<string, Meta>();
  protected filters: Filters = emptyFilters();
  protected timer?: number;
  protected searchSeq = 0;
  private stackSeq = 0;
  private legalEl?: HTMLElement;
  protected previewSeq = 0;
  protected el!: { tabs: HTMLElement; status: HTMLElement; results: HTMLElement; stack: HTMLElement; preview: HTMLElement };

  constructor(leaf: WorkspaceLeaf, protected settings: Settings) {
    super(leaf);
  }

  getViewType() {
    return DECK_VIEW;
  }
  getDisplayText() {
    return this.path.split("/").pop()?.replace(/\.md$/, "") ?? "Deck";
  }
  getIcon() {
    return "layers";
  }
  getState() {
    return { path: this.path };
  }

  async setState(state: { path?: string }, result: ViewStateResult) {
    this.path = state?.path ?? "";
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) this.deck = parseDeck(await this.app.vault.cachedRead(file));
    this.build();
    await super.setState(state, result);
  }

  async onClose() {
    window.clearTimeout(this.timer);
  }

  protected build() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-deck");

    const preview = root.createDiv("mtg-side");
    const main = root.createDiv("mtg-main");
    const tabs = main.createDiv("mtg-tabs");
    this.legalEl = main.createDiv("mtg-legal");
    // サイドバーの一覧を使う設定のときは画面内の検索欄を出さない (設定で戻せる)
    const { status, results } = this.settings.sidebar ? { status: createDiv(), results: createDiv() } : this.buildSearch(main);
    this.el = { preview, tabs, status, results, stack: main.createDiv("mtg-groups") };
    this.renderTabs();
    void this.renderStack();
    this.renderResults([]);
  }

  // 画面内の検索欄と結果欄 (サイドバーを使わない設定のとき)
  protected buildSearch(parent: HTMLElement) {
    buildFilterBar(parent, this.filters, () => this.scheduleSearch());
    return { status: parent.createDiv("mtg-status"), results: parent.createDiv("mtg-results") };
  }

  // 設定の切り替え後に作り直す
  rebuild() {
    this.filters = emptyFilters();
    this.build();
  }

  private renderTabs() {
    this.el.tabs.empty();
    for (const b of ["main", "side"] as Board[]) {
      const total = [...this.deck[b].values()].reduce((a, e) => a + e.n, 0);
      const btn = this.el.tabs.createEl("button", { text: `${b === "main" ? "メイン" : "サイド"} ${total}` });
      btn.toggleClass("is-on", this.board === b);
      btn.onclick = () => {
        this.board = b;
        this.renderTabs();
        void this.renderStack();
      };
    }
    this.el.tabs.createEl("button", { text: "Import" }).onclick = () =>
      new ImportModal(this.app, false, (_, text) => void this.importInto(text)).open();
    this.renderLegal();
  }

  // デッキ内の全カード(メイン+サイド)が使えるフォーマットを ○ / × で出す。? は情報が未取得
  private renderLegal() {
    const el = this.legalEl;
    if (!el) return;
    el.empty();
    const v = deckVerdicts(this.app, [...this.deck.main.keys(), ...this.deck.side.keys()]);
    for (const [id, name] of LEGAL_FORMATS) {
      const r = v[id];
      const chip = el.createSpan({ text: `${name} ${r.verdict === "ok" ? "○" : r.verdict === "ng" ? "×" : "?"}`, cls: `mtg-chip is-${r.verdict}` });
      chip.setAttr("aria-label", r.verdict === "ng" ? `使えないカード: ${r.bad.join(", ")}` : r.verdict === "unknown" ? "リーガル情報が未取得のカードがある" : "全てのカードが使える");
    }
    const unknown = v[LEGAL_FORMATS[0][0]].unknown;
    if (unknown.length) {
      el.createEl("button", { text: `リーガル情報を更新 (${unknown.length}枚)` }).onclick = async () => {
        try {
          new Notice(`リーガル情報を更新: ${await updateLegality(this.app, unknown)} 枚`);
        } catch (e) {
          new Notice(`更新失敗: ${(e as Error).message}`);
        }
        this.renderLegal();
      };
    }
  }

  // 取り込んだカードは今のデッキに足す (枚数は加算、版は既存を優先)。上書きはしない
  private async importInto(text: string) {
    const r = await resolveDeck(this.app, this.settings, text);
    if (!r) return;
    for (const board of ["main", "side"] as Board[]) {
      for (const [key, e] of r.deck[board]) {
        const cur = this.deck[board].get(key);
        this.deck[board].set(key, { n: (cur?.n ?? 0) + e.n, print: cur?.print ?? e.print });
      }
    }
    await this.save();
  }

  // ---- 検索 ----

  protected scheduleSearch() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.search(), 300);
  }

  protected async search() {
    const seq = ++this.searchSeq;
    const f = this.filters;
    if (isEmpty(f)) {
      this.el.status.setText("");
      return this.renderResults([]);
    }

    const local = await searchLocal(this.app, f);
    if (seq !== this.searchSeq) return;
    if (local.length) {
      this.el.status.setText(`Cards 内 ${local.length} 件`);
      return this.renderResults(local.slice(0, MAX_RESULTS));
    }

    this.el.status.setText("Cards に無いので Scryfall を検索中…");
    try {
      const found = await searchCards(scryfallQuery(f));
      if (seq !== this.searchSeq) return;
      this.el.status.setText(`Scryfall ${found.length} 件`);
      this.renderResults(found.slice(0, MAX_RESULTS).map((c) => scryfallResult(this.app, this.settings, c)));
    } catch (e) {
      this.el.status.setText(`検索失敗: ${(e as Error).message}`);
    }
  }

  protected renderResults(results: Result[]) {
    const box = this.el.results;
    box.empty();
    for (const r of results) {
      const row = box.createDiv("mtg-row");
      row.createSpan({ text: r.ja ? `${r.name} / ${r.ja}` : r.name, cls: "mtg-name" });
      row.createSpan({ text: r.manaCost, cls: "mtg-dim" });
      row.createSpan({ text: r.typeLine, cls: "mtg-dim" });
      row.onmouseenter = () => void this.preview(r.name, r.image(), r.text(), r.ja);
      const add = row.createEl("button", { text: "+" });
      add.onclick = () => {
        void this.addCard(r);
      };
    }
  }

  // ---- デッキ ----

  // サイドバーの一覧から呼ばれる。clickで1枚追加 / shift+clickで1枚削除
  async addCard(r: Result) {
    try {
      const { key, meta } = await r.resolve();
      this.meta.set(key, meta);
      await this.change(key, 1);
    } catch (e) {
      new Notice(`追加失敗: ${(e as Error).message}`);
    }
  }

  // サイドバーの一覧にホバーしたとき、左の拡大表示に出す
  previewResult(r: Result) {
    void this.preview(r.name, r.image(), r.text(), r.ja);
  }

  async removeCard(r: Result) {
    if (r.localKey) await this.change(r.localKey, -1);
  }

  // フォーマットのルール (構築戦なら同名4枚・サイド15枚まで) を満たさない追加は断る
  private async violation(key: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    const format = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter?.format : undefined;
    const meta = await this.getMeta(key);
    return formatOf(format).canAdd({ deck: this.deck, board: this.board, key, typeLine: meta?.typeLine ?? "", text: await oracleEnglish(this.app, key) });
  }

  private async change(key: string, delta: number) {
    if (delta > 0) {
      const why = await this.violation(key);
      if (why) return void new Notice(why);
    }
    const m = this.deck[this.board];
    const e = m.get(key);
    const n = Math.max(0, (e?.n ?? 0) + delta);
    n ? m.set(key, { ...e, n }) : m.delete(key);
    await this.save();
  }

  private async setPrint(key: string, print?: string) {
    const e = this.deck[this.board].get(key);
    if (e) this.deck[this.board].set(key, { ...e, print });
    await this.save();
  }

  private async save() {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) await this.app.vault.process(file, (c) => writeDeck(c, this.deck));
    this.renderTabs();
    await this.renderStack();
  }

  private async getMeta(key: string): Promise<Meta | undefined> {
    const known = this.meta.get(key);
    if (known) return known;
    const info = cardInfo(this.app, key);
    if (!info) return undefined;
    const meta = { name: info.name, typeLine: info.typeLine, cmc: info.cmc, image: await cardImage(this.app, info.file) };
    this.meta.set(key, meta);
    return meta;
  }

  private async renderStack() {
    const seq = ++this.stackSeq;
    const cards = await Promise.all(
      [...this.deck[this.board]].map(async ([key, { n: count, print }]) => {
        const meta = await this.getMeta(key);
        const image = (print && (await printingImage(this.app, key, print))) || meta?.image;
        return { key, count, meta, image };
      }),
    );
    if (seq !== this.stackSeq) return;

    const groups = new Map<string, typeof cards>();
    for (const c of cards) {
      const type = c.meta ? TYPE_CHECK.find((t) => c.meta!.typeLine.includes(t)) ?? "Other" : "Other";
      groups.set(type, [...(groups.get(type) ?? []), c]);
    }

    this.el.stack.empty();
    for (const g of GROUP_ORDER) {
      const items = groups.get(g)?.sort((a, b) => (a.meta?.cmc ?? 0) - (b.meta?.cmc ?? 0) || a.key.localeCompare(b.key));
      if (!items) continue;
      const col = this.el.stack.createDiv("mtg-group");
      col.createEl("h4", { text: `${g} (${items.reduce((a, c) => a + c.count, 0)})` });
      for (const c of items) {
        const item = col.createDiv("mtg-item");
        if (c.image) item.createEl("img", { attr: { src: c.image, alt: c.key } });
        else item.createSpan({ text: c.key, cls: "mtg-name" });
        item.createSpan({ text: String(c.count), cls: "mtg-badge" });
        const ctl = item.createDiv("mtg-ctl");
        ctl.createEl("button", { text: "🖼", attr: { "aria-label": "イラスト変更" } }).onclick = () => void this.pickPrint(c.key);
        ctl.createEl("button", { text: "−" }).onclick = () => void this.change(c.key, -1);
        ctl.createEl("button", { text: "+" }).onclick = () => void this.change(c.key, 1);
        item.onmouseenter = () => void this.preview(c.key, Promise.resolve(c.image), cardText(this.app, c.key), cardInfo(this.app, c.key)?.nameLocal);
      }
    }
  }

  private async pickPrint(key: string) {
    const prints = await readPrintings(this.app, key);
    if (!prints.length) return void new Notice("収録一覧が無いカード。Cards から削除して取り直すと付く");
    new PrintModal(this.app, key, prints, true, (p) => void this.setPrint(key, p)).open();
  }

  // ja = 設定した言語のカード名。無ければ英語名だけ出す
  protected async preview(name: string, image: Promise<string | undefined>, text: Promise<string>, ja?: string) {
    const seq = ++this.previewSeq;
    const [url, body] = await Promise.all([image, text]);
    if (seq !== this.previewSeq) return;
    this.el.preview.empty();
    if (url) this.el.preview.createEl("img", { attr: { src: url, alt: name } });
    this.el.preview.createDiv({ text: ja && ja !== name ? `${name} (${ja})` : name, cls: "mtg-preview-name" });
    this.el.preview.createDiv({ text: body, cls: "mtg-preview-text" });
  }
}

export class PrintModal extends Modal {
  constructor(app: App, private key: string, private prints: Printing[], private canReset: boolean, private onPick: (print?: string) => void) {
    super(app);
  }
  onOpen() {
    this.setTitle(`${this.key} のイラスト`);
    this.modalEl.addClass("mtg-print-modal");
    // コレクションは版が必須なので「指定なし」は出さない
    if (this.canReset) this.contentEl.createEl("button", { text: "指定なし (標準に戻す)" }).onclick = () => this.pick();
    const grid = this.contentEl.createDiv("mtg-print-grid");
    for (const p of this.prints) {
      const cell = grid.createDiv("mtg-print");
      // 画像は表示されるものだけ読み込む (一覧が長くても重くならない)
      cell.createEl("img", { attr: { src: printingImageUrl(p.id), loading: "lazy", alt: p.set } });
      cell.createDiv({ text: `${p.set.toUpperCase()} ${p.collector_number}${p.lang !== "en" ? ` (${p.lang})` : ""}`, cls: "mtg-dim" });
      cell.createDiv({ text: p.released_at, cls: "mtg-dim" });
      cell.onclick = () => this.pick(`${p.set} ${p.collector_number}`);
    }
  }
  private pick(print?: string) {
    this.close();
    this.onPick(print);
  }
  onClose() {
    this.contentEl.empty();
  }
}
