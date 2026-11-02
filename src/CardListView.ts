import { App, EventRef, ItemView, Modal, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { cardInfo } from "./cards";
import { Board } from "./deck";
import { DeckView } from "./DeckView";
import { groupOf, groupRank } from "./layout";
import { Filters, Result, buildFilterBar, emptyFilters, localResult, searchAll } from "./search";
import { Settings } from "./settings";
import { manaCost } from "./symbols";

export const CARDLIST_VIEW = "mtg-cardlist";
const PAGE = 60;

const COLOR_HEX: Record<string, string> = { W: "#e6dca8", U: "#4a90d9", B: "#7a6a86", R: "#d9534a", G: "#4a9a5b" };

// 無色は灰色、多色は色を並べたグラデーション
const colorOf = (colors: string[]) => {
  const hex = colors.map((c) => COLOR_HEX[c]).filter(Boolean);
  if (!hex.length) return "#8a8f98";
  return hex.length === 1 ? hex[0] : `linear-gradient(${hex.join(", ")})`;
};

// デッキ画面の見出しの並び → コスト → 名前
const byLayout = (a: Result, b: Result, aCmd = false, bCmd = false) =>
  groupRank(groupOf(a.typeLine, aCmd)) - groupRank(groupOf(b.typeLine, bCmd)) || a.cmc - b.cmc || a.name.localeCompare(b.name);

interface Row {
  r: Result;
  n?: number; // デッキ内の枚数
  tag?: string;
  board?: Board; // デッキ内の一覧のとき、そのカードがいる欄
  illegal?: boolean; // デッキ内の一覧のとき、いまのフォーマットで使えない
}

// 「新しく追加」: 条件を入れて検索する。「デッキ内のカードも含める」を付けると、いまデッキにあるカードも結果に出る
class SearchModal extends Modal {
  constructor(app: App, private f: Filters, private opts: { includeDeck: boolean }, private onSearch: () => void) {
    super(app);
  }
  onOpen() {
    const root = this.contentEl;
    root.empty();
    this.setTitle("新しく追加");
    buildFilterBar(root, this.f, () => {});
    new Setting(root).setName("デッキ内のカードも含める").addToggle((t) => t.setValue(this.opts.includeDeck).onChange((v) => (this.opts.includeDeck = v)));
    new Setting(root).setName("トークンも含める").addToggle((t) => t.setValue(this.f.tokens).onChange((v) => (this.f.tokens = v)));
    new Setting(root)
      .addButton((b) =>
        b.setButtonText("条件をクリア").onClick(() => {
          Object.assign(this.f, emptyFilters());
          this.onOpen();
        }),
      )
      .addButton((b) => b.setButtonText("検索").setCta().onClick(() => this.go()));
    // 名前や効果の欄で Enter でも検索する
    root.addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && (e.target as HTMLElement).tagName === "INPUT" && this.go());
  }
  private go() {
    this.close();
    this.onSearch();
  }
  onClose() {
    this.contentEl.empty();
  }
}

// 右サイドバー。デッキ画面を開いている間だけ出る。
// 普段: いまデッキに入っているカード。「新しく追加」で検索すると、結果 (Cards/ + Scryfall) に切り替わる。
// どちらも、クリックで1枚追加 / Shift+クリックで1枚削除 (デッキ内の一覧では、そのカードがいる欄の枚数が増減する)
export class CardListView extends ItemView {
  private f = emptyFilters();
  private searching = false; // true = 検索結果を出している
  private opts = { includeDeck: false }; // 検索結果に、いまデッキにあるカードも含める
  private seq = 0;
  private results: Result[] = [];
  private shown = PAGE;
  private note = "";
  private lastTarget?: DeckView;
  private targetEl!: HTMLElement;
  private headEl!: HTMLElement;
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
    this.headEl = root.createDiv("mtg-lhead");
    this.renderHead();
    this.status = root.createDiv("mtg-status");
    this.grid = root.createDiv("mtg-lgrid");
    // デッキが変わったら (追加・削除・枚数) 一覧も更新する
    this.registerEvent((this.app.workspace as unknown as { on(n: string, cb: () => void): EventRef }).on("mtg-deck-changed", () => {
        this.updateTarget(); // 追加先の名前も、デッキの読み込み後に合わせる
        this.draw();
      }));
    this.updateTarget();
    this.draw();
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
    if (!this.targetEl) return;
    this.targetEl.empty();
    this.targetEl.createSpan({ text: t ? `${t.getDisplayText()} ` : "デッキ画面を開く" });
    if (!t) return;
    // メイン/サイドの切り替え。デッキ画面のタブと、追加先の欄も同じになる
    this.targetEl.createEl("button", { text: t.onSide ? "サイド" : "メイン", cls: "mtg-lboard" }).onclick = () => {
      t.showSide(!t.onSide);
      this.updateTarget();
      this.draw();
    };
  }

  // 「新しく追加」と、検索中だけ出る「デッキ内に戻る」
  private renderHead() {
    this.headEl.empty();
    this.headEl.createEl("button", { text: "＋ 新しく追加", cls: "mod-cta" }).onclick = () =>
      new SearchModal(this.app, this.f, this.opts, () => void this.search()).open();
    if (this.searching) {
      this.headEl.createEl("button", { text: "← デッキ内に戻る" }).onclick = () => {
        this.searching = false;
        this.seq++; // 取得中の検索があれば捨てる
        this.renderHead();
        this.draw();
      };
    }
  }

  // 条件で検索する (条件が空なら Cards/ の全カード)。Cards/ に無ければ Scryfall も探す
  private async search() {
    const seq = ++this.seq;
    this.searching = true;
    this.renderHead();
    await searchAll(this.app, this.settings, this.f, () => seq !== this.seq, (res, note) => {
      const t = this.getTarget();
      this.results = this.opts.includeDeck ? res : res.filter((r) => !(r.localKey && t?.countOf(r.localKey)));
      this.note = note;
      this.results.sort((a, b) => byLayout(a, b));
      this.shown = PAGE;
      this.draw();
    });
  }

  private deckRows(): Row[] {
    const t = this.getTarget();
    const tag = { commander: "👑", main: undefined, side: undefined };
    const rows: Row[] = [];
    for (const c of t?.deckCards() ?? []) {
      if ((c.board === "side") !== !!t?.onSide) continue;
      const info = cardInfo(this.app, c.key);
      if (!info) continue;
      const r = localResult(this.app, info);
      rows.push({ r, n: c.n, tag: tag[c.board], board: c.board, illegal: !!t && !t.allows(r) });
    }
    // 使えないカードは先頭にまとめて見落とさないようにし、あとはメイン → サイド。
    // それぞれ、デッキ画面の見出しと同じ並び (タイプ別、コスト順)
    const rank = (x: Row) => (x.illegal ? 0 : 4) + 0;
    return rows.sort((a, b) => rank(a) - rank(b) || byLayout(a.r, b.r, a.board === "commander", b.board === "commander"));
  }

  private draw() {
    if (!this.grid) return;
    const target = this.getTarget();
    const deckMode = !this.searching;
    const rows: Row[] = deckMode
      ? this.deckRows()
      : this.results.slice(0, this.shown).map((r) => ({ r, n: (r.localKey && target?.countOf(r.localKey)) || undefined }));
    this.status.setText(
      deckMode
        ? `${rows.reduce((a, x) => a + (x.n ?? 0), 0)} 枚${rows.some((x) => x.illegal) ? ` · このフォーマットで使えないカード ${rows.filter((x) => x.illegal).length} 種` : ""}`
        : `${this.note}${this.results.length > this.shown ? ` (先頭 ${this.shown} 件を表示)` : ""}`,
    );

    this.grid.empty();
    for (const { r, n, tag, board, illegal } of rows) {
      const cell = this.grid.createDiv("mtg-lcell");
      cell.setAttr("aria-label", r.ja && r.ja !== r.name ? `${r.name} (${r.ja})` : r.name);
      cell.style.setProperty("--mtg-color", colorOf(r.colors));
      const banned = !deckMode && !!target && !target.allows(r);
      cell.toggleClass("is-banned", banned);
      if (banned) cell.setAttr("aria-label", `${r.ja ?? r.name} (このフォーマットでは使えない)`);
      cell.toggleClass("is-illegal", !!illegal);
      if (illegal) cell.setAttr("aria-label", `${r.ja ?? r.name} (このフォーマットでは使えない。Shift+クリックで外す)`);
      // 見えている行の分だけ読み込む (loading=lazy)。設定でオフにできる
      if (this.settings.listArt && r.art) cell.createEl("img", { cls: "mtg-lart", attr: { src: r.art, loading: "lazy", alt: "" } });
      manaCost(cell, r.manaCost).addClass("mtg-lcost");
      cell.createSpan({ text: r.ja ?? r.name, cls: "mtg-lname" });
      if (illegal) cell.createSpan({ text: "✕ 使えない", cls: "mtg-lillegal" });
      if (tag) cell.createSpan({ text: tag, cls: "mtg-ltag" });
      if (n) cell.createSpan({ text: `${n}×`, cls: "mtg-lcount" });
      cell.onmouseenter = () => target?.previewResult(r);
      cell.onclick = async (e) => {
        const t = this.getTarget();
        if (!t) return void new Notice("追加先のデッキ画面が見つからない。デッキ画面を開いてから、もう一度");
        try {
          if (deckMode) {
            if (r.localKey && board) await t.adjustCard(r.localKey, e.shiftKey ? -1 : 1, board);
            return;
          }
          if (!e.shiftKey && !t.allows(r)) return void new Notice(`${r.name} はこのフォーマットでは使えない`);
          cell.addClass("is-busy"); // Cards/ に無いカードは取得に数秒かかる
          await (e.shiftKey ? t.removeCard(r) : t.addCard(r));
        } catch (err) {
          console.error(err);
          new Notice(`追加できない: ${(err as Error).message}`);
        } finally {
          cell.removeClass("is-busy");
        }
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
