import { App } from "obsidian";
import { CardInfo, cardImage, cardText, ensureCardFile, localCards, readPrintings } from "./cards";
import { ScryfallCard, artCropUrl, cardImageUrl, legalList, restrictedList, searchCards } from "./scryfall";
import { Settings } from "./settings";
import { COLORS, symbolImg } from "./symbols";

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

// タイプの選択肢。値は Scryfall の t: にも、ノートの type_line の照合にもそのまま使う
export const TYPES: [string, string][] = [
  ["", "タイプ: すべて"],
  ["Creature", "クリーチャー"],
  ["Instant", "インスタント"],
  ["Sorcery", "ソーサリー"],
  ["Artifact", "アーティファクト"],
  ["Enchantment", "エンチャント"],
  ["Land", "土地"],
  ["Planeswalker", "プレインズウォーカー"],
  ["Battle", "バトル"],
];

// 検索欄 (名前・効果・タイプ・色)。画面内の検索と、サイドバーの「新しく追加」で共有。
// 欄は f の現在の値で始まり、変えると f を書き換えて onChange を呼ぶ
export function buildFilterBar(parent: HTMLElement, f: Filters, onChange: () => void) {
  const bar = parent.createDiv("mtg-bar");
  const input = (ph: string, key: "name" | "effect") => {
    const el = bar.createEl("input", { type: "text", placeholder: ph });
    el.value = f[key];
    el.addEventListener("input", () => {
      f[key] = el.value.trim();
      onChange();
    });
  };
  input("名前 (日本語可)", "name");
  input("効果テキスト", "effect");
  const sel = bar.createEl("select", { attr: { "aria-label": "タイプ" } });
  for (const [value, label] of TYPES) sel.createEl("option", { text: label, value });
  sel.value = f.type;
  sel.onchange = () => {
    f.type = sel.value;
    onChange();
  };
  for (const c of COLORS) {
    const b = bar.createEl("button", { cls: "mtg-color", attr: { "aria-label": c } });
    symbolImg(b, c);
    b.toggleClass("is-on", f.colors.has(c));
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

// 検索語ごとの Scryfall の結果。画面を開いている間だけ覚えて、同じ検索で API を呼び直さない
const found = new Map<string, ScryfallCard[]>();

// Cards/ の結果を先に出し、続けて Scryfall の結果のうち Cards/ に無いものを足す。
// (Cards/ に1枚でもあると Scryfall を見に行かない、という作りだと、同じ名前の別カードが出なくなる)
// update(結果, 注記) は2回呼ばれる: Cards/ だけ → Scryfall を足した後
export async function searchAll(
  app: App,
  settings: Settings,
  f: Filters,
  stale: () => boolean,
  update: (results: Result[], note: string) => void,
) {
  const local = await searchLocal(app, f);
  if (stale()) return;
  const q = scryfallQuery(f);
  // 名前だけで1文字のときは広すぎるので Scryfall は見ない
  if (!q.trim() || (f.name.length === 1 && !f.effect && !f.type && !f.colors.size)) return update(local, `Cards ${local.length} 件`);
  update(local, `Cards ${local.length} 件 · Scryfall を検索中…`);
  try {
    if (!found.has(q)) found.set(q, await searchCards(q));
  } catch (e) {
    if (!stale()) update(local, `Cards ${local.length} 件 · Scryfall の検索失敗: ${(e as Error).message}`);
    return;
  }
  if (stale()) return;
  const have = new Set(local.map((r) => r.name));
  const extra = found.get(q)!.filter((c) => !have.has(c.name)).map((c) => scryfallResult(app, settings, c));
  update([...local, ...extra], `Cards ${local.length} 件 + Scryfall ${extra.length} 件`);
}
