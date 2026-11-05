import { Game, GameCard, ManaColor, PlayerId, Pool, PoolKey, typeIn } from "./state";

// マナコスト ("{2}{U}{U}") の読み取りと、マナの支払い。
// マナの持ち方 (Game): mana = 使えるマナの合計 / pool = そのうち色のついたもの (W U B R G と、好きな色 A)。合計から pool を引いた残りは、無色のマナ。
// 制限つきのマナ (restrictedMana) は、合計には入らない、別の持ち物。

export interface HybridOption {
  color?: ManaColor | "C";
  generic?: number;
}
export interface ManaCost {
  generic: number;
  colors: Partial<Record<ManaColor | "C", number>>;
  hybrid: HybridOption[][]; // 混成マナ。どれか1つの選択肢で払う
  text: string;
}

const COLORS = ["W", "U", "B", "R", "G"];
export const emptyCost = (): ManaCost => ({ generic: 0, colors: {}, hybrid: [], text: "" });

// 読めない形は Error (マナコストの形が違う)。{X} は 0、{S} (氷雪) は無色1点として読む。{W/P} (ファイレクシア) は、色のマナ1点として読む (ライフでは払えない)
export function parseManaCost(s: string): ManaCost {
  const out = emptyCost();
  out.text = s;
  if (!s.trim()) return out;
  if (!/^(\{[^{}]+\})+$/.test(s)) throw new Error(`マナコストの形が違う: ${s} (例: {1}{U}{U})`);
  for (const [, body] of s.matchAll(/\{([^{}]+)\}/g)) {
    const parts = body.split("/");
    const sym = (x: string): HybridOption => {
      if (/^\d+$/.test(x)) return { generic: Number(x) };
      if (COLORS.includes(x) || x === "C") return { color: x as ManaColor | "C" };
      throw new Error(`マナコストの形が違う: {${body}}`);
    };
    if (parts.length === 1) {
      const x = parts[0];
      if (x === "X") continue;
      if (x === "S") out.generic += 1;
      else {
        const o = sym(x);
        if (o.generic !== undefined) out.generic += o.generic;
        else out.colors[o.color!] = (out.colors[o.color!] ?? 0) + 1;
      }
    } else if (parts.includes("P")) {
      const c = parts.find((x) => x !== "P")!;
      const o = sym(c);
      if (o.color) out.colors[o.color] = (out.colors[o.color] ?? 0) + 1;
      else throw new Error(`マナコストの形が違う: {${body}}`);
    } else out.hybrid.push(parts.map(sym));
  }
  return out;
}

export function addCosts(a: ManaCost, b: ManaCost): ManaCost {
  const colors = { ...a.colors };
  for (const [c, n] of Object.entries(b.colors)) colors[c as ManaColor | "C"] = (colors[c as ManaColor | "C"] ?? 0) + (n ?? 0);
  return { generic: a.generic + b.generic, colors, hybrid: [...a.hybrid, ...b.hybrid], text: a.text + b.text };
}

// メッセージ用: 汎用だけなら数、色があればマナコストの表記
export const describeCost = (c: ManaCost): string => (!Object.keys(c.colors).length && !c.hybrid.length ? String(c.generic) : c.text || `{${c.generic}}`);

// その呪文のコストに使える、制限つきマナ (その呪文の型に合うもの)
export const restrictedFor = (g: Game, p: PlayerId, spell?: GameCard) =>
  spell ? (g.restrictedMana[p] ?? []).filter((e) => (!e.type || typeIn(spell.typeLine, e.type)) && (!e.notType || !typeIn(spell.typeLine, e.notType))) : [];

interface Ledger {
  pool: Pool;
  colorless: number;
  restricted: number[]; // restrictedFor の並びごとの残り
}
const clone = (l: Ledger): Ledger => ({ pool: { ...l.pool }, colorless: l.colorless, restricted: [...l.restricted] });

// 払う。commit が偽なら、払えるかだけ調べて、状態は変えない。払えなければ偽 (状態は変えない)
// 順番: 色つきのシンボル (制限つき → 同じ色 → 好きな色) → 混成 → 汎用 (制限つき → 無色 → 好きな色 → 色つきの余り)
export function trySpend(g: Game, p: PlayerId, cost: ManaCost, spell: GameCard | undefined, commit: boolean): boolean {
  const entries = restrictedFor(g, p, spell);
  const start = g.pool[p] ?? {};
  const poolSum = Object.values(start).reduce((a, n) => a + (n ?? 0), 0);
  const colorlessAtStart = Math.max(0, (g.mana[p] ?? 0) - poolSum);
  let l: Ledger = { pool: { ...start }, colorless: colorlessAtStart, restricted: entries.map((e) => e.amount) };

  const takeRestricted = (match: (c?: PoolKey) => boolean): boolean => {
    const i = entries.findIndex((e, k) => l.restricted[k] > 0 && match(e.color));
    if (i < 0) return false;
    l.restricted[i]--;
    return true;
  };
  const takeColor = (c: ManaColor): boolean => {
    if (takeRestricted((x) => x === c)) return true;
    if ((l.pool[c] ?? 0) > 0) {
      l.pool[c]!--;
      return true;
    }
    if (takeRestricted((x) => x === "A")) return true; // 制限つきの好きな色は、自分の色つきマナのあと
    if ((l.pool.A ?? 0) > 0) {
      l.pool.A!--;
      return true;
    }
    const some = (Object.keys(l.pool) as PoolKey[]).find((k) => k.startsWith("A:") && k.includes(c) && (l.pool[k] ?? 0) > 0); // 「GWU のいずれか」のマナ
    if (some) {
      l.pool[some]!--;
      return true;
    }
    return false;
  };
  const takeColorless = (): boolean => {
    if (takeRestricted((x) => x === undefined)) return true;
    if (l.colorless > 0) {
      l.colorless--;
      return true;
    }
    return false;
  };
  const takeGeneric = (): boolean => {
    if (takeRestricted(() => true) || takeColorless()) return true;
    if ((l.pool.A ?? 0) > 0) {
      l.pool.A!--;
      return true;
    }
    const most = (Object.keys(l.pool) as PoolKey[]).filter((k) => (l.pool[k] ?? 0) > 0).sort((a, b) => (l.pool[b] ?? 0) - (l.pool[a] ?? 0))[0];
    if (!most) return false;
    l.pool[most]!--;
    return true;
  };
  const payOption = (o: HybridOption): boolean => {
    if (o.generic !== undefined) return Array.from({ length: o.generic }).every(() => takeGeneric());
    return o.color === "C" ? takeColorless() : takeColor(o.color as ManaColor);
  };

  for (const [c, n] of Object.entries(cost.colors)) for (let i = 0; i < (n ?? 0); i++) if (!payOption({ color: c as ManaColor | "C" })) return false;
  // 混成: 組み合わせを探す (選択肢ごとに試して、だめなら戻る)。色の選択肢を先に、汎用の選択肢を後に試す。最後に汎用を払うところまで通ったものを採る
  const groups = cost.hybrid.map((g2) => [...g2].sort((x, y) => (x.color ? 0 : 1) - (y.color ? 0 : 1)));
  const payRest = (i: number): boolean => {
    if (i === groups.length) {
      for (let k = 0; k < cost.generic; k++) if (!takeGeneric()) return false;
      return true;
    }
    for (const o of groups[i]) {
      const saved = l;
      l = clone(l);
      if (payOption(o) && payRest(i + 1)) return true;
      l = saved;
    }
    return false;
  };
  if (!payRest(0)) return false;

  if (commit) {
    const poolSumAfter = Object.values(l.pool).reduce((a, n) => a + (n ?? 0), 0);
    g.mana[p] = (g.mana[p] ?? 0) - (poolSum + colorlessAtStart - poolSumAfter - l.colorless);
    g.pool[p] = l.pool;
    entries.forEach((e, k) => (e.amount = l.restricted[k]));
    if (g.restrictedMana[p]) g.restrictedMana[p] = g.restrictedMana[p].filter((e) => e.amount > 0);
  }
  return true;
}

// 汎用の N 点だけ払う (「支払わないかぎり」など)。色つきのマナでも払える
export const spendGeneric = (g: Game, p: PlayerId, n: number, commit = true): boolean => trySpend(g, p, { ...emptyCost(), generic: n }, undefined, commit);
