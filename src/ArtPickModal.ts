import { App, Modal } from "obsidian";
import { t } from "./i18n";
import { ScryCard, artOf } from "./node/scryfall";

// 別のイラストを選ぶ: 同じカードの、絵の違う版 (イラストごとに 1 枚) を並べる。押すと onPick
export class ArtPickModal extends Modal {
  constructor(app: App, private cardName: string, private arts: ScryCard[], private onPick: (a: ScryCard) => void) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText(t("artTitle", this.cardName));
    if (this.arts.length <= 1) this.contentEl.createDiv({ text: t("artNone"), cls: "mtg-ne-dim" });
    const grid = this.contentEl.createDiv("mtg-cs-arts");
    for (const a of this.arts) {
      const src = artOf(a);
      if (!src) continue;
      const cell = grid.createDiv("mtg-cs-art");
      cell.createEl("img", { attr: { src, alt: a.name, loading: "lazy" } });
      cell.createDiv({ text: [a.set?.toUpperCase(), a.collector_number && `#${a.collector_number}`, a.released_at?.slice(0, 4)].filter(Boolean).join(" "), cls: "mtg-cs-artcap" });
      cell.onclick = () => { this.onPick(a); this.close(); };
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}
