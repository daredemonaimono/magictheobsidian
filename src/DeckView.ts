import { App, ItemView, Modal, Notice, Setting, TFile, ViewStateResult, WorkspaceLeaf, moment } from "obsidian";
import { cardImage, cardInfo, cardText, oracleEnglish, printingImage, printingOf, readPrintings, setLocalText, updateLegality } from "./cards";
import { CREATABLE, FORMATS, formatOf, judge } from "./rules";
import { formatPrice, priceOf } from "./prices";
import { deckArtUrl } from "./ThumbnailModal";
import { ImportModal, resolveDeck } from "./import";
import { Settings } from "./settings";
import { Board, Deck, emptyDeck, parseDeck, writeDeck } from "./deck";
import { Printing, printingImageUrl } from "./scryfall";
import { COLUMNS, groupOf, groupRank } from "./layout";
import { Filters, Meta, Result, buildFilterBar, emptyFilters, isEmpty, searchAll } from "./search";

export const DECK_VIEW = "mtg-deck";

const MAX_RESULTS = 40;

export class DeckView extends ItemView {
  private path = "";
  private deck: Deck = emptyDeck();
  private board: Board = "main";
  protected meta = new Map<string, Meta>();
  protected filters: Filters = emptyFilters();
  protected timer?: number;
  protected searchSeq = 0;
  private stackSeq = 0;
  private format?: string; // 画面で変えた直後のフォーマット (frontmatter への反映を待たずに使う)
  protected previewSeq = 0;
  private headSeq = 0;
  private footSeq = 0;
  private headEl!: HTMLElement;
  private footEl!: HTMLElement;
  protected el!: { tabs: HTMLElement; status: HTMLElement; results: HTMLElement; stack: HTMLElement; preview: HTMLElement };

  constructor(leaf: WorkspaceLeaf, protected settings: Settings) {
    super(leaf);
    // デッキ一覧など、別の画面でサムネイル・説明文・フォーマットを変えたときも、ヘッダーを合わせる
    this.registerEvent(
      this.app.metadataCache.on("changed", (f) => {
        if (f.path !== this.path || !this.headEl) return;
        void this.renderHeader();
        void this.renderFooter();
      }),
    );
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
    this.board = this.rules().boards[0]; // 統率戦ならコマンダー欄から
    this.build();
    this.app.workspace.trigger("mtg-deck-changed"); // 読み込みが終わった。サイドバーの一覧を、このデッキの中身にする
    await super.setState(state, result);
  }

  async onClose() {
    window.clearTimeout(this.timer);
  }

  protected build() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-deck");

    this.headEl = root.createDiv("mtg-dhead");
    const body = root.createDiv("mtg-dbody");
    this.footEl = root.createDiv("mtg-dfoot");
    const preview = body.createDiv("mtg-side");
    const main = body.createDiv("mtg-main");
    const tabs = main.createDiv("mtg-tabs");
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
    const label: Record<Board, string> = { main: "メイン", side: "サイド", commander: "コマンダー" };
    const rules = this.rules();
    for (const b of rules.boards) {
      // 統率者構築は、コマンダーもメインの画面に並ぶので合計で数える
      const boards = rules.hasCommander && b === "main" ? ["commander", "main"] as Board[] : [b];
      const total = boards.flatMap((x) => [...this.deck[x].values()]).reduce((a, e) => a + e.n, 0);
      const btn = this.el.tabs.createEl("button", { text: `${label[b]} ${total}` });
      btn.toggleClass("is-on", this.board === b);
      btn.onclick = () => {
        this.board = b;
        this.renderTabs();
        void this.renderStack();
        this.app.workspace.trigger("mtg-deck-changed"); // サイドバーの一覧も、メイン/サイドに合わせる
      };
    }
    this.el.tabs.createEl("button", { text: "Import" }).onclick = () =>
      new ImportModal(this.app, false, (_, text) => void this.importInto(text)).open();

    void this.renderHeader();
    void this.renderFooter();
  }

  private get file() {
    const f = this.app.vault.getAbstractFileByPath(this.path);
    return f instanceof TFile ? f : undefined;
  }

  // 上のヘッダー: ヘッダー画像 (デッキのカードアート。デッキ一覧のサムネイルと同じ)、デッキ名、フォーマット (適合 ○/×)、説明文。フォーマットと説明文はここから編集できる
  private async renderHeader() {
    const file = this.file;
    const el = this.headEl;
    if (!file || !el) return;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const seq = ++this.headSeq;
    const key: string | undefined = fm?.thumbnail; // デッキ一覧のサムネイルと同じ
    const art = key ? await deckArtUrl(this.app, this.deck, key) : undefined;
    if (seq !== this.headSeq) return;
    el.empty();
    if (art) el.style.setProperty("--mtg-head-art", `url("${art}")`);
    else el.style.removeProperty("--mtg-head-art");

    el.createDiv({ text: this.getDisplayText(), cls: "mtg-dtitle" });
    const badges = el.createDiv("mtg-dbadges");

    // フォーマット。変えるとルール (枚数・使えるカード) が変わる。`制限なし` は、format が無い・知らないデッキの扱い
    const current = this.formatId();
    const sel = badges.createEl("select", { cls: "mtg-dhformat", attr: { "aria-label": "フォーマット" } });
    const options = CREATABLE.filter((id) => (current === "commander") === (id === "commander"));
    if (!options.includes(current)) options.unshift(current);
    for (const id of options) sel.createEl("option", { text: FORMATS[id].name.toUpperCase(), value: id });
    sel.value = current;
    sel.disabled = current === "commander";
    sel.onchange = () => void this.setFormat(sel.value);
    const all = ["commander", "main", "side"].flatMap((b) => [...this.deck[b as Board].keys()]);
    if (current !== "constructed") {
      const v = judge(all.map((k) => ({ key: k, legal: cardInfo(this.app, k)?.legal })), current, this.deck.commander.size > 0);
      const tip = { ok: "このフォーマットで使える", ng: "使えないカードがある", unknown: "リーガル情報が無いカードがある" }[v];
      badges.createSpan({ text: { ok: "○", ng: "×", unknown: "？" }[v], cls: `mtg-dverdict is-${v}`, attr: { "aria-label": tip } });
    }
    badges.createSpan({ text: `更新 ${moment(file.stat.mtime).fromNow()}`, cls: "mtg-dago-head" });

    // 説明文はクリックで編集 (ヘッダー画像は、デッキ一覧の🖼で設定する)
    const desc = el.createDiv({ text: fm?.description || "クリックして説明文を入力", cls: "mtg-ddesc" });
    desc.toggleClass("is-empty", !fm?.description);
    desc.onclick = () =>
      new TextModal(this.app, "デッキの説明文", String(fm?.description ?? ""), async (t) => {
        await this.app.fileManager.processFrontMatter(file, (f) => (t.trim() ? (f.description = t.trim()) : delete f.description));
        void this.renderHeader();
      }).open();
  }

  // 下のバー: 枚数、デッキの合計価格 (コレクションと同じ通貨)、タイプ別の枚数
  private async renderFooter() {
    const el = this.footEl;
    if (!el) return;
    const seq = ++this.footSeq;
    const sum = (m: Map<string, { n: number }>) => [...m.values()].reduce((a, e) => a + e.n, 0);
    const types = new Map<string, number>();
    let total = 0;
    let missing = 0;
    for (const [board, m] of [["commander", this.deck.commander], ["main", this.deck.main]] as const) {
      for (const [key, e] of m) {
        const info = cardInfo(this.app, key);
        const g = groupOf(info?.typeLine ?? "", board === "commander");
        types.set(g, (types.get(g) ?? 0) + e.n);
      }
    }
    for (const [key, e] of [...this.deck.commander, ...this.deck.main, ...this.deck.side]) {
      const id = (e.print && (await printingOf(this.app, key, e.print))?.id) || cardInfo(this.app, key)?.id;
      const v = id ? priceOf(id, false, this.settings.currency) : undefined;
      v === undefined ? missing++ : (total += v * e.n);
    }
    if (seq !== this.footSeq) return;
    el.empty();
    const mainN = sum(this.deck.main) + sum(this.deck.commander);
    el.createSpan({ text: `メイン ${mainN} / サイド ${sum(this.deck.side)}` });
    el.createSpan({ text: FORMATS[this.formatId()].name.toUpperCase(), cls: "mtg-dfoot-dim" });
    el.createSpan({
      text: `${formatPrice(total, this.settings.currency)}${missing ? ` (値段なし ${missing} 種)` : ""}`,
      attr: { "aria-label": "デッキの合計価格 (コレクションの価格の更新で取った価格を使う)" },
    });
    const right = el.createDiv("mtg-dfoot-types");
    for (const g of [...types.keys()].sort((a, b) => groupRank(a) - groupRank(b))) right.createSpan({ text: `${g} ${types.get(g)}` });
  }

  // デッキのフォーマット (frontmatter の format:)。無い・知らないものは制限なし
  private formatId(): string {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    const id = this.format ?? (file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter?.format : undefined);
    return id in FORMATS ? id : "constructed";
  }

  private rules() {
    return formatOf(this.formatId());
  }

  // 作成後にフォーマットを変える。統率戦とのあいだは欄の構成が違うので変えられない (作り直す)
  private async setFormat(id: string) {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof TFile)) return;
    this.format = id;
    await this.app.fileManager.processFrontMatter(file, (fm) => (fm.format = id));
    this.board = this.rules().boards[0];
    this.renderTabs();
    await this.renderStack();
    this.app.workspace.trigger("mtg-deck-changed"); // サイドバーの一覧で、使えなくなったカードを出し直す
  }

  // サイドバーの一覧でカードを選べるか。このデッキのフォーマットで使えないと分かっているカードは選べない
  allows(r: Result): boolean {
    const id = this.rules().legalId;
    return !id || !r.legal || r.legal.includes(id);
  }


  // 取り込んだカードは今のデッキに足す (枚数は加算、版は既存を優先)。上書きはしない
  private async importInto(text: string) {
    const r = await resolveDeck(this.app, this.settings, text);
    if (!r) return;
    const rules = this.rules();
    for (const from of ["commander", "main", "side"] as Board[]) {
      const board = rules.boards.includes(from) || (from === "commander" && rules.hasCommander) ? from : "main"; // 欄が無いフォーマットはメインへ
      for (const [key, e] of r.deck[from]) {
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
    await searchAll(this.app, this.settings, f, () => seq !== this.searchSeq, (res, note) => {
      this.el.status.setText(note);
      this.renderResults(res.slice(0, MAX_RESULTS));
    });
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

  // サイドバーのメイン/サイド切り替え。追加先の欄も同じになる
  get onSide() {
    return this.board === "side";
  }
  showSide(side: boolean) {
    this.board = side ? "side" : this.rules().boards[0];
    this.renderTabs();
    void this.renderStack();
  }

  // サイドバーに並べる、いまデッキに入っているカード (コマンダー → メイン → サイド、コスト順)
  deckCards(): { key: string; n: number; board: Board }[] {
    const cmc = (k: string) => cardInfo(this.app, k)?.cmc ?? 0;
    return (["commander", "main", "side"] as Board[]).flatMap((board) =>
      [...this.deck[board]].map(([key, e]) => ({ key, n: e.n, board })).sort((a, b) => cmc(a.key) - cmc(b.key) || a.key.localeCompare(b.key)),
    );
  }

  // サイドバーのデッキ内の一覧から、そのカードの枚数を増減する (欄はカードがいる欄)。上限などのルールは追加と同じ
  async adjustCard(key: string, delta: number, board: Board) {
    await this.change(key, delta, board);
  }

  countOf(key: string) {
    return (["commander", "main", "side"] as Board[]).reduce((a, b) => a + (this.deck[b].get(key)?.n ?? 0), 0);
  }

  // サイドバーの一覧にホバーしたとき、左の拡大表示に出す
  previewResult(r: Result) {
    void this.preview(r.name, r.image(), r.text(), r.ja);
  }

  async removeCard(r: Result) {
    if (r.localKey) await this.change(r.localKey, -1);
  }

  // フォーマットのルール (構築戦なら同名4枚・サイド15枚まで) を満たさない追加は断る
  private async violation(key: string, board: Board = this.board): Promise<string | null> {
    const rules = this.rules();
    let meta = await this.getMeta(key);
    // Vintage の制限カード (1枚だけ) の判定には制限の情報が要る。古いカードで未取得なら、このカード1枚だけ取りに行く
    if (rules.legalId === "vintage" && meta && !meta.restricted) {
      const got = (await updateLegality(this.app, [key]).catch(() => undefined))?.get(key);
      if (got) {
        meta = { ...meta, ...got };
        this.meta.set(key, meta);
      }
    }
    return rules.canAdd({
      deck: this.deck,
      board,
      key,
      typeLine: meta?.typeLine ?? "",
      text: await oracleEnglish(this.app, key),
      legal: meta?.legal,
      restricted: meta?.restricted,
    });
  }

  private async change(key: string, delta: number, board: Board = this.board) {
    if (delta > 0) {
      const why = await this.violation(key, board);
      if (why) return void new Notice(why);
    }
    const m = this.deck[board];
    const e = m.get(key);
    const n = Math.max(0, (e?.n ?? 0) + delta);
    n ? m.set(key, { ...e, n }) : m.delete(key);
    await this.save();
  }

  private async setPrint(key: string, print: string | undefined, board: Board) {
    const e = this.deck[board].get(key);
    if (e) this.deck[board].set(key, { ...e, print });
    await this.save();
  }

  // 統率者構築: メインの1枚をコマンダーに指定する。コマンダーは1体まで (今の指定を外してから)
  private async designate(key: string) {
    const main = this.deck.main;
    const e = main.get(key);
    if (!e) return;
    if (this.deck.commander.size) return void new Notice("コマンダーは1体まで (今のコマンダーを先に解除する)");
    e.n > 1 ? main.set(key, { ...e, n: e.n - 1 }) : main.delete(key);
    const why = await this.violation(key, "commander"); // メインから外した状態で、コマンダーとして入れられるか見る
    if (why) {
      main.set(key, e);
      return void new Notice(why);
    }
    this.deck.commander.set(key, { n: 1, print: e.print });
    await this.save();
  }

  private async undesignate(key: string) {
    const e = this.deck.commander.get(key);
    if (!e) return;
    this.deck.commander.delete(key);
    this.deck.main.set(key, { n: (this.deck.main.get(key)?.n ?? 0) + 1, print: e.print });
    await this.save();
  }

  private async save() {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) await this.app.vault.process(file, (c) => writeDeck(c, this.deck));
    this.renderTabs();
    await this.renderStack();
    this.app.workspace.trigger("mtg-deck-changed"); // サイドバーの一覧を更新させる
  }

  private async getMeta(key: string): Promise<Meta | undefined> {
    const known = this.meta.get(key);
    if (known) return known;
    const info = cardInfo(this.app, key);
    if (!info) return undefined;
    const meta = { name: info.name, typeLine: info.typeLine, cmc: info.cmc, image: await cardImage(this.app, info.file), legal: info.legal, restricted: info.restricted };
    this.meta.set(key, meta);
    return meta;
  }

  private async renderStack() {
    const seq = ++this.stackSeq;
    const rules = this.rules();
    // 統率者構築はコマンダーとメインを1つの画面に並べる。それ以外は今のタブ (メイン/サイド)
    const shown: Board[] = rules.hasCommander ? ["commander", "main"] : [this.board];
    const cards = await Promise.all(
      shown.flatMap((board) =>
        [...this.deck[board]].map(async ([key, { n: count, print }]) => {
          const meta = await this.getMeta(key);
          const image = (print && (await printingImage(this.app, key, print))) || meta?.image;
          return { key, count, board, meta, image };
        }),
      ),
    );
    if (seq !== this.stackSeq) return;

    const groups = new Map<string, typeof cards>();
    for (const c of cards) {
      const type = groupOf(c.meta?.typeLine ?? "", c.board === "commander");
      groups.set(type, [...(groups.get(type) ?? []), c]);
    }

    this.el.stack.empty();
    for (const names of COLUMNS) {
      const column = this.el.stack.createDiv("mtg-col");
      for (const g of names) {
        const items = groups.get(g)?.sort((a, b) => (a.meta?.cmc ?? 0) - (b.meta?.cmc ?? 0) || a.key.localeCompare(b.key));
        if (!items) continue;
        const col = column.createDiv("mtg-group");
        col.createEl("h4", { text: `${g} (${items.reduce((a, c) => a + c.count, 0)})` });
        for (const c of items) {
          const item = col.createDiv("mtg-item");
          if (c.image) item.createEl("img", { attr: { src: c.image, alt: c.key } });
          else item.createSpan({ text: c.key, cls: "mtg-name" });
          item.createSpan({ text: String(c.count), cls: "mtg-badge" });
          const ctl = item.createDiv("mtg-ctl");
          ctl.createEl("button", { text: "🖼", attr: { "aria-label": "イラスト変更" } }).onclick = () => void this.pickPrint(c.key, c.board);
          // 統率者構築: 伝説のカードはコマンダーに指定できる。指定済みなら解除
          if (rules.hasCommander && (c.board === "commander" || c.meta?.typeLine.includes("Legendary"))) {
            const crown = ctl.createEl("button", { text: "👑", attr: { "aria-label": c.board === "commander" ? "コマンダーを解除" : "コマンダーにする" } });
            crown.toggleClass("is-on", c.board === "commander");
            crown.onclick = () => void (c.board === "commander" ? this.undesignate(c.key) : this.designate(c.key));
          }
          ctl.createEl("button", { text: "−" }).onclick = () => void this.change(c.key, -1, c.board);
          if (c.board !== "commander") ctl.createEl("button", { text: "+" }).onclick = () => void this.change(c.key, 1, c.board);
          item.onmouseenter = () => void this.preview(c.key, Promise.resolve(c.image), cardText(this.app, c.key), cardInfo(this.app, c.key)?.nameLocal);
        }
      }
      if (!column.hasChildNodes()) column.remove();
    }
  }

  private async pickPrint(key: string, board: Board) {
    const prints = await readPrintings(this.app, key);
    if (!prints.length) return void new Notice("収録一覧が無いカード。Cards から削除して取り直すと付く");
    new PrintModal(this.app, key, prints, true, (p) => void this.setPrint(key, p, board)).open();
  }

  // ja = 設定した言語のカード名。無ければ英語名だけ出す
  protected async preview(name: string, image: Promise<string | undefined>, text: Promise<string>, ja?: string) {
    const seq = ++this.previewSeq;
    const [url, body] = await Promise.all([image, text]);
    if (seq !== this.previewSeq) return;
    this.el.preview.empty();
    if (url) this.el.preview.createEl("img", { attr: { src: url, alt: name } });
    this.el.preview.createDiv({ text: ja && ja !== name ? `${name} (${ja})` : name, cls: "mtg-preview-name" });
    const text_ = this.el.preview.createDiv({ text: body, cls: "mtg-preview-text" });
    // 設定した言語のテキストを手で直す (取れなかったとき用)。英語の本文は変えない
    const lang = this.settings.textLang;
    if (lang !== "en" && cardInfo(this.app, name)) {
      const pen = text_.createEl("button", { text: "✎", cls: "mtg-preview-edit", attr: { "aria-label": `効果テキスト (${lang}) を編集` } });
      pen.onclick = () =>
        new TextModal(this.app, `${name} (${lang})`, body, async (t) => {
          await setLocalText(this.app, name, lang, t);
          void this.preview(name, image, cardText(this.app, name), ja);
        }).open();
    }
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

class TextModal extends Modal {
  constructor(app: App, private title: string, private body: string, private onSave: (text: string) => Promise<void>) {
    super(app);
  }
  onOpen() {
    this.setTitle(this.title);
    const area = this.contentEl.createEl("textarea", { cls: "mtg-textedit" });
    area.value = this.body;
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("保存").setCta().onClick(async () => {
        await this.onSave(area.value);
        this.close();
      }),
    );
  }
  onClose() {
    this.contentEl.empty();
  }
}
