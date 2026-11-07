import { cardRoles } from "./roles";
import { Game, PlayerId, RuleBook } from "./state";

// Dredge の判断材料: デッキの内訳 (ライブラリーに残っているカードの枚数。順番は使わない) から、上から N 枚を墓地に置いたとき、何が落ちるかの確率を計算する。
// カード名・デッキ固有の指定は使わない。ノードの役割だけから、カードの働きを決める:
//   payoff = 落とすと得 (ライブラリーから墓地に置かれたときに働く誘発: Narcomoeba・Creeping Chill) / lossy = 落とすと困る (墓地では使えない、マナ以外の起動型能力: Bazaar of Baghdad) / neutral = どちらでもない
export type MillRole = "payoff" | "lossy" | "neutral";

export function millRole(rules: RuleBook, cardName: string): MillRole {
  const r = cardRoles(rules, cardName);
  if (r.all.includes("millPayoff")) return "payoff";
  if (r.all.includes("graveyardValue")) return "neutral"; // 墓地で働く (取り戻せる・墓地から使える)
  return r.activated.some((ab) => ab.some((x) => x !== "mana")) ? "lossy" : "neutral";
}

export interface DredgeEval {
  n: number;
  library: number;
  payoff: number; // ライブラリーにある、落とすと得のカードの枚数
  lossy: number; // 落とすと困るカードの枚数
  pPayoff: number; // 上から n 枚に、少なくとも 1 枚落ちる確率
  pLossy: number;
  expPayoff: number; // 落ちる期待枚数
  expLossy: number;
}

// K 枚入った L 枚の山から、n 枚引いて、少なくとも 1 枚が K 枚のどれかである確率 (超幾何分布)
const atLeastOne = (k: number, l: number, n: number): number => {
  if (k <= 0 || l <= 0) return 0;
  if (l - k < n) return 1;
  let none = 1;
  for (let i = 0; i < n; i++) none *= (l - k - i) / (l - i);
  return 1 - none;
};

export function evalDredge(g: Game, rules: RuleBook, p: PlayerId, n: number): DredgeEval {
  const lib = g.libraries[p];
  const roles = new Map<string, MillRole>();
  const count = (role: MillRole) => lib.filter((c) => (roles.get(c.name) ?? (roles.set(c.name, millRole(rules, c.name)), roles.get(c.name))) === role).length;
  const payoff = count("payoff");
  const lossy = count("lossy");
  return { n, library: lib.length, payoff, lossy, pPayoff: atLeastOne(payoff, lib.length, n), pLossy: atLeastOne(lossy, lib.length, n), expPayoff: lib.length ? (payoff * n) / lib.length : 0, expLossy: lib.length ? (lossy * n) / lib.length : 0 };
}

// 判定 (機械的): yes = する (困るカードが無く、得が見込める) / no = しない (困るカードが落ちやすく、得が見込めない) / ask = 迷う (AI に、数字つきで聞く)
export function dredgeVerdict(e: DredgeEval): "yes" | "no" | "ask" {
  if (e.lossy > 0 && e.expPayoff < 0.5 && e.pLossy >= 0.3) return "no";
  if (e.lossy === 0 && e.expPayoff >= 0.5) return "yes";
  return "ask";
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
export function dredgeNote(e: DredgeEval): string {
  return `Dredge ${e.n} の見込み (ライブラリー ${e.library} 枚の内訳から計算): 上から ${e.n} 枚を墓地に置く。落とすと得のカード (ライブラリーから墓地に置かれたときに働く): ${e.payoff} 枚入っていて、少なくとも 1 枚落ちる確率 ${pct(e.pPayoff)}・期待 ${e.expPayoff.toFixed(1)} 枚。落とすと困るカード (墓地では使えない起動型能力を持つ): ${e.lossy} 枚入っていて、少なくとも 1 枚落ちる確率 ${pct(e.pLossy)}・期待 ${e.expLossy.toFixed(1)} 枚。`;
}
