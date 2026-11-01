import { App, Notice, requestUrl } from "obsidian";
import { printingOf } from "./cards";
import { loadCollection } from "./collection";
import { fetchCollection } from "./scryfall";

export interface Prices {
  usd?: string | null;
  usd_foil?: string | null;
  usd_etched?: string | null;
  eur?: string | null;
  eur_foil?: string | null;
}

export const CURRENCIES: Record<string, string> = { USD: "USD ($)", EUR: "EUR (€)", JPY: "JPY (¥)", GBP: "GBP (£)", CAD: "CAD", AUD: "AUD", CNY: "CNY", KRW: "KRW" };

// 価格は手動更新だけ (勝手に API を呼ばない)。取得結果は data.json に保存して次回起動でも使う
export const priceStore = {
  prices: {} as Record<string, Prices>,
  updated: "", // ISO 日時。空 = 未取得
  rates: {} as Record<string, number>, // 1 EUR あたりの為替レート (Frankfurter)
  save: async () => {},
};

// 為替レートを取る (価格の更新と、通貨を変えたときだけ)
export async function updateRates() {
  const res = await requestUrl({ url: `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${Object.keys(CURRENCIES).filter((c) => c !== "EUR").join(",")}` });
  priceStore.rates = (res.json as { rates: Record<string, number> }).rates;
  await priceStore.save();
}

// 所持している版の価格を Scryfall から取り直す。1回75件まで。戻り値は更新した件数
export async function updateCollectionPrices(app: App): Promise<number> {
  const ids = new Set<string>();
  for (const r of (await loadCollection(app)).values()) {
    const p = await printingOf(app, r.card, r.print);
    if (p) ids.add(p.id);
  }
  const { data, failed } = await fetchCollection([...ids]);
  for (const c of data) priceStore.prices[c.id] = c.prices ?? {};
  priceStore.updated = new Date().toISOString();
  await priceStore.save();
  await updateRates().catch(() => new Notice("為替レートを取れなかった (前回のレートを使う)"));
  if (failed) throw new Error(`${failed} 回の取得に失敗 (取れた分だけ更新した)`);
  return ids.size;
}

const rateOf = (cur: string) => (cur === "EUR" ? 1 : priceStore.rates[cur]);
const convert = (v: number, from: string, to: string) => {
  if (from === to) return v;
  const a = rateOf(from);
  const b = rateOf(to);
  return a && b ? (v / a) * b : undefined;
};

// 設定した通貨での価格。Scryfall の USD (TCGplayer) があればそれ、無ければ EUR (Cardmarket) を換算する
// shortcut: 状態 (NM/LP…) による値引きはしない。必要になったら係数を設定に足す
export function priceOf(id: string, foil: boolean, currency = "USD"): number | undefined {
  const p = priceStore.prices[id];
  const usd = foil ? p?.usd_foil ?? p?.usd_etched ?? p?.usd : p?.usd;
  if (usd) return convert(Number(usd), "USD", currency);
  const eur = foil ? p?.eur_foil ?? p?.eur : p?.eur;
  return eur ? convert(Number(eur), "EUR", currency) : undefined;
}

export const formatPrice = (v: number | undefined, currency: string) =>
  v === undefined ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(v);
