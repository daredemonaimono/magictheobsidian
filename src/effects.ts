// カード処理の書き方 (v3)。Obsidian にも対戦エンジンにも依存しない、型・検証・日本語表示・v2 からの変換だけを持つ。
// 効果は「命令 (Step)」の並び。命令は 誰が / 何を / どこで / どうする / どれだけ / いつまで の穴を埋める形で書く。
// 古い記録 (v2: {"op": ...}) も読めて、同じ意味の v3 に変換される (AI を呼び直さなくてよい)。

export type Who = "you" | "opponent";
export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "exile";
export type CmpOp = "<" | "<=" | "=" | ">=" | ">";
export interface Cmp {
  op: CmpOp;
  n: number;
}

// どれだけ
export type Amount = number | { of: "power" | "toughness" | "cmc"; ref: string } | { count: CardSel };

// 何を
export interface CardSel {
  kind: "cards";
  zone?: Zone; // 既定は戦場
  owner?: Who | "any"; // 戦場ではコントローラー
  types?: string[]; // どれか (creature / land / artifact / enchantment / planeswalker / instant / sorcery / permanent)
  subtypes?: string[]; // どれか (Plains / Swamp など)
  not?: string[]; // 除く (land / basic / creature / legendary など)
  name?: string;
  cmc?: Cmp;
  power?: Cmp;
  count?: Amount | "all"; // 既定は 1
  upTo?: boolean; // 「N 枚まで」
  chooser?: Who; // 選ぶ人。既定は能力のコントローラー
  top?: boolean; // 山札の一番上から (選ばない)
}
export type PlayerSel = { kind: "player"; who: Who | "each" | "controllerOf"; ref?: string };
export type AnySel = { kind: "any" }; // 「いずれか1つの対象」(クリーチャー・プレインズウォーカー・プレイヤー)
export type RefSel = { kind: "ref"; ref: string }; // 名前のついた対象・前の命令の結果
export type Selector = CardSel | PlayerSel | AnySel | RefSel;

export type Cond = { cmp: [Amount, CmpOp, Amount] } | { has: CardSel } | { did: string };

// 命令 (どうする)
export type Step =
  | { do: "move"; what: Selector; to: Zone; how?: "draw" | "destroy" | "sacrifice" | "discard"; position?: "top" | "bottom"; as?: string }
  | { do: "change"; what: Selector; stat: "life" | "damage"; delta: Amount; as?: string } // life: 正で回復、負で失う。damage: 与えるダメージ (正)
  | { do: "addMana"; options: string; n?: number } // options = 出せる色 ("B" / "WUBRG")。複数なら1度だけ色を選び n 個出す
  | { do: "shuffle"; owner: Who }
  | { do: "flip"; win?: Step[]; lose?: Step[] }
  | { do: "if"; cond: Cond; then: Step[]; else?: Step[] }
  | { do: "may"; steps: Step[]; who?: Who }
  | { do: "unsupported"; text: string };

export interface AbilityCost {
  tap?: boolean;
  mana?: string; // "{1}{W}"
  life?: number;
  sacrificeSelf?: boolean;
}
export interface TargetDef {
  id: string;
  sel: CardSel | AnySel | PlayerSel;
}
export interface Ability {
  kind: "mana" | "activated" | "triggered" | "spell";
  cost?: AbilityCost;
  trigger?: { event: "upkeep" | "etb" | "dies"; whose?: Who | "each" };
  optional?: boolean; // 「〜してもよい」
  targets?: TargetDef[]; // 唱える・起動するときに選ぶ (誘発は、解決時に選ぶ。簡略)
  effects: Step[];
  text?: string; // 表示用
}

// ---- 検証 (知らない形は「未対応」にして、能力の残りは動かす) ----

const TYPES = ["creature", "land", "artifact", "enchantment", "planeswalker", "instant", "sorcery", "permanent", "card"];
const ZONES: Zone[] = ["library", "hand", "battlefield", "graveyard", "exile"];
const KINDS = ["mana", "activated", "triggered", "spell"];
const EVENTS = ["upkeep", "etb", "dies"];
const NOTS = ["land", "basic", "creature", "legendary", "artifact", "enchantment"];
const num = (x: unknown, d = 1) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : d);
const who = (x: unknown): Who => (x === "opponent" ? "opponent" : "you");
const strs = (x: unknown, allowed?: string[]) => (Array.isArray(x) ? x.map(String).filter((s) => !allowed || allowed.includes(s)) : undefined);
const cmp = (x: unknown): Cmp | undefined => {
  const c = x as Record<string, unknown> | undefined;
  return c && ["<", "<=", "=", ">=", ">"].includes(String(c.op)) && typeof c.n === "number" ? { op: c.op as CmpOp, n: c.n } : undefined;
};

export function cardSel(x: unknown): CardSel {
  const s = (x ?? {}) as Record<string, unknown>;
  const out: CardSel = { kind: "cards" };
  if (ZONES.includes(s.zone as Zone)) out.zone = s.zone as Zone;
  if (s.owner === "you" || s.owner === "opponent" || s.owner === "any") out.owner = s.owner;
  const types = strs(s.types, TYPES);
  if (types?.length) out.types = types;
  const sub = strs(s.subtypes);
  if (sub?.length) out.subtypes = sub;
  const not = strs(s.not, NOTS);
  if (not?.length) out.not = not;
  if (typeof s.name === "string") out.name = s.name;
  if (cmp(s.cmc)) out.cmc = cmp(s.cmc);
  if (cmp(s.power)) out.power = cmp(s.power);
  if (s.count === "all") out.count = "all";
  else if (s.count !== undefined) out.count = amount(s.count);
  if (s.upTo) out.upTo = true;
  if (s.chooser === "you" || s.chooser === "opponent") out.chooser = s.chooser;
  if (s.top) out.top = true;
  return out;
}

export function amount(x: unknown): Amount {
  if (typeof x === "number") return num(x, 0);
  const a = (x ?? {}) as Record<string, unknown>;
  if (["power", "toughness", "cmc"].includes(String(a.of)) && typeof a.ref === "string") return { of: a.of as "power", ref: a.ref };
  if (a.count) return { count: cardSel(a.count) };
  return 0;
}

function selector(x: unknown): Selector | undefined {
  const s = (x ?? {}) as Record<string, unknown>;
  if (s.kind === "player") return { kind: "player", who: s.who === "opponent" || s.who === "each" || s.who === "controllerOf" ? s.who : "you", ...(typeof s.ref === "string" ? { ref: s.ref } : {}) };
  if (s.kind === "any") return { kind: "any" };
  if (s.kind === "ref" && typeof s.ref === "string") return { kind: "ref", ref: s.ref };
  if (s.kind === "cards") return cardSel(s);
  return undefined;
}

function cond(x: unknown): Cond | undefined {
  const c = (x ?? {}) as Record<string, unknown>;
  if (Array.isArray(c.cmp) && c.cmp.length === 3 && ["<", "<=", "=", ">=", ">"].includes(String(c.cmp[1]))) return { cmp: [amount(c.cmp[0]), c.cmp[1] as CmpOp, amount(c.cmp[2])] };
  if (c.has) return { has: cardSel(c.has) };
  if (typeof c.did === "string") return { did: c.did };
  return undefined;
}

export function sanitizeSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r): Step => {
    const e = (r ?? {}) as Record<string, unknown>;
    const bad = (): Step => ({ do: "unsupported", text: typeof e.text === "string" ? e.text : JSON.stringify(r) });
    const as = typeof e.as === "string" ? { as: e.as } : {};
    switch (e.do) {
      case "move": {
        const what = selector(e.what);
        if (!what || !ZONES.includes(e.to as Zone)) return bad();
        return { do: "move", what, to: e.to as Zone, ...(["draw", "destroy", "sacrifice", "discard"].includes(String(e.how)) ? { how: e.how as "draw" } : {}), ...(e.position === "bottom" || e.position === "top" ? { position: e.position } : {}), ...as };
      }
      case "change": {
        const what = selector(e.what);
        if (!what || (e.stat !== "life" && e.stat !== "damage")) return bad();
        const d = typeof e.delta === "number" ? Math.trunc(e.delta) : amount(e.delta);
        return { do: "change", what, stat: e.stat, delta: d, ...as };
      }
      case "addMana":
        return typeof e.options === "string" && /^[WUBRGC]+$/.test(e.options) ? { do: "addMana", options: e.options, n: num(e.n) } : bad();
      case "shuffle":
        return { do: "shuffle", owner: who(e.owner) };
      case "flip":
        return { do: "flip", win: sanitizeSteps(e.win), lose: sanitizeSteps(e.lose) };
      case "if": {
        const c = cond(e.cond);
        return c ? { do: "if", cond: c, then: sanitizeSteps(e.then), else: sanitizeSteps(e.else) } : bad();
      }
      case "may":
        return { do: "may", steps: sanitizeSteps(e.steps), ...(e.who === "opponent" ? { who: "opponent" as const } : {}) };
      case "unsupported":
        return bad();
      default:
        return bad();
    }
  });
}

// ---- v2 (op) → v3 (do) の変換 ----

const nonbasic = (t: Record<string, unknown>) => (t.nonbasic ? ["basic"] : undefined);

// v2 の効果の配列を v3 にする。対象を取る効果は、能力の targets に持ち上げる (hoist に積む)
function fromV2(raw: unknown[], hoist: TargetDef[]): unknown[] {
  return raw.map((r) => {
    const e = (r ?? {}) as Record<string, unknown>;
    if (typeof e.do === "string") return e; // 既に v3
    switch (e.op) {
      case "addMana":
        return { do: "addMana", options: e.options, n: e.n };
      case "draw":
        return { do: "move", how: "draw", what: { kind: "cards", zone: "library", owner: who(e.who), top: true, count: num(e.n) }, to: "hand" };
      case "discard":
        return {
          do: "move",
          how: "discard",
          what: { kind: "cards", zone: "hand", owner: who(e.who), ...(e.nonland ? { not: ["land"] } : {}), count: num(e.n), chooser: e.chooser === "you" ? "you" : who(e.who) },
          to: "graveyard",
        };
      case "gainLife":
      case "loseLife":
        return { do: "change", what: { kind: "player", who: who(e.who) }, stat: "life", delta: (e.op === "gainLife" ? 1 : -1) * num(e.n, 0) };
      case "damage": {
        if (e.to === "you" || e.to === "opponent") return { do: "change", what: { kind: "player", who: e.to }, stat: "damage", delta: num(e.n, 0) };
        const id = `t${hoist.length + 1}`;
        hoist.push({ id, sel: e.to === "any" ? { kind: "any" } : { kind: "cards", types: ["creature"], count: 1 } });
        return { do: "change", what: { kind: "ref", ref: id }, stat: "damage", delta: num(e.n, 0) };
      }
      case "flip":
        return { do: "flip", win: fromV2((e.win as unknown[]) ?? [], hoist), lose: fromV2((e.lose as unknown[]) ?? [], hoist) };
      case "destroy":
      case "exile": {
        const t = (e.target ?? {}) as Record<string, unknown>;
        const id = `t${hoist.length + 1}`;
        const owner = t.controller === "you" || t.controller === "opponent" ? t.controller : "any";
        hoist.push({ id, sel: { kind: "cards", owner, types: Array.isArray(t.types) ? (t.types as string[]) : ["permanent"], ...(nonbasic(t) ? { not: nonbasic(t) } : {}), count: 1 } });
        return { do: "move", what: { kind: "ref", ref: id }, to: e.op === "destroy" ? "graveyard" : "exile", ...(e.op === "destroy" ? { how: "destroy" } : {}) };
      }
      default:
        return { do: "unsupported", text: typeof e.text === "string" ? e.text : JSON.stringify(r) };
    }
  });
}

// 記録の1つの能力 (v2 でも v3 でも) を、検証した v3 にする。形が壊れていれば undefined
export function normalizeAbility(raw: unknown): Ability | undefined {
  const a = (raw ?? {}) as Record<string, unknown>;
  if (!KINDS.includes(String(a.kind))) return undefined;
  const hoist: TargetDef[] = [];
  const effects = sanitizeSteps(fromV2(Array.isArray(a.effects) ? a.effects : [], hoist));
  const cost = (a.cost ?? {}) as Record<string, unknown>;
  const ab: Ability = { kind: a.kind as Ability["kind"], effects };
  if (a.cost) ab.cost = { ...(cost.tap ? { tap: true } : {}), ...(typeof cost.mana === "string" ? { mana: cost.mana } : {}), ...(cost.life ? { life: num(cost.life) } : {}), ...(cost.sacrificeSelf ? { sacrificeSelf: true } : {}) };
  if (ab.kind === "triggered") {
    const t = (a.trigger ?? {}) as Record<string, unknown>;
    if (!EVENTS.includes(String(t.event))) return { kind: "triggered", effects: [{ do: "unsupported", text: `未対応の誘発: ${JSON.stringify(a.trigger)}` }] };
    ab.trigger = { event: t.event as "upkeep", whose: t.whose === "opponent" || t.whose === "each" ? t.whose : "you" };
  }
  if (a.optional) ab.optional = true;
  if (typeof a.text === "string") ab.text = a.text;
  const targets: TargetDef[] = [...hoist];
  if (Array.isArray(a.targets)) {
    for (const t of a.targets as Record<string, unknown>[]) {
      const sel = selector(t.sel);
      if (typeof t.id === "string" && sel && sel.kind !== "ref") targets.push({ id: t.id, sel });
    }
  }
  if (targets.length) ab.targets = targets;
  return ab;
}

// ---- 日本語での表示 (診断画面・ログ・記録の確認用) ----

const T_JA: Record<string, string> = { creature: "クリーチャー", land: "土地", artifact: "アーティファクト", enchantment: "エンチャント", planeswalker: "プレインズウォーカー", instant: "インスタント", sorcery: "ソーサリー", permanent: "パーマネント", card: "カード", basic: "基本土地", legendary: "伝説の" };
const Z_JA: Record<Zone, string> = { library: "山札", hand: "手札", battlefield: "戦場", graveyard: "墓地", exile: "追放領域" };
const OWNER_JA = (o?: Who | "any") => (o === "you" ? "自分の" : o === "opponent" ? "相手の" : "");
const CMP_JA: Record<CmpOp, string> = { "<": "未満", "<=": "以下", "=": "", ">=": "以上", ">": "より大きい" };

export function describeAmount(a: Amount | "all" | undefined): string {
  if (a === undefined) return "1";
  if (a === "all") return "すべて";
  if (typeof a === "number") return String(a);
  if ("of" in a) return `「${a.ref}」の${a.of === "power" ? "パワー" : a.of === "toughness" ? "タフネス" : "マナ総量"}`;
  return `${describeSel(a.count)}の数`;
}

export function describeSel(s: Selector): string {
  if (s.kind === "ref") return `「${s.ref}」`;
  if (s.kind === "any") return "いずれか1つ(クリーチャー・プレイヤー)";
  if (s.kind === "player") return s.who === "you" ? "自分" : s.who === "opponent" ? "相手" : s.who === "each" ? "各プレイヤー" : `「${s.ref ?? "?"}」のコントローラー`;
  const parts = [
    `${s.zone ? Z_JA[s.zone] : "戦場"}の${OWNER_JA(s.owner)}`,
    ...(s.not ?? []).map((n) => `${T_JA[n] ?? n}でない`),
    ...(s.subtypes?.length ? [`${s.subtypes.join("か")}`] : []),
    ...(s.types?.length ? [s.types.map((t) => T_JA[t] ?? t).join("か")] : ["カード"]),
    ...(s.name ? [`「${s.name}」`] : []),
    ...(s.cmc ? [`マナ総量${s.cmc.n}${CMP_JA[s.cmc.op]}`] : []),
    ...(s.power ? [`パワー${s.power.n}${CMP_JA[s.power.op]}`] : []),
  ];
  const count = s.count === "all" ? "すべて" : `${describeAmount(s.count)}${s.upTo ? "枚まで" : "枚"}`;
  return `${s.top ? "上から" : ""}${parts.join(" ")} ${count}${s.chooser ? `(${s.chooser === "you" ? "自分" : "相手"}が選ぶ)` : ""}`;
}

export function describeCond(c: Cond): string {
  if ("cmp" in c) return `${describeAmount(c.cmp[0])} ${c.cmp[1]} ${describeAmount(c.cmp[2])}`;
  if ("has" in c) return `${describeSel(c.has)} がある`;
  return `「${c.did}」を実行した`;
}

export function describeStep(s: Step): string {
  switch (s.do) {
    case "move": {
      const verb = s.how === "draw" ? "引く" : s.how === "destroy" ? "破壊する" : s.how === "sacrifice" ? "生け贄にする" : s.how === "discard" ? "捨てる" : `${Z_JA[s.to]}へ移す`;
      return `${describeSel(s.what)} を${s.to === "exile" && !s.how ? "追放する" : s.to === "hand" && !s.how ? "手札に加える" : verb}${s.as ? ` →「${s.as}」` : ""}`;
    }
    case "change": {
      const d = typeof s.delta === "number" ? Math.abs(s.delta) : describeAmount(s.delta);
      if (s.stat === "damage") return `${describeSel(s.what)} に ${d} 点のダメージ`;
      return `${describeSel(s.what)} のライフを ${d} 点${typeof s.delta === "number" && s.delta < 0 ? "失う" : "得る"}`;
    }
    case "addMana":
      return `マナを出す: ${s.options.length > 1 ? `${s.options}のいずれか1色を` : s.options}${s.n && s.n > 1 ? ` ${s.n} 個` : ""}`;
    case "shuffle":
      return `${s.owner === "you" ? "自分" : "相手"}の山札をシャッフル`;
    case "flip":
      return `コインを投げる${s.win?.length ? `。勝ったら: ${s.win.map(describeStep).join("、")}` : ""}${s.lose?.length ? `。負けたら: ${s.lose.map(describeStep).join("、")}` : ""}`;
    case "if":
      return `もし ${describeCond(s.cond)} なら: ${s.then.map(describeStep).join("、")}${s.else?.length ? `。そうでなければ: ${s.else.map(describeStep).join("、")}` : ""}`;
    case "may":
      return `${s.who === "opponent" ? "相手が" : ""}してもよい: ${s.steps.map(describeStep).join("、")}`;
    default:
      return `【未対応】${s.text}`;
  }
}

export function describeCost(c?: AbilityCost): string {
  if (!c) return "";
  return [c.tap ? "{T}" : "", c.mana ?? "", c.life ? `${c.life} 点のライフを払う` : "", c.sacrificeSelf ? "これを生け贄にする" : ""].filter(Boolean).join("、");
}

export function describeAbility(a: Ability): string {
  const head = { spell: "唱えて解決したとき", activated: "起動", mana: "マナ能力", triggered: `誘発 (${a.trigger?.event === "upkeep" ? `${a.trigger.whose === "opponent" ? "相手" : a.trigger.whose === "each" ? "各プレイヤー" : "自分"}のアップキープの開始時` : a.trigger?.event === "etb" ? "戦場に出たとき" : a.trigger?.event === "dies" ? "死亡したとき" : "?"})` }[a.kind];
  const cost = describeCost(a.cost);
  const targets = a.targets?.length ? `対象: ${a.targets.map((t) => `「${t.id}」= ${describeSel(t.sel)}`).join("、")}。` : "";
  return `${head}${cost ? ` [${cost}]` : ""}${a.optional ? " (任意)" : ""}: ${targets}${a.effects.map(describeStep).join("、")}`;
}

// 入れ子の中も含めて、「未対応」の文を集める
export function unsupportedIn(steps: Step[]): string[] {
  return steps.flatMap((s) => (s.do === "unsupported" ? [s.text] : s.do === "flip" ? unsupportedIn([...(s.win ?? []), ...(s.lose ?? [])]) : s.do === "if" ? unsupportedIn([...s.then, ...(s.else ?? [])]) : s.do === "may" ? unsupportedIn(s.steps) : []));
}
