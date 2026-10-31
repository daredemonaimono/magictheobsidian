import { App, TFile, normalizePath } from "obsidian";
import { Settings } from "./settings";
import { Printing, ScryfallCard, printingImageUrl, fetchLocalized, fetchPrintings, fileSafe, toMarkdown } from "./scryfall";

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
