import { App } from "obsidian";
import { cardImage, cardInfo, printingOf } from "./cards";
import { loadCollection } from "./collection";
import { DECK_DIR, parseDeck } from "./deck";
import { preload } from "./imageCache";
import { artCropUrl, printingImageUrl } from "./scryfall";

// デッキとコレクションのカードの画像 (カード全体・イラスト) を、先にローカルへ保存する。保存済みは飛ばす (通信しない)
export async function preloadDeckAndCollection(app: App, progress?: (done: number, total: number) => void): Promise<number> {
  const urls: string[] = [];
  const add = async (key: string, print?: string) => {
    const id = (print && (await printingOf(app, key, print))?.id) || cardInfo(app, key)?.id;
    if (id) urls.push(printingImageUrl(id), artCropUrl(id));
    else {
      const info = cardInfo(app, key);
      const u = info ? await cardImage(app, info.file) : undefined;
      if (u) urls.push(u);
    }
  };
  for (const f of app.vault.getMarkdownFiles().filter((x) => x.path.startsWith(`${DECK_DIR}/`))) {
    const deck = parseDeck(await app.vault.cachedRead(f));
    for (const board of [deck.commander, deck.main, deck.side]) for (const [key, e] of board) await add(key, e.print);
  }
  for (const row of (await loadCollection(app)).values()) await add(row.card, row.print);
  await preload(urls, progress);
  return new Set(urls).size;
}
