import { App, ItemView, Modal, Notice, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { CardInfo, cardImage, cardInfo, cardText, ensureCardFile, localCards, printingImage, readPrintings } from "./cards";
import { Settings } from "./settings";
import { Board, Deck, parseDeck, writeDeck } from "./deck";
import { Printing, ScryfallCard, cardImageUrl, printingImageUrl, searchCards } from "./scryfall";

export const DECK_VIEW = "mtg-deck";

const COLORS = ["W", "U", "B", "R", "G"];
// Land を先に判定する (Artifact Land は土地として扱う)
const TYPE_CHECK = ["Land", "Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment"];
const GROUP_ORDER = ["Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle", "Land", "Other"];
const MAX_RESULTS = 40;

export interface Meta {
  name: string;
  typeLine: string;
  cmc: number;
  image?: string;
}

// key = Cards/ のファイル名。ensureCardFile で md 化してから返す
export interface Result {
  name: string;
  ja?: string;
  typeLine: string;
  manaCost: string;
  image: () => Promise<string | undefined>;
  text: () => Promise<string>;
  // print = 追加時の版 (コレクションで使う)
  resolve: () => Promise<{ key: string; meta: Meta; print?: string }>;
}

export class DeckView extends ItemView {
  private path = "";
  private deck: Deck = { main: new Map(), side: new Map() };
  private board: Board = "main";
  protected meta = new Map<string, Meta>();
  protected filters = { name: "", effect: "", type: "", colors: new Set<string>() };
  protected timer?: number;
  protected searchSeq = 0;
  private stackSeq = 0;
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
    const { status, results } = this.buildSearch(main);
    this.el = { preview, tabs, status, results, stack: main.createDiv("mtg-groups") };
    this.renderTabs();
    void this.renderStack();
    this.renderResults([]);
  }

  // 検索欄 (名前・効果・タイプ・色) と結果欄。デッキ画面とコレクション画面で共有
  protected buildSearch(parent: HTMLElement) {
    const bar = parent.createDiv("mtg-bar");
    const input = (ph: string, key: "name" | "effect" | "type") =>
      bar.createEl("input", { type: "text", placeholder: ph }).addEventListener("input", (e) => {
        this.filters[key] = (e.target as HTMLInputElement).value.trim();
        this.scheduleSearch();
      });
    input("名前 (日本語可)", "name");
    input("効果テキスト", "effect");
    input("タイプ", "type");
    for (const c of COLORS) {
      const b = bar.createEl("button", { text: c, cls: "mtg-color" });
      b.onclick = () => {
        this.filters.colors.has(c) ? this.filters.colors.delete(c) : this.filters.colors.add(c);
        b.toggleClass("is-on", this.filters.colors.has(c));
        this.scheduleSearch();
      };
    }

    return { status: parent.createDiv("mtg-status"), results: parent.createDiv("mtg-results") };
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
  }

  // ---- 検索 ----

  protected scheduleSearch() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.search(), 300);
  }

  protected async search() {
    const seq = ++this.searchSeq;
    const f = this.filters;
    if (!f.name && !f.effect && !f.type && !f.colors.size) {
      this.el.status.setText("");
      return this.renderResults([]);
    }

    const local = await this.searchLocal();
    if (seq !== this.searchSeq) return;
    if (local.length) {
      this.el.status.setText(`Cards 内 ${local.length} 件`);
      return this.renderResults(local.slice(0, MAX_RESULTS));
    }

    this.el.status.setText("Cards に無いので Scryfall を検索中…");
    try {
      const found = await searchCards(this.scryfallQuery());
      if (seq !== this.searchSeq) return;
      this.el.status.setText(`Scryfall ${found.length} 件`);
      this.renderResults(found.slice(0, MAX_RESULTS).map((c) => this.scryfallResult(c)));
    } catch (e) {
      this.el.status.setText(`検索失敗: ${(e as Error).message}`);
    }
  }

  protected async searchLocal(): Promise<Result[]> {
    const { name, effect, type, colors } = this.filters;
    const lc = (s?: string) => (s ?? "").toLowerCase();
    const out: Result[] = [];
    for (const c of localCards(this.app)) {
      if (name && !lc(c.name).includes(lc(name)) && !lc(c.nameLocal).includes(lc(name))) continue;
      if (type && !lc(c.typeLine).includes(lc(type))) continue;
      if ([...colors].some((x) => !c.colors.includes(x))) continue;
      // shortcut: 効果検索は md を毎回読む。数千枚で重くなったら索引を作る
      if (effect && !lc(await this.app.vault.cachedRead(c.file)).includes(lc(effect))) continue;
      out.push(this.localResult(c));
    }
    return out;
  }

  protected scryfallQuery(): string {
    const { name, effect, type, colors } = this.filters;
    const q = name.split(/\s+/).filter(Boolean);
    if (/[^\x00-\x7F]/.test(name)) q.push("lang:any"); // 日本語名
    if (effect) q.push(`o:"${effect}"`);
    for (const t of type.split(/\s+/).filter(Boolean)) q.push(`t:${t}`);
    if (colors.size) q.push(`c>=${[...colors].join("")}`);
    return q.join(" ");
  }

  protected localResult(c: CardInfo): Result {
    return {
      name: c.name,
      ja: c.nameLocal,
      typeLine: c.typeLine,
      manaCost: c.manaCost,
      image: () => cardImage(this.app, c.file),
      text: () => cardText(this.app, c.file.basename),
      resolve: async () => {
        const prints = await readPrintings(this.app, c.file.basename);
        const p = prints.find((x) => x.set === c.set) ?? prints[0];
        return {
          key: c.file.basename,
          meta: { name: c.name, typeLine: c.typeLine, cmc: c.cmc, image: await cardImage(this.app, c.file) },
          print: p && `${p.set} ${p.collector_number}`,
        };
      },
    };
  }

  protected scryfallResult(c: ScryfallCard): Result {
    const meta: Meta = { name: c.name, typeLine: c.type_line, cmc: c.cmc, image: cardImageUrl(c) };
    return {
      name: c.name,
      ja: c.printed_name !== c.name ? c.printed_name : undefined,
      typeLine: c.type_line,
      manaCost: c.mana_cost ?? c.card_faces?.[0]?.mana_cost ?? "",
      image: async () => meta.image,
      text: async () => c.printed_text ?? c.oracle_text ?? c.card_faces?.map((f) => f.printed_text ?? f.oracle_text).join("\n\n---\n\n") ?? "",
      resolve: async () => ({
        key: (await ensureCardFile(this.app, c, this.settings)).basename,
        meta,
        print: `${c.set} ${c.collector_number}`,
      }),
    };
  }

  protected renderResults(results: Result[]) {
    const box = this.el.results;
    box.empty();
    for (const r of results) {
      const row = box.createDiv("mtg-row");
      row.createSpan({ text: r.ja ? `${r.name} / ${r.ja}` : r.name, cls: "mtg-name" });
      row.createSpan({ text: r.manaCost, cls: "mtg-dim" });
      row.createSpan({ text: r.typeLine, cls: "mtg-dim" });
      row.onmouseenter = () => void this.preview(r.name, r.image(), r.text());
      const add = row.createEl("button", { text: "+" });
      add.onclick = () => {
        void this.add(r);
      };
    }
  }

  // ---- デッキ ----

  protected async add(r: Result) {
    try {
      const { key, meta } = await r.resolve();
      this.meta.set(key, meta);
      await this.change(key, 1);
    } catch (e) {
      new Notice(`追加失敗: ${(e as Error).message}`);
    }
  }

  private async change(key: string, delta: number) {
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
        item.onmouseenter = () => void this.preview(c.key, Promise.resolve(c.image), cardText(this.app, c.key));
      }
    }
  }

  private async pickPrint(key: string) {
    const prints = await readPrintings(this.app, key);
    if (!prints.length) return void new Notice("収録一覧が無いカード。Cards から削除して取り直すと付く");
    new PrintModal(this.app, key, prints, true, (p) => void this.setPrint(key, p)).open();
  }

  protected async preview(name: string, image: Promise<string | undefined>, text: Promise<string>) {
    const seq = ++this.previewSeq;
    const [url, body] = await Promise.all([image, text]);
    if (seq !== this.previewSeq) return;
    this.el.preview.empty();
    if (url) this.el.preview.createEl("img", { attr: { src: url, alt: name } });
    this.el.preview.createDiv({ text: name, cls: "mtg-preview-name" });
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
