import { App } from "obsidian";
import { cardImage, cardInfo, localCards, printingOf } from "./cards";
import { loadCollection } from "./collection";
import { DECK_DIR, parseDeck } from "./deck";
import { preload } from "./imageCache";
import { PreloadKind, PreloadScope } from "./imageKey";
import { artCropUrl, printingImageUrl } from "./scryfall";

// カードの画像 (カード全体・イラスト) を、先にローカルへ保存する。保存済みは飛ばす (通信しない)。
// scope = decks (デッキとコレクションのカード。デッキで選んだ版も) / all (Cards/ のカードすべて。標準の版)。kind = both / card / art
export async function preloadImages(app: App, scope: PreloadScope, kind: PreloadKind, progress?: (done: number, total: number) => void): Promise<number> {
  const urls: string[] = [];
  const wantCard = kind !== "art";
  const wantArt = kind !== "card";
  const add = async (key: string, print?: string) => {
    const id = (print && (await printingOf(app, key, print))?.id) || cardInfo(app, key)?.id;
    if (id) {
      if (wantCard) urls.push(printingImageUrl(id));
      if (wantArt) urls.push(artCropUrl(id));
    } else if (wantCard) {
      const info = cardInfo(app, key);
      const u = info ? await cardImage(app, info.file) : undefined;
      if (u) urls.push(u);
    }
  };
  if (scope === "all") {
    for (const c of localCards(app)) await add(c.file.basename);
  } else {
    for (const f of app.vault.getMarkdownFiles().filter((x) => x.path.startsWith(`${DECK_DIR}/`))) {
      const deck = parseDeck(await app.vault.cachedRead(f));
      for (const board of [deck.commander, deck.main, deck.side, deck.token]) for (const [key, e] of board) await add(key, e.print);
    }
    for (const row of (await loadCollection(app)).values()) await add(row.card, row.print);
  }
  await preload(urls, progress);
  return new Set(urls).size;
}
