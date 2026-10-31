import { App, TFile, normalizePath, requestUrl } from "obsidian";
import { LEGAL_FORMATS, judge } from "./rules";
import { Settings } from "./settings";
import { Printing, ScryfallCard, legalList, restrictedList, printingImageUrl, fetchLocalized, fetchPrintings, fileSafe, toMarkdown } from "./scryfall";

export const CARD_DIR = "Cards";

export interface CardInfo {
  file: TFile;
  name: string;
  nameLocal?: string;
  typeLine: string;
  colors: string[];
  cmc: number;
  manaCost: string;
  set: string;
  id: string; // scryfall_id
  legal?: string[]; // 使えるフォーマット。未取得なら undefined
  restricted?: string[]; // 制限カードのフォーマット (Vintage)
}

function toInfo(app: App, file: TFile): CardInfo | null {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm?.name) return null;
  return {
    file,
    name: fm.name,
    nameLocal: fm.name_local ?? fm.name_ja,
    typeLine: fm.type_line ?? "",
    colors: fm.colors ?? [],
    cmc: fm.cmc ?? 0,
    manaCost: fm.mana_cost ?? "",
    set: fm.set ?? "",
    id: fm.scryfall_id ?? "",
    legal: Array.isArray(fm.legal) ? fm.legal : undefined,
    restricted: Array.isArray(fm.restricted) ? fm.restricted : undefined,
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

// カード md の Printings 表を読む。表が無ければ空 (取得前に作ったカード)。lang 列が無い古い表は英語扱い
export async function readPrintings(app: App, key: string): Promise<Printing[]> {
  const f = app.vault.getAbstractFileByPath(`${CARD_DIR}/${key}.md`);
  if (!(f instanceof TFile)) return [];
  return (await app.vault.cachedRead(f))
    .split("\n")
    .filter((l) => l.startsWith("| "))
    .map((l) => l.slice(2, -2).split(" | "))
    .filter((c) => /^[0-9a-f-]{36}$/.test(c[4] ?? ""))
    .map(([set, collector_number, rarity, released_at, id, lang]) => ({ set, collector_number, rarity, released_at, id, lang: lang ?? "en" }));
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
  const ids = [...byId.keys()];
  const done = new Map<string, { legal: string[]; restricted: string[] }>();
  let failed = 0;
  for (let i = 0; i < ids.length; i += 75) {
    if (i) await new Promise((r) => setTimeout(r, 100)); // Scryfall の負荷配慮
    const res = await requestUrl({
      url: "https://api.scryfall.com/cards/collection",
      method: "POST",
      contentType: "application/json",
      headers: { "User-Agent": "magictheobsidian/0.10.1", Accept: "application/json" },
      body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }),
      throw: false,
    });
    if (res.status !== 200) {
      failed++;
      continue;
    }
    for (const c of res.json.data) {
      const f = app.vault.getAbstractFileByPath(`${CARD_DIR}/${byId.get(c.id)}.md`);
      if (!(f instanceof TFile)) continue;
      const result = { legal: legalList(c.legalities), restricted: restrictedList(c.legalities) };
      await app.fileManager.processFrontMatter(f, (fm) => {
        fm.legal = result.legal;
        fm.restricted = result.restricted;
      });
      done.set(byId.get(c.id)!, result);
    }
  }
  if (failed) throw new Error(`${failed} 回の取得に失敗 (取れた分だけ更新した)`);
  return done;
}
