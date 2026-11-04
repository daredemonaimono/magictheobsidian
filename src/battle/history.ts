// ルールの履歴: Rules/_backup/<カード名>/<日時>-<種類>.md に、書き換わる前の内容を、版ごとに1ファイルで残す
export type Kind = "ai" | "edit" | "restore"; // AI が作り替える前 / 手で直す前 / 版を戻す前
export const KIND_LABEL: Record<Kind, string> = { ai: "AI が作り替える前", edit: "手で直す前", restore: "版を戻す前" };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const stampOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export const versionName = (d: Date, kind: Kind): string => `${stampOf(d)}-${kind}.md`;

// 同じ秒にもう1つできるときは、-2, -3 ... を付けて空いている名前にする
export function freeName(d: Date, kind: Kind, existing: Set<string>): string {
  let name = versionName(d, kind);
  for (let n = 2; existing.has(name); n++) name = `${stampOf(d)}-${kind}-${n}.md`;
  return name;
}

const VERSION = /^(\d{4}-\d{2}-\d{2}-\d{6})-(ai|edit|restore)(?:-(\d+))?\.md$/;
export function parseVersion(file: string): { stamp: string; kind: Kind } | null {
  const m = file.match(VERSION);
  return m ? { stamp: m[1], kind: m[2] as Kind } : null;
}

// 新しい順。履歴でないファイルは入れない
export function sortNewestFirst(files: string[]): string[] {
  const key = (f: string) => {
    const m = f.match(VERSION)!;
    return m[1] + "-" + pad(Number(m[3] ?? 1), 6);
  };
  return files.filter((f) => VERSION.test(f)).sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}

// 手で直したときの版のまとめ方: 連続した編集 (最後の編集から gap ミリ秒以上あかない間) は1つの編集として扱い、最初の1回だけ true
export class EditSessions {
  private last = new Map<string, number>();
  constructor(private gap: number) {}
  note(card: string, now: number): boolean {
    const prev = this.last.get(card);
    this.last.set(card, now);
    return prev === undefined || now - prev >= this.gap;
  }
  // AI の作り替えや版を戻したあとは、まとめを切る
  reset(card: string): void {
    this.last.delete(card);
  }
}
