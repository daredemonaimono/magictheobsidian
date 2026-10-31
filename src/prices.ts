import { App, requestUrl } from "obsidian";
import { printingOf } from "./cards";
import { loadCollection } from "./collection";

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
export async function updateCollectionPrices(app: App): Promise<number> {
  const ids = new Set<string>();
  for (const r of (await loadCollection(app)).values()) {
    const p = await printingOf(app, r.card, r.print);
    if (p) ids.add(p.id);
  }
  const all = [...ids];
  let failed = 0;
  for (let i = 0; i < all.length; i += 75) {
    if (i) await new Promise((r) => setTimeout(r, 100)); // Scryfall の負荷配慮
    const res = await requestUrl({
      url: "https://api.scryfall.com/cards/collection",
      method: "POST",
      contentType: "application/json",
      headers: { "User-Agent": "magictheobsidian/0.3.1", Accept: "application/json" },
      body: JSON.stringify({ identifiers: all.slice(i, i + 75).map((id) => ({ id })) }),
      throw: false,
    });
    if (res.status !== 200) {
      failed++;
      continue;
    }
    for (const c of res.json.data) priceStore.prices[c.id] = c.prices ?? {};
  }
  priceStore.updated = new Date().toISOString();
  await priceStore.save();
  if (failed) throw new Error(`${failed} 回の取得に失敗 (取れた分だけ更新した)`);
  return all.length;
}

// shortcut: 状態 (NM/LP…) による値引きはしない。必要になったら係数を設定に足す
export function priceOf(id: string, foil: boolean): number | undefined {
  const p = priceStore.prices[id];
  const v = foil ? p?.usd_foil ?? p?.usd_etched ?? p?.usd : p?.usd;
  return v ? Number(v) : undefined;
}
