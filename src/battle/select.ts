import { CardStatus, NO_NODES, NO_RULE, Status } from "./coverage";

// 「Battle: build rules with AI」の画面に出す行と、初期のチェック
export interface Row {
  card: string;
  hasRule: boolean; // ノードを設定したルールがある (壊れていても true。ノートが無い・ノードが未設定は false)。チェックして実行すると、あれば上書きになる
  status: Status | "none"; // none = ルールのノートが無い
  unsupported?: boolean; // ノードはあるが、## 未対応 が残っている (ルールなし扱い。新しいノードで組めるようになったかもしれないので、頼み直せる)
}

export function toRows(cards: string[], statuses: Map<string, CardStatus>): Row[] {
  return [...cards]
    .sort((a, b) => a.localeCompare(b))
    .map((card) => {
      const s = statuses.get(card);
      const unsupported = s?.status === "partial" && s.reasons.some((r) => r.startsWith("未対応: ")); // ノードがあっても、## 未対応 が残っている
      const none = !s || s.reasons[0] === NO_RULE || s.reasons[0] === NO_NODES || unsupported; // ノートが無い・ノードが未設定・未対応が残っているものは、「ルールなし」
      return { card, hasRule: !none, status: none ? "none" : s!.status, ...(unsupported ? { unsupported } : {}) };
    });
}

// 初期のチェックは、ルールなし (ノートが無い・ノードが未設定・未対応が残っている) のカード
export const initialChecked = (rows: Row[]): Set<string> => new Set(rows.filter((r) => !r.hasRule).map((r) => r.card));

export const filterRows = (rows: Row[], q: string): Row[] => rows.filter((r) => r.card.toLowerCase().includes(q.trim().toLowerCase()));

// 「表示中をチェック / 外す」: 絞り込みで見えている行だけを変える。見えていない行のチェックは保持する
export function setShown(checked: Set<string>, rows: Row[], q: string, on: boolean): Set<string> {
  const next = new Set(checked);
  for (const r of filterRows(rows, q)) {
    if (on) next.add(r.card);
    else next.delete(r.card);
  }
  return next;
}

// 実行すると上書きになる枚数 (ルールがあるカードがチェックされている数)
export const overwriteCount = (rows: Row[], checked: Set<string>): number => rows.filter((r) => r.hasRule && checked.has(r.card)).length;

// 実行できなければ理由、できれば null。裁定後のテキストは1枚だけ選んだときに送れる (複数枚に同じ裁定を送ると、別のカードに誤って効くため)
export function runCheck(count: number, ruling: string): string | null {
  if (count === 0) return "カードを選んでください";
  if (ruling.trim() && count !== 1) return `裁定後のテキストは、1枚だけ選んだときに送れる(いま ${count} 枚)`;
  return null;
}
