import { App, ItemView, Modal, Notice, Setting, TAbstractFile, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { cardInfo, deckVerdicts, printingOf } from "./cards";
import { DECK_DIR, parseDeck } from "./deck";
import { DECK_VIEW } from "./DeckView";
import { LEGAL_FORMATS, Verdict } from "./rules";
import { artCropUrl } from "./scryfall";
import { symbolImg } from "./symbols";

export const DECKLIST_VIEW = "mtg-decklist";

export interface DeckListActions {
  open: (file: TFile) => void;
  create: () => void;
  import: () => void;
}

interface Entry {
  file: TFile;
  legal: Record<string, Verdict>; // フォーマットごとの判定 (デッキ内の全カード)
  favorite: boolean;
  colors: string[];
  count: number; // メインの枚数
  keys: string[]; // メインとサイドのカード (サムネイルの候補)
  art?: string;
}

const COLOR_ORDER = ["W", "U", "B", "R", "G"];
const ago = (ms: number) => {
  const min = Math.round((Date.now() - ms) / 60000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (min < 60) return rtf.format(-min, "minute");
  if (min < 60 * 24) return rtf.format(-Math.round(min / 60), "hour");
  return rtf.format(-Math.round(min / 60 / 24), "day");
};

// Moxfield のデッキ一覧のような画面。All / お気に入りの2タブ。サムネイルはデッキ内のカードから選ぶ
export class DeckListView extends ItemView {
  private tab: "all" | "fav" = "all";
  private query = "";
  private format = ""; // 空 = 全フォーマット
  private seq = 0;
  private body!: HTMLElement;
  private tabs!: HTMLElement;
  private status!: HTMLElement;
  private refresh = debounce(() => void this.render(), 300, true);

  constructor(leaf: WorkspaceLeaf, private actions: DeckListActions) {
    super(leaf);
  }

  getViewType() {
    return DECKLIST_VIEW;
  }
  getDisplayText() {
    return "Decks";
  }
  getIcon() {
    return "layers";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-decklist");

    const bar = root.createDiv("mtg-dbar");
    this.tabs = bar.createDiv("mtg-dtabs");
    const sel = bar.createEl("select");
    sel.createEl("option", { text: "全フォーマット", value: "" });
    for (const [id, name] of LEGAL_FORMATS) sel.createEl("option", { text: `${name} で使える`, value: id });
    sel.onchange = () => {
      this.format = sel.value;
      void this.render();
    };
    bar.createEl("input", { type: "text", placeholder: "デッキを検索" }).addEventListener("input", (e) => {
      this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      void this.render();
    });
    bar.createEl("button", { text: "＋ 新しいデッキ" }).onclick = () => this.actions.create();
    bar.createEl("button", { text: "Import" }).onclick = () => this.actions.import();
    this.status = root.createDiv("mtg-status");
    this.body = root.createDiv("mtg-dgrid");

    const inDir = (f: { path: string }) => f.path.startsWith(`${DECK_DIR}/`);
    this.registerEvent(this.app.metadataCache.on("changed", (f) => inDir(f) && this.refresh()));
    const touch = (f: TAbstractFile) => inDir(f) && this.refresh();
    this.registerEvent(this.app.vault.on("create", touch));
    this.registerEvent(this.app.vault.on("delete", touch));
    this.registerEvent(this.app.vault.on("rename", touch));
    await this.render();
  }

  private async loadEntries(): Promise<Entry[]> {
    const out: Entry[] = [];
    for (const file of this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${DECK_DIR}/`))) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.mtg !== "deck") continue;
      const deck = parseDeck(await this.app.vault.cachedRead(file));
      const mainKeys = [...deck.commander.keys(), ...deck.main.keys()]; // 統率戦はコマンダーが先頭
      const keys = [...deck.commander.keys(), ...mainKeys, ...deck.side.keys()];
      const colors = new Set(mainKeys.flatMap((k) => cardInfo(this.app, k)?.colors ?? []));

      // サムネイル: frontmatter の thumbnail (デッキ内のカード名)。無ければメインの先頭。選んだ版があればその版のイラスト
      const thumb = keys.includes(fm.thumbnail) ? fm.thumbnail : mainKeys[0];
      let art: string | undefined;
      if (thumb) {
        const print = (deck.commander.get(thumb) ?? deck.main.get(thumb) ?? deck.side.get(thumb))?.print;
        const id = (print && (await printingOf(this.app, thumb, print))?.id) || cardInfo(this.app, thumb)?.id;
        art = id ? artCropUrl(id) : undefined;
      }
      out.push({
        file,
        legal: Object.fromEntries(Object.entries(deckVerdicts(this.app, keys, deck.commander.size > 0 || fm.format === "commander")).map(([k, r]) => [k, r.verdict])),
        favorite: !!fm.favorite,
        colors: COLOR_ORDER.filter((c) => colors.has(c)),
        count: [...deck.main.values(), ...deck.commander.values()].reduce((a, e) => a + e.n, 0),
        keys,
        art,
      });
    }
    return out.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
  }

  private async render() {
    const seq = ++this.seq;
    const all = await this.loadEntries();
    if (seq !== this.seq) return;

    this.tabs.empty();
    for (const [id, label] of [["all", "All Decks"], ["fav", "♥ お気に入り"]] as const) {
      const b = this.tabs.createEl("button", { text: label });
      b.toggleClass("is-on", this.tab === id);
      b.onclick = () => {
        this.tab = id;
        void this.render();
      };
    }

    const list = all.filter((d) => (this.tab === "all" || d.favorite) && d.file.basename.toLowerCase().includes(this.query) && (!this.format || d.legal[this.format] === "ok"));
    this.status.setText(`${list.length} 件 (更新日の新しい順)`);
    this.body.empty();
    for (const d of list) this.card(d);
  }

  // ノートごと消す。Obsidian の「削除したファイルの行き先」の設定に従う (標準ではゴミ箱へ)。カードのノートは消さない
  private async deleteDeck(file: TFile) {
    // 開いているデッキ画面があれば閉じる
    for (const leaf of this.app.workspace.getLeavesOfType(DECK_VIEW)) {
      if (leaf.getViewState().state?.path === file.path) leaf.detach();
    }
    try {
      await this.app.fileManager.trashFile(file);
      new Notice(`削除した: ${file.basename}`);
    } catch (e) {
      new Notice(`削除できない: ${(e as Error).message}`);
    }
  }

  private card(d: Entry) {
    const wrap = this.body.createDiv("mtg-dcard");
    const tile = wrap.createDiv("mtg-dtile");
    if (d.art) tile.createEl("img", { attr: { src: d.art, loading: "lazy", alt: "" } });
    tile.createDiv("mtg-dshade");
    tile.createDiv({ text: d.file.basename, cls: "mtg-dname" });
    // 使えるフォーマット (全カードが使えると分かっているもの)。未取得ならその旨
    const names = LEGAL_FORMATS.filter(([id]) => d.legal[id] === "ok").map(([, n]) => n);
    const unknown = LEGAL_FORMATS.every(([id]) => d.legal[id] === "unknown");
    tile.createDiv({ text: `${unknown ? "判定なし" : names.join(" · ") || "どのフォーマットでも不可"} · ${d.count}枚`, cls: "mtg-dformat" });
    const pips = tile.createDiv("mtg-dpips");
    for (const c of d.colors) symbolImg(pips, c);

    const ctl = tile.createDiv("mtg-dctl");
    const heart = ctl.createEl("button", { text: d.favorite ? "♥" : "♡", attr: { "aria-label": "お気に入り" } });
    heart.toggleClass("is-on", d.favorite);
    heart.onclick = (e) => {
      e.stopPropagation();
      void this.app.fileManager.processFrontMatter(d.file, (fm) => (d.favorite ? delete fm.favorite : (fm.favorite = true)));
    };
    ctl.createEl("button", { text: "🖼", attr: { "aria-label": "サムネイルを選ぶ" } }).onclick = (e) => {
      e.stopPropagation();
      new ThumbnailModal(this.app, d.keys, (key) => void this.app.fileManager.processFrontMatter(d.file, (fm) => (fm.thumbnail = key))).open();
    };
    ctl.createEl("button", { text: "🗑", attr: { "aria-label": "デッキを削除" } }).onclick = (e) => {
      e.stopPropagation();
      new ConfirmDelete(this.app, d.file, () => void this.deleteDeck(d.file)).open();
    };
    tile.onclick = () => this.actions.open(d.file);
    wrap.createDiv({ text: ago(d.file.stat.mtime), cls: "mtg-dago" });
  }
}

// デッキ内のカードのイラストから、サムネイルにするカードを選ぶ
class ThumbnailModal extends Modal {
  constructor(app: App, private keys: string[], private onPick: (key: string) => void) {
    super(app);
  }
  onOpen() {
    this.setTitle("サムネイルにするカード");
    this.modalEl.addClass("mtg-print-modal");
    const grid = this.contentEl.createDiv("mtg-print-grid");
    for (const key of this.keys) {
      const id = cardInfo(this.app, key)?.id;
      const cell = grid.createDiv("mtg-print");
      if (id) cell.createEl("img", { attr: { src: artCropUrl(id), loading: "lazy", alt: key } });
      cell.createDiv({ text: key, cls: "mtg-dim" });
      cell.onclick = () => {
        this.close();
        this.onPick(key);
      };
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}

class ConfirmDelete extends Modal {
  constructor(app: App, private file: TFile, private onYes: () => void) {
    super(app);
  }
  onOpen() {
    this.setTitle("デッキを削除");
    this.contentEl.createEl("p", { text: `「${this.file.basename}」をノートごと削除する。デッキの中のカード(Cards/)は消えない。` });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("キャンセル").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("削除")
          .setWarning()
          .onClick(() => {
            this.close();
            this.onYes();
          }),
      );
  }
  onClose() {
    this.contentEl.empty();
  }
}
