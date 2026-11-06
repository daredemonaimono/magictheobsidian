import { App, Modal, TFile } from "obsidian";
import { setImg } from "./imageCache";
import { cardInfo, printingOf } from "./cards";
import { Deck, parseDeck } from "./deck";
import { artCropUrl } from "./scryfall";

// デッキのカードのアート (デッキで選んだ版。選んでいなければカードの標準の版)
export async function deckArtUrl(app: App, deck: Deck, key: string): Promise<string | undefined> {
  const e = deck.commander.get(key) ?? deck.main.get(key) ?? deck.side.get(key);
  const id = (e?.print && (await printingOf(app, key, e.print))?.id) || cardInfo(app, key)?.id;
  return id ? artCropUrl(id) : undefined;
}

// デッキの中で使っているカードアート (デッキで選んだ版。選んでいなければカードの標準の版) から、サムネイルにするカードを選ぶ
export class ThumbnailModal extends Modal {
  constructor(app: App, private file: TFile, private title: string, private onPick: (key: string) => void) {
    super(app);
  }
  async onOpen() {
    this.setTitle(this.title);
    this.modalEl.addClass("mtg-print-modal");
    const grid = this.contentEl.createDiv("mtg-print-grid");
    const deck = parseDeck(await this.app.vault.cachedRead(this.file));
    const seen = new Set<string>();
    for (const [key, e] of [...deck.commander, ...deck.main, ...deck.side]) {
      if (seen.has(key)) continue;
      seen.add(key);
      const cell = grid.createDiv("mtg-print");
      const img = cell.createEl("img", { attr: { loading: "lazy", alt: key } });
      void (async () => {
        const id = (e.print && (await printingOf(this.app, key, e.print))?.id) || cardInfo(this.app, key)?.id;
        if (id) setImg(img, artCropUrl(id));
      })();
      cell.createDiv({ text: key, cls: "mtg-dim" });
      if (e.print) cell.createDiv({ text: e.print.toUpperCase(), cls: "mtg-dim" });
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
