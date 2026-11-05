// 戦闘ダメージの割り振りの、計算 (画面の「ブロッカーのカードをクリックして増減」が使う。純粋な関数)
export interface AssignShape {
  power: number;
  trample: boolean;
  blockers: { id: string; lethal: number }[]; // 宣言の順
}
type Vals = Record<string, number>;

const sum = (v: Vals) => Object.values(v).reduce((a, n) => a + n, 0);

// id のブロッカーに、ダメージを +1 (d=1) / −1 (d=-1) する。トランプルなしは、合計を保つ: +1 は、ほかのいちばん多いブロッカーから 1 つ取り、−1 は、ほかの先頭のブロッカーに 1 つ渡す。トランプルは、残り (相手プレイヤーへ) とのやりとり
export function bump(s: AssignShape, vals: Vals, id: string, d: 1 | -1): Vals {
  const v = { ...vals };
  if (!(id in v)) return v;
  if (d === 1) {
    if (s.trample && s.power - sum(v) > 0) v[id]++;
    else {
      const others = s.blockers.filter((b) => b.id !== id && v[b.id] > 0);
      if (!others.length) return v;
      const donor = others.reduce((a, b) => (v[b.id] >= v[a.id] ? b : a)); // いちばん多い (同じなら、あと)
      v[donor.id]--;
      v[id]++;
    }
  } else {
    if (v[id] <= 0) return v;
    v[id]--;
    if (!s.trample) {
      const recv = s.blockers.find((b) => b.id !== id);
      if (recv) v[recv.id]++;
    }
  }
  return v;
}

// id のブロッカーに、致死ダメージを先に割り振り、残りは、宣言の順に致死ダメージ (トランプルなしは、残りを、最後のブロッカーに全部)
export function focus(s: AssignShape, id: string): Vals {
  const v: Vals = Object.fromEntries(s.blockers.map((b) => [b.id, 0]));
  let rest = s.power;
  const order = [...s.blockers.filter((b) => b.id === id), ...s.blockers.filter((b) => b.id !== id)];
  for (const b of order) {
    const n = Math.min(rest, b.lethal);
    v[b.id] = n;
    rest -= n;
  }
  if (rest > 0 && !s.trample) v[s.blockers[s.blockers.length - 1].id] += rest;
  return v;
}
