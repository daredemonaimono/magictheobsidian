import { App, ItemView, Modal, Notice, Setting, TFile, ViewStateResult, WorkspaceLeaf, moment, setIcon } from "obsidian";
import { cssUrl, localUrl, setImg } from "./imageCache";
import { TextModal, editLocalName, editLocalText, wikiButton } from "./cardEdit";
import { iconButton, imageButton } from "./icons";
import { typeIcon } from "./typeIcon";
import { editableMemo, setMemo } from "./battle/memo";
import { addFlip } from "./flip";
import { normLocalName } from "./localName";
import { CARD_DIR, addPrintings, oracleIdOf, cardBackImage, cardBackText, cardImage, cardInfo, cardText, oracleEnglish, printingImage, printingOf, readPrintings, refetchCard, updateLegality } from "./cards";
import { CREATABLE, FORMATS, formatOf, judge } from "./rules";
import { loadCollection } from "./collection";
import { formatPrice, priceOf, refreshPrices } from "./prices";
import { ThumbnailModal, deckArtUrl } from "./ThumbnailModal";
import { Settings } from "./settings";
import { Board, Deck, emptyDeck, parseDeck, thumbnailKey, writeDeck } from "./deck";
import { Printing, fetchById, fetchPrintingsLang, printingImageUrl } from "./scryfall";
import { COLUMNS, groupOf, groupRank, isToken } from "./layout";
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
    const label: Record<Board, string> = { main: "メイン", side: "サイド", commander: "コマンダー", token: "トークン" };
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
        this.app.workspace.trigger("mtg-show-list"); // サイドバーが畳まれていたら開く
      };
    }
    void this.renderHeader();
    void this.renderFooter();
  }

  // デッキの全カード (トークン含む) の情報を Scryfall から取る (勝手には取らない。ヘッダーの更新ボタンから)。
  // 取り込みで取れなかった効果テキスト・リーガル情報を補い、価格も取り直す。手で直したテキストは上書きしない
  private refreshing = false;
  private async refreshInfo() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.headEl?.querySelector<HTMLElement>(".mtg-drefresh")?.addClass("is-busy");
    const notice = new Notice("情報を取得中…", 0);
    try {
      const entries = (["commander", "main", "side", "token"] as Board[]).flatMap((b) => [...this.deck[b]]);
      const keys = [...new Set(entries.map(([k]) => k))];
      const lang = this.settings.textLang;
      // 設定言語のテキスト (## Text (ja)) が無いノートは、取り直して作る (英語設定なら不要)
      const noText: string[] = [];
      if (lang !== "en") {
        for (const k of keys) {
          const f = this.app.vault.getAbstractFileByPath(`${CARD_DIR}/${k}.md`);
          if (f instanceof TFile && !(await this.app.vault.cachedRead(f)).includes("\n## Text (")) noText.push(k);
        }
      }
      // クリーチャーで、パワー・タフネスが無い古いノートも取り直す (対戦エンジンで使う)
      for (const k of keys) {
        const i = cardInfo(this.app, k);
        if (i && /\bCreature\b/.test(i.typeLine) && (i.power === undefined || i.keywords === undefined) && !noText.includes(k)) noText.push(k);
      }
      // 名前が A // B で、layout が無い古いノートも取り直す (裏面の画像を取る)
      for (const k of keys) {
        const i = cardInfo(this.app, k);
        if (i && i.name.includes(" // ") && !i.layout && !noText.includes(k)) noText.push(k);
        if (i && /\bPlaneswalker\b/.test(i.typeLine) && !i.loyaltyKnown && !noText.includes(k)) noText.push(k); // 忠誠度の行が無い古いノートも取り直す (対戦で使う。X は X と書くので、取り直しは1回だけ)
      }
      let fetched = 0;
      let failedCards = 0;
      const failedNames: string[] = [];
      for (const k of noText) {
        notice.setMessage(`情報を取得中… ${++fetched}/${noText.length}`);
        try {
          await refetchCard(this.app, this.settings, k);
        } catch (e) {
          failedCards++;
          failedNames.push(`${k} (${(e as Error).message})`);
        }
        await new Promise((r) => setTimeout(r, 100)); // Scryfall の負荷配慮
      }
      const noLegal = keys.filter((k) => !noText.includes(k) && !cardInfo(this.app, k)?.legal);
      if (noLegal.length) await updateLegality(this.app, noLegal).catch(() => failedCards++);
      const ids = new Set<string>();
      for (const [key, e] of entries) {
        const id = (e.print && (await printingOf(this.app, key, e.print))?.id) || cardInfo(this.app, key)?.id;
        if (id) ids.add(id);
      }
      const failed = await refreshPrices([...ids]);
      this.meta.clear(); // 取り直した型・リーガルを読み直す
      notice.hide();
      new Notice(
        `情報を取得: 取り直し ${noText.length} 枚・価格 ${ids.size} 件` +
          (failed || failedCards ? ` (失敗 ${failed + failedCards} 回。取れた分だけ更新した${failedNames.length ? `。取り直せなかったカード: ${failedNames.slice(0, 3).join(", ")}` : ""})` : ""),
      );
    } catch (e) {
      notice.hide();
      new Notice(`情報の取得失敗: ${(e as Error).message}`);
    }
    this.refreshing = false;
    this.headEl?.querySelector<HTMLElement>(".mtg-drefresh")?.removeClass("is-busy");
    void this.renderStack();
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
    const key = thumbnailKey(fm?.thumbnail, this.deck); // デッキ一覧のサムネイルと同じ決め方 (一覧で選んでも、ここで選んでも、両方に反映される)
    const art = key ? await deckArtUrl(this.app, this.deck, key) : undefined;
    if (seq !== this.headSeq) return;
    el.empty();
    const artLocal = await cssUrl(art); // 保存済みの画像 (通信しない)
    if (seq !== this.headSeq) return;
    if (artLocal) el.style.setProperty("--mtg-head-art", `url("${artLocal}")`);
    else el.style.removeProperty("--mtg-head-art");

    // ヘッダーにカーソルを合わせると、右上に、メモのアイコン。押すと、AI へのメモ (対戦で、このデッキを AI が使うときに読む) を、自由に書ける
    // 更新ボタン (カバー写真のアイコンの左): デッキの全カードの情報 (効果テキスト・リーガル・価格) を取り直す
    iconButton(el, "refresh-cw", "情報を更新 (効果テキスト・リーガル・価格を取り直す)", `mtg-drefresh clickable-icon${this.refreshing ? " is-busy" : ""}`).onclick = () => void this.refreshInfo();
    // 隣の画像のアイコンで、カバー写真 (デッキ一覧のサムネイルと同じもの) を選べる
    const cover = imageButton(el, "カバー写真を選ぶ", "mtg-dcover clickable-icon");
    cover.onclick = () => new ThumbnailModal(this.app, file, "カバー写真にするカードアート", (k) => void this.app.fileManager.processFrontMatter(file, (f) => (f.thumbnail = k))).open();
    const memo = el.createEl("button", { cls: "mtg-dmemo clickable-icon", attr: { "aria-label": "AI へのメモ" } });
    setIcon(memo, "sticky-note");
    memo.onclick = async () => {
      const f = this.file;
      if (!f) return;
      const body = editableMemo(await this.app.vault.read(f));
      new TextModal(this.app, "AI へのメモ", body, async (t) => {
        await this.app.vault.process(f, (c) => setMemo(c, t));
      }, "このデッキを、対戦で AI が使うとき、読みます。マリガンの基準・立ち回り・コンボなどを、自由に書いてください (書いていないことは、AI が自分で判断します)。デッキのノートの「## メモ」の欄に保存されます。", [...new Set((["commander", "main", "side"] as Board[]).flatMap((b) => [...this.deck[b].keys()]))].map((key) => ({ key, label: cardInfo(this.app, key)?.nameLocal ?? key }))).open();
    };

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
    const all = ["commander", "main", "side"].flatMap((b) => [...this.deck[b as Board].keys()]).filter((k) => !isToken(cardInfo(this.app, k)?.typeLine ?? ""));
    if (current !== "constructed") {
      const v = judge(all.map((k) => ({ key: k, legal: cardInfo(this.app, k)?.legal })), current, this.deck.commander.size > 0);
      const tip = { ok: "このフォーマットで使える", ng: "使えないカードがある", unknown: "リーガル情報が無いカードがある" }[v];
      badges.createSpan({ text: { ok: "○", ng: "×", unknown: "？" }[v], cls: `mtg-dverdict is-${v}`, attr: { "aria-label": tip } });
    }
    badges.createSpan({ text: `更新 ${moment(file.stat.mtime).fromNow()}`, cls: "mtg-dago-head" });

    // 説明文はクリックで編集 (ヘッダー画像 (カバー写真) は、ここのヘッダーの画像アイコンか、デッキ一覧で設定する)
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
    const need = new Map<string, { n: number; unit?: number }>();
    for (const [key, e] of [...this.deck.commander, ...this.deck.main, ...this.deck.side]) {
      const id = (e.print && (await printingOf(this.app, key, e.print))?.id) || cardInfo(this.app, key)?.id;
      const v = id ? priceOf(id, false, this.settings.currency) : undefined;
      v === undefined ? missing++ : (total += v * e.n);
      const cur = need.get(key);
      need.set(key, { n: (cur?.n ?? 0) + e.n, unit: cur?.unit ?? v });
    }
    // 資産 (コレクション) に無い分の差額。版は問わず、同じカードの所持枚数で数える。基本土地は数えない
    const owned = new Map<string, number>();
    for (const r of (await loadCollection(this.app)).values()) owned.set(r.card, (owned.get(r.card) ?? 0) + r.n);
    let lack = 0;
    let lackN = 0;
    for (const [key, x] of need) {
      if (cardInfo(this.app, key)?.typeLine.includes("Basic")) continue;
      const short = Math.max(0, x.n - (owned.get(key) ?? 0));
      lackN += short;
      lack += short * (x.unit ?? 0);
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
    el.createSpan({
      text: lackN ? `不足 ${formatPrice(lack, this.settings.currency)} (${lackN} 枚)` : "不足なし",
      attr: { "aria-label": "資産 (コレクション) に無いカードの差額。価格は「価格取得」で取り直せる" },
    });
    const right = el.createDiv("mtg-dfoot-types");
    for (const g of [...types.keys()].sort((a, b) => groupRank(a) - groupRank(b))) {
      const item = right.createSpan("mtg-dfoot-type"); // タイプのアイコン + 枚数
      typeIcon(item, g);
      item.createSpan({ text: String(types.get(g)) });
    }
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
    if (isToken(r.typeLine)) return true; // トークンはフォーマットに関係なく入れられる
    const id = this.rules().legalId;
    return !id || !r.legal || r.legal.includes(id);
  }


  // 取り込んだカードは今のデッキに足す (枚数は加算、版は既存を優先)。上書きはしない
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

  // メインの1枚をサイドへ、サイドの1枚をメインへ移す。移した先で入れられるか (枚数の上限・フォーマット) も見る。だめなら、そのまま
  async moveCard(key: string, from: Board) {
    if (from !== "main" && from !== "side") return;
    const to: Board = from === "main" ? "side" : "main";
    if (!this.rules().boards.includes(to)) return void new Notice("このフォーマットには、サイドボードが無い");
    const src = this.deck[from].get(key);
    if (!src) return;
    src.n > 1 ? this.deck[from].set(key, { ...src, n: src.n - 1 }) : this.deck[from].delete(key);
    const why = await this.violation(key, to); // 移す1枚を外した状態で、移した先に入れられるか
    if (why) {
      this.deck[from].set(key, src);
      return void new Notice(why);
    }
    const dst = this.deck[to].get(key);
    this.deck[to].set(key, { ...dst, n: (dst?.n ?? 0) + 1, print: dst?.print ?? src.print });
    await this.save();
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
  deckCards(): { key: string; n: number; board: Board; print?: string }[] {
    const cmc = (k: string) => cardInfo(this.app, k)?.cmc ?? 0;
    return (["commander", "main", "side", "token"] as Board[]).flatMap((board) =>
      [...this.deck[board]].map(([key, e]) => ({ key, n: e.n, board, print: e.print })).sort((a, b) => cmc(a.key) - cmc(b.key) || a.key.localeCompare(b.key)),
    );
  }

  // サイドバーのデッキ内の一覧から、そのカードの枚数を増減する (欄はカードがいる欄)。上限などのルールは追加と同じ
  async adjustCard(key: string, delta: number, board: Board) {
    await this.change(key, delta, board);
  }

  countOf(key: string) {
    return (["commander", "main", "side", "token"] as Board[]).reduce((a, b) => a + (this.deck[b].get(key)?.n ?? 0), 0);
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
    // トークンは、どの欄から操作しても別枠 (Token) に入り、ルールの確認も受けない
    if (isToken((await this.getMeta(key))?.typeLine ?? "")) board = "token";
    else if (delta > 0) {
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
    const shown: Board[] = rules.hasCommander ? ["commander", "main", "token"] : [this.board, "token"];
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
          const img = c.image ? item.createEl("img", { attr: { alt: c.key } }) : undefined;
          setImg(img, c.image); // 保存済みの画像 (通信しない)。無ければ、読み込みと同時に保存する
          if (!img) item.createSpan({ text: c.key, cls: "mtg-name" });
          item.createSpan({ text: String(c.count), cls: "mtg-badge" });
          const ctl = item.createDiv("mtg-ctl");
          imageButton(ctl, "イラスト変更").onclick = () => void this.pickPrint(c.key, c.board);
          if (this.settings.textLang === "ja") wikiButton(ctl, c.key, cardInfo(this.app, c.key)?.nameLocal); // 日本語の設定のときだけ、MTG Wiki のページを開く
          // 統率者構築: 伝説のカードはコマンダーに指定できる。指定済みなら解除
          if (rules.hasCommander && (c.board === "commander" || c.meta?.typeLine.includes("Legendary"))) {
            const crown = iconButton(ctl, "crown", c.board === "commander" ? "コマンダーを解除" : "コマンダーにする");
            crown.toggleClass("is-on", c.board === "commander");
            crown.onclick = () => void (c.board === "commander" ? this.undesignate(c.key) : this.designate(c.key));
          }
          // 両面カード (裏面の画像があるものだけ): ↩︎ で裏面に。左のプレビューも合わせる (増減は、サイドバーの一覧で行う)
          const file = cardInfo(this.app, c.key)?.file;
          if (file && img)
            void cardBackImage(this.app, file, c.image).then((back) =>
              addFlip(ctl, img, c.image, back, (flipped, src) => void this.preview(c.key, Promise.resolve(src), flipped ? cardBackText(this.app, c.key) : cardText(this.app, c.key), cardInfo(this.app, c.key)?.nameLocal)),
            );
          item.onmouseenter = () => void this.preview(c.key, Promise.resolve(c.image), cardText(this.app, c.key), cardInfo(this.app, c.key)?.nameLocal);
        }
      }
      if (!column.hasChildNodes()) column.remove();
    }
  }

  private async pickPrint(key: string, board: Board) {
    let prints = await readPrintings(this.app, key);
    // ノートの標準の版 (scryfall_id) が表に無いとき (表が無い古いノートなど): その1枚を取って表に足す。持っている版が、選択肢に出る
    const own = cardInfo(this.app, key)?.id;
    if (own && !prints.some((p) => p.id === own)) {
      try {
        const got = (await fetchById(own)) as unknown as Printing;
        await addPrintings(this.app, key, [got]);
        prints = [...prints, got]; // 表の読み直しを待たずに、取れた1枚をそのまま出す
      } catch {
        /* 取れなくても、選択画面は開く */
      }
    }
    const oracle = oracleIdOf(this.app, key);
    const cur = this.deck[board].get(key)?.print?.split(" ")[2];
    // 言語タブ: ある言語を開いたときに、その言語の版を取りに行って、ノートの表に足す
    const tabs = { langs: [...new Set([...prints.map((p) => p.lang), "en", this.settings.textLang])], first: cur ?? this.settings.textLang, load: async (lang: string) => {
      const got = oracle ? await fetchPrintingsLang(oracle, lang) : [];
      await addPrintings(this.app, key, got);
      return got;
    } };
    new PrintModal(this.app, key, prints, true, (p) => void this.setPrint(key, p, board), tabs).open();
  }

  // ja = 設定した言語のカード名。無ければ英語名だけ出す
  protected async preview(name: string, image: Promise<string | undefined>, text: Promise<string>, ja?: string) {
    const seq = ++this.previewSeq;
    const [url, body] = await Promise.all([image, text]);
    if (seq !== this.previewSeq) return;
    this.el.preview.empty();
    if (url) setImg(this.el.preview.createEl("img", { attr: { alt: name } }), url);
    const nameRow = this.el.preview.createDiv("mtg-preview-namerow");
    nameRow.createDiv({ text: ja && ja !== name ? `${name} (${ja})` : name, cls: "mtg-preview-name" });
    const lang = this.settings.textLang;
    const editable = lang !== "en" && !!cardInfo(this.app, name);
    // 設定した言語のカード名 (ローカルネーム) を手で直す。フロントマターの name_local と aliases に書く (効果テキストの欄の上)
    if (editable) {
      iconButton(nameRow, "pencil", `カード名 (${lang}) を編集`).onclick = () =>
        editLocalName(this.app, this.settings, name, ja, (local) => void this.preview(name, image, text, local)); // いま書いた名前で出し直す (メタデータの更新を待たない)
    }
    const text_ = this.el.preview.createDiv({ text: body, cls: "mtg-preview-text" });
    // 設定した言語のテキストを手で直す (取れなかったとき用)。英語の本文は変えない
    if (editable) {
      iconButton(text_, "pencil", `効果テキスト (${lang}) を編集`, "mtg-preview-edit").onclick = () => editLocalText(this.app, this.settings, name, body, () => void this.preview(name, image, cardText(this.app, name), ja));
    }
  }
}

export interface PrintTabs {
  langs: string[]; // タブにする言語
  first: string; // 最初に開く言語
  load: (lang: string) => Promise<Printing[]>; // 表に無い言語の版を取ってくる
}
export class PrintModal extends Modal {
  constructor(app: App, private key: string, private prints: Printing[], private canReset: boolean, private onPick: (print?: string) => void, private tabs?: PrintTabs) {
    super(app);
  }
  onOpen() {
    this.setTitle(`${this.key} のイラスト`);
    this.modalEl.addClass("mtg-print-modal");
    // コレクションは版が必須なので「指定なし」は出さない
    if (this.canReset) this.contentEl.createEl("button", { text: "最新のアートにする" }).onclick = () => this.pick();
    const bar = this.contentEl.createDiv("mtg-print-tabs");
    const grid = this.contentEl.createDiv("mtg-print-grid");
    const loaded = new Set(this.prints.map((p) => p.lang));
    const LANG_NAME: Record<string, string> = { en: "英語", ja: "日本語", ko: "韓国語", zhs: "簡体字中国語", zht: "繁体字中国語", fr: "フランス語", de: "ドイツ語", es: "スペイン語", it: "イタリア語", pt: "ポルトガル語", ru: "ロシア語", ph: "ファイレクシア語" };
    const show = async (lang?: string) => {
      bar.querySelectorAll("button").forEach((b) => b.toggleClass("mod-cta", b.dataset.lang === lang));
      if (lang && !loaded.has(lang) && this.tabs) {
        // まだ取っていない言語: ボタンを押したときだけ、その言語の版を取りに行く (自動では通信しない)
        grid.empty();
        const name = LANG_NAME[lang] ?? lang;
        const fetchBtn = grid.createEl("button", { cls: "mod-cta", text: `${name}版を取得する` });
        fetchBtn.onclick = async () => {
          fetchBtn.disabled = true;
          fetchBtn.setText("取得中…");
          const got = await this.tabs!.load(lang).catch(() => []);
          loaded.add(lang);
          const ids = new Set(this.prints.map((p) => p.id));
          this.prints.push(...got.filter((p) => !ids.has(p.id)));
          await show(lang);
        };
        return;
      }
      grid.empty();
      // 取得済みの言語: 持っている版を出し、取り直したいときの「再取得」ボタンを上に出す
      if (lang && this.tabs) {
        const again = grid.createEl("button", { text: `${LANG_NAME[lang] ?? lang}版を再取得する`, cls: "mtg-print-again" });
        again.onclick = async () => {
          again.disabled = true;
          again.setText("取得中…");
          const got = await this.tabs!.load(lang).catch(() => []);
          const ids = new Set(this.prints.map((p) => p.id));
          this.prints.push(...got.filter((p) => !ids.has(p.id)));
          await show(lang);
        };
      }
      const list = lang ? this.prints.filter((p) => p.lang === lang) : this.prints;
      if (!list.length) grid.createDiv({ text: "この言語の版は無い", cls: "mtg-dim" });
      for (const p of list) {
        const cell = grid.createDiv("mtg-print");
        // 画像は表示されるものだけ読み込む (一覧が長くても重くならない)
        cell.createEl("img", { attr: { src: printingImageUrl(p.id), loading: "lazy", alt: p.set } });
        cell.createDiv({ text: `${p.set.toUpperCase()} ${p.collector_number}${p.lang !== "en" ? ` (${p.lang})` : ""}`, cls: "mtg-dim" });
        cell.createDiv({ text: p.released_at, cls: "mtg-dim" });
        cell.onclick = () => this.pick(`${p.set} ${p.collector_number}${this.tabs ? ` ${p.lang}` : ""}`);
      }
    };
    if (this.tabs) {
      for (const l of this.tabs.langs) {
        const b = bar.createEl("button", { text: l });
        b.dataset.lang = l;
        b.onclick = () => void show(l);
      }
      void show(this.tabs.langs.includes(this.tabs.first) ? this.tabs.first : this.tabs.langs[0]);
    } else void show();
  }
  private pick(print?: string) {
    this.close();
    this.onPick(print);
  }
  onClose() {
    this.contentEl.empty();
  }
}
