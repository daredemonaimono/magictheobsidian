import { App } from "obsidian";
import { CardInfo, cardImage, cardText, ensureCardFile, localCards, readPrintings } from "./cards";
import { ScryfallCard, artCropUrl, cardImageUrl, legalList, restrictedList } from "./scryfall";
import { Settings } from "./settings";

export interface Meta {
  name: string;
  typeLine: string;
  cmc: number;
  image?: string;
  legal?: string[];
  restricted?: string[];
}

// key = Cards/ のファイル名。resolve() は Scryfall 由来ならここでノート化する
export interface Result {
  name: string;
  ja?: string;
  typeLine: string;
  manaCost: string;
  cmc: number;
  colors: string[];
  legal?: string[]; // 使えるフォーマット (未取得なら undefined)
  art?: string; // イラストだけの小さい画像のURL (一覧用)
  localKey?: string; // Cards/ に既にあるカードだけ (削除操作はノートを作らないため、これで判定)
  image: () => Promise<string | undefined>;
  text: () => Promise<string>;
  // print = 追加時の版 (コレクションで使う)
  resolve: () => Promise<{ key: string; meta: Meta; print?: string }>;
}

export interface Filters {
  name: string;
  effect: string;
  type: string;
  colors: Set<string>;
}

export const emptyFilters = (): Filters => ({ name: "", effect: "", type: "", colors: new Set() });
export const isEmpty = (f: Filters) => !f.name && !f.effect && !f.type && !f.colors.size;

const COLORS = ["W", "U", "B", "R", "G"];

// 検索欄 (名前・効果・タイプ・色)。サイドバーの一覧と、画面内検索で共有
export function buildFilterBar(parent: HTMLElement, f: Filters, onChange: () => void) {
  const bar = parent.createDiv("mtg-bar");
  const input = (ph: string, key: "name" | "effect" | "type") =>
    bar.createEl("input", { type: "text", placeholder: ph }).addEventListener("input", (e) => {
      f[key] = (e.target as HTMLInputElement).value.trim();
      onChange();
    });
  input("名前 (日本語可)", "name");
  input("効果テキスト", "effect");
  input("タイプ", "type");
  for (const c of COLORS) {
    const b = bar.createEl("button", { text: c, cls: "mtg-color" });
    b.onclick = () => {
      f.colors.has(c) ? f.colors.delete(c) : f.colors.add(c);
      b.toggleClass("is-on", f.colors.has(c));
      onChange();
    };
  }
}

// 条件が空なら Cards/ の全カード (名前順)
export async function searchLocal(app: App, f: Filters): Promise<Result[]> {
  const { name, effect, type, colors } = f;
  const lc = (s?: string) => (s ?? "").toLowerCase();
  const out: Result[] = [];
  for (const c of localCards(app).sort((a, b) => a.name.localeCompare(b.name))) {
    if (name && !lc(c.name).includes(lc(name)) && !lc(c.nameLocal).includes(lc(name))) continue;
    if (type && !lc(c.typeLine).includes(lc(type))) continue;
    if ([...colors].some((x) => !c.colors.includes(x))) continue;
    // shortcut: 効果検索は md を毎回読む。数千枚で重くなったら索引を作る
    if (effect && !lc(await app.vault.cachedRead(c.file)).includes(lc(effect))) continue;
    out.push(localResult(app, c));
  }
  return out;
}

export function scryfallQuery(f: Filters): string {
  const { name, effect, type, colors } = f;
  const q = name.split(/\s+/).filter(Boolean);
  if (/[^\x00-\x7F]/.test(name)) q.push("lang:any"); // 日本語名
  if (effect) q.push(`o:"${effect}"`);
  for (const t of type.split(/\s+/).filter(Boolean)) q.push(`t:${t}`);
  if (colors.size) q.push(`c>=${[...colors].join("")}`);
  return q.join(" ");
}

export function localResult(app: App, c: CardInfo): Result {
  return {
    name: c.name,
    ja: c.nameLocal,
    typeLine: c.typeLine,
    manaCost: c.manaCost,
    cmc: c.cmc,
    colors: c.colors,
    legal: c.legal,
    art: c.id ? artCropUrl(c.id) : undefined,
    localKey: c.file.basename,
    image: () => cardImage(app, c.file),
    text: () => cardText(app, c.file.basename),
    resolve: async () => {
      const prints = await readPrintings(app, c.file.basename);
      const p = prints.find((x) => x.set === c.set) ?? prints[0];
      return {
        key: c.file.basename,
        meta: { name: c.name, typeLine: c.typeLine, cmc: c.cmc, image: await cardImage(app, c.file), legal: c.legal, restricted: c.restricted },
        print: p && `${p.set} ${p.collector_number}`,
      };
    },
  };
}

export function scryfallResult(app: App, settings: Settings, c: ScryfallCard): Result {
  const meta: Meta = {
    name: c.name,
    typeLine: c.type_line,
    cmc: c.cmc,
    image: cardImageUrl(c),
    legal: legalList(c.legalities),
    restricted: restrictedList(c.legalities),
  };
  return {
    name: c.name,
    ja: c.printed_name !== c.name ? c.printed_name : undefined,
    typeLine: c.type_line,
    manaCost: c.mana_cost ?? c.card_faces?.[0]?.mana_cost ?? "",
    cmc: c.cmc,
    colors: c.colors ?? c.card_faces?.[0]?.colors ?? [],
    legal: meta.legal,
    art: artCropUrl(c.id),
    image: async () => meta.image,
    text: async () => c.printed_text ?? c.oracle_text ?? c.card_faces?.map((x) => x.printed_text ?? x.oracle_text).join("\n\n---\n\n") ?? "",
    resolve: async () => ({
      key: (await ensureCardFile(app, c, settings)).basename,
      meta,
      print: `${c.set} ${c.collector_number}`,
    }),
  };
}
