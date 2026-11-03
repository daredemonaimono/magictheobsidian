// テスト用の obsidian の代わり。使うのは requestUrl だけ (fetch で実際に問い合わせる)
export async function requestUrl(o: { url: string; method?: string; body?: string; contentType?: string; headers?: Record<string, string> }) {
  const res = await fetch(o.url, {
    method: o.method ?? "GET",
    body: o.body,
    headers: { ...(o.headers ?? {}), ...(o.contentType ? { "Content-Type": o.contentType } : {}) },
  });
  return { status: res.status, json: await res.json() };
}

// 純粋な関数のテストで、型や名前だけ必要な分 (実際には使わない)
export class TFile {}
export const normalizePath = (p: string) => p;
export const parseYaml = (s: string) => s;
export class TFolder {}
