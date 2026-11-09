import { App, ItemView, Modal, Notice, Setting, TAbstractFile, TFile, WorkspaceLeaf, debounce, normalizePath } from "obsidian";
import { setImg } from "./imageCache";
import { cardInfo, printingOf } from "./cards";
import { DECK_DIR, parseDeck, thumbnailKey } from "./deck";
import { DECK_VIEW } from "./DeckView";
import { FORMATS, LEGAL_FORMATS } from "./rules";
import { artCropUrl } from "./scryfall";
import { ThumbnailModal } from "./ThumbnailModal";
import { iconButton, imageButton } from "./icons";
import { COLORS, symbolImg } from "./symbols";

export const DECKLIST_VIEW = "mtg-decklist";

export interface DeckListActions {
  open: (file: TFile) => void;
  create: () => void;
  background: () => string | undefined; // 背景の画像の URL (設定が無ければ undefined)
}

interface Entry {
  file: TFile;
  format: string; // デッキに設定したフォーマット (作成時、またはデッキ画面で選んだもの。frontmatter の format:)。無い・知らないものは、制限なし (constructed)
  favorite: boolean;
  colors: string[];
  count: number; // メインの枚数
  keys: string[]; // メインとサイドのカード (サムネイルの候補)
  art?: string;
}

// Moxfield のデッキ一覧のような画面。All / お気に入りの2タブ。サムネイルはデッキ内のカードから選ぶ
export class DeckListView extends ItemView {
  private query = "";
  private format = ""; // 空 = 全フォーマット
  private sort = "mtime";
  private colors = new Set<string>(); // しぼりこむ色 (すべて含むデッキだけ)
  private seq = 0;
  private body!: HTMLElement;
  private tabs!: HTMLElement;
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

  // 背景の画像 (ダッシュボードのボタンで設定)。文字が読めるよう、暗いベールを重ねる
  applyBg() {
    const url = this.actions.background();
    const el = this.contentEl;
    el.style.backgroundImage = url ? `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), url("${url}")` : "";
    el.toggleClass("has-bg", !!url);
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-decklist");
    this.applyBg();

    // 上の帯 (アリーナと同じ並び): 見出し・フォーマット・並び順・検索・色のしぼりこみ (・お気に入り)
    const bar = root.createDiv("mtg-dbar");
    bar.createDiv({ text: "Decks", cls: "mtg-dtitle" });
    const sel = bar.createEl("select");
    sel.createEl("option", { text: "All Decks", value: "" });
    for (const [id, name] of LEGAL_FORMATS) sel.createEl("option", { text: name.toUpperCase(), value: id });
    sel.onchange = () => {
      this.format = sel.value;
      void this.render();
    };
    const sortSel = bar.createEl("select");
    for (const [v, t] of [["mtime", "Last Modified"], ["name", "Name"], ["ctime", "Created"]]) sortSel.createEl("option", { text: t, value: v });
    sortSel.onchange = () => {
      this.sort = sortSel.value;
      void this.render();
    };
    bar.createEl("input", { type: "search", placeholder: "Search...", cls: "mtg-dsearch" }).addEventListener("input", (e) => {
      this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      void this.render();
    });
    this.tabs = bar.createDiv("mtg-dcolors");
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
      const thumb = thumbnailKey(fm.thumbnail, deck);
      let art: string | undefined;
      if (thumb) {
        const print = (deck.commander.get(thumb) ?? deck.main.get(thumb) ?? deck.side.get(thumb))?.print;
        const id = (print && (await printingOf(this.app, thumb, print))?.id) || cardInfo(this.app, thumb)?.id;
        art = id ? artCropUrl(id) : undefined;
      }
      out.push({
        file,
        format: typeof fm.format === "string" && fm.format in FORMATS ? fm.format : "constructed",
        favorite: !!fm.favorite,
        colors: COLORS.filter((c) => colors.has(c)),
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
    for (const c of COLORS) {
      const b = this.tabs.createEl("button", { cls: "mtg-dcolor", attr: { "aria-label": c } });
      symbolImg(b, c);
      b.toggleClass("is-on", this.colors.has(c));
      b.onclick = () => {
        if (!this.colors.delete(c)) this.colors.add(c);
        void this.render();
      };
    }
    const sorters: Record<string, (a: Entry, b: Entry) => number> = {
      mtime: (a, b) => b.file.stat.mtime - a.file.stat.mtime,
      ctime: (a, b) => b.file.stat.ctime - a.file.stat.ctime,
      name: (a, b) => a.file.basename.localeCompare(b.file.basename),
    };
    const list = all
      .filter((d) => d.file.basename.toLowerCase().includes(this.query) && (!this.format || d.format === this.format) && [...this.colors].every((c) => d.colors.includes(c)))
      .sort(sorters[this.sort] ?? sorters.mtime);
    this.body.empty();
    // 先頭は、新しいデッキを作る「＋」のタイル (アリーナと同じ)
    const add = this.body.createDiv("mtg-dcard");
    const plus = add.createDiv({ cls: "mtg-dtile mtg-dnew", attr: { "aria-label": "新しいデッキ" } });
    plus.createDiv({ text: "＋", cls: "mtg-dplus" });
    plus.onclick = () => this.actions.create();
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

  // デッキ名をその場で書き換える。ファイル名を変えるので、デッキのノート (md) の名前と、いつも同じ
  private rename(file: TFile, el: HTMLElement) {
    const input = el.createEl("input", { type: "text", cls: "mtg-dname-input", value: file.basename });
    el.setText("");
    el.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== file.basename) {
        if (/[\\/:*?"<>|#^\[\]]/.test(name)) new Notice("名前に使えない文字があります: \\ / : * ? \" < > | # ^ [ ]");
        else if (this.app.vault.getAbstractFileByPath(normalizePath(`${file.parent?.path ?? ""}/${name}.md`))) new Notice("同じ名前のデッキがあります");
        else await this.app.fileManager.renameFile(file, normalizePath(`${file.parent?.path ?? ""}/${name}.md`));
      }
      el.setText(file.basename);
    };
    input.onkeydown = (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") void finish(true);
      else if (e.key === "Escape") void finish(false);
    };
    input.onblur = () => void finish(true);
    input.onclick = (e) => e.stopPropagation();
  }

  private card(d: Entry) {
    const wrap = this.body.createDiv("mtg-dcard");
    const tile = wrap.createDiv("mtg-dtile");
    if (d.art) setImg(tile.createEl("img", { attr: { loading: "lazy", alt: "" } }), d.art);
    tile.createDiv("mtg-dshade");
    // フォーマットは、デッキに設定したものだけ (どのフォーマットで使えるかの一覧は出さない)
    const pips = tile.createDiv("mtg-dpips");
    for (const c of d.colors) symbolImg(pips, c);

    const ctl = tile.createDiv("mtg-dctl");
    imageButton(ctl, "サムネイルを選ぶ").onclick = (e) => {
      e.stopPropagation();
      new ThumbnailModal(this.app, d.file, "サムネイルにするカードアート", (key) => void this.app.fileManager.processFrontMatter(d.file, (fm) => (fm.thumbnail = key))).open();
    };
    iconButton(ctl, "trash-2", "デッキを削除").onclick = (e) => {
      e.stopPropagation();
      new ConfirmDelete(this.app, d.file, () => void this.deleteDeck(d.file)).open();
    };
    tile.onclick = () => this.actions.open(d.file);
    const nameEl = wrap.createDiv({ text: d.file.basename, cls: "mtg-dname", attr: { "aria-label": "クリックで名前を変える" } });
    nameEl.onclick = (e) => {
      e.stopPropagation();
      this.rename(d.file, nameEl);
    };
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
