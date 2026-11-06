// 画像の URL → ローカルに保存するときのファイル名。純粋な関数 (obsidian を読み込まない)。
// Scryfall の画像は、大きさ・面・id で決まるので、同じ画像は、いつも同じ名前になる (URL の ?数字 は無視する)。それ以外の URL は、URL の短い値で名前を付ける

const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

export function imageKey(url: string): string {
  const card = url.match(/^https:\/\/cards\.scryfall\.io\/([a-z_]+)\/(front|back)\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})\.(jpg|png)/);
  if (card) return `${card[1]}-${card[2]}-${card[3]}.${card[4]}`; // 例: normal-front-<id>.jpg / art_crop-front-<id>.jpg
  const back = url.match(/^https:\/\/backs\.scryfall\.io\/([a-z_]+)\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})\.(jpg|png)/);
  if (back) return `cardback-${back[1]}-${back[2]}.${back[3]}`;
  return `h${fnv(url.split("?")[0])}.img`;
}

// ローカルに保存してよい画像か (Scryfall の画像だけ)。それ以外は、そのまま読み込む
export const cacheable = (url: string): boolean => /^https:\/\/(cards|backs)\.scryfall\.io\//.test(url);

// 画像の保存の仕方 (設定)。off = 保存しない (そのつど通信) / view = 見た画像を保存する / preload = 見た画像に加えて、デッキとコレクションのカードを、先にまとめて保存する
export type ImageMode = "off" | "view" | "preload";
export const IMAGE_MODES: ImageMode[] = ["off", "view", "preload"];

// 「先に保存」の範囲と種類 (設定)。範囲: decks = デッキとコレクションのカード / all = Cards/ のカードすべて。種類: both = カード全体とイラスト / card = カード全体 / art = イラストだけ
export type PreloadScope = "decks" | "all";
export type PreloadKind = "both" | "card" | "art";
export const PRELOAD_SCOPES: PreloadScope[] = ["decks", "all"];
export const PRELOAD_KINDS: PreloadKind[] = ["both", "card", "art"];
