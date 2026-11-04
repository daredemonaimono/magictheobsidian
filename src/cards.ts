import { App, TFile, normalizePath, parseYaml } from "obsidian";
import { backFaceText, backImageOf, backUrl } from "./flip";
import { LEGAL_FORMATS, judge } from "./rules";
import { Settings } from "./settings";
import { Printing, ScryfallCard, legalList, restrictedList, printingImageUrl, fetchById, fetchCard, fetchCollection, fetchLocalized, fetchPrintings, fileSafe, toMarkdown } from "./scryfall";

export const CARD_DIR = "Cards";

export interface CardInfo {
  file: TFile;
  name: string;
  nameLocal?: string;
  typeLine: string;
  colors: string[];
  cmc: number;
  manaCost: string;
  keywords?: string[]; // Scryfall のキーワード能力の一覧 (英語)。古いノートには無い
  power?: string; // クリーチャーだけ。"*" などもあるので文字列。古いノートには無い
  toughness?: string;
  set: string;
  id: string; // scryfall_id
  legal?: string[]; // 使えるフォーマット。未取得なら undefined
  restricted?: string[]; // 制限カードのフォーマット (Vintage)
  layout?: string; // Scryfall のレイアウト (transform / prepare など)。古いノートには無い
  loyalty?: number; // プレインズウォーカーの初期忠誠度。古いノート・X には無い
  loyaltyKnown?: boolean; // loyalty: が書いてある (X も)。無いのは、古いノート (情報取得で付く)
}

function toInfo(app: App, file: TFile): CardInfo | null {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm?.name) return null;
  return {
    file,
    name: fm.name,
    nameLocal: fm.name_local,
    typeLine: fm.type_line ?? "",
    colors: fm.colors ?? [],
    cmc: fm.cmc ?? 0,
    manaCost: fm.mana_cost ?? "",
    keywords: Array.isArray(fm.keywords) ? fm.keywords : undefined,
    power: fm.power !== undefined ? String(fm.power) : undefined,
    toughness: fm.toughness !== undefined ? String(fm.toughness) : undefined,
    set: fm.set ?? "",
    id: fm.scryfall_id ?? "",
    legal: Array.isArray(fm.legal) ? fm.legal : undefined,
    restricted: Array.isArray(fm.restricted) ? fm.restricted : undefined,
    layout: fm.layout,
    loyalty: typeof fm.loyalty === "number" ? fm.loyalty : undefined,
    loyaltyKnown: fm.loyalty !== undefined,
  };
}

export function localCards(app: App): CardInfo[] {
  return app.vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(`${CARD_DIR}/`))
    .map((f) => toInfo(app, f))
    .filter((c): c is CardInfo => c !== null);
}

export function cardInfo(app: App, key: string): CardInfo | null {
  const f = app.vault.getAbstractFileByPath(`${CARD_DIR}/${key}.md`);
  return f instanceof TFile ? toInfo(app, f) : null;
}

export async function cardImage(app: App, file: TFile): Promise<string | undefined> {
  return (await app.vault.cachedRead(file)).match(/!\[\]\((.+?)\)/)?.[1];
}

export async function ensureCardFile(app: App, card: ScryfallCard, settings: Settings): Promise<TFile> {
  const path = normalizePath(`${CARD_DIR}/${fileSafe(card.name)}.md`);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  if (!app.vault.getAbstractFileByPath(CARD_DIR)) await app.vault.createFolder(CARD_DIR);
  // 収録一覧が取れなくてもカード自体は作る
  const printings: Printing[] = await fetchPrintings(card, settings.cardLang).catch(() => []);
  const local = await fetchLocalized(card.oracle_id, settings.textLang).catch(() => undefined);
  return app.vault.create(path, toMarkdown(card, { lang: settings.textLang, local, printings }));
}

// カード md の Printings 表を読む。表が無ければ空 (取得前に作ったカード)
export async function readPrintings(app: App, key: string): Promise<Printing[]> {
  const f = app.vault.getAbstractFileByPath(`${CARD_DIR}/${key}.md`);
  if (!(f instanceof TFile)) return [];
  return (await app.vault.cachedRead(f))
    .split("\n")
    .filter((l) => l.startsWith("| "))
    .map((l) => l.slice(2, -2).split(" | "))
    .filter((c) => /^[0-9a-f-]{36}$/.test(c[4] ?? ""))
    .map(([set, collector_number, rarity, released_at, id, lang]) => ({ set, collector_number, rarity, released_at, id, lang }));
}

// 英語のオラクルテキスト (設定言語の Text 節は含めない)。ルール判定用
export async function oracleEnglish(app: App, key: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(`${CARD_DIR}/${key}.md`);
  if (!(f instanceof TFile)) return "";
  const c = await app.vault.cachedRead(f);
  return c.replace(/^---[\s\S]*?\n---\n/, "").replace(/!\[\]\(.*?\)\n*/, "").split(/\n## Text \(|\n\[Scryfall\]/)[0].trim();
}

// 効果テキスト。設定言語のテキストがあればそれ、無ければ英語
export async function cardText(app: App, key: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(`${CARD_DIR}/${key}.md`);
  if (!(f instanceof TFile)) return "";
  const c = await app.vault.cachedRead(f);
  const local = c.match(/\n## Text \([^)]+\)\n\n([\s\S]*?)(?=\n\[Scryfall\])/);
  if (local) return local[1].trim();
  return c.replace(/^---[\s\S]*?\n---\n/, "").replace(/!\[\]\(.*?\)\n*/, "").split("\n[Scryfall]")[0].trim();
}

// 裏面の画像 (両面カードだけ。ノートに書いてある)。front = いま表示している表の画像 (版を選んでいれば、その版。無ければノートのもの)
export async function cardBackImage(app: App, file: TFile, front?: string): Promise<string | undefined> {
  const noted = backImageOf(await app.vault.cachedRead(file));
  return noted && (front ? backUrl(front) : noted);
}

// 裏面のテキスト (名前が "A // B" のカード)。無ければ空
export async function cardBackText(app: App, key: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(`${CARD_DIR}/${key}.md`);
  return f instanceof TFile ? backFaceText(await app.vault.cachedRead(f)) ?? "" : "";
}

// 設定言語のテキスト (`## Text (ja)`) だけを書き換える。英語の本文は触らない。空にすると節ごと消す。
// ↻ で取り直すと本文は作り直されるので、手で直した内容は消える
export async function setLocalText(app: App, key: string, lang: string, text: string) {
  const f = app.vault.getAbstractFileByPath(`${CARD_DIR}/${key}.md`);
  if (!(f instanceof TFile)) return;
  const body = text.trim();
  const section = /\n## Text \([^)]+\)\n\n[\s\S]*?(?=\n\[Scryfall\])/;
  await app.vault.process(f, (c) => {
    if (section.test(c)) return c.replace(section, body ? () => `\n## Text (${lang})\n\n${body}\n` : () => "");
    return body ? c.replace("\n[Scryfall]", () => `\n## Text (${lang})\n\n${body}\n\n[Scryfall]`) : c;
  });
}

export async function printingOf(app: App, key: string, print: string): Promise<Printing | undefined> {
  const [set, no] = print.split(" ");
  return (await readPrintings(app, key)).find((x) => x.set === set && x.collector_number === no);
}

export async function printingImage(app: App, key: string, print: string): Promise<string | undefined> {
  const p = await printingOf(app, key, print);
  return p && printingImageUrl(p.id);
}

// デッキ内のカードから、フォーマットごとの判定を出す
export function deckVerdicts(app: App, keys: string[], commanderDeck = false) {
  const cards = keys.map((key) => ({ key, legal: cardInfo(app, key)?.legal }));
  return Object.fromEntries(LEGAL_FORMATS.map(([id]) => [id, judge(cards, id, commanderDeck)]));
}

// 手動更新。カードのノートに `legal:` と `restricted:` を書く。1回75件まで。戻り値はカード名 → 判定 (取れたカードだけ)
export async function updateLegality(app: App, keys: string[]): Promise<Map<string, { legal: string[]; restricted: string[] }>> {
  const byId = new Map<string, string>();
  for (const key of keys) {
    const id = cardInfo(app, key)?.id;
    if (id) byId.set(id, key);
  }
  const { data, failed } = await fetchCollection([...byId.keys()]);
  const done = new Map<string, { legal: string[]; restricted: string[] }>();
  for (const c of data) {
    const key = byId.get(c.id)!;
    const f = app.vault.getAbstractFileByPath(`${CARD_DIR}/${key}.md`);
    if (!(f instanceof TFile)) continue;
    const result = { legal: legalList(c.legalities), restricted: restrictedList(c.legalities) };
    await app.fileManager.processFrontMatter(f, (fm) => {
      fm.legal = result.legal;
      fm.restricted = result.restricted;
    });
    done.set(key, result);
  }
  if (failed) throw new Error(`${failed} 回の取得に失敗 (取れた分だけ更新した)`);
  return done;
}

// カードのノートを Scryfall から取り直す。本文 (画像・テキスト・収録一覧) は作り直し、
// frontmatter は取り直した項目を上書きして、自分で足したキーは残す。本文に書き足したメモは消える
export async function refetchCard(app: App, settings: Settings, key: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(`${CARD_DIR}/${key}.md`);
  const info = cardInfo(app, key);
  if (!(file instanceof TFile) || !info) throw new Error("カードのノートが見つからない");
  const card = info.id ? await fetchById(info.id) : await fetchCard(info.name);
  const printings = await fetchPrintings(card, settings.cardLang).catch(() => []);
  const local = await fetchLocalized(card.oracle_id, settings.textLang).catch(() => undefined);
  const fresh = toMarkdown(card, { lang: settings.textLang, local, printings });
  const head = /^---\n([\s\S]*?)\n---\n/;
  const freshHead = fresh.match(head)!;
  await app.vault.process(file, (old) => (old.match(head)?.[0] ?? freshHead[0]) + fresh.slice(freshHead[0].length));
  await app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, parseYaml(freshHead[1])));
}
