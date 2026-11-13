import { CARD_TYPES } from "./cardtypes";
import { CardData, Print } from "./card";

// Scryfall (https://scryfall.com/docs/api) のカードを、CardData にする。カードのノートは英語なので、英語の名前・原文を使う。通信は main.ts (ここは、純粋な変換)。
interface Face { image_uris?: { small?: string; art_crop?: string }; name?: string; printed_name?: string; mana_cost?: string; type_line?: string; oracle_text?: string; printed_text?: string; printed_type_line?: string }
export interface ScryCard extends Face { object?: string; id: string; oracle_id?: string; set?: string; collector_number?: string; released_at?: string; name: string; lang?: string; keywords?: string[]; card_faces?: Face[]; data?: ScryCard[] }

// 名前で検索 (1 ページ目)。日本語などの名前は、lang:ja で、日本語版のカードの中から探す
export function scryfallUrl(query: string): string {
  const q = query.trim();
  return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(/[^\x00-\x7F]/.test(q) ? `${q} lang:ja` : q)}&unique=cards`;
}
export interface Filters { colors: string[]; type: string }
export const COLORS = ["W", "U", "B", "R", "G", "C"]; // C = 無色
// 名前 + タイプ (t:) + 色 (c:。選んだ色をすべて含む)
export const buildQuery = (name: string, f: Filters) => [name.trim(), f.type && `t:${f.type}`, f.colors.length && `c:${f.colors.join("").toLowerCase()}`].filter(Boolean).join(" ");
// 版違い (同じカードの、すべての印刷)。デッキで版を選ぶときのために、絵の URL と一緒に持つ
export const printsUrl = (oracleId: string) => `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`oracleid:${oracleId}`)}&unique=prints&order=released`;
export function printsFrom(res: ScryCard): Print[] {
  return cardsOf(res).flatMap((c) => {
    const art = c.image_uris?.art_crop ?? c.card_faces?.[0]?.image_uris?.art_crop;
    return art && c.set && c.collector_number ? [{ id: c.id, set: c.set, number: c.collector_number, released: c.released_at ?? "", art }] : [];
  });
}
// 絵のキャッシュ (ローカルに保存): ファイル名は Scryfall の id。ノートは、ユーザーが書き換えられるので、取りに行くのは、Scryfall の画像の配信元だけ
export const artFileName = (id: string) => `${id.replace(/[^\w-]/g, "")}.jpg`;
export const isScryfallImage = (url: string) => url.startsWith("https://cards.scryfall.io/");
export const cardsOf = (res: ScryCard): ScryCard[] => (res.object === "list" ? res.data ?? [] : [res]);
export const thumbOf = (c: ScryCard): string | undefined => c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small;

// withJa = 日本語の印刷の、名前・原文・タイプ行も取る (設定が日本語のとき)。無ければ、入れない
export function fromScryfall(res: ScryCard, withJa = false): CardData {
  const c = cardsOf(res)[0];
  if (!c) throw new Error("no card");
  const faces = c.card_faces?.length ? c.card_faces : [c];
  const join = (f: (x: Face) => string | undefined, sep: string) => faces.map(f).filter(Boolean).join(sep);
  const typeLine = c.type_line ?? join((x) => x.type_line, " // ");
  // カードタイプ: 英語のタイプ行の中で、最初に見つかったもの (土地などは、唱えないので、無し)
  const art = c.image_uris?.art_crop ?? faces[0].image_uris?.art_crop;
  const type = CARD_TYPES.find((x) => new RegExp(`\\b${x.label.en}\\b`, "i").test(typeLine))?.id;
  const ja = withJa ? { nameJa: join((x) => x.printed_name, " // "), textJa: c.printed_text ?? join((x) => x.printed_text, "\n//\n"), typeLineJa: c.printed_type_line ?? join((x) => x.printed_type_line, " // ") } : {};
  return {
    name: c.name,
    ...(type ? { type } : {}),
    scryfall: c.id,
    ...(art ? { art } : {}),
    ...(c.keywords?.length ? { keywords: c.keywords } : {}),
    ...((c.mana_cost ?? join((x) => x.mana_cost, " // ")) ? { mana: c.mana_cost ?? join((x) => x.mana_cost, " // ") } : {}),
    typeLine,
    text: c.oracle_text ?? join((x) => x.oracle_text, "\n//\n"),
    ...Object.fromEntries(Object.entries(ja).filter(([, v]) => v)),
    abilities: [],
  };
}
