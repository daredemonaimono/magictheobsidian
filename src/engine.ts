// 対戦エンジンの核 (Obsidian に依存しない)。2人対戦。
// 持つもの: ゾーン、ターンとステップ、優先権とスタック、マナの支払い、土地は1ターン1枚、戦闘 (飛行・速攻・警戒)、勝敗。
// 効果は effects.ts の書き方 (命令の並び) を、ここで機械的に実行する。記録の無い呪文は、唱えると墓地に行くだけ (ログに「効果は未実装」)。
// shortcut: マナの支払いは全探索に近い単純な割り当て。ソース20個を超えるデッキで重くなったら見直す。

export type Phase = "upkeep" | "draw" | "main1" | "beginCombat" | "attackers" | "blockers" | "damage" | "endCombat" | "main2" | "end";

// ---- 能力と効果 (カードごとの処理の記録。Bot/Rules/ のノートに JSON で保存され、エンジンが機械的に実行する) ----
// 書き方 (型・検証・日本語表示) は effects.ts にある
import { Ability, Amount, CardSel, Cond, PlayerSel, Selector, Step, TargetDef, Who, Zone, normalizeAbility } from "./effects";
export type { Ability, Step, Who };

export interface CardDef {
  key: string; // Cards/ のファイル名
  name: string;
  typeLine: string;
  manaCost: string;
  cmc: number;
  power: number;
  toughness: number;
  entersTapped: boolean; // 「戦闘領域に出るに際してタップ状態で出る」(条件なし) の土地・カード
  keywords: string[]; // 小文字: flying, haste, vigilance, flash, reach
  abilities: Ability[];
  mana: string[]; // タップだけで出るマナ (自動の支払い用)。1要素 = 1マナで、出せる色の集合 ("WB" = 白か黒、"C" = 無色)
  oracle: string;
}
export interface Card {
  uid: number;
  def: CardDef;
  owner: number;
}
export interface Perm extends Card {
  controller: number;
  tapped: boolean;
  sick: boolean; // 召喚酔い (このターンの頭から支配していない)
  damage: number;
  attacking: boolean;
  blocking?: number; // ブロックしている攻撃クリーチャーの uid
  blockOrder?: number; // 1体に複数でブロックされたとき、ダメージを割り振る順
  blocked?: boolean; // 攻撃クリーチャーが、ブロックされた (ブロッカーが後で死んでも、ブロックされたまま)
  deathtouched?: boolean; // 接死のダメージを受けた
}
export interface Player {
  life: number;
  library: Card[];
  hand: Card[];
  field: Perm[];
  graveyard: Card[];
  exile: Card[];
  pool: string[]; // マナプール (ステップの終わりに空になる)
  drewEmpty: boolean;
}
export interface StackItem {
  def: CardDef; // 表示用 (呪文ならそのカード、能力なら出どころ)
  controller: number;
  card?: Card; // 呪文のとき
  ability?: Ability; // 能力のとき
  targets?: Record<string, Target>; // 唱えたとき・起動したときに選んだ対象
}
// 対象。戦闘ゾーンのカードは、その時点の姿 (snap) も持つ (後で消えても、パワーなどを参照できる)
export type Target = { kind: "card"; uid: number; zone: Zone; snap: Snap } | { kind: "player"; player: number };
export interface Snap {
  def: CardDef;
  owner: number;
  controller: number;
}
interface Result {
  n: number;
  snaps: Snap[];
}
interface Ctx {
  controller: number;
  source: CardDef;
  targets: Record<string, Target>;
  results: Record<string, Result>;
}
export interface State {
  players: Player[];
  active: number;
  turn: number;
  phase: Phase;
  stack: StackItem[];
  landDropped: boolean;
  winner?: number; // -1 = 引き分け
  log: string[];
}

export type PriorityAction =
  | { kind: "pass" }
  | { kind: "land"; uid: number }
  | { kind: "cast"; uid: number; tap: number[] } // tap = マナプールで足りない分を払うためにタップするマナ源 (空 = プールだけで払える)
  | { kind: "tapMana"; uid: number; color?: string } // マナ能力。タップしてマナプールに出す (手動のプレイヤーだけ)
  | { kind: "activate"; uid: number; index: number; tap: number[] };
export type Decision =
  | { type: "priority"; player: number; actions: PriorityAction[] }
  | { type: "attackers"; player: number; eligible: number[] }
  | { type: "blockers"; player: number; attackers: number[]; eligible: number[]; legal: Block[] } // legal = ブロックしてよい組 (飛行・威嚇などの制限を満たすもの)
  | { type: "choice"; player: number; prompt: string; options: string[]; hand?: number[] }; // hand = 選択肢が手札のカードのとき、その uid (画面で手札をクリックして選べる)
export type Block = { attacker: number; blocker: number };
// priority → PriorityAction / attackers → number[] (攻撃する uid) / blockers → Block[] / choice → 選んだ番号 (0 始まり)
export type Answer = PriorityAction | number[] | Block[] | number;
export type Controller = (g: Game, d: Decision) => Promise<Answer>;
export interface HistoryStep {
  player: number;
  type: Decision["type"];
  answer: unknown;
}

// ---- カードの定義 ----

// 戦闘のキーワード (エンジンの固定ルール。カードごとの記録は要らない)
export const KEYWORDS = [
  "flying", "haste", "vigilance", "flash", "reach", "trample", "first strike", "double strike", "deathtouch", "lifelink", "menace", "defender", "indestructible",
  "hexproof", "shroud", "intimidate", "fear", "skulk", "shadow", "islandwalk", "swampwalk", "mountainwalk", "forestwalk", "plainswalk",
];
const LANDWALK: Record<string, string> = { islandwalk: "Island", swampwalk: "Swamp", mountainwalk: "Mountain", forestwalk: "Forest", plainswalk: "Plains" };

export function parseKeywords(oracle: string): string[] {
  const found = new Set<string>();
  // 行の頭がキーワードだけの行 ("Flying" / "Flying, haste") を拾う。注釈文の中は拾わない
  for (const line of oracle.split("\n")) {
    const parts = line.trim().toLowerCase().replace(/\(.*\)/, "").split(/\s*,\s*/);
    if (parts.length && parts.every((p) => KEYWORDS.includes(p))) parts.forEach((p) => found.add(p));
  }
  return [...found];
}

const BASIC: Record<string, string> = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G", Wastes: "C" };

// {T}: Add ... の能力からマナを読む。追加のコスト (生け贄など) がある能力は読まない。
// shortcut: 痛みや条件 (Caves of Koilos のダメージなど) は無視する
export function parseMana(typeLine: string, oracle: string): string[] {
  if (/\bBasic\b/.test(typeLine) && /\bLand\b/.test(typeLine)) {
    const sub = Object.keys(BASIC).find((b) => typeLine.includes(b));
    return sub ? [BASIC[sub]] : [];
  }
  const units: string[] = [];
  const add = (i: number, colors: string) => (units[i] = [...new Set((units[i] ?? "") + colors)].join(""));
  for (const m of oracle.matchAll(/\{T\}:\s*Add\s+([^.\n]+)/g)) {
    const text = m[1];
    if (/any color/i.test(text)) {
      add(0, "WUBRG");
      continue;
    }
    const syms = [...text.matchAll(/\{([WUBRGC])\}/g)].map((s) => s[1]);
    if (!syms.length) continue;
    if (/\}\s*or\s*\{/.test(text)) add(0, syms.join(""));
    else syms.forEach((s, i) => add(i, s));
  }
  return units.filter(Boolean);
}

// タップだけで出る (追加のコストが無い) マナ能力を、1マナずつの色の集合にする。自動の支払いで使う
export function simpleMana(abilities: Ability[]): string[] {
  const units: string[] = [];
  for (const a of abilities) {
    if (a.kind !== "mana" || !a.cost?.tap || a.cost.mana || a.cost.life || a.cost.sacrificeSelf) continue;
    for (const e of a.effects) if (e.do === "addMana") for (let i = 0; i < (e.n ?? 1); i++) units.push(e.options);
  }
  return units;
}

// abilities が無いときは、効果テキストから読めるマナ能力だけを持つ
export function makeDef(p: { key: string; name: string; typeLine: string; manaCost: string; cmc: number; power?: number; toughness?: number; oracle: string; abilities?: unknown[]; keywords?: string[] }): CardDef {
  const abilities: Ability[] =
    p.abilities?.map((a) => normalizeAbility(a)).filter((a): a is Ability => !!a) ?? // 古い書き方 (v2) も、ここで v3 になる
    (parseMana(p.typeLine, p.oracle).length
      ? [{ kind: "mana", cost: { tap: true }, effects: parseMana(p.typeLine, p.oracle).map((options) => ({ do: "addMana" as const, options })) }]
      : []);
  // Scryfall のキーワード一覧 (言語に依らず英語) と、効果テキストから読んだものを合わせる
  const keywords = [...new Set([...parseKeywords(p.oracle), ...(p.keywords ?? []).map((k) => k.toLowerCase()).filter((k) => KEYWORDS.includes(k))])];
  // 条件つき (unless / if / may) は読まない
  const entersTapped = p.oracle.split("\n").some((l) => /\benters(?: the battlefield)? tapped\.?\s*$/i.test(l) && !/\b(unless|if|may)\b/i.test(l));
  return { ...p, power: p.power ?? 0, toughness: p.toughness ?? 0, keywords, abilities, mana: simpleMana(abilities), entersTapped };
}

export const isLand = (d: CardDef) => /\bLand\b/.test(d.typeLine);
export const isCreature = (d: CardDef) => /\bCreature\b/.test(d.typeLine);
const isPermanent = (d: CardDef) => !/\b(Instant|Sorcery)\b/.test(d.typeLine);
const hasKw = (d: CardDef, k: string) => d.keywords.includes(k);
const colorsOf = (d: CardDef) => new Set(d.manaCost.match(/[WUBRG]/g) ?? []);
const isArtifact = (d: CardDef) => /\bArtifact\b/.test(d.typeLine);

// ---- マナ ----

export interface Cost {
  generic: number;
  colored: string[]; // 各記号が払える色の集合
}
export function parseCost(manaCost: string): Cost {
  const cost: Cost = { generic: 0, colored: [] };
  for (const m of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const s = m[1];
    if (/^\d+$/.test(s)) cost.generic += Number(s);
    else if (/^[WUBRGC]$/.test(s)) cost.colored.push(s);
    else if (s === "X") continue;
    else if (/^[WUBRG]\/[WUBRG]$/.test(s)) cost.colored.push(s.replace("/", ""));
    else if (/^[WUBRG]\/P$/.test(s)) cost.colored.push(s[0]); // shortcut: ファイレクシアマナは色マナとして払う (ライフでは払わない)
    else if (/^2\/[WUBRG]$/.test(s)) cost.colored.push(s[2]);
  }
  return cost;
}

// 払えるなら、タップするマナ源の uid を返す。払えないなら null
export function planPayment(cost: Cost, sources: Perm[]): number[] | null {
  const units = sources.flatMap((p, si) => p.def.mana.map((opts, ui) => ({ si, ui, opts })));
  const taken = new Set<string>();
  const total = (set: Set<number>) => [...set].reduce((a, si) => a + sources[si].def.mana.length, 0);
  const dfs = (i: number, used: Set<number>): number[] | null => {
    if (i === cost.colored.length) {
      const set = new Set(used);
      let have = total(set) - cost.colored.length;
      // 残りの無色分: 追加でタップするマナ源 (出せるマナが多い順)
      const rest = sources.map((_, si) => si).filter((si) => !set.has(si)).sort((a, b) => sources[b].def.mana.length - sources[a].def.mana.length);
      for (const si of rest) {
        if (have >= cost.generic) break;
        set.add(si);
        have += sources[si].def.mana.length;
      }
      return have >= cost.generic ? [...set].map((si) => sources[si].uid) : null;
    }
    for (const u of units) {
      const k = `${u.si}.${u.ui}`;
      if (taken.has(k) || !cost.colored[i].split("").some((c) => u.opts.includes(c))) continue;
      taken.add(k);
      const had = used.has(u.si);
      used.add(u.si);
      const r = dfs(i + 1, used);
      if (!had) used.delete(u.si);
      taken.delete(k);
      if (r) return r;
    }
    return null;
  };
  if (cost.colored.length === 0 && cost.generic === 0) return [];
  return dfs(0, new Set());
}

// マナプールで払える分を先に使う。残りのコストを返す (プールは破壊的に減る)
export function spendPool(cost: Cost, pool: string[]): Cost {
  const rest: Cost = { generic: cost.generic, colored: [] };
  for (const opts of cost.colored) {
    const i = pool.findIndex((m) => opts.includes(m));
    if (i >= 0) pool.splice(i, 1);
    else rest.colored.push(opts);
  }
  const use = Math.min(rest.generic, pool.length);
  pool.splice(0, use);
  rest.generic -= use;
  return rest;
}

// ---- ゲーム ----

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAIN: Phase[] = ["main1", "main2"];
export const DEFAULT_STOPS: Phase[] = ["main1", "main2", "end"];
const usable = (p: Perm) => !p.tapped && !(isCreature(p.def) && p.sick && !hasKw(p.def, "haste"));

export class Game {
  s: State;
  history: HistoryStep[] = [];
  private nextUid = 1;
  private rand: () => number;
  onLog?: (line: string) => void;
  onChange?: () => void; // 盤面が変わったとき (画面の更新用)

  // decks[i] = i 番目のプレイヤーのデッキ。先攻は 0 番。seed を同じにすると、シャッフルもコイン投げも同じになる。
  // manual[i] = true のプレイヤーは、マナを手でタップして出す (false は、唱えるとき自動でタップする)
  // opts.manual[i] = true のプレイヤーは、マナを手でタップする。opts.first = 先攻 (省略するとダイスで決める)。opts.opening = false で、先攻決めとマリガンを省く
  private manual: boolean[];
  stops: Set<Phase>; // 手動のプレイヤーが優先権で止まるステップ (スタックに何かあるときは、常に止まる)
  private first: number | undefined;
  private opening: boolean;
  constructor(decks: CardDef[][], public seed: number, private controllers: Controller[], opts: { manual?: boolean[]; first?: number; opening?: boolean; stops?: Phase[] } = {}) {
    this.stops = new Set(opts.stops ?? DEFAULT_STOPS);
    this.manual = opts.manual ?? [false, false];
    this.first = opts.first;
    this.opening = opts.opening ?? true;
    this.rand = rng(seed);
    this.s = { players: [], active: 0, turn: 0, phase: "upkeep", stack: [], landDropped: false, log: [] };
    decks.forEach((deck, owner) => {
      const library = deck.map((def) => ({ uid: this.nextUid++, def, owner }));
      this.shuffle(library);
      this.s.players.push({ life: 20, library, hand: library.splice(0, 7), field: [], graveyard: [], exile: [], pool: [], drewEmpty: false });
    });
  }

  private shuffle<T>(a: T[]) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  log(line: string) {
    this.s.log.push(line);
    this.onLog?.(line);
  }

  private other = (p: number) => 1 - p;
  card(uid: number): Card | undefined {
    for (const p of this.s.players) for (const c of [...p.hand, ...p.field, ...p.graveyard, ...p.exile, ...p.library]) if (c.uid === uid) return c;
    return undefined;
  }
  perm(uid: number): Perm | undefined {
    return this.s.players.flatMap((p) => p.field).find((c) => c.uid === uid);
  }

  async play(maxTurns = 60) {
    this.log(`対戦開始 (seed ${this.seed})`);
    if (this.opening) await this.openingHands();
    this.first ??= 0;
    while (this.s.winner === undefined && this.s.turn < maxTurns) await this.turn();
    if (this.s.winner === undefined) this.log(`${maxTurns} ターンで打ち切り`);
  }

  // 各ステップで優先権のやりとりをする。攻撃クリーチャーがいなければ、宣言・ブロック・ダメージのステップは飛ばす
  private async turn() {
    const s = this.s;
    s.turn++;
    s.active = (this.first! + s.turn - 1) % 2;
    s.landDropped = false;
    s.players[s.active].field.forEach((p) => ((p.tapped = false), (p.sick = false)));
    this.log(`--- ターン ${s.turn} (プレイヤー${s.active + 1}) ---`);
    const step = async (phase: Phase) => {
      s.phase = phase;
      this.onChange?.();
      await this.priorityRound();
      for (const pl of s.players) pl.pool = []; // マナはステップの終わりに消える
      return s.winner === undefined;
    };
    s.phase = "upkeep";
    this.fire("upkeep");
    if (!(await step("upkeep"))) return;
    s.phase = "draw";
    if (s.turn > 1) this.draw(s.active); // 先攻の最初のターンは引かない
    if (s.winner !== undefined || !(await step("draw"))) return;
    if (!(await step("main1")) || !(await step("beginCombat"))) return;
    s.phase = "attackers";
    if (await this.declareAttackers()) {
      if (!(await step("attackers"))) return;
      s.phase = "blockers";
      await this.declareBlockers();
      if (!(await step("blockers"))) return;
      s.phase = "damage";
      this.combatDamage();
      if (s.winner !== undefined || !(await step("damage"))) return;
    }
    for (const pl of s.players) for (const p of pl.field) (p.attacking = false), (p.blocking = undefined), (p.blocked = false);
    if (!(await step("endCombat")) || !(await step("main2")) || !(await step("end"))) return;
    await this.cleanup();
  }

  private draw(p: number) {
    const pl = this.s.players[p];
    const c = pl.library.shift();
    if (!c) return void ((pl.drewEmpty = true), this.log(`プレイヤー${p + 1}: 山札が無い`), this.checkState());
    pl.hand.push(c);
    this.log(`プレイヤー${p + 1}: ドロー (${p === 0 ? c.def.name : "?"})`);
  }

  // ダイスで先攻・後攻を決め (勝った人が選ぶ)、マリガン (ロンドン式: 引き直して、キープした後に枚数ぶんをライブラリーの下に置く)
  private async openingHands() {
    const s = this.s;
    if (this.first === undefined) {
      const winner = this.rand() < 0.5 ? 0 : 1;
      const c = await this.choose(winner, "ダイスに勝った。先攻・後攻を選ぶ", ["先攻", "後攻"]);
      this.first = c === 0 ? winner : 1 - winner;
      this.log(`プレイヤー${winner + 1} がダイスに勝ち、${c === 0 ? "先攻" : "後攻"}を選んだ`);
    }
    for (const p of [this.first, 1 - this.first]) {
      const pl = s.players[p];
      let n = 0;
      while (n < 6 && (await this.choose(p, `初手をキープするか (マリガン ${n} 回済み)`, ["キープ", "マリガン"], undefined)) === 1) {
        n++;
        pl.library.push(...pl.hand);
        pl.hand = [];
        this.shuffle(pl.library);
        pl.hand = pl.library.splice(0, 7);
        this.log(`プレイヤー${p + 1}: マリガン (${n} 回目)`);
        this.onChange?.();
      }
      for (let i = 0; i < n; i++) {
        const idx = await this.choose(p, `ライブラリーの下に置くカードを選ぶ (あと${n - i}枚)`, pl.hand.map((c) => c.def.name), pl.hand.map((c) => c.uid));
        pl.library.push(...pl.hand.splice(idx, 1));
        this.onChange?.();
      }
      this.log(`プレイヤー${p + 1}: ${n ? `${n} 回マリガンして` : ""}キープ (${pl.hand.length} 枚)`);
    }
  }

  private async cleanup() {
    const s = this.s;
    for (const pl of s.players) for (const p of pl.field) (p.damage = 0), (p.deathtouched = false);
    const me = s.players[s.active];
    while (me.hand.length > 7) {
      const i = await this.choose(s.active, `手札が ${me.hand.length} 枚。捨てるカードを選ぶ`, me.hand.map((c) => c.def.name), me.hand.map((c) => c.uid));
      const [c] = me.hand.splice(i, 1);
      me.graveyard.push(c);
      this.log(`プレイヤー${s.active + 1}: 手札上限で捨てる (${c.def.name})`);
      this.onChange?.();
    }
  }

  // ---- 優先権 ----

  // コストを払えるなら、プールで足りない分のためにタップするマナ源の uid (空 = プールだけで払える)。払えなければ null
  private payment(p: number, manaCost: string): number[] | null {
    const pl = this.s.players[p];
    const rest = spendPool(parseCost(manaCost), [...pl.pool]);
    return planPayment(rest, pl.field.filter((x) => usable(x) && x.def.mana.length));
  }

  actions(p: number): PriorityAction[] {
    const s = this.s;
    const pl = s.players[p];
    const acts: PriorityAction[] = [];
    const sorcery = s.active === p && MAIN.includes(s.phase) && s.stack.length === 0;
    const seen = new Set<string>();
    for (const c of pl.hand) {
      if (seen.has(c.def.key)) continue;
      seen.add(c.def.key);
      if (isLand(c.def)) {
        if (sorcery && !s.landDropped) acts.push({ kind: "land", uid: c.uid });
        continue;
      }
      const instantSpeed = /\bInstant\b/.test(c.def.typeLine) || hasKw(c.def, "flash");
      if (!sorcery && !instantSpeed) continue;
      const tap = this.payment(p, c.def.manaCost);
      if (tap && c.def.abilities.filter((a) => a.kind === "spell").every((a) => this.targetsAvailable(p, a))) acts.push({ kind: "cast", uid: c.uid, tap });
    }
    for (const perm of pl.field) {
      perm.def.abilities.forEach((ab, index) => {
        if (ab.kind !== "mana" && ab.kind !== "activated") return;
        const cost = ab.cost ?? {};
        const simple = ab.kind === "mana" && cost.tap && !cost.mana && !cost.life && !cost.sacrificeSelf;
        if (cost.tap && !usable(perm)) return;
        if (simple) {
          // 手動のプレイヤーだけ、タップしてマナを出せる。単独のマナで色を選べるものは、色ごとに行動を作る
          if (!this.manual[p]) return;
          const units = ab.effects.filter((e): e is Extract<Step, { do: "addMana" }> => e.do === "addMana");
          if (units.length === 1 && (units[0].n ?? 1) === 1 && units[0].options.length > 1) for (const color of units[0].options) acts.push({ kind: "tapMana", uid: perm.uid, color });
          else acts.push({ kind: "tapMana", uid: perm.uid });
          return;
        }
        if (cost.life !== undefined && pl.life <= cost.life) return;
        if (!this.targetsAvailable(p, ab)) return;
        const tapped = cost.tap ? [perm.uid] : [];
        const others = cost.mana ? this.payment(p, cost.mana) : [];
        if (!others) return;
        acts.push({ kind: "activate", uid: perm.uid, index, tap: [...tapped, ...others.filter((u) => u !== perm.uid)] });
      });
    }
    acts.push({ kind: "pass" });
    return acts;
  }

  private async ask<T extends Answer>(d: Decision): Promise<T> {
    const answer = await this.controllers[d.player](this, d);
    this.history.push({ player: d.player, type: d.type, answer });
    return answer as T;
  }

  // 選択肢が1つなら聞かずにそれを選ぶ
  private async choose(player: number, prompt: string, options: string[], hand?: number[]): Promise<number> {
    if (options.length <= 1) return 0;
    const n = await this.ask<number>({ type: "choice", player, prompt, options, hand });
    return Number.isInteger(n) && n >= 0 && n < options.length ? n : 0;
  }

  private async priorityRound() {
    const s = this.s;
    let p = s.active;
    let passes = 0;
    while (s.winner === undefined) {
      const actions = this.actions(p);
      // 行動がパスと「マナのタップ」だけなら聞かない (呼び出しの節約)
      // 手動のプレイヤーは、止まると決めたステップか、スタックに何かあるときだけ聞く (アップキープなどで、勝手に止まらない)
      const stopHere = !this.manual[p] || s.stack.length > 0 || this.stops.has(s.phase);
      const meaningful = stopHere ? actions.filter((x) => x.kind !== "pass" && x.kind !== "tapMana") : [];
      const a = meaningful.length === 0 ? ({ kind: "pass" } as PriorityAction) : await this.ask<PriorityAction>({ type: "priority", player: p, actions });
      if (a.kind === "pass") {
        if (++passes >= 2) {
          if (!s.stack.length) return;
          await this.resolveTop();
          passes = 0;
          p = s.active;
        } else p = this.other(p);
        continue;
      }
      passes = 0;
      const key = JSON.stringify(a);
      const chosen = actions.find((x) => JSON.stringify(x) === key);
      if (!chosen) throw new Error(`選べない行動: ${key}`);
      await this.perform(p, chosen);
    }
  }

  // 場に出す (出たときの誘発を拾う)
  private enter(card: Card, controller: number) {
    const perm: Perm = { ...card, controller, tapped: card.def.entersTapped, sick: true, damage: 0, attacking: false };
    this.s.players[controller].field.push(perm);
    this.fire("etb", perm);
  }

  private payCost(p: number, tap: number[], manaCost?: string) {
    const pl = this.s.players[p];
    if (manaCost) spendPool(parseCost(manaCost), pl.pool);
    for (const uid of tap) this.perm(uid)!.tapped = true;
  }

  private async perform(p: number, a: PriorityAction) {
    const s = this.s;
    const pl = s.players[p];
    if (a.kind === "pass") return;
    if (a.kind === "tapMana") {
      const perm = this.perm(a.uid)!;
      perm.tapped = true;
      const units = perm.def.abilities.find((x) => x.kind === "mana" && x.cost?.tap && !x.cost.mana && !x.cost.life && !x.cost.sacrificeSelf)!.effects;
      for (const e of units) if (e.do === "addMana") for (let i = 0; i < (e.n ?? 1); i++) pl.pool.push(a.color ?? e.options[0]);
      this.log(`プレイヤー${p + 1}: ${perm.def.name} をタップ (マナ ${pl.pool.join("")})`);
    } else if (a.kind === "activate") {
      const perm = this.perm(a.uid)!;
      const ab = perm.def.abilities[a.index];
      const targets = await this.declareTargets(p, ab, perm.def); // 対象は、コストを払う前に選ぶ
      this.payCost(p, a.tap, ab.cost?.mana);
      if (ab.cost?.life) (pl.life -= ab.cost.life), this.log(`プレイヤー${p + 1}: コストで ${ab.cost.life} 点のライフを払う (${pl.life})`);
      if (ab.cost?.sacrificeSelf) (this.sacrifice(perm), this.log(`${perm.def.name} を生け贄にする`));
      this.log(`プレイヤー${p + 1}: 起動 ${perm.def.name}${ab.text ? ` (${ab.text})` : ""}`);
      if (ab.kind === "mana") await this.runSteps(ab.effects, { controller: p, source: perm.def, targets, results: {} }); // マナ能力はスタックを使わない
      else s.stack.push({ def: perm.def, controller: p, ability: ab, targets });
      this.checkState();
    } else {
      const i = pl.hand.findIndex((c) => c.uid === a.uid);
      const [card] = pl.hand.splice(i, 1);
      if (a.kind === "land") {
        this.enter(card, p);
        s.landDropped = true;
        this.log(`プレイヤー${p + 1}: 土地を出す ${card.def.name}`);
      } else {
        const targets: Record<string, Target> = {};
        for (const ab of card.def.abilities.filter((x) => x.kind === "spell")) Object.assign(targets, await this.declareTargets(p, ab, card.def));
        this.payCost(p, a.tap, card.def.manaCost);
        s.stack.push({ def: card.def, controller: p, card, targets });
        this.log(`プレイヤー${p + 1}: 唱える ${card.def.name} ${card.def.manaCost}`);
      }
    }
    this.onChange?.();
  }

  private sacrifice(perm: Perm) {
    const pl = this.s.players[perm.controller];
    pl.field.splice(pl.field.indexOf(perm), 1);
    this.s.players[perm.owner].graveyard.push({ uid: perm.uid, def: perm.def, owner: perm.owner });
  }

  private async resolveTop() {
    const s = this.s;
    const item = s.stack.pop()!;
    const ab = item.ability;
    // 誘発の対象は、解決時に選ぶ (簡略)。対象が全部無くなっていたら、不発 (効果は何も起きない)
    const defs = ab ? [ab] : item.card!.def.abilities.filter((x) => x.kind === "spell");
    let targets = item.targets ?? {};
    if (ab && !item.targets && ab.targets?.length) targets = await this.declareTargets(item.controller, ab, item.def);
    const needs = defs.flatMap((d) => d.targets ?? []);
    const fizzled = needs.length > 0 && needs.every((t) => !this.targetLegal(targets[t.id]));
    if (ab) {
      if (ab.optional && (await this.choose(item.controller, `${item.def.name}: ${ab.text ?? "能力"} を使う?`, ["使う", "使わない"])) === 1) return;
      if (fizzled) this.log(`${item.def.name} の能力: 対象が無く、何も起きない`);
      else {
        this.log(`${item.def.name} の能力を解決`);
        await this.runSteps(ab.effects, { controller: item.controller, source: item.def, targets, results: {} });
      }
    } else {
      const card = item.card!;
      if (isPermanent(card.def)) {
        this.enter(card, item.controller);
        this.log(`${card.def.name} が場に出る`);
      } else {
        if (!defs.length) this.log(`${card.def.name} を解決 (効果は未実装)`);
        else if (fizzled) this.log(`${card.def.name}: 対象が無くなり、不発`);
        else {
          this.log(`${card.def.name} を解決`);
          const results: Record<string, Result> = {};
          for (const d of defs) await this.runSteps(d.effects, { controller: item.controller, source: card.def, targets, results });
        }
        s.players[card.owner].graveyard.push(card);
      }
    }
    this.checkState();
    this.onChange?.();
  }

  // ---- 誘発 ----

  // event の誘発型能力をスタックに積む。upkeep = ターンプレイヤーのアップキープ。etb / dies = subject 自身
  private fire(event: "upkeep" | "etb" | "dies", subject?: Perm) {
    const s = this.s;
    const sources = event === "upkeep" ? s.players.flatMap((pl) => pl.field) : subject ? [subject] : [];
    // ターンプレイヤーの能力を先に積む (後に解決される)
    sources.sort((a, b) => Number(b.controller === s.active) - Number(a.controller === s.active));
    for (const src of sources) {
      for (const ab of src.def.abilities) {
        if (ab.kind !== "triggered" || ab.trigger?.event !== event) continue;
        if (event === "upkeep") {
          const w = ab.trigger.whose ?? "you";
          if (w === "you" && src.controller !== s.active) continue;
          if (w === "opponent" && src.controller === s.active) continue;
        }
        s.stack.push({ def: src.def, controller: src.controller, ability: ab });
        this.log(`誘発: ${src.def.name}${ab.text ? ` (${ab.text})` : ""}`);
      }
    }
  }

  // ---- 効果の実行 (effects.ts の命令を、機械的に実行する) ----

  private locate(uid: number): { zone: Zone; player: number; obj: Card | Perm } | undefined {
    for (const [player, pl] of this.s.players.entries()) {
      for (const zone of ["battlefield", "hand", "graveyard", "exile", "library"] as Zone[]) {
        const list: (Card | Perm)[] = zone === "battlefield" ? pl.field : pl[zone];
        const obj = list.find((c) => c.uid === uid);
        if (obj) return { zone, player, obj };
      }
    }
    return undefined;
  }

  private snap(obj: Card | Perm): Snap {
    return { def: obj.def, owner: obj.owner, controller: "controller" in obj ? obj.controller : obj.owner };
  }

  private cmp(v: number, c: { op: string; n: number }) {
    return c.op === "<" ? v < c.n : c.op === "<=" ? v <= c.n : c.op === "=" ? v === c.n : c.op === ">=" ? v >= c.n : v > c.n;
  }

  private matches(obj: Card | Perm, sel: CardSel): boolean {
    const d = obj.def;
    if (sel.types?.length && !sel.types.some((t) => t === "permanent" || t === "card" || (t === "land" ? isLand(d) : t === "creature" ? isCreature(d) : new RegExp(`\\b${t}\\b`, "i").test(d.typeLine)))) return false;
    if (sel.supertypes?.length && !sel.supertypes.every((t) => new RegExp(`\\b${t}\\b`, "i").test(d.typeLine))) return false;
    if (sel.subtypes?.length && !sel.subtypes.some((t) => new RegExp(`\\b${t}\\b`, "i").test(d.typeLine))) return false;
    for (const n of sel.not ?? []) {
      if (n === "land" ? isLand(d) : n === "creature" ? isCreature(d) : new RegExp(`\\b${n}\\b`, "i").test(d.typeLine)) return false;
    }
    if (sel.name && d.name !== sel.name) return false;
    if (sel.cmc && !this.cmp(d.cmc, sel.cmc)) return false;
    if (sel.power && !this.cmp(d.power, sel.power)) return false;
    return true;
  }

  private evalAmount(a: Amount | undefined, ctx: Ctx): number {
    if (a === undefined) return 1;
    if (typeof a === "number") return a;
    if ("count" in a) return this.candidates(a.count, ctx).length;
    const snap = this.snapOf(a.ref, ctx);
    return snap ? (a.of === "power" ? snap.def.power : a.of === "toughness" ? snap.def.toughness : snap.def.cmc) : 0;
  }

  private snapOf(ref: string, ctx: Ctx): Snap | undefined {
    const t = ctx.targets[ref];
    if (t?.kind === "card") return t.snap;
    return ctx.results[ref]?.snaps[0];
  }

  private evalCond(c: Cond, ctx: Ctx): boolean {
    if ("cmp" in c) return this.cmp(this.evalAmount(c.cmp[0], ctx), { op: c.cmp[1], n: this.evalAmount(c.cmp[2], ctx) });
    if ("has" in c) return this.candidates(c.has, ctx).length > 0;
    return (ctx.results[c.did]?.n ?? 0) > 0;
  }

  private canTarget(p: Perm, by: number) {
    return !(hasKw(p.def, "shroud") || (hasKw(p.def, "hexproof") && p.controller !== by)); // 呪禁・被覆
  }

  // sel に合うカードの候補。ゾーンは既定で戦場。owner は、戦場ではコントローラー、他のゾーンでは持ち主
  private candidates(sel: CardSel, ctx: Ctx): { obj: Card | Perm; zone: Zone; player: number }[] {
    const zone = sel.zone ?? "battlefield";
    const who = sel.owner ?? (sel.top ? "you" : "any");
    const players = who === "you" ? [ctx.controller] : who === "opponent" ? [1 - ctx.controller] : [0, 1];
    return players.flatMap((player) => {
      const list: (Card | Perm)[] = zone === "battlefield" ? this.s.players[player].field : this.s.players[player][zone];
      return list.filter((obj) => this.matches(obj, sel)).map((obj) => ({ obj, zone, player }));
    });
  }

  // 候補から、枚数ぶん選ぶ。選ぶ人は chooser (既定は能力のコントローラー)。全部が入るなら聞かない
  private async selectCards(sel: CardSel, ctx: Ctx, why: string) {
    const cands = this.candidates(sel, ctx);
    const n = sel.count === "all" ? cands.length : Math.max(0, this.evalAmount(sel.count, ctx));
    if (sel.top) return cands.slice(0, n);
    if (n >= cands.length && !sel.upTo) return cands;
    const chooser = sel.chooser === "opponent" ? 1 - ctx.controller : ctx.controller;
    const rest = [...cands];
    const picked: typeof cands = [];
    for (let i = 0; i < n && rest.length; i++) {
      const names = rest.map((c) => (cands.some((x) => x.player !== cands[0].player) ? `${c.obj.def.name} (${c.player === chooser ? "自分の" : "相手の"})` : c.obj.def.name));
      const own = rest.every((c) => c.zone === "hand" && c.player === chooser);
      const options = sel.upTo ? [...names, "選ばない"] : names;
      const k = await this.choose(chooser, `${ctx.source.name}: ${why}`, options, own && !sel.upTo ? rest.map((c) => c.obj.uid) : undefined);
      if (k >= rest.length) break;
      picked.push(...rest.splice(k, 1));
    }
    return picked;
  }

  // 唱える・起動する前に、対象を選べるか
  private targetsAvailable(p: number, ab: Ability): boolean {
    return (ab.targets ?? []).every((t) => this.targetCandidates(t, { controller: p, source: undefined as never, targets: {}, results: {} }).length > 0);
  }

  private targetCandidates(t: TargetDef, ctx: Ctx): Target[] {
    const by = ctx.controller;
    if (t.sel.kind === "player") return [0, 1].filter((i) => t.sel.kind === "player" && (t.sel.who === "each" || (t.sel.who === "opponent" ? i !== by : t.sel.who === "you" ? i === by : true))).map((player): Target => ({ kind: "player", player }));
    const perms = t.sel.kind === "any" ? this.s.players.flatMap((pl) => pl.field).filter((x) => isCreature(x.def) || /\bPlaneswalker\b/.test(x.def.typeLine)).map((x) => ({ obj: x as Card | Perm, zone: "battlefield" as Zone, player: x.controller })) : this.candidates(t.sel, ctx);
    const cards = perms.filter((c) => c.zone !== "battlefield" || this.canTarget(c.obj as Perm, by)).map((c): Target => ({ kind: "card", uid: c.obj.uid, zone: c.zone, snap: this.snap(c.obj) }));
    return t.sel.kind === "any" ? [...cards, ...([0, 1].map((player) => ({ kind: "player", player })) as Target[])] : cards;
  }

  private async declareTargets(p: number, ab: Ability, source: CardDef): Promise<Record<string, Target>> {
    const out: Record<string, Target> = {};
    for (const t of ab.targets ?? []) {
      const list = this.targetCandidates(t, { controller: p, source, targets: out, results: {} });
      if (!list.length) continue;
      // 選ぶ人から見て、自分のものか相手のものかを付ける (「プレイヤー2」だと、自分のことか分からなくなる)
      const names = list.map((x) => (x.kind === "player" ? (x.player === p ? "自分(プレイヤー)" : "相手(プレイヤー)") : `${x.snap.def.name} (${x.snap.controller === p ? "自分の" : "相手の"})`));
      out[t.id] = list[await this.choose(p, `${source.name}: 対象を選ぶ`, names)];
    }
    return out;
  }

  private targetLegal(t?: Target): boolean {
    if (!t) return false;
    if (t.kind === "player") return true;
    return this.locate(t.uid)?.zone === t.zone;
  }

  private playersOf(sel: PlayerSel, ctx: Ctx): number[] {
    if (sel.who === "each") return [0, 1];
    if (sel.who === "controllerOf") {
      const snap = sel.ref ? this.snapOf(sel.ref, ctx) : undefined;
      return snap ? [snap.controller] : [];
    }
    return [sel.who === "you" ? ctx.controller : 1 - ctx.controller];
  }

  private async runSteps(steps: Step[], ctx: Ctx): Promise<void> {
    const s = this.s;
    const me = ctx.controller;
    for (const e of steps) {
      if (s.winner !== undefined) return;
      switch (e.do) {
        case "addMana": {
          const n = e.n ?? 1;
          const color = e.options[await this.choose(me, "マナの色を選ぶ", e.options.split(""))];
          for (let i = 0; i < n; i++) s.players[me].pool.push(color);
          this.log(`プレイヤー${me + 1}: マナ ${color.repeat(n)} (プール ${s.players[me].pool.join("")})`);
          break;
        }
        case "shuffle":
          this.shuffle(s.players[e.owner === "you" ? me : 1 - me].library);
          this.log(`プレイヤー${(e.owner === "you" ? me : 1 - me) + 1}: 山札をシャッフル`);
          break;
        case "flip": {
          const win = this.rand() < 0.5;
          this.log(`コイン投げ: ${win ? "勝ち" : "負け"}`);
          await this.runSteps((win ? e.win : e.lose) ?? [], ctx);
          break;
        }
        case "if":
          await this.runSteps(this.evalCond(e.cond, ctx) ? e.then : (e.else ?? []), ctx);
          break;
        case "may":
          if ((await this.choose(e.who === "opponent" ? 1 - me : me, `${ctx.source.name}: してもよい`, ["する", "しない"])) === 0) await this.runSteps(e.steps, ctx);
          break;
        case "move":
          await this.move(e, ctx);
          break;
        case "change":
          await this.change(e, ctx);
          break;
        case "unsupported":
          this.log(`未対応の効果: ${e.text}`);
          break;
      }
      this.checkState();
    }
  }

  // 対象の指定を、いまの実体にする (名前・結果の参照を引く)。戦場以外のゾーンは、いまそこにあるものだけ
  private async resolveWhat(what: Selector, ctx: Ctx, why: string): Promise<{ obj: Card | Perm; zone: Zone; player: number }[]> {
    if (what.kind === "cards") return this.selectCards(what, ctx, why);
    if (what.kind === "ref") {
      const t = ctx.targets[what.ref];
      const uids = t?.kind === "card" ? [t.uid] : (ctx.results[what.ref]?.snaps ?? []).map(() => -1);
      return uids.flatMap((u) => (u >= 0 && this.targetLegal(t) ? [this.locate(u)!] : [])).map((l) => ({ obj: l.obj, zone: l.zone, player: l.player }));
    }
    return [];
  }

  private async move(e: Extract<Step, { do: "move" }>, ctx: Ctx) {
    const s = this.s;
    const me = ctx.controller;
    const as: Result | undefined = e.as ? (ctx.results[e.as] = { n: 0, snaps: [] }) : undefined;
    // 引く: 山札の上から。山札が足りないと、その人は負ける
    if (e.how === "draw" && e.what.kind === "cards") {
      const who = e.what.owner === "opponent" ? 1 - me : me;
      const n = e.what.count === "all" ? 0 : Math.max(0, this.evalAmount(e.what.count, ctx));
      for (let i = 0; i < n; i++) this.draw(who);
      return;
    }
    const found = await this.resolveWhat(e.what, ctx, e.how === "discard" ? "捨てさせるカードを選ぶ" : "カードを選ぶ");
    if (e.how === "discard" && e.what.kind === "cards" && e.what.chooser !== "opponent" && e.what.owner === "opponent")
      this.log(`プレイヤー${2 - me} の手札を公開: ${this.s.players[1 - me].hand.map((c) => c.def.name).join(", ") || "なし"}`);
    for (const f of found) {
      const owner = s.players[f.obj.owner];
      const from = f.zone === "battlefield" ? s.players[f.player].field : s.players[f.player][f.zone];
      const idx = (from as (Card | Perm)[]).findIndex((c) => c.uid === f.obj.uid);
      if (idx < 0) continue;
      const perm = f.zone === "battlefield" ? (f.obj as Perm) : undefined;
      if (e.how === "destroy" && perm && hasKw(perm.def, "indestructible")) {
        this.log(`${perm.def.name} は破壊されない`);
        continue;
      }
      (from as (Card | Perm)[]).splice(idx, 1);
      const card: Card = { uid: f.obj.uid, def: f.obj.def, owner: f.obj.owner };
      if (as) (as.n++, as.snaps.push(this.snap(f.obj)));
      switch (e.to) {
        case "battlefield":
          this.enter(card, me);
          break;
        case "graveyard":
          owner.graveyard.push(card);
          if (perm) this.fire("dies", perm);
          break;
        case "exile":
          owner.exile.push(card);
          break;
        case "hand":
          owner.hand.push(card);
          break;
        case "library":
          e.position === "bottom" ? owner.library.push(card) : owner.library.unshift(card);
          break;
      }
      const Z: Record<string, string> = { battlefield: "戦場", hand: "手札", library: "山札", graveyard: "墓地", exile: "追放領域" };
      this.log(`${card.def.name} (プレイヤー${f.player + 1}): ${Z[f.zone]} → ${Z[e.to]}${e.how === "destroy" ? " (破壊)" : e.how === "discard" ? " (捨てる)" : ""}`);
    }
  }

  private async change(e: Extract<Step, { do: "change" }>, ctx: Ctx) {
    const s = this.s;
    const n = typeof e.delta === "number" ? e.delta : this.evalAmount(e.delta, ctx);
    const what = e.what;
    let players: number[] = [];
    let perms: Perm[] = [];
    if (what.kind === "player") players = this.playersOf(what, ctx);
    else if (what.kind === "ref") {
      const t = ctx.targets[what.ref];
      if (t?.kind === "player") players = [t.player];
      else if (t?.kind === "card" && this.targetLegal(t)) perms = [this.locate(t.uid)!.obj as Perm];
    } else if (what.kind === "cards") perms = (await this.selectCards(what, ctx, "対象を選ぶ")).map((c) => c.obj as Perm);
    for (const p of players) {
      const delta = e.stat === "damage" ? -n : n;
      s.players[p].life += delta;
      this.log(`${e.stat === "damage" ? `${ctx.source.name} が ` : ""}プレイヤー${p + 1}${e.stat === "damage" ? ` に ${n} 点` : `: ライフ ${delta >= 0 ? "+" : ""}${delta}`} (${s.players[p].life})`);
    }
    if (e.stat === "damage") for (const t of perms) (t.damage += n), this.log(`${ctx.source.name} が ${t.def.name} に ${n} 点`);
  }

  // ---- 戦闘 ----

  private async declareAttackers(): Promise<boolean> {
    const s = this.s;
    const me = s.players[s.active];
    const eligible = me.field.filter((p) => isCreature(p.def) && !p.tapped && !hasKw(p.def, "defender") && (!p.sick || hasKw(p.def, "haste"))).map((p) => p.uid);
    if (!eligible.length) return false;
    const picked = await this.ask<number[]>({ type: "attackers", player: s.active, eligible });
    const chosen = picked.filter((u) => eligible.includes(u));
    for (const uid of chosen) {
      const p = this.perm(uid)!;
      p.attacking = true;
      if (!hasKw(p.def, "vigilance")) p.tapped = true;
    }
    if (chosen.length) this.log(`攻撃: ${chosen.map((u) => this.perm(u)!.def.name).join(", ")}`);
    this.onChange?.();
    return chosen.length > 0;
  }

  // blk が atk をブロックしてよいか (飛行・威嚇などの制限)
  private canBlock(atk: Perm, blk: Perm): boolean {
    const a = atk.def;
    const b = blk.def;
    if (hasKw(a, "flying") && !hasKw(b, "flying") && !hasKw(b, "reach")) return false;
    if (hasKw(a, "fear") && !isArtifact(b) && !colorsOf(b).has("B")) return false;
    if (hasKw(a, "intimidate") && !isArtifact(b) && ![...colorsOf(a)].some((c) => colorsOf(b).has(c))) return false;
    if (hasKw(a, "skulk") && b.power > a.power) return false;
    if (hasKw(a, "shadow") !== hasKw(b, "shadow")) return false; // 影のクリーチャーは、影のクリーチャーとだけ戦う
    for (const [kw, land] of Object.entries(LANDWALK)) if (hasKw(a, kw) && this.s.players[blk.controller].field.some((l) => isLand(l.def) && l.def.typeLine.includes(land))) return false;
    return true;
  }

  private async declareBlockers() {
    const s = this.s;
    const def = this.other(s.active);
    const attackers = s.players[s.active].field.filter((p) => p.attacking);
    const eligible = s.players[def].field.filter((p) => isCreature(p.def) && !p.tapped);
    if (!eligible.length) return;
    const legal = attackers.flatMap((a) => eligible.filter((b) => this.canBlock(a, b)).map((b) => ({ attacker: a.uid, blocker: b.uid })));
    if (!legal.length) return;
    const blocks = await this.ask<Block[]>({ type: "blockers", player: def, attackers: attackers.map((a) => a.uid), eligible: eligible.map((b) => b.uid), legal });
    const used = new Set<number>();
    const per = new Map<number, Perm[]>();
    for (const b of blocks) {
      if (used.has(b.blocker) || !legal.some((l) => l.attacker === b.attacker && l.blocker === b.blocker)) continue; // 1体は1体だけブロックできる
      used.add(b.blocker);
      per.set(b.attacker, [...(per.get(b.attacker) ?? []), this.perm(b.blocker)!]);
    }
    for (const [auid, list] of per) {
      const a = this.perm(auid)!;
      if (hasKw(a.def, "menace") && list.length < 2) continue; // 威迫は2体以上でないとブロックできない
      a.blocked = true;
      list.forEach((blk, i) => {
        blk.blocking = auid;
        blk.blockOrder = i;
        this.log(`ブロック: ${blk.def.name} → ${a.def.name}`);
      });
    }
    this.onChange?.();
  }

  // 1つのダメージ。接死 (どんな量でも致死) と絆魂 (与えたダメージだけ回復) を扱う
  private deal(src: Perm, target: Perm | number, amount: number) {
    if (amount <= 0) return;
    const s = this.s;
    if (typeof target === "number") {
      s.players[target].life -= amount;
      this.log(`${src.def.name} が プレイヤー${target + 1} に ${amount} 点 (${s.players[target].life})`);
    } else {
      target.damage += amount;
      if (hasKw(src.def, "deathtouch")) target.deathtouched = true;
    }
    if (hasKw(src.def, "lifelink")) {
      s.players[src.controller].life += amount;
      this.log(`${src.def.name}: 絆魂で ${amount} 点回復 (プレイヤー${src.controller + 1}: ${s.players[src.controller].life})`);
    }
  }

  // 先制攻撃・二段攻撃のダメージ → 通常のダメージ。トランプルは、致死分を割り振ったあまりをプレイヤーに与える。
  // shortcut: 2回のダメージの間は、優先権のやりとりをしない
  private combatDamage() {
    const s = this.s;
    const defIdx = this.other(s.active);
    const strikes = (p: Perm, first: boolean) => (first ? hasKw(p.def, "first strike") || hasKw(p.def, "double strike") : !hasKw(p.def, "first strike") || hasKw(p.def, "double strike"));
    for (const first of [true, false]) {
      const attackers = s.players[s.active].field.filter((p) => p.attacking);
      const todo: (() => void)[] = []; // 同時に与えるため、先に決めてから実行する
      for (const a of attackers) {
        const blockers = s.players[defIdx].field.filter((b) => b.blocking === a.uid).sort((x, y) => (x.blockOrder ?? 0) - (y.blockOrder ?? 0));
        if (strikes(a, first)) {
          if (!a.blocked) todo.push(() => this.deal(a, defIdx, a.def.power));
          else if (!blockers.length) hasKw(a.def, "trample") && todo.push(() => this.deal(a, defIdx, a.def.power));
          else {
            let rest = a.def.power;
            blockers.forEach((b, i) => {
              const lethal = hasKw(a.def, "deathtouch") ? 1 : Math.max(0, b.def.toughness - b.damage);
              const n = i === blockers.length - 1 && !hasKw(a.def, "trample") ? rest : Math.min(rest, lethal);
              rest -= n;
              todo.push(() => this.deal(a, b, n));
            });
            if (hasKw(a.def, "trample") && rest > 0) todo.push(() => this.deal(a, defIdx, rest));
          }
        }
        for (const b of blockers) if (strikes(b, first)) todo.push(() => this.deal(b, a, b.def.power));
      }
      todo.forEach((f) => f());
      this.checkState();
    }
    this.onChange?.();
  }

  // 状況起因処理: 致死ダメージのクリーチャーは死に、ライフ 0 以下か山札切れで負ける
  private checkState() {
    const s = this.s;
    for (const [i, pl] of s.players.entries()) {
      for (const p of [...pl.field]) {
        if (isCreature(p.def) && (p.def.toughness <= 0 || (!hasKw(p.def, "indestructible") && (p.damage >= p.def.toughness || (p.deathtouched && p.damage > 0))))) {
          pl.field.splice(pl.field.indexOf(p), 1);
          s.players[p.owner].graveyard.push({ uid: p.uid, def: p.def, owner: p.owner });
          this.log(`${p.def.name} が死ぬ (プレイヤー${i + 1})`);
          this.fire("dies", p);
        }
      }
    }
    if (s.winner !== undefined) return; // 決着後は、もう判定しない (勝ちのログを何度も出さない)
    const lost = s.players.map((pl) => pl.life <= 0 || pl.drewEmpty);
    if (lost[0] && lost[1]) s.winner = -1;
    else if (lost[0]) s.winner = 1;
    else if (lost[1]) s.winner = 0;
    if (s.winner !== undefined) this.log(s.winner === -1 ? "引き分け" : `プレイヤー${s.winner + 1} の勝ち`);
  }
}
