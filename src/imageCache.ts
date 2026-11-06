import { App, requestUrl } from "obsidian";
import { ImageMode, cacheable, imageKey } from "./imageKey";

// カード画像のローカル保存。保存先は、プラグイン自身のフォルダの中 (.obsidian/plugins/<id>/cache/images/)。
// Vault の外 (設定のフォルダ) なので、ノートからは参照されず、Obsidian の一覧・検索・同期の対象にならない。
// 画像は、読み込むときに、保存済みならその画像 (メモリの blob URL) を使い、無ければ Scryfall から読み込みつつ、保存する (設定 view / preload)。
// shortcut: 容量の上限は持たない。大きくなったら、設定の「消す」で消す (消しても、見るときに、また保存される)

const CONCURRENCY = 3; // 同時にダウンロードする数 (Scryfall の負荷配慮)

let app: App;
let dir = "";
let mode: () => ImageMode = () => "off";
const blobs = new Map<string, string>(); // ファイル名 → blob URL (この起動のあいだだけ)
const pending = new Map<string, Promise<void>>(); // ダウンロード中 (同じ画像を二重に取らない)
let running = 0;
const queue: (() => void)[] = [];

// pluginDir = this.manifest.dir (例: .obsidian/plugins/magictheobsidian)
export function initImageCache(a: App, pluginDir: string, getMode: () => ImageMode) {
  app = a;
  dir = `${pluginDir}/cache/images`;
  mode = getMode;
}

const path = (key: string) => `${dir}/${key}`;

async function ensureDir() {
  const ad = app.vault.adapter;
  let cur = "";
  for (const seg of dir.split("/")) {
    cur = cur ? `${cur}/${seg}` : seg;
    if (!(await ad.exists(cur))) await ad.mkdir(cur);
  }
}

async function blobOf(key: string): Promise<string | undefined> {
  const known = blobs.get(key);
  if (known) return known;
  const ad = app.vault.adapter;
  if (!(await ad.exists(path(key)))) return undefined;
  const buf = await ad.readBinary(path(key));
  const url = URL.createObjectURL(new Blob([buf], { type: key.endsWith(".png") ? "image/png" : "image/jpeg" }));
  blobs.set(key, url);
  return url;
}

function slot<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const go = () => {
      running++;
      job().then(resolve, reject).finally(() => {
        running--;
        queue.shift()?.();
      });
    };
    running < CONCURRENCY ? go() : queue.push(go);
  });
}

// 画像を取って保存する (保存済みなら何もしない)。取れなかったら、静かに諦める (次に見るときに、また試す)
export function download(url: string): Promise<void> {
  if (!cacheable(url)) return Promise.resolve();
  const key = imageKey(url);
  const going = pending.get(key);
  if (going) return going;
  const p = slot(async () => {
    try {
      if (await app.vault.adapter.exists(path(key))) return;
      const res = await requestUrl({ url, throw: false });
      if (res.status !== 200) return;
      await ensureDir();
      await app.vault.adapter.writeBinary(path(key), res.arrayBuffer);
    } catch {
      /* 保存できなくても、画像は、通信で出る */
    }
  }).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

// 表示に使う URL。保存済みならその画像 (通信しない)、無ければ元の URL (設定が view / preload なら、読み込みと同時に保存を始める)
export async function localUrl(url: string | undefined): Promise<string | undefined> {
  if (!url || mode() === "off" || !cacheable(url) || !app) return url;
  try {
    const saved = await blobOf(imageKey(url));
    if (saved) return saved;
  } catch {
    return url;
  }
  void download(url);
  return url;
}

// img の画像を、保存済みのものにする (非同期)。同じ img に、あとから別の画像を頼んだら、古いほうは捨てる
export function setImg(img: HTMLImageElement | undefined, url: string | undefined): void {
  if (!img || !url) return;
  img.dataset.want = url;
  void localUrl(url).then((u) => {
    if (u && img.dataset.want === url) img.setAttribute("src", u);
  });
}

// CSS の url("…") に使う URL (背景など)
export const cssUrl = async (url: string | undefined): Promise<string | undefined> => localUrl(url);

// 保存済みの画像の数と大きさ (設定の表示用)
export async function cacheInfo(): Promise<{ files: number; bytes: number }> {
  const ad = app.vault.adapter;
  if (!(await ad.exists(dir))) return { files: 0, bytes: 0 };
  const { files } = await ad.list(dir);
  let bytes = 0;
  for (const f of files) bytes += (await ad.stat(f))?.size ?? 0;
  return { files: files.length, bytes };
}

// 保存した画像を、すべて消す。次に見るときに、また保存される
export async function clearImageCache(): Promise<number> {
  const ad = app.vault.adapter;
  if (!(await ad.exists(dir))) return 0;
  const { files } = await ad.list(dir);
  for (const f of files) await ad.remove(f);
  for (const u of blobs.values()) URL.revokeObjectURL(u);
  blobs.clear();
  return files.length;
}

// 先読み: 渡された URL を、順に保存する (保存済みは飛ばす)。progress = 何個終わったか
export async function preload(urls: string[], progress?: (done: number, total: number) => void): Promise<void> {
  const list = [...new Set(urls.filter(cacheable))];
  let done = 0;
  await Promise.all(list.map((u) => download(u).finally(() => progress?.(++done, list.length))));
}
