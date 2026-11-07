import { Action, manaOnly, slotsOf, tryWithMana } from "./actions";
import { activatedAbilities, characteristics } from "./continuous";
import { cpuAttack, cpuBlock, tapFor } from "./cpu";
import { BuiltDeck, buildMatch } from "./deckToGame";
import { RuleError, activateAbility, activateFromGraveyard, activateFromHand, attackersAt, castSpell, graveyardAbilitiesOf, handAbilitiesOf, passPriority, playLand } from "./engine";
import { NeedInput, makeDecider } from "./input";
import { CastRecord } from "./node";
import { Game, GameCard, PlayerId, RuleBook } from "./state";

// CPU 同士の自動対戦 (デバッグ用)。画面も API も使わず、エンジンだけで、たくさん回して、不具合を拾う。
// 拾うもの: 例外 / 「使える」と判定したのに、実行すると失敗する (判定と実行の食い違い) / カードの増減・二重 / 数値の異常 / 止まって進まない / ログの「未実装」など。
// 動きは、使える行動の中から、乱数 (種つき) で選ぶ。だから、同じ種なら、同じ試合になる。賢さは要らない (いろいろなカードを動かすのが目的)

export interface Issue {
  kind: string; // crash / mismatch / conservation / invalid / stuck / log
  message: string;
  count: number;
  example: { game: number; seed: number; turn: number; step: string; log: string[] };
}

export interface SelfPlayReport {
  games: number;
  finished: number; // 勝敗がついた試合
  turnLimit: number; // ターン上限で打ち切った試合
  ends: Record<string, number>; // 終わり方 (ライフ / 山札切れ / 引き分け / ターン上限)
  wins: Record<string, number>; // デッキ名 → 勝った試合
  avgTurns: number;
  issues: Issue[];
  used: Record<string, { deck: string; cast: number; land: number; ability: number; trigger: number; entered: number }>; // カード名 → 動いた回数
  neverUsed: Record<string, string[]>; // デッキ名 → 一度も動かなかったカード (唱えない・出さない・能力も動かない)
  seconds: number;
}

export interface SelfPlayOptions {
  games: number;
  seed?: number;
  maxTurns?: number; // 1 試合のターン上限 (既定 30)
  maxSteps?: number; // 1 試合の優先権の回数の上限 (既定 4000。超えたら、止まったと見なす)
  stopOnIssues?: number; // この数を超える種類の不具合が出たら、打ち切る (既定 50)
}

// 種つきの乱数 (mulberry32)
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isLand = (c: GameCard) => /\bLand\b/.test(c.typeLine);
const WINDOW_LIMIT = 14; // 1 回の優先権で、続けて動く回数の上限

interface Cand {
  act: Action;
  cast?: CastRecord;
  targets: Record<string, string>;
  name: string;
  kind: "land" | "cast" | "ability";
}

// 使える行動の一覧 (マナは、全部出せるとして判定する: 実行のときに、自動でタップする)
function candidates(g: Game, rules: RuleBook, p: PlayerId, rng: () => number): Cand[] {
  const out: Cand[] = [];
  const pick = (act: Action, cast?: CastRecord): Record<string, string> | undefined => {
    const slots = slotsOf(g, rules, p, act);
    if (slots.some((s) => s.legal.length < s.min)) return undefined;
    const t: Record<string, string> = {};
    for (const s of slots) {
      if (!s.legal.length) continue;
      const n = Math.max(s.min, rng() < 0.7 ? 1 : 0);
      const ids = [...s.legal].sort(() => rng() - 0.5).slice(0, Math.min(Math.max(n, s.min), s.max));
      if (ids.length) t[s.as] = ids.join(",");
    }
    return t;
  };
  const add = (name: string, kind: Cand["kind"], act: Action, cast?: CastRecord) => {
    const targets = pick(act, cast);
    if (!targets) return;
    if (tryWithMana(g, rules, p, act, targets, cast) === undefined) out.push({ act, cast, targets, name, kind });
  };
  for (const c of g.hands[p]) {
    if (isLand(c)) {
      add(c.name, "land", { kind: "land", card: c.id });
      continue;
    }
    const body = rules.get(c.name)?.abilities.find((a) => a.kind === "spell")?.body ?? [];
    const act: Action = { kind: "cast", card: c.id };
    const variants: (CastRecord | undefined)[] = [undefined];
    if (c.cost2) variants.splice(0, 1, { door: 1 }, { door: 2 }); // 部屋: どちらの扉も
    if (body.some((x) => x.node === "altCost")) variants.push({ alt: true });
    if (body.some((x) => x.node === "additionalCost" && x.args.flag === "kicked")) variants.push({ kicked: true });
    for (const v of variants) add(c.name, "cast", act, v);
    handAbilitiesOf(rules, c.name).forEach((_, index) => add(c.name, "ability", { kind: "handAbility", card: c.id, index }));
  }
  for (const perm of g.battlefield) {
    if (perm.controller !== p) continue;
    activatedAbilities(g, rules, perm).forEach((ab, index) => {
      if (manaOnly(ab.body)) return; // マナ能力は、払うとき自動で使う
      if ((g.activated?.[`${perm.id}:${index}`] ?? 0) >= 3) return; // 同じ能力を 1 ターンに何度も: 暴走防止 (AI と同じ上限)
      add(perm.card.name, "ability", { kind: "activate", perm: perm.id, index });
    });
  }
  for (const c of g.graveyards[p]) {
    graveyardAbilitiesOf(rules, c.name).forEach((_, index) => add(c.name, "ability", { kind: "yardAbility", card: c.id, index }));
    const decl = (rules.get(c.name)?.abilities ?? []).filter((a) => a.kind === "static").flatMap((a) => a.body).find((x) => x.node === "castFromGraveyard");
    if (decl) add(c.name, "cast", { kind: "yardCast", card: c.id }, decl.args.alt === true ? { alt: true } : undefined);
  }
  return out;
}

function perform(g: Game, rules: RuleBook, p: PlayerId, c: Cand): void {
  tapFor(g, rules, p, c.act, c.targets, c.cast);
  const a = c.act;
  if (a.kind === "land") playLand(g, p, a.card, rules);
  else if (a.kind === "cast") castSpell(g, p, a.card, c.targets, rules, c.cast);
  else if (a.kind === "yardCast") castSpell(g, p, a.card, c.targets, rules, { ...c.cast, from: "graveyard" });
  else if (a.kind === "handAbility") activateFromHand(g, p, a.card, a.index, c.targets, rules);
  else if (a.kind === "yardAbility") activateFromGraveyard(g, p, a.card, a.index, c.targets, rules);
  else activateAbility(g, p, a.perm, a.index, c.targets, rules);
}

// カードの総数・二重・数値の異常を調べる。問題があれば、理由の一覧
export function invariants(g: Game, initial: Set<string>, rules?: RuleBook): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  const see = (c: GameCard, zone: string) => {
    if (c.token) return;
    const was = seen.get(c.id);
    if (was) out.push(`同じカードが 2 つの場所にある: ${c.name} (${was} と ${zone})`);
    seen.set(c.id, zone);
  };
  for (const p of g.players) {
    g.libraries[p].forEach((c) => see(c, `${p}の山札`));
    g.hands[p].forEach((c) => see(c, `${p}の手札`));
    g.graveyards[p].forEach((c) => see(c, `${p}の墓地`));
    g.exile[p].forEach((c) => see(c, `${p}の追放`));
  }
  g.battlefield.forEach((x) => see(x.card, "戦場"));
  g.stack.forEach((s) => {
    if (!s.ability && !s.copy) see(s.card, "スタック");
  });
  for (const id of initial) if (!seen.has(id)) out.push(`カードが消えた: ${id}`);
  for (const [id, zone] of seen) if (!initial.has(id)) out.push(`知らないカードが現れた: ${id} (${zone})`);
  for (const p of g.players) {
    if (!Number.isFinite(g.life[p])) out.push(`ライフが数でない: ${p}`);
    if ((g.mana[p] ?? 0) < 0) out.push(`マナが負: ${p} (${g.mana[p]})`);
    for (const [k, n] of Object.entries(g.pool[p] ?? {})) if ((n ?? 0) < 0) out.push(`プールが負: ${p} ${k}`);
  }
  if (g.landsPlayed > 1) out.push(`1 ターンに土地を ${g.landsPlayed} 枚出している`);
  for (const x of g.battlefield) {
    // 死ぬはずのクリーチャーが、戦場に残っている (状況起因処理の取りこぼし)。スタックが空のときだけ見る
    if (rules && !g.stack.length) {
      const now = characteristics(g, x, rules);
      if (/\bCreature\b/.test(now.typeLine) && now.toughness !== null && now.toughness <= 0) out.push(`タフネス 0 以下のクリーチャーが残っている: ${x.card.name}`);
    }
    if (x.counters) for (const [k, n] of Object.entries(x.counters)) if (!Number.isFinite(n) || n < 0) out.push(`カウンターが異常: ${x.card.name} ${k}=${n}`);
    if (x.damage !== undefined && !Number.isFinite(x.damage)) out.push(`ダメージが異常: ${x.card.name}`);
  }
  return out;
}

const BAD_LOG = /未実装|NaN|undefined|\[object/;

// onProgress があれば、1 試合ごとに、画面に処理を返す (画面が固まらないように)
export async function runSelfPlay(decks: [BuiltDeck, BuiltDeck], rules: RuleBook, opts: SelfPlayOptions, onProgress?: (done: number, total: number) => void): Promise<SelfPlayReport> {
  const started = Date.now();
  const maxTurns = opts.maxTurns ?? 30;
  const maxSteps = opts.maxSteps ?? 4000;
  const issues = new Map<string, Issue>();
  const used: SelfPlayReport["used"] = {};
  const wins: Record<string, number> = { [decks[0].name]: 0, [decks[1].name]: 0 };
  let finished = 0;
  let turnLimit = 0;
  const ends: Record<string, number> = {};
  let turns = 0;
  const use = (name: string, deck: string, key: "cast" | "land" | "ability" | "trigger" | "entered") => {
    const u = (used[name] ??= { deck, cast: 0, land: 0, ability: 0, trigger: 0, entered: 0 });
    u[key]++;
  };

  for (let i = 0; i < opts.games; i++) {
    const seed = (opts.seed ?? 1) * 1000 + i;
    const rng = seeded(seed);
    const swap = i % 2 === 1; // 先手・後手を交互に
    const [d0, d1] = swap ? [decks[1], decks[0]] : [decks[0], decks[1]];
    const deckOf: Record<string, string> = { you: d0.name, opp: d1.name };
    let g: Game;
    try {
      g = buildMatch(d0.data, d1.data, rules, rng);
    } catch (e) {
      record(issues, "crash", `対戦を始められない: ${(e as Error).message}`, i, seed, undefined);
      continue;
    }
    const base = makeDecider("", [], ["you", "opp"], rules);
    // 入力待ち (人への質問) は、既定の動きにする。自動対戦に、答える人はいない
    g.decide = new Proxy(base, {
      get: (t, k) => {
        const f = (t as unknown as Record<string, unknown>)[k as string];
        if (typeof f !== "function") return f;
        return (...a: unknown[]) => {
          try {
            return (f as (...x: unknown[]) => unknown).apply(t, a);
          } catch (e) {
            if (e instanceof NeedInput) return undefined;
            throw e;
          }
        };
      },
    });
    const initial = new Set<string>();
    for (const p of g.players) for (const z of [g.libraries[p], g.hands[p]]) z.forEach((c) => initial.add(c.id));
    const seenTriggers = new Set<string>();
    let steps = 0;
    let lastLog = 0;
    let bad = false;
    const note = (kind: string, message: string) => {
      bad = true;
      record(issues, kind, message, i, seed, g);
    };
    const check = () => {
      for (const m of invariants(g, initial, rules)) note("conservation", m);
      for (const l of g.log.slice(lastLog)) if (BAD_LOG.test(l)) note("log", l.length > 140 ? `${l.slice(0, 140)}…` : l);
      lastLog = g.log.length;
      for (const s of g.stack) if (s.ability && !seenTriggers.has(`${s.id}`)) {
        seenTriggers.add(`${s.id}`);
        use(s.card.name, deckOf[s.controller] ?? "", "trigger");
      }
    };
    const entered = new Set<string>();
    try {
      while (!g.over && g.priority && steps++ < maxSteps && g.turn <= maxTurns && !bad) {
        const p = g.priority;
        // 戦闘: 攻撃の宣言とブロック (雑魚 CPU の決まり)
        if (g.step === "combat") {
          if (g.combatPhase === "attackers" && g.active === p && !g.attackersDeclared) cpuAttack(g, rules, p);
          if (g.combatPhase === "blockers") for (const d of g.players) if (d !== g.active && attackersAt(g, d).length && !g.blockersDeclared?.includes(d)) cpuBlock(g, rules, d);
        }
        // 動く: 自分のメインフェイズ (スタックが空) では、たくさん。ほかでは、ときどき (インスタントなど)
        const main = p === g.active && (g.step === "main1" || g.step === "main2") && g.stack.length === 0;
        if (main || rng() < 0.25) {
          for (let k = 0; k < WINDOW_LIMIT && !g.over; k++) {
            const cs = candidates(g, rules, p, rng);
            if (!cs.length || (!main && rng() < 0.5) || rng() < 0.08) break;
            const lands = cs.filter((c) => c.kind === "land");
            const c = lands.length && rng() < 0.9 ? lands[Math.floor(rng() * lands.length)] : cs[Math.floor(rng() * cs.length)];
            try {
              perform(g, rules, p, c);
              use(c.name, deckOf[p] ?? "", c.kind === "land" ? "land" : c.kind === "cast" ? "cast" : "ability");
            } catch (e) {
              if (e instanceof RuleError) note("mismatch", `「使える」と判定したのに、実行すると失敗した: ${c.name} (${c.act.kind}${c.cast ? ` ${JSON.stringify(c.cast)}` : ""}): ${e.message}`);
              else throw e;
              break;
            }
            check();
            if (bad) break;
          }
        }
        for (const x of g.battlefield) if (!entered.has(x.id)) {
          entered.add(x.id);
          use(x.card.name, deckOf[x.controller] ?? "", "entered");
        }
        if (bad || g.over) break;
        passPriority(g, g.priority!, rules);
        check();
      }
    } catch (e) {
      note("crash", `例外: ${(e as Error).message.split("\n")[0]} @ ${(((e as Error).stack ?? "").split("\n")[1] ?? "").trim().slice(0, 100)}`);
    }
    if (!g.over && !bad && steps > maxSteps) note("stuck", `優先権が ${maxSteps} 回回っても、終わらない (ターン ${g.turn} ${g.step})`);
    if (g.over) {
      finished++;
      const w = g.over.winner;
      if (w) wins[deckOf[w]] = (wins[deckOf[w]] ?? 0) + 1;
      const loser = g.players.find((q) => q !== w);
      const why = !w ? "引き分け" : loser && g.life[loser] <= 0 ? "ライフ 0" : loser && g.drewEmpty.includes(loser) ? "山札切れ" : "その他";
      ends[why] = (ends[why] ?? 0) + 1;
    } else if (g.turn > maxTurns) {
      turnLimit++;
      ends["ターン上限"] = (ends["ターン上限"] ?? 0) + 1;
    }
    turns += g.turn;
    if (onProgress) {
      onProgress(i + 1, opts.games);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (issues.size > (opts.stopOnIssues ?? 50)) break;
  }

  const neverUsed: Record<string, string[]> = {};
  for (const d of decks) {
    neverUsed[d.name] = [...new Set(d.data.main.map((e) => e.key))].filter((k) => {
      const u = used[k];
      return !u || (u.cast + u.land + u.ability + u.trigger + u.entered === 0);
    });
  }
  return { games: opts.games, finished, turnLimit, ends, wins, avgTurns: opts.games ? turns / opts.games : 0, issues: [...issues.values()].sort((a, b) => b.count - a.count), used, neverUsed, seconds: (Date.now() - started) / 1000 };
}

function record(issues: Map<string, Issue>, kind: string, message: string, game: number, seed: number, g: Game | undefined) {
  const key = `${kind}|${message.replace(/\d+/g, "N")}`;
  const hit = issues.get(key);
  if (hit) return void hit.count++;
  issues.set(key, { kind, message, count: 1, example: { game, seed, turn: g?.turn ?? 0, step: g?.step ?? "", log: g ? g.log.slice(-10) : [] } });
}

const KIND_JA: Record<string, string> = { crash: "例外", mismatch: "判定と実行の食い違い", conservation: "カードの増減・数値の異常", stuck: "止まって進まない", log: "ログの異常" };

// 結果を、読める文章 (md) にする
export function reportMarkdown(r: SelfPlayReport, names: [string, string]): string {
  const lines: string[] = ["---", "mtg: selfplay", "---", "", `# CPU 同士の自動対戦 (${names[0]} vs ${names[1]})`, ""];
  lines.push(`- 試合数 ${r.games} / 勝敗がついた ${r.finished} / ターン上限で打ち切り ${r.turnLimit} / 平均ターン ${r.avgTurns.toFixed(1)} / ${r.seconds.toFixed(1)} 秒`);
  lines.push(`- 勝ち: ${Object.entries(r.wins).map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  lines.push(`- 終わり方: ${Object.entries(r.ends).map(([k, v]) => `${k} ${v}`).join(" / ") || "なし"} (山札切れが多いときは、引く・切削のルールを疑う)`);
  lines.push("", "CPU は、使える行動を、乱数で選んでいます。勝敗の強さの比較には、使えません。目的は、いろいろなカードを動かして、不具合を見つけることです。", "");
  lines.push(`## 不具合の候補 (${r.issues.length} 種類)`, "");
  if (!r.issues.length) lines.push("見つかりませんでした。", "");
  for (const is of r.issues) {
    lines.push(`### ${KIND_JA[is.kind] ?? is.kind} ×${is.count}`, "", is.message, "", `例: 試合 ${is.example.game} (種 ${is.example.seed}) ターン ${is.example.turn} ${is.example.step}`, "", "```", ...is.example.log, "```", "");
  }
  lines.push("## 一度も動かなかったカード", "");
  for (const [d, cs] of Object.entries(r.neverUsed)) lines.push(`- ${d}: ${cs.length ? cs.join("、") : "なし"}`);
  lines.push("", "## 動いたカード (回数: 唱える / 出す / 能力 / 誘発 / 戦場に出た)", "");
  for (const [name, u] of Object.entries(r.used).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`- ${name} (${u.deck}): ${u.cast} / ${u.land} / ${u.ability} / ${u.trigger} / ${u.entered}`);
  return `${lines.join("\n")}\n`;
}
