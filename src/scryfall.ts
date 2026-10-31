import { requestUrl } from "obsidian";

export interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  printed_name?: string;
  printed_text?: string;
  printed_type_line?: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  colors?: string[];
  color_identity: string[];
  set: string;
  collector_number: string;
  rarity: string;
  scryfall_uri: string;
  prints_search_uri?: string;
  legalities?: Record<string, string>;
  image_uris?: { normal: string };
  card_faces?: {
    name: string;
    mana_cost: string;
    type_line: string;
    colors?: string[];
    oracle_text?: string;
    printed_name?: string;
    printed_text?: string;
    printed_type_line?: string;
    image_uris?: { normal: string };
  }[];
  oracle_text?: string;
}

const HEADERS = { "User-Agent": "magictheobsidian/0.1.0", Accept: "application/json" };

export const cardImageUrl = (c: ScryfallCard) => c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal;

// shortcut: 表面 jpg 固定。裏面や png しか無い版が出たら Printings に URL を持たせる
export const printingImageUrl = (id: string) => `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;

// 横長のイラスト部分だけの小さい画像 (サイドバー一覧用)。表面 jpg 固定
export const artCropUrl = (id: string) => `https://cards.scryfall.io/art_crop/front/${id[0]}/${id[1]}/${id}.jpg`;

export async function fetchCard(name: string): Promise<ScryfallCard> {
  const res = await requestUrl({
    url: `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
    headers: HEADERS,
    throw: false,
  });
  if (res.status !== 200) throw new Error(res.json?.details ?? `HTTP ${res.status}`);
  return res.json;
}

// セットと番号で版を指定して取得 (デッキ取り込み用)
export async function fetchPrint(set: string, no: string): Promise<ScryfallCard> {
  const res = await requestUrl({
    url: `https://api.scryfall.com/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(no)}`,
    headers: HEADERS,
    throw: false,
  });
  if (res.status !== 200) throw new Error(res.json?.details ?? `HTTP ${res.status}`);
  return res.json;
}

// 該当なしは 404 で返るので空配列にする
export async function searchCards(q: string): Promise<ScryfallCard[]> {
  const res = await requestUrl({
    url: `https://api.scryfall.com/cards/search?unique=cards&q=${encodeURIComponent(q)}`,
    headers: HEADERS,
    throw: false,
  });
  if (res.status === 404) return [];
  if (res.status !== 200) throw new Error(res.json?.details ?? `HTTP ${res.status}`);
  return res.json.data;
}

export interface Printing {
  id: string;
  set: string;
  collector_number: string;
  rarity: string;
  released_at: string;
  lang: string;
}

// 全収録を新しい順に。ページ分割されるので next_page を辿る。
// 英語以外は、その言語の版だけ。無ければ英語にする
export async function fetchPrintings(card: ScryfallCard, lang = "en"): Promise<Printing[]> {
  const get = async (url: string | undefined) => {
    const out: Printing[] = [];
    while (url) {
      const res = await requestUrl({ url, headers: HEADERS, throw: false });
      if (res.status !== 200) break;
      out.push(...res.json.data);
      url = res.json.has_more ? res.json.next_page : undefined;
    }
    return out;
  };
  if (lang !== "en") {
    const q = encodeURIComponent(`oracleid:${card.oracle_id} lang:${lang}`);
    const found = await get(`https://api.scryfall.com/cards/search?order=released&unique=prints&q=${q}`);
    if (found.length) return found;
  }
  return get(card.prints_search_uri);
}

// 指定言語の版 (printed_name / printed_text を持つ)。全カードに全言語があるわけではないので無ければ undefined
export async function fetchLocalized(oracleId: string, lang: string): Promise<ScryfallCard | undefined> {
  if (lang === "en") return undefined;
  const res = await requestUrl({
    url: `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`oracleid:${oracleId} lang:${lang}`)}`,
    headers: HEADERS,
    throw: false,
  });
  return res.status === 200 ? res.json.data?.[0] : undefined;
}

// restricted (Vintage の制限カード) も使えるものとして数える
export const legalList = (l: Record<string, string> = {}) => Object.entries(l).filter(([, v]) => v === "legal" || v === "restricted").map(([k]) => k);

export const restrictedList = (l: Record<string, string> = {}) => Object.entries(l).filter(([, v]) => v === "restricted").map(([k]) => k);

export const fileSafe = (s: string) => s.replace(" // ", " - ").replace(/[\\/:*?"<>|#^\[\]]/g, "");

export interface CardOptions {
  lang: string;
  local?: ScryfallCard;
  printings: Printing[];
}

export function toMarkdown(c: ScryfallCard, { lang, local, printings }: CardOptions): string {
  const faces = c.card_faces ?? [c];
  const text = faces
    .map((f) => `${c.card_faces ? `### ${f.name}\n` : ""}${f.type_line}\n\n${(f.oracle_text ?? "").replace(/\n/g, "\n\n")}`)
    .join("\n\n---\n\n");
  const localText = local
    ? (local.card_faces ?? [local])
        .map((f) => `${local.card_faces ? `### ${f.printed_name ?? f.name}\n` : ""}${f.printed_type_line ?? f.type_line}\n\n${(f.printed_text ?? "").replace(/\n/g, "\n\n")}`)
        .join("\n\n---\n\n")
    : "";
  const localName = local?.printed_name;
  // 英語以外の画像言語を選んでいて、その版があれば最新版の画像を使う
  const img = lang !== "en" && printings[0]?.lang === lang ? printingImageUrl(printings[0].id) : cardImageUrl(c);
  const fm = [
    "---",
    `name: "${c.name}"`,
    ...(localName && localName !== c.name ? [`name_local: "${localName}"`, `aliases: ["${localName}"]`] : []),
    `mana_cost: "${c.mana_cost ?? c.card_faces?.[0]?.mana_cost ?? ""}"`,
    `cmc: ${c.cmc}`,
    `type_line: "${c.type_line}"`,
    `colors: [${(c.colors ?? c.card_faces?.[0]?.colors ?? []).join(", ")}]`,
    `color_identity: [${c.color_identity.join(", ")}]`,
    `rarity: ${c.rarity}`,
    `set: ${c.set}`,
    `scryfall_id: ${c.id}`,
    `oracle_id: ${c.oracle_id}`,
    `legal: [${legalList(c.legalities).join(", ")}]`,
    `restricted: [${restrictedList(c.legalities).join(", ")}]`, // 空でも書く (キーが無い = 未取得、と区別するため)
    `tags: [mtg/card]`,
    "---",
  ].join("\n");
  // 画像URLは scryfall_id から作れるので Printings には保存しない。資産管理ではこの id を単位にする
  const prints = printings.length
    ? `\n## Printings\n\n| set | no | rarity | released | scryfall_id | lang |\n|---|---|---|---|---|---|\n${printings
        .map((p) => `| ${p.set} | ${p.collector_number} | ${p.rarity} | ${p.released_at} | ${p.id} | ${p.lang ?? "en"} |`)
        .join("\n")}\n`
    : "";
  return `${fm}\n\n${img ? `![](${img})\n\n` : ""}${text}\n\n${localText.trim() ? `## Text (${lang})\n\n${localText}\n\n` : ""}[Scryfall](${c.scryfall_uri})\n${prints}`;
}
