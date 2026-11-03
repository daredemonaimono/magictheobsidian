import { App } from "obsidian";
import { botBus, HoverCard } from "./botbus";
import { cardImage, cardInfo } from "./cards";

const images = new Map<string, string | null>(); // key → 画像の URL (取得中は null)

// カード1枚。画像があれば画像、無ければ名前。カーソルを合わせると右サイドバーに効果が出る
export function cardEl(app: App, parent: HTMLElement, c: HoverCard, cls = "") {
  const el = parent.createDiv({ cls: `mtg-bcard ${cls}` });
  el.createSpan({ text: c.name, cls: "mtg-bcard-name" });
  el.onmouseenter = () => botBus.setHover(c);
  const show = (url: string) => {
    el.querySelector(".mtg-bcard-name")?.remove();
    el.prepend(createEl("img", { attr: { src: url, alt: c.name, loading: "lazy" } }));
  };
  const known = images.get(c.key);
  if (known) show(known);
  else if (known === undefined) {
    images.set(c.key, null);
    const info = cardInfo(app, c.key);
    if (info) void cardImage(app, info.file).then((u) => u && (images.set(c.key, u), show(u)));
  }
  return el;
}
