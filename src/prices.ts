import { requestUrl } from "obsidian";

interface Prices {
  usd?: string | null;
  usd_foil?: string | null;
  usd_etched?: string | null;
}

// 画面を開いている間だけ覚える。ノートには保存しない
const cache = new Map<string, Prices>();

// 1回75件まで。取れなかった id は価格なし扱い
export async function fetchPrices(ids: string[]) {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id));
  for (let i = 0; i < missing.length; i += 75) {
    const res = await requestUrl({
      url: "https://api.scryfall.com/cards/collection",
      method: "POST",
      contentType: "application/json",
      headers: { "User-Agent": "magictheobsidian/0.3.0", Accept: "application/json" },
      body: JSON.stringify({ identifiers: missing.slice(i, i + 75).map((id) => ({ id })) }),
      throw: false,
    });
    if (res.status !== 200) continue;
    for (const c of res.json.data) cache.set(c.id, c.prices ?? {});
  }
}

// shortcut: 状態 (NM/LP…) による値引きはしない。必要になったら係数を設定に足す
export function priceOf(id: string, foil: boolean): number | undefined {
  const p = cache.get(id);
  const v = foil ? p?.usd_foil ?? p?.usd_etched ?? p?.usd : p?.usd;
  return v ? Number(v) : undefined;
}
