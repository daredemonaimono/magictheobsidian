import { App, Notice, requestUrl } from "obsidian";
import { cardInfo, printingOf } from "./cards";
import { Settings } from "./settings";
import { loadCollection } from "./collection";
import { fetchCollection } from "./scryfall";

export interface Prices {
  usd?: string | null;
  usd_foil?: string | null;
  usd_etched?: string | null;
}

// 価格は手動更新だけ (勝手に API を呼ばない)。取得結果は data.json に保存して次回起動でも使う
export const priceStore = {
  prices: {} as Record<string, Prices>,
  updated: "", // ISO 日時。空 = 未取得
  save: async () => {},
};

// 所持している版の価格を Scryfall から取り直す。1回75件まで。戻り値は更新した件数
export async function updateCollectionPrices(app: App, settings: Settings): Promise<number> {
  // キーが無い Scryfall 優先は、Scryfall のみと同じ
  const mode = settings.priceSource === "scryfall-first" && !settings.tcgKey ? "scryfall" : settings.priceSource;
  if (mode === "tcg" && !settings.tcgKey) throw new Error("設定に TCG Price Lookup の API キーを入れてください");
  const ids = new Set<string>();
  const rows = [...(await loadCollection(app)).values()];
  for (const r of rows) {
    const p = await printingOf(app, r.card, r.print);
    if (p) ids.add(p.id);
  }
  let failed = 0;
  if (mode !== "tcg") {
    const res = await fetchCollection([...ids]);
    failed = res.failed;
    for (const c of res.data) priceStore.prices[c.id] = c.prices ?? {};
  }
  if (mode !== "scryfall") {
    // TCG Price Lookup のみ: 全部。Scryfall 優先: Scryfall で値段が無かった行だけ
    const wanted: Wanted[] = [];
    for (const r of rows) {
      const p = await printingOf(app, r.card, r.print);
      const name = cardInfo(app, r.card)?.name;
      if (p && name && (mode === "tcg" || priceOf(p.id, r.foil) === undefined)) wanted.push({ id: p.id, name, no: p.collector_number, foil: r.foil });
    }
    await fillMissing(wanted, settings.tcgKey);
  }
  priceStore.updated = new Date().toISOString();
  await priceStore.save();
  if (failed) throw new Error(`${failed} 回の取得に失敗 (取れた分だけ更新した)`);
  return ids.size;
}

// shortcut: 状態 (NM/LP…) による値引きはしない。必要になったら係数を設定に足す
export function priceOf(id: string, foil: boolean): number | undefined {
  const p = priceStore.prices[id];
  const v = foil ? p?.usd_foil ?? p?.usd_etched ?? p?.usd : p?.usd;
  return v ? Number(v) : undefined;
}

interface Wanted {
  id: string; // scryfall_id (価格の保存先)
  name: string;
  no: string; // コレクター番号
  foil: boolean;
}

interface TcgCard {
  name: string;
  number: string | null;
  variant: string | null;
  prices?: { raw?: Record<string, { tcgplayer?: { market?: number | null; mid?: number | null } }> };
}

// Scryfall で値段が取れなかったカードだけ、TCG Price Lookup (無料枠: 1日100回・3秒に1回) で補う。
// Scryfall の id では引けないので、名前で探してコレクター番号が合うものを使う。決まらないものは推測せず飛ばす
async function fillMissing(wanted: Wanted[], key: string) {
  const byName = new Map<string, Wanted[]>();
  for (const w of wanted) byName.set(w.name, [...(byName.get(w.name) ?? []), w]);
  let filled = 0;
  let stopped = "";
  let first = true;
  for (const [name, ws] of byName) {
    if (!first) await new Promise((r) => setTimeout(r, 3100));
    first = false;
    const url = `https://api.tcgpricelookup.com/v1/cards/search?game=mtg&limit=100&q=${encodeURIComponent(name)}`;
    const res = await requestUrl({ url, headers: { "X-API-Key": key }, throw: false });
    if (res.status === 401) return void new Notice("TCG Price Lookup の API キーが正しくない");
    if (res.status === 429) {
      stopped = "回数の上限 (無料枠は1日100回) に達した";
      break;
    }
    if (res.status !== 200) continue;
    const cards = ((res.json as { data?: TcgCard[] }).data ?? []).filter((c) => c.name.toLowerCase() === name.toLowerCase());
    for (const w of ws) {
      const hits = cards.filter((c) => c.number === w.no);
      const foil = hits.filter((c) => /foil/i.test(c.variant ?? ""));
      const plain = hits.filter((c) => !/foil/i.test(c.variant ?? ""));
      const pick = (list: TcgCard[]) => {
        const raw = list.length === 1 ? list[0].prices?.raw?.near_mint?.tcgplayer : undefined;
        const v = raw?.market ?? raw?.mid;
        return v == null ? undefined : v.toFixed(2);
      };
      const usd = pick(plain);
      const usdFoil = pick(foil);
      if (!usd && !usdFoil) continue;
      priceStore.prices[w.id] = { ...priceStore.prices[w.id], ...(usd ? { usd } : {}), ...(usdFoil ? { usd_foil: usdFoil } : {}) };
      filled++;
    }
  }
  new Notice(`TCG Price Lookup で取れた価格: ${filled} / ${wanted.length} 件${stopped ? ` (${stopped})` : ""}`);
}
