import { requestUrl } from "obsidian";

// MTG Wiki (日本語のカード情報)。MediaWiki なので API でページを引ける。ページ名は「日本語名/英語名」
// (日本語版が無いカードは英語名だけ)。テキストは取らず、ページの URL を返して開くだけ
const API = "https://mtgwiki.com/api.php";
const WIKI = "https://mtgwiki.com/wiki/";

const front = (s: string) => s.split(" // ")[0]; // 両面カードは表面の名前
const pageUrl = (title: string) => WIKI + encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/");

async function api(params: Record<string, string>) {
  const res = await requestUrl({ url: `${API}?${new URLSearchParams({ format: "json", ...params })}`, throw: false });
  if (res.status !== 200) throw new Error(`MTG Wiki HTTP ${res.status}`);
  return res.json;
}

// 1) 日本語名/英語名、2) 英語名 の順でページを探す。無ければ検索の先頭、それも無ければ検索ページ
export async function wikiUrl(name: string, ja?: string): Promise<string> {
  const en = front(name);
  const candidates = [ja ? `${front(ja)}/${en}` : "", en].filter(Boolean);

  const r = await api({ action: "query", redirects: "1", titles: candidates.join("|") });
  const hop = new Map<string, string>(); // 正規化・リダイレクトでページ名が変わる分
  for (const x of [...(r.query.normalized ?? []), ...(r.query.redirects ?? [])]) hop.set(x.from, x.to);
  const found = new Set<string>(Object.values<{ title: string; missing?: string }>(r.query.pages).filter((p) => !("missing" in p)).map((p) => p.title));
  for (const c of candidates) {
    let t = c;
    for (let i = 0; i < 3 && hop.has(t); i++) t = hop.get(t)!;
    if (found.has(t)) return pageUrl(t);
  }

  const s = await api({ action: "query", list: "search", srsearch: en, srlimit: "1" });
  const hit: string | undefined = s.query?.search?.[0]?.title;
  return hit ? pageUrl(hit) : `https://mtgwiki.com/index.php?search=${encodeURIComponent(en)}`;
}
