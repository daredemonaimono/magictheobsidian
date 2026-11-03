// 対戦エンジンの核 (Obsidian に依存しない)。2人対戦。
// 持つもの: ゾーン、ターンとステップ、優先権とスタック、マナの支払い、土地は1ターン1枚、戦闘 (飛行・速攻・警戒)、勝敗。
// 持たないもの (後で足す): 呪文・能力の効果、インスタントの効果、ブロックの複数割り当て、トランプル・先制攻撃など。
// カードの効果は未実装で、インスタント・ソーサリーは唱えると墓地に行くだけ (ログに「効果は未実装」と出す)。
// shortcut: マナの支払いは全探索に近い単純な割り当て。ソース20個を超えるデッキで重くなったら見直す。

export type Phase = "upkeep" | "draw" | "main1" | "beginCombat" | "attackers" | "blockers" | "damage" | "endCombat" | "main2" | "end";

export interface CardDef {
  key: string; // Cards/ のファイル名
  name: string;
  typeLine: string;
  manaCost: string;
  cmc: number;
  power: number;
  toughness: number;
  keywords: string[]; // 小文字: flying, haste, vigilance, flash, reach
  mana: string[]; // タップで出るマナ。1要素 = 1マナで、出せる色の集合 ("WB" = 白か黒、"C" = 無色)
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
}
export interface Player {
  life: number;
  library: Card[];
  hand: Card[];
  field: Perm[];
  graveyard: Card[];
  drewEmpty: boolean;
}
export interface StackItem {
  card: Card;
  controller: number;
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

export type PriorityAction = { kind: "pass" } | { kind: "land"; uid: number } | { kind: "cast"; uid: number; tap: number[] };
export type Decision =
  | { type: "priority"; player: number; actions: PriorityAction[] }
  | { type: "attackers"; player: number; eligible: number[] }
  | { type: "blockers"; player: number; attackers: number[]; eligible: number[] };
export type Block = { attacker: number; blocker: number };
// priority → PriorityAction / attackers → number[] (攻撃する uid) / blockers → Block[]
export type Controller = (g: Game, d: Decision) => Promise<PriorityAction | number[] | Block[]>;
export interface Step {
  player: number;
  type: Decision["type"];
  answer: unknown;
}

// ---- カードの定義 ----

const KEYWORDS = ["flying", "haste", "vigilance", "flash", "reach"];

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

export function makeDef(p: { key: string; name: string; typeLine: string; manaCost: string; cmc: number; power?: number; toughness?: number; oracle: string }): CardDef {
  return { ...p, power: p.power ?? 0, toughness: p.toughness ?? 0, keywords: parseKeywords(p.oracle), mana: parseMana(p.typeLine, p.oracle) };
}

export const isLand = (d: CardDef) => /\bLand\b/.test(d.typeLine);
export const isCreature = (d: CardDef) => /\bCreature\b/.test(d.typeLine);
const isPermanent = (d: CardDef) => !/\b(Instant|Sorcery)\b/.test(d.typeLine);
const hasKw = (d: CardDef, k: string) => d.keywords.includes(k);

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

export class Game {
  s: State;
  history: Step[] = [];
  private nextUid = 1;
  onLog?: (line: string) => void;
  onChange?: () => void; // 盤面が変わったとき (画面の更新用)

  // decks[i] = i 番目のプレイヤーのデッキ。先攻は 0 番。seed を同じにすると、シャッフルが同じになる
  constructor(decks: CardDef[][], public seed: number, private controllers: Controller[]) {
    const rand = rng(seed);
    this.s = { players: [], active: 0, turn: 0, phase: "upkeep", stack: [], landDropped: false, log: [] };
    decks.forEach((deck, owner) => {
      const library = deck.map((def) => ({ uid: this.nextUid++, def, owner }));
      for (let i = library.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [library[i], library[j]] = [library[j], library[i]];
      }
      this.s.players.push({ life: 20, library, hand: library.splice(0, 7), field: [], graveyard: [], drewEmpty: false });
    });
  }

  log(line: string) {
    this.s.log.push(line);
    this.onLog?.(line);
  }

  private other = (p: number) => 1 - p;
  card(uid: number): Card | undefined {
    for (const p of this.s.players) for (const c of [...p.hand, ...p.field, ...p.graveyard, ...p.library]) if (c.uid === uid) return c;
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
      return s.winner === undefined;
    };
    s.phase = "upkeep";
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
    for (const pl of s.players) for (const p of pl.field) (p.attacking = false), (p.blocking = undefined);
    if (!(await step("endCombat")) || !(await step("main2")) || !(await step("end"))) return;
    this.cleanup();
  }

  private draw(p: number) {
    const pl = this.s.players[p];
    const c = pl.library.shift();
    if (!c) return void (pl.drewEmpty = true, this.log(`プレイヤー${p + 1}: 山札が無い`), this.checkState());
    pl.hand.push(c);
    this.log(`プレイヤー${p + 1}: ドロー (${p === 0 ? c.def.name : "?"})`);
  }

  private cleanup() {
    const s = this.s;
    for (const pl of s.players) for (const p of pl.field) p.damage = 0;
    const me = s.players[s.active];
    while (me.hand.length > 7) {
      me.hand.sort((a, b) => a.def.cmc - b.def.cmc);
      const c = me.hand.pop()!;
      me.graveyard.push(c);
      this.log(`プレイヤー${s.active + 1}: 手札上限で捨てる (${c.def.name})`);
    }
  }

  // ---- 優先権 ----

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
      const sources = pl.field.filter((x) => !x.tapped && x.def.mana.length && !(isCreature(x.def) && x.sick && !hasKw(x.def, "haste")));
      const tap = planPayment(parseCost(c.def.manaCost), sources);
      if (tap) acts.push({ kind: "cast", uid: c.uid, tap });
    }
    acts.push({ kind: "pass" });
    return acts;
  }

  private async ask<T>(d: Decision): Promise<T> {
    const answer = await this.controllers[d.player](this, d);
    this.history.push({ player: d.player, type: d.type, answer });
    return answer as T;
  }

  private async priorityRound() {
    const s = this.s;
    let p = s.active;
    let passes = 0;
    while (s.winner === undefined) {
      const actions = this.actions(p);
      // 選べるのがパスだけなら聞かない (呼び出しの節約)
      const a = actions.length === 1 ? actions[0] : await this.ask<PriorityAction>({ type: "priority", player: p, actions });
      if (a.kind === "pass") {
        if (++passes >= 2) {
          if (!s.stack.length) return;
          this.resolveTop();
          passes = 0;
          p = s.active;
        } else p = this.other(p);
        continue;
      }
      passes = 0;
      const chosen = actions.find((x) => x.kind === a.kind && "uid" in x && "uid" in a && x.uid === a.uid);
      if (!chosen) throw new Error(`選べない行動: ${JSON.stringify(a)}`);
      this.perform(p, chosen);
    }
  }

  private perform(p: number, a: PriorityAction) {
    const s = this.s;
    const pl = s.players[p];
    if (a.kind === "pass") return;
    const i = pl.hand.findIndex((c) => c.uid === a.uid);
    const [card] = pl.hand.splice(i, 1);
    if (a.kind === "land") {
      pl.field.push({ ...card, controller: p, tapped: false, sick: true, damage: 0, attacking: false });
      s.landDropped = true;
      this.log(`プレイヤー${p + 1}: 土地を出す ${card.def.name}`);
    } else {
      for (const uid of a.tap) this.perm(uid)!.tapped = true;
      s.stack.push({ card, controller: p });
      this.log(`プレイヤー${p + 1}: 唱える ${card.def.name} ${card.def.manaCost}`);
    }
    this.onChange?.();
  }

  private resolveTop() {
    const s = this.s;
    const item = s.stack.pop()!;
    const pl = s.players[item.controller];
    if (isPermanent(item.card.def)) {
      pl.field.push({ ...item.card, controller: item.controller, tapped: false, sick: true, damage: 0, attacking: false });
      this.log(`${item.card.def.name} が場に出る`);
    } else {
      s.players[item.card.owner].graveyard.push(item.card);
      this.log(`${item.card.def.name} を解決 (効果は未実装)`);
    }
    this.checkState();
    this.onChange?.();
  }

  // ---- 戦闘 ----

  private async declareAttackers(): Promise<boolean> {
    const s = this.s;
    const me = s.players[s.active];
    const eligible = me.field.filter((p) => isCreature(p.def) && !p.tapped && (!p.sick || hasKw(p.def, "haste"))).map((p) => p.uid);
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

  private async declareBlockers() {
    const s = this.s;
    const def = this.other(s.active);
    const attackers = s.players[s.active].field.filter((p) => p.attacking);
    const eligible = s.players[def].field.filter((p) => isCreature(p.def) && !p.tapped).map((p) => p.uid);
    if (!eligible.length) return;
    const blocks = await this.ask<Block[]>({ type: "blockers", player: def, attackers: attackers.map((a) => a.uid), eligible });
    const usedA = new Set<number>();
    const usedB = new Set<number>();
    for (const b of blocks) {
      const a = attackers.find((x) => x.uid === b.attacker);
      const blk = s.players[def].field.find((x) => x.uid === b.blocker);
      if (!a || !blk || !eligible.includes(b.blocker) || usedA.has(b.attacker) || usedB.has(b.blocker)) continue; // shortcut: 1体に複数でブロックは未対応
      if (hasKw(a.def, "flying") && !hasKw(blk.def, "flying") && !hasKw(blk.def, "reach")) continue;
      usedA.add(b.attacker);
      usedB.add(b.blocker);
      blk.blocking = a.uid;
      this.log(`ブロック: ${blk.def.name} → ${a.def.name}`);
    }
    this.onChange?.();
  }

  private combatDamage() {
    const s = this.s;
    const def = s.players[this.other(s.active)];
    for (const a of s.players[s.active].field.filter((p) => p.attacking)) {
      const blocker = def.field.find((b) => b.blocking === a.uid);
      if (blocker) {
        blocker.damage += a.def.power;
        a.damage += blocker.def.power;
      } else {
        def.life -= a.def.power;
        this.log(`${a.def.name} が ${a.def.power} 点 (プレイヤー${this.other(s.active) + 1}: ${def.life})`);
      }
    }
    this.checkState();
    this.onChange?.();
  }

  // 状況起因処理: 致死ダメージのクリーチャーは死に、ライフ 0 以下か山札切れで負ける
  private checkState() {
    const s = this.s;
    for (const [i, pl] of s.players.entries()) {
      for (const p of [...pl.field]) {
        if (isCreature(p.def) && (p.def.toughness <= 0 || p.damage >= p.def.toughness)) {
          pl.field.splice(pl.field.indexOf(p), 1);
          s.players[p.owner].graveyard.push({ uid: p.uid, def: p.def, owner: p.owner });
          this.log(`${p.def.name} が死ぬ (プレイヤー${i + 1})`);
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
