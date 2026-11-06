import { Notice, ViewStateResult } from "obsidian";
import { foilMark, iconButton, imageButton } from "./icons";
import { addFlip } from "./flip";
import { CardInfo, cardBackImage, cardImage, cardInfo, printingOf, readPrintings } from "./cards";
import { CONDS, Row, loadCollection, rowKey, saveCollection } from "./collection";
import { DeckView, PrintModal } from "./DeckView";
import { Result } from "./search";
import { formatPrice, priceOf, priceStore, updateCollectionPrices } from "./prices";
import { printingImageUrl } from "./scryfall";
import { colorFilterButtons, matchesColors } from "./symbols";

export const COLLECTION_VIEW = "mtg-collection";

interface Item {
  row: Row;
  key: string;
  info: CardInfo | null;
  id?: string; // scryfall_id (価格取得用)
  image?: string;
}

// 所持カード。検索の仕組みはデッキ画面と共有し、表示と保存先 (Collection/<セット>.md) だけ違う
export class CollectionView extends DeckView {
  private rows = new Map<string, Row>();
  private sets = new Set<string>();
  private cf = { name: "", set: "", colors: new Set<string>() };
  private mode: "grid" | "list" = "grid";
  private panel!: HTMLElement;
  private head!: HTMLElement;
  private body!: HTMLElement;
  private setSelect!: HTMLSelectElement;
  private renderSeq = 0;

  getViewType() {
    return COLLECTION_VIEW;
  }
  getDisplayText() {
    return "Collection";
  }
  getState() {
    return { path: "" };
  }

  async setState(state: { path?: string }, result: ViewStateResult) {
    this.rows = await loadCollection(this.app);
    this.sets = new Set([...this.rows.values()].map((r) => r.print.split(" ")[0]));
    await super.setState(state, result); // build() が呼ばれる
  }

  protected build() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-coll");

    root.createEl("h2", { text: "Collection" });
    this.head = root.createDiv("mtg-chead");

    const actions = root.createDiv("mtg-bar");
    const addBtn = actions.createEl("button", { text: "＋ Add cards" });
    const updBtn = actions.createEl("button", { text: "価格を更新" });
    updBtn.onclick = async () => {
      updBtn.disabled = true;
      new Notice("価格を更新中…");
      try {
        new Notice(`価格を更新: ${await updateCollectionPrices(this.app)} 件`);
      } catch (e) {
        new Notice(`価格の更新失敗: ${(e as Error).message}`);
      }
      updBtn.disabled = false;
      void this.render();
    };
    this.panel = root.createDiv("mtg-cpanel");
    addBtn.onclick = () => this.panel.toggleClass("is-open", !this.panel.hasClass("is-open"));

    const left = this.panel.createDiv("mtg-cleft");
    const { status, results } = this.buildSearch(left);
    const preview = this.panel.createDiv("mtg-cpreview");

    const fbar = root.createDiv("mtg-bar");
    this.setSelect = fbar.createEl("select");
    this.setSelect.onchange = () => {
      this.cf.set = this.setSelect.value;
      void this.render();
    };
    colorFilterButtons(fbar, this.cf.colors, () => void this.render());
    fbar.createEl("input", { type: "text", placeholder: "所持カードを検索" }).addEventListener("input", (e) => {
      this.cf.name = (e.target as HTMLInputElement).value.trim();
      void this.render();
    });
    for (const [m, label] of [["grid", "▦"], ["list", "☰"]] as const) {
      const b = fbar.createEl("button", { text: label });
      b.toggleClass("is-on", this.mode === m);
      b.onclick = () => {
        this.mode = m;
        fbar.querySelectorAll("button:not(.mtg-color)").forEach((x) => x.removeClass("is-on"));
        b.addClass("is-on");
        void this.render();
      };
    }

    this.body = root.createDiv();
    this.el = { preview, tabs: createDiv(), status, results, stack: this.body };
    this.renderResults([]);
    void this.render();
  }

  // ---- 表示 ----

  private async render() {
    const seq = ++this.renderSeq;
    const items: Item[] = await Promise.all(
      [...this.rows].map(async ([key, row]) => {
        const info = cardInfo(this.app, row.card);
        const p = await printingOf(this.app, row.card, row.print);
        const image = p ? printingImageUrl(p.id) : info ? await cardImage(this.app, info.file) : undefined;
        return { row, key, info, id: p?.id, image };
      }),
    );
    if (seq === this.renderSeq) this.draw(items);
  }

  private price = (i: Item) => (i.id ? priceOf(i.id, i.row.foil, this.settings.currency) : undefined);
  private fmt = (v?: number) => formatPrice(v, this.settings.currency);

  private draw(all: Item[]) {
    const lc = (s?: string) => (s ?? "").toLowerCase();
    const { name, set, colors } = this.cf;
    const items = all
      .filter((i) => {
        if (set && i.row.print.split(" ")[0] !== set) return false;
        if (name && ![i.row.card, i.info?.name, i.info?.nameLocal].some((n) => lc(n).includes(lc(name)))) return false;
        return matchesColors(i.info?.colors ?? [], colors);
      })
      .sort((a, b) => a.row.card.localeCompare(b.row.card) || a.row.print.localeCompare(b.row.print));

    const count = items.reduce((a, i) => a + i.row.n, 0);
    const value = items.reduce((a, i) => a + i.row.n * (this.price(i) ?? 0), 0);
    const updated = priceStore.updated ? new Date(priceStore.updated).toLocaleString() : "未取得 (「価格を更新」を押す)";
    this.head.setText(`${count} 枚 · ${this.fmt(value)} · 価格の更新: ${updated}`);

    this.setSelect.empty();
    this.setSelect.createEl("option", { text: "Any Set", value: "" });
    for (const s of [...this.sets].sort()) this.setSelect.createEl("option", { text: s.toUpperCase(), value: s });
    this.setSelect.value = this.cf.set;

    this.body.empty();
    const wrap = this.body.createDiv(this.mode === "grid" ? "mtg-cgrid" : "mtg-clist");
    for (const i of items) this.mode === "grid" ? this.gridCell(wrap, i) : this.listRow(wrap, i);
  }

  private tags(i: Item) {
    return `${i.row.print.split(" ")[0].toUpperCase()} ${i.row.print.split(" ")[1]}`;
  }

  private gridCell(parent: HTMLElement, i: Item) {
    const cell = parent.createDiv("mtg-ccell");
    const card = cell.createDiv("mtg-citem");
    const img = i.image ? card.createEl("img", { attr: { src: i.image, alt: i.row.card } }) : undefined;
    if (!img) card.createSpan({ text: i.row.card, cls: "mtg-name" });
    card.toggleClass("is-foil", i.row.foil);
    card.createSpan({ text: `${i.row.n}×`, cls: "mtg-badge" });
    const ctl = card.createDiv("mtg-ctl");
    this.controls(ctl, i);
    if (i.info && img) void cardBackImage(this.app, i.info.file, i.image).then((back) => addFlip(ctl, img, i.image, back));
    const meta = cell.createDiv("mtg-cmeta");
    meta.createSpan({ text: this.fmt(this.price(i)), cls: "mtg-cprice" });
    const tagEl = meta.createSpan({ text: `${this.tags(i)} · ${i.row.cond}`, cls: "mtg-dim" });
    if (i.row.foil) foilMark(tagEl);
  }

  private listRow(parent: HTMLElement, i: Item) {
    const row = parent.createDiv("mtg-row");
    row.createSpan({ text: `${i.row.n}×`, cls: "mtg-dim" });
    row.createSpan({ text: i.info?.nameLocal ? `${i.row.card} / ${i.info.nameLocal}` : i.row.card, cls: "mtg-name" });
    row.createSpan({ text: this.tags(i), cls: "mtg-dim" });
    const condEl = row.createSpan({ text: i.row.cond, cls: "mtg-dim" });
    if (i.row.foil) foilMark(condEl);
    row.createSpan({ text: this.fmt(this.price(i)) });
    this.controls(row.createDiv("mtg-ctl is-inline"), i);
  }

  // ホバーで出る操作。状態/foil は1枚だけ別の行に移す (3枚持ちの1枚だけ foil にできる)
  private controls(ctl: HTMLElement, i: Item) {
    const k = i.key;
    imageButton(ctl, "イラスト変更").onclick = () => void this.pickRowPrint(k);
    ctl.createEl("button", { text: "−" }).onclick = () => void this.adjust(k, -1);
    ctl.createEl("button", { text: "+" }).onclick = () => void this.adjust(k, 1);
    ctl.createEl("button", { text: i.row.cond, attr: { "aria-label": "状態を変更 (1枚)" } }).onclick = () =>
      void this.moveOne(k, { cond: CONDS[(CONDS.indexOf(i.row.cond) + 1) % CONDS.length] });
    const foil = iconButton(ctl, "sparkles", "foil 切替 (1枚)");
    foil.toggleClass("is-on", i.row.foil);
    foil.onclick = () => void this.moveOne(k, { foil: !i.row.foil });
  }

  // ---- 変更 ----

  private merge(t: Row) {
    const k = rowKey(t);
    this.rows.set(k, { ...t, n: t.n + (this.rows.get(k)?.n ?? 0) });
  }

  private async persist() {
    await saveCollection(this.app, this.rows, this.sets);
    await this.render();
  }

  private async adjust(key: string, delta: number) {
    const r = this.rows.get(key);
    if (!r) return;
    r.n + delta > 0 ? (r.n += delta) : this.rows.delete(key);
    await this.persist();
  }

  private async moveOne(key: string, patch: Partial<Pick<Row, "cond" | "foil">>) {
    const r = this.rows.get(key);
    if (!r) return;
    r.n > 1 ? r.n-- : this.rows.delete(key);
    this.merge({ ...r, ...patch, n: 1 });
    await this.persist();
  }

  // 版は行ごと別の版に移す
  private async setRowPrint(key: string, print: string) {
    const r = this.rows.get(key);
    if (!r) return;
    this.rows.delete(key);
    this.merge({ ...r, print });
    await this.persist();
  }

  private async pickRowPrint(key: string) {
    const r = this.rows.get(key);
    if (!r) return;
    const prints = await readPrintings(this.app, r.card);
    if (!prints.length) return void new Notice("収録一覧が無いカード。Cards から削除して取り直すと付く");
    new PrintModal(this.app, r.card, prints, false, (p) => p && void this.setRowPrint(key, p)).open();
  }

  async addCard(r: Result) {
    try {
      const { key, print } = await r.resolve();
      if (!print) return void new Notice("収録一覧が無いカード。Cards から削除して取り直すと追加できる");
      this.merge({ n: 1, card: key, print, cond: "NM", foil: false });
      await this.persist();
    } catch (e) {
      new Notice(`追加失敗: ${(e as Error).message}`);
    }
  }
}
