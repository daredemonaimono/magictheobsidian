// 対戦エンジンの核 (Obsidian に依存しない)。2人対戦。
// 持つもの: ゾーン、ターンとステップ、優先権とスタック、マナの支払い、土地は1ターン1枚、戦闘 (飛行・速攻・警戒)、勝敗。
// 持たないもの (後で足す): 呪文・能力の効果、インスタントの効果、ブロックの複数割り当て、トランプル・先制攻撃など。
// カードの効果は未実装で、インスタント・ソーサリーは唱えると墓地に行くだけ (ログに「効果は未実装」と出す)。
// shortcut: マナの支払いは全探索に近い単純な割り当て。ソース20個を超えるデッキで重くなったら見直す。

export type Phase = "upkeep" | "draw" | "main1" | "beginCombat" | "attackers" | "blockers" | "damage" | "endCombat" | "main2" | "end";

// ---- 能力と効果 (カードごとの処理の記録。Bot/Rules/ のノートに JSON で保存され、エンジンが機械的に実行する) ----

export type Who = "you" | "opponent";
export interface TargetSpec {
  controller?: Who | "any";
  types?: ("creature" | "land" | "artifact" | "enchantment" | "planeswalker" | "permanent")[];
  nonbasic?: boolean; // 基本でない土地だけ
}
// 効果の部品。足りないものは「未対応」にして記録され、あとから増やす
export type Op =
  | { op: "addMana"; options: string; n?: number } // options = 出せる色 ("B" / "WB" / "WUBRG")。複数なら1度だけ色を選び、n 個出す
  | { op: "draw"; n: number; who?: Who }
  | { op: "gainLife"; n: number; who?: Who }
  | { op: "loseLife"; n: number; who?: Who }
  | { op: "damage"; n: number; to: Who | "creature" | "any" }
  | { op: "flip"; win?: Op[]; lose?: Op[] } // コイン投げ (seed つきの乱数)
  | { op: "destroy"; target: TargetSpec }
  | { op: "exile"; target: TargetSpec }
  | { op: "unsupported"; text: string };
export interface AbilityCost {
  tap?: boolean;
  mana?: string; // "{1}{W}"
  life?: number;
  sacrificeSelf?: boolean;
}
export interface Ability {
  kind: "mana" | "activated" | "triggered" | "spell";
  cost?: AbilityCost; // mana / activated
  trigger?: { event: "upkeep" | "etb" | "dies"; whose?: Who | "each" }; // triggered。upkeep の whose = 誰のアップキープか
  optional?: boolean; // 「〜してもよい」
  effects: Op[];
  text?: string; // 表示用
}

export interface CardDef {
  key: string; // Cards/ のファイル名
  name: string;
  typeLine: string;
  manaCost: string;
  cmc: number;
  power: number;
  toughness: number;
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
  | { type: "choice"; player: number; prompt: string; options: string[] };
export type Block = { attacker: number; blocker: number };
// priority → PriorityAction / attackers → number[] (攻撃する uid) / blockers → Block[] / choice → 選んだ番号 (0 始まり)
export type Answer = PriorityAction | number[] | Block[] | number;
export type Controller = (g: Game, d: Decision) => Promise<Answer>;
export interface Step {
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
    for (const e of a.effects) if (e.op === "addMana") for (let i = 0; i < (e.n ?? 1); i++) units.push(e.options);
  }
  return units;
}

// abilities が無いときは、効果テキストから読めるマナ能力だけを持つ
export function makeDef(p: { key: string; name: string; typeLine: string; manaCost: string; cmc: number; power?: number; toughness?: number; oracle: string; abilities?: Ability[]; keywords?: string[] }): CardDef {
  const abilities: Ability[] =
    p.abilities ??
    (parseMana(p.typeLine, p.oracle).length
      ? [{ kind: "mana", cost: { tap: true }, effects: parseMana(p.typeLine, p.oracle).map((options) => ({ op: "addMana" as const, options })) }]
      : []);
  // Scryfall のキーワード一覧 (言語に依らず英語) と、効果テキストから読んだものを合わせる
  const keywords = [...new Set([...parseKeywords(p.oracle), ...(p.keywords ?? []).map((k) => k.toLowerCase()).filter((k) => KEYWORDS.includes(k))])];
  return { ...p, power: p.power ?? 0, toughness: p.toughness ?? 0, keywords, abilities, mana: simpleMana(abilities) };
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
const usable = (p: Perm) => !p.tapped && !(isCreature(p.def) && p.sick && !hasKw(p.def, "haste"));

export class Game {
  s: State;
  history: Step[] = [];
  private nextUid = 1;
  private rand: () => number;
  onLog?: (line: string) => void;
  onChange?: () => void; // 盤面が変わったとき (画面の更新用)

  // decks[i] = i 番目のプレイヤーのデッキ。先攻は 0 番。seed を同じにすると、シャッフルもコイン投げも同じになる。
  // manual[i] = true のプレイヤーは、マナを手でタップして出す (false は、唱えるとき自動でタップする)
  constructor(decks: CardDef[][], public seed: number, private controllers: Controller[], private manual: boolean[] = [false, false]) {
    this.rand = rng(seed);
    this.s = { players: [], active: 0, turn: 0, phase: "upkeep", stack: [], landDropped: false, log: [] };
    decks.forEach((deck, owner) => {
      const library = deck.map((def) => ({ uid: this.nextUid++, def, owner }));
      for (let i = library.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [library[i], library[j]] = [library[j], library[i]];
      }
      this.s.players.push({ life: 20, library, hand: library.splice(0, 7), field: [], graveyard: [], exile: [], pool: [], drewEmpty: false });
    });
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
    while (this.s.winner === undefined && this.s.turn < maxTurns) await this.turn();
    if (this.s.winner === undefined) this.log(`${maxTurns} ターンで打ち切り`);
  }

  // 各ステップで優先権のやりとりをする。攻撃クリーチャーがいなければ、宣言・ブロック・ダメージのステップは飛ばす
  private async turn() {
    const s = this.s;
    s.turn++;
    s.active = (s.turn - 1) % 2;
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
    this.cleanup();
  }

  private draw(p: number) {
    const pl = this.s.players[p];
    const c = pl.library.shift();
    if (!c) return void ((pl.drewEmpty = true), this.log(`プレイヤー${p + 1}: 山札が無い`), this.checkState());
    pl.hand.push(c);
    this.log(`プレイヤー${p + 1}: ドロー (${p === 0 ? c.def.name : "?"})`);
  }

  private cleanup() {
    const s = this.s;
    for (const pl of s.players) for (const p of pl.field) (p.damage = 0), (p.deathtouched = false);
    const me = s.players[s.active];
    while (me.hand.length > 7) {
      me.hand.sort((a, b) => a.def.cmc - b.def.cmc);
      const c = me.hand.pop()!;
      me.graveyard.push(c);
      this.log(`プレイヤー${s.active + 1}: 手札上限で捨てる (${c.def.name})`);
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
      if (tap) acts.push({ kind: "cast", uid: c.uid, tap });
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
          const units = ab.effects.filter((e): e is Extract<Op, { op: "addMana" }> => e.op === "addMana");
          if (units.length === 1 && (units[0].n ?? 1) === 1 && units[0].options.length > 1) for (const color of units[0].options) acts.push({ kind: "tapMana", uid: perm.uid, color });
          else acts.push({ kind: "tapMana", uid: perm.uid });
          return;
        }
        if (cost.life !== undefined && pl.life <= cost.life) return;
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
  private async choose(player: number, prompt: string, options: string[]): Promise<number> {
    if (options.length <= 1) return 0;
    const n = await this.ask<number>({ type: "choice", player, prompt, options });
    return Number.isInteger(n) && n >= 0 && n < options.length ? n : 0;
  }

  private async priorityRound() {
    const s = this.s;
    let p = s.active;
    let passes = 0;
    while (s.winner === undefined) {
      const actions = this.actions(p);
      // 行動がパスと「マナのタップ」だけなら聞かない (呼び出しの節約)
      const meaningful = actions.filter((x) => x.kind !== "pass" && x.kind !== "tapMana");
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
    const perm: Perm = { ...card, controller, tapped: false, sick: true, damage: 0, attacking: false };
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
      for (const e of units) if (e.op === "addMana") for (let i = 0; i < (e.n ?? 1); i++) pl.pool.push(a.color ?? e.options[0]);
      this.log(`プレイヤー${p + 1}: ${perm.def.name} をタップ (マナ ${pl.pool.join("")})`);
    } else if (a.kind === "activate") {
      const perm = this.perm(a.uid)!;
      const ab = perm.def.abilities[a.index];
      this.payCost(p, a.tap, ab.cost?.mana);
      if (ab.cost?.life) pl.life -= ab.cost.life;
      if (ab.cost?.sacrificeSelf) this.sacrifice(perm);
      this.log(`プレイヤー${p + 1}: 起動 ${perm.def.name}${ab.text ? ` (${ab.text})` : ""}`);
      if (ab.kind === "mana") await this.runEffects(ab.effects, { controller: p, source: perm.def }); // マナ能力はスタックを使わない
      else s.stack.push({ def: perm.def, controller: p, ability: ab });
      this.checkState();
    } else {
      const i = pl.hand.findIndex((c) => c.uid === a.uid);
      const [card] = pl.hand.splice(i, 1);
      if (a.kind === "land") {
        this.enter(card, p);
        s.landDropped = true;
        this.log(`プレイヤー${p + 1}: 土地を出す ${card.def.name}`);
      } else {
        this.payCost(p, a.tap, card.def.manaCost);
        s.stack.push({ def: card.def, controller: p, card });
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
    if (item.ability) {
      if (item.ability.optional && (await this.choose(item.controller, `${item.def.name}: ${item.ability.text ?? "能力"} を使う?`, ["使う", "使わない"])) === 1) return;
      this.log(`${item.def.name} の能力を解決`);
      await this.runEffects(item.ability.effects, { controller: item.controller, source: item.def });
    } else {
      const card = item.card!;
      if (isPermanent(card.def)) {
        this.enter(card, item.controller);
        this.log(`${card.def.name} が場に出る`);
      } else {
        const spell = card.def.abilities.filter((a) => a.kind === "spell");
        if (!spell.length) this.log(`${card.def.name} を解決 (効果は未実装)`);
        else {
          this.log(`${card.def.name} を解決`);
          for (const a of spell) await this.runEffects(a.effects, { controller: item.controller, source: card.def });
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

  // ---- 効果の実行 ----

  private candidates(spec: TargetSpec, controller: number): Perm[] {
    return this.s.players
      .flatMap((pl) => pl.field)
      .filter((p) => {
        if (hasKw(p.def, "shroud") || (hasKw(p.def, "hexproof") && p.controller !== controller)) return false; // 呪禁・被覆
        const c = spec.controller ?? "any";
        if (c === "you" && p.controller !== controller) return false;
        if (c === "opponent" && p.controller === controller) return false;
        const types = spec.types ?? ["permanent"];
        const ok = types.some((t) => (t === "permanent" ? true : t === "land" ? isLand(p.def) : t === "creature" ? isCreature(p.def) : new RegExp(`\\b${t}\\b`, "i").test(p.def.typeLine)));
        if (!ok) return false;
        if (spec.nonbasic && /\bBasic\b/.test(p.def.typeLine)) return false;
        return true;
      });
  }

  private async pickPerm(spec: TargetSpec, controller: number, what: string): Promise<Perm | undefined> {
    const list = this.candidates(spec, controller);
    if (!list.length) return void this.log(`${what}: 対象が無い`);
    const i = await this.choose(controller, `${what}: 対象を選ぶ`, list.map((p) => `${p.def.name} (プレイヤー${p.controller + 1})`));
    return list[i];
  }

  private who(w: Who | undefined, controller: number) {
    return w === "opponent" ? this.other(controller) : controller;
  }

  private async runEffects(effects: Op[], ctx: { controller: number; source: CardDef }): Promise<void> {
    const s = this.s;
    const me = ctx.controller;
    for (const e of effects) {
      if (s.winner !== undefined) return;
      switch (e.op) {
        case "addMana": {
          const n = e.n ?? 1;
          const color = e.options[await this.choose(me, "マナの色を選ぶ", e.options.split(""))];
          for (let i = 0; i < n; i++) s.players[me].pool.push(color);
          this.log(`プレイヤー${me + 1}: マナ ${color.repeat(n)} (プール ${s.players[me].pool.join("")})`);
          break;
        }
        case "draw":
          for (let i = 0; i < e.n; i++) this.draw(this.who(e.who, me));
          break;
        case "gainLife":
        case "loseLife": {
          const p = this.who(e.who, me);
          s.players[p].life += e.op === "gainLife" ? e.n : -e.n;
          this.log(`プレイヤー${p + 1}: ライフ ${e.op === "gainLife" ? "+" : "-"}${e.n} (${s.players[p].life})`);
          break;
        }
        case "damage": {
          if (e.to === "you" || e.to === "opponent") {
            const p = this.who(e.to, me);
            s.players[p].life -= e.n;
            this.log(`${ctx.source.name} が プレイヤー${p + 1} に ${e.n} 点 (${s.players[p].life})`);
          } else {
            const perms = this.candidates({ types: ["creature"] }, me);
            const opts = [...perms.map((p) => `${p.def.name} (プレイヤー${p.controller + 1})`), ...(e.to === "any" ? ["プレイヤー1", "プレイヤー2"] : [])];
            if (!opts.length) {
              this.log(`${ctx.source.name}: 対象が無い`);
              break;
            }
            const i = await this.choose(me, `${ctx.source.name}: ${e.n} 点のダメージの対象を選ぶ`, opts);
            if (i < perms.length) {
              perms[i].damage += e.n;
              this.log(`${ctx.source.name} が ${perms[i].def.name} に ${e.n} 点`);
            } else {
              const p = i - perms.length;
              s.players[p].life -= e.n;
              this.log(`${ctx.source.name} が プレイヤー${p + 1} に ${e.n} 点 (${s.players[p].life})`);
            }
          }
          break;
        }
        case "flip": {
          const win = this.rand() < 0.5;
          this.log(`コイン投げ: ${win ? "勝ち" : "負け"}`);
          await this.runEffects((win ? e.win : e.lose) ?? [], ctx);
          break;
        }
        case "destroy":
        case "exile": {
          const t = await this.pickPerm(e.target, me, `${ctx.source.name}`);
          if (!t) break;
          if (e.op === "destroy" && hasKw(t.def, "indestructible")) {
            this.log(`${t.def.name} は破壊されない`);
            break;
          }
          const pl = s.players[t.controller];
          pl.field.splice(pl.field.indexOf(t), 1);
          const card: Card = { uid: t.uid, def: t.def, owner: t.owner };
          if (e.op === "destroy") {
            s.players[t.owner].graveyard.push(card);
            this.fire("dies", t);
          } else s.players[t.owner].exile.push(card);
          this.log(`${t.def.name} を${e.op === "destroy" ? "破壊" : "追放"}`);
          break;
        }
        case "unsupported":
          this.log(`未対応の効果: ${e.text}`);
          break;
      }
      this.checkState();
    }
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
    const lost = s.players.map((pl) => pl.life <= 0 || pl.drewEmpty);
    if (lost[0] && lost[1]) s.winner = -1;
    else if (lost[0]) s.winner = 1;
    else if (lost[1]) s.winner = 0;
    if (s.winner !== undefined) this.log(s.winner === -1 ? "引き分け" : `プレイヤー${s.winner + 1} の勝ち`);
  }
}
