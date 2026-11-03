import { App, normalizePath } from "obsidian";
import { entryById } from "./typecatalog";

// 実装待ち: 今の関数 (型) では書けない処理。AI が「こういう関数が要る」という仕様を書いて、ここに保存する。
// 関数が実装されて、待っている型 (waitFor) が「未実装」でなくなったら、元のカードの記録の更新案を作れる。
export interface NeedSpec {
  name: string; // 関数の名前 (英語)
  title: string; // 日本語の名前
  description: string; // どう動くか
  inputs: string; // 受け取るもの
  state: string; // 必要なゲームの状態 (例: トークン、カウンター)
  waitFor: string[]; // 待っている型の id (カタログの todo.* など)。無ければ、新しい id (todo.名前)
}

export interface PendingItem {
  id: string;
  key: string; // カードの key
  instruction: string; // あなたが書いた処理 (原文)
  needs: NeedSpec[];
  created: string;
  status: "waiting" | "done";
  proposal?: { abilities: unknown[]; raw: unknown[]; unsupported: string[]; macros: unknown[]; needs: unknown[]; errors: string[]; cost: number }; // 実装後に自動で作った更新案 (確認して保存する)
}

let base = "";
export function initPendingStore(manifestDir: string) {
  base = normalizePath(`${manifestDir}/rulebook/pending.json`);
}

export async function readPending(app: App): Promise<PendingItem[]> {
  if (!(await app.vault.adapter.exists(base))) return [];
  try {
    return JSON.parse(await app.vault.adapter.read(base));
  } catch {
    return [];
  }
}

export async function writePending(app: App, items: PendingItem[]) {
  const dir = normalizePath(`${base}/..`);
  if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
  await app.vault.adapter.write(base, JSON.stringify(items, null, 1));
}

// 待っている型が全部、実装済み (または一部) になったか
export const isReady = (p: PendingItem) => p.status === "waiting" && p.needs.length > 0 && p.needs.every((n) => n.waitFor.length > 0 && n.waitFor.every((id) => !!entryById(id) && entryById(id)!.status !== "planned"));

export function newPendingId() {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
