// カード処理の書き方 (v3)。Obsidian にも対戦エンジンにも依存しない、型・検証・日本語表示・v2 からの変換だけを持つ。
// 効果は「命令 (Step)」の並び。命令は 誰が / 何を / どこで / どうする / どれだけ / いつまで の穴を埋める形で書く。
// 古い記録 (v2: {"op": ...}) も読めて、同じ意味の v3 に変換される (AI を呼び直さなくてよい)。

export type Who = "you" | "opponent";
export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "exile" | "stack"; // stack = スタックの呪文 (対象にする・コピーする)。移す先には使えない
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
  colors?: string[]; // どれか (W U B R G)。マナコストの色。「黒のカード」など
  subtypes?: string[]; // どれか (Plains / Swamp など)
  supertypes?: string[]; // すべて (legendary / basic / snow)。「伝説の〜」「基本〜」
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
export type SelfSel = { kind: "self" }; // いま解決している呪文・能力そのもの (コピーするときなど)
export type AnySel = { kind: "any" }; // 「いずれか1つの対象」(クリーチャー・プレインズウォーカー・プレイヤー)
export type RefSel = { kind: "ref"; ref: string }; // 名前のついた対象・前の命令の結果
export type Selector = CardSel | PlayerSel | AnySel | RefSel | SelfSel;

export type Cond = { cmp: [Amount, CmpOp, Amount] } | { has: CardSel } | { did: string };

// 命令 (どうする)
export type Step =
  | { do: "move"; what: Selector; to: Zone; how?: "draw" | "destroy" | "sacrifice" | "discard"; position?: "top" | "bottom"; as?: string }
  | { do: "change"; what: Selector; stat: "life" | "damage"; delta: Amount; as?: string } // life: 正で回復、負で失う。damage: 与えるダメージ (正)
  | { do: "addMana"; options: string; n?: number } // options = 出せる色 ("B" / "WUBRG")。複数なら1度だけ色を選び n 個出す
  | { do: "shuffle"; owner: Who }
  | { do: "flip"; win?: Step[]; lose?: Step[] }
  | { do: "if"; cond: Cond; then: Step[]; else?: Step[] }
  | { do: "may"; steps: Step[]; who?: Who | PlayerSel; cost?: { mana?: string } } // who = 決める人 (支払うコストがあれば、その人が払う)。cost = してもよいが、払うなら
  | { do: "copy"; what: Selector; by?: PlayerSel; newTargets?: boolean; color?: string } // スタックの呪文 (self = いま解決している呪文) のコピーを作る。コピーは、先に解決される。by = コピーを持つ人。newTargets = 新しい対象を選んでもよい。color = コピーの色
  | { do: "unsupported"; text: string };

export interface AbilityCost {
  tap?: boolean;
  mana?: string; // "{1}{W}"
  life?: number;
  sacrificeSelf?: boolean;
}
// 代替コスト: マナコストの代わりに払う。どれか1つ以上を組み合わせられる
export interface AltCost {
  sacrifice?: { sel: CardSel; n: number }; // 自分のパーマネントを n 個生け贄にする
  exileFromHand?: { sel: CardSel; n: number }; // 自分の手札から n 枚を追放する
  life?: number;
  mana?: string; // 別のマナコスト
  unless?: "yourTurn" | "notYourTurn"; // 条件: 自分のターンでないときだけ、など
}
export interface Suspend {
  n: number; // 時間カウンターの数
  cost: string; // 待機コスト ("{R}")
}
export interface TargetDef {
  id: string;
  sel: CardSel | AnySel | PlayerSel;
}
// 常在型能力の制限 (戦場にある間、ずっと働く)。いまは「起動の禁止」だけ
export type Restriction = { type: "cantActivate"; what: CardSel }; // what に合うパーマネントの、起動型能力・マナ能力は、起動できない

export interface Ability {
  kind: "mana" | "activated" | "triggered" | "spell" | "static" | "altCost" | "suspend";
  restrictions?: Restriction[]; // static のとき
  alt?: AltCost; // altCost のとき (その呪文を、このコストで唱えられる)
  suspend?: Suspend; // suspend のとき (手札から待機できる)
  cost?: AbilityCost;
  trigger?: { event: "upkeep" | "etb" | "dies"; whose?: Who | "each" };
  optional?: boolean; // 「〜してもよい」
  targets?: TargetDef[]; // 唱える・起動するときに選ぶ (誘発は、解決時に選ぶ。簡略)
  effects: Step[];
  text?: string; // 表示用
}

export const STEP_VERBS = ["move", "change", "addMana", "shuffle", "flip", "if", "may", "copy", "unsupported"] as const; // 命令の種類 (型のカタログと、AI への指示書が、これと合っているか、テストで確かめる)

// ---- 検証 (知らない形は「未対応」にして、能力の残りは動かす) ----

const TYPES = ["creature", "land", "artifact", "enchantment", "planeswalker", "instant", "sorcery", "permanent", "card"];
const ZONES: Zone[] = ["library", "hand", "battlefield", "graveyard", "exile", "stack"];
const DEST_ZONES: Zone[] = ["library", "hand", "battlefield", "graveyard", "exile"]; // 移す先
const COLORS = ["W", "U", "B", "R", "G"];
const KINDS = ["mana", "activated", "triggered", "spell", "static", "altCost", "suspend"];
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
  const cols = strs(s.colors, COLORS);
  if (cols?.length) out.colors = cols;
  const sup = strs(s.supertypes, ["legendary", "basic", "snow"]);
  if (sup?.length) out.supertypes = sup;
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
  if (s.kind === "self") return { kind: "self" };
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
        if (!what || !DEST_ZONES.includes(e.to as Zone)) return bad();
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
      case "may": {
        const who = e.who === "opponent" ? ("opponent" as const) : selector(e.who);
        const c = (e.cost ?? {}) as Record<string, unknown>;
        return { do: "may", steps: sanitizeSteps(e.steps), ...(who && who !== "opponent" && who.kind === "player" ? { who } : who === "opponent" ? { who } : {}), ...(typeof c.mana === "string" ? { cost: { mana: c.mana } } : {}) };
      }
      case "copy": {
        const what = selector(e.what);
        if (!what || (what.kind !== "self" && what.kind !== "ref")) return bad();
        const by = selector(e.by);
        return { do: "copy", what, ...(by && by.kind === "player" ? { by } : {}), ...(e.newTargets ? { newTargets: true } : {}), ...(typeof e.color === "string" && COLORS.includes(e.color) ? { color: e.color } : {}) };
      }
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
export function normalizeAbility(raw: unknown, macros?: Map<string, Macro>): Ability | undefined {
  const a = (raw ?? {}) as Record<string, unknown>;
  if (!KINDS.includes(String(a.kind))) return undefined;
  const hoist: TargetDef[] = [];
  const effects = sanitizeSteps(fromV2(macros ? expandSteps(Array.isArray(a.effects) ? a.effects : [], macros) : Array.isArray(a.effects) ? a.effects : [], hoist));
  const cost = (a.cost ?? {}) as Record<string, unknown>;
  const ab: Ability = { kind: a.kind as Ability["kind"], effects };
  if (a.cost) ab.cost = { ...(cost.tap ? { tap: true } : {}), ...(typeof cost.mana === "string" ? { mana: cost.mana } : {}), ...(cost.life ? { life: num(cost.life) } : {}), ...(cost.sacrificeSelf ? { sacrificeSelf: true } : {}) };
  if (ab.kind === "triggered") {
    const t = (a.trigger ?? {}) as Record<string, unknown>;
    if (!EVENTS.includes(String(t.event))) return { kind: "triggered", effects: [{ do: "unsupported", text: `未対応の誘発: ${JSON.stringify(a.trigger)}` }] };
    ab.trigger = { event: t.event as "upkeep", whose: t.whose === "opponent" || t.whose === "each" ? t.whose : "you" };
  }
  if (ab.kind === "static") {
    const rs = (Array.isArray(a.restrictions) ? a.restrictions : []).filter((r: Record<string, unknown>) => r?.type === "cantActivate").map((r: Record<string, unknown>): Restriction => ({ type: "cantActivate", what: cardSel(r.what) }));
    if (!rs.length) return { kind: "static", effects: [{ do: "unsupported", text: `未対応の常在型能力: ${JSON.stringify(a.restrictions ?? a)}` }] };
    ab.restrictions = rs;
  }
  if (ab.kind === "altCost") {
    const alt = (a.alt ?? {}) as Record<string, unknown>;
    const pick = (x: unknown) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return o.sel ? { sel: cardSel(o.sel), n: num(o.n) } : undefined;
    };
    const out: AltCost = { ...(pick(alt.sacrifice) ? { sacrifice: pick(alt.sacrifice) } : {}), ...(pick(alt.exileFromHand) ? { exileFromHand: pick(alt.exileFromHand) } : {}), ...(alt.life ? { life: num(alt.life) } : {}), ...(typeof alt.mana === "string" ? { mana: alt.mana } : {}), ...(alt.unless === "yourTurn" || alt.unless === "notYourTurn" ? { unless: alt.unless } : {}) };
    if (!out.sacrifice && !out.exileFromHand && !out.life && !out.mana) return { kind: "altCost", effects: [{ do: "unsupported", text: `未対応の代替コスト: ${JSON.stringify(a.alt ?? a)}` }] };
    ab.alt = out;
  }
  if (ab.kind === "suspend") {
    const sp = (a.suspend ?? {}) as Record<string, unknown>;
    if (typeof sp.cost !== "string") return { kind: "suspend", effects: [{ do: "unsupported", text: `未対応の待機: ${JSON.stringify(a.suspend ?? a)}` }] };
    ab.suspend = { n: num(sp.n), cost: sp.cost };
  }
  if (a.optional) ab.optional = true;
  if (typeof a.text === "string") ab.text = a.text;
  const targets: TargetDef[] = [...hoist];
  if (Array.isArray(a.targets)) {
    for (const t of a.targets as Record<string, unknown>[]) {
      const sel = selector(t.sel);
      if (typeof t.id === "string" && sel && sel.kind !== "ref" && sel.kind !== "self") targets.push({ id: t.id, sel });
    }
  }
  if (targets.length) ab.targets = targets;
  return ab;
}

// ---- 日本語での表示 (診断画面・ログ・記録の確認用) ----

const T_JA: Record<string, string> = { creature: "クリーチャー", land: "土地", artifact: "アーティファクト", enchantment: "エンチャント", planeswalker: "プレインズウォーカー", instant: "インスタント", sorcery: "ソーサリー", permanent: "パーマネント", card: "カード", basic: "基本土地", legendary: "伝説の" };
const Z_JA: Record<Zone, string> = { library: "山札", hand: "手札", battlefield: "戦場", graveyard: "墓地", exile: "追放領域", stack: "スタック" };
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
  if (s.kind === "self") return "この呪文";
  if (s.kind === "any") return "いずれか1つ(クリーチャー・プレイヤー)";
  if (s.kind === "player") return s.who === "you" ? "自分" : s.who === "opponent" ? "相手" : s.who === "each" ? "各プレイヤー" : `「${s.ref ?? "?"}」のコントローラー`;
  const parts = [
    `${s.zone ? Z_JA[s.zone] : "戦場"}の${OWNER_JA(s.owner)}`,
    ...(s.not ?? []).map((n) => `${T_JA[n] ?? n}でない`),
    ...(s.supertypes ?? []).map((t) => T_JA[t] ?? t),
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
    case "may": {
      const who = s.who === undefined ? "" : s.who === "opponent" ? "相手が" : s.who === "you" ? "" : `${describeSel(s.who)}が`;
      return `${who}${s.cost?.mana ? `${s.cost.mana} を払って` : ""}してもよい: ${s.steps.map(describeStep).join("、")}`;
    }
    case "copy":
      return `${describeSel(s.what)} のコピーを作る${s.by ? `(持つのは ${describeSel(s.by)})` : ""}${s.color ? `。コピーは${s.color}色` : ""}${s.newTargets ? "。新しい対象を選んでもよい" : ""}`;
    default:
      return `【未対応】${s.text}`;
  }
}

export function describeCost(c?: AbilityCost): string {
  if (!c) return "";
  return [c.tap ? "{T}" : "", c.mana ?? "", c.life ? `${c.life} 点のライフを払う` : "", c.sacrificeSelf ? "これを生け贄にする" : ""].filter(Boolean).join("、");
}

export function describeAbility(a: Ability): string {
  const head = { spell: "唱えて解決したとき", activated: "起動", mana: "マナ能力", static: "常在型(戦場にある間)", altCost: "代替コスト", suspend: "待機", triggered: `誘発 (${a.trigger?.event === "upkeep" ? `${a.trigger.whose === "opponent" ? "相手" : a.trigger.whose === "each" ? "各プレイヤー" : "自分"}のアップキープの開始時` : a.trigger?.event === "etb" ? "戦場に出たとき" : a.trigger?.event === "dies" ? "死亡したとき" : "?"})` }[a.kind];
  const cost = describeCost(a.cost);
  const targets = a.targets?.length ? `対象: ${a.targets.map((t) => `「${t.id}」= ${describeSel(t.sel)}`).join("、")}。` : "";
  const rest = (a.restrictions ?? []).map((r) => `${describeSel({ ...r.what, count: undefined })} の起動型能力 (マナ能力を含む) は起動できない`).join("、");
  const alt = a.alt
    ? [
        a.alt.unless === "notYourTurn" ? "自分のターンでないとき、" : a.alt.unless === "yourTurn" ? "自分のターンのとき、" : "",
        a.alt.sacrifice ? `${describeSel(a.alt.sacrifice.sel)} を ${a.alt.sacrifice.n} つ生け贄にする` : "",
        a.alt.exileFromHand ? `手札の ${describeSel({ ...a.alt.exileFromHand.sel, zone: undefined, count: undefined })} を ${a.alt.exileFromHand.n} 枚追放する` : "",
        a.alt.life ? `${a.alt.life} 点のライフを払う` : "",
        a.alt.mana ? `${a.alt.mana} を払う` : "",
        "ことで、マナコストの代わりに唱えられる",
      ].join("")
    : "";
  const sus = a.suspend ? `手札から ${a.suspend.cost} を払って追放し、時間カウンターを ${a.suspend.n} 個置く。自分のアップキープに1個取り除き、最後の1個を取り除いたとき、マナコストを払わずに唱えてもよい` : "";
  return `${head}${cost ? ` [${cost}]` : ""}${a.optional ? " (任意)" : ""}: ${targets}${rest}${alt}${sus}${(rest || alt || sus) && a.effects.length ? "、" : ""}${a.effects.map(describeStep).join("、")}`;
}

// 入れ子の中も含めて、「未対応」の文を集める
export function unsupportedIn(steps: Step[]): string[] {
  return steps.flatMap((s) => (s.do === "unsupported" ? [s.text] : s.do === "flip" ? unsupportedIn([...(s.win ?? []), ...(s.lose ?? [])]) : s.do === "if" ? unsupportedIn([...s.then, ...(s.else ?? [])]) : s.do === "may" ? unsupportedIn(s.steps) : []));
}

// ---- マクロ (既にある命令の組み合わせに、名前をつけた部品) ----
// 記録には {"do":"use","macro":"名前","args":{"n":1}} と書く。読み込むとき、命令の並びに展開する (エンジンは、展開後の命令だけを実行する)。
// マクロの steps の中の "$名前" は、引数に置き換わる。

export interface Macro {
  name: string; // camelCase。命令の種類 (move など) と同じ名前は使えない
  title: string; // 日本語の名前
  description: string; // 何をするか
  params: string[]; // 引数の名前
  steps: unknown[]; // 命令の並び ("$引数名" を含められる)
}

const MACRO_NAME = /^[a-z][A-Za-z0-9]{1,40}$/;

// 形を確かめる。使えない形は、理由を返す
export function validateMacro(raw: unknown): { macro?: Macro; error?: string } {
  const m = (raw ?? {}) as Record<string, unknown>;
  if (typeof m.name !== "string" || !MACRO_NAME.test(m.name)) return { error: "name は、英字で始まる英数字 (2〜41文字)" };
  if ((STEP_VERBS as readonly string[]).includes(m.name) || m.name === "use") return { error: `name「${m.name}」は、命令の名前と重なる` };
  if (!Array.isArray(m.steps) || !m.steps.length) return { error: "steps が空" };
  const params = Array.isArray(m.params) ? m.params.map(String).filter((p) => /^[A-Za-z]\w*$/.test(p)) : [];
  const ok = (steps: unknown[]): boolean =>
    steps.every((x) => {
      const e = (x ?? {}) as Record<string, unknown>;
      if (e.do === "use") return typeof e.macro === "string";
      if (!(STEP_VERBS as readonly string[]).includes(String(e.do)) || e.do === "unsupported") return false;
      if (e.do === "flip") return ok([...((e.win as unknown[]) ?? []), ...((e.lose as unknown[]) ?? [])]);
      if (e.do === "if") return ok([...((e.then as unknown[]) ?? []), ...((e.else as unknown[]) ?? [])]);
      if (e.do === "may") return ok((e.steps as unknown[]) ?? []);
      return true;
    });
  if (!ok(m.steps)) return { error: "steps に、知らない命令か、未対応 (unsupported) が入っている" };
  return { macro: { name: m.name, title: typeof m.title === "string" ? m.title : m.name, description: typeof m.description === "string" ? m.description : "", params, steps: m.steps } };
}

export function substitute(node: unknown, args: Record<string, unknown>): unknown {
  if (typeof node === "string") return node.startsWith("$") && node.slice(1) in args ? args[node.slice(1)] : node;
  if (Array.isArray(node)) return node.map((x) => substitute(x, args));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substitute(v, args)]));
  return node;
}

// use を展開する。入れ子 (flip / if / may の中) も展開する。見つからないマクロや、深すぎる入れ子は「未対応」になる
export function expandSteps(raw: unknown[], macros: Map<string, Macro>, depth = 0): unknown[] {
  return raw.flatMap((x): unknown[] => {
    const e = (x ?? {}) as Record<string, unknown>;
    if (e.do === "use") {
      const m = macros.get(String(e.macro));
      if (!m || depth >= 5) return [{ do: "unsupported", text: `マクロ「${String(e.macro)}」が見つからない` }];
      const args = (e.args ?? {}) as Record<string, unknown>;
      return expandSteps(substitute(JSON.parse(JSON.stringify(m.steps)), args) as unknown[], macros, depth + 1);
    }
    const out = { ...e };
    if (Array.isArray(e.win)) out.win = expandSteps(e.win, macros, depth);
    if (Array.isArray(e.lose)) out.lose = expandSteps(e.lose, macros, depth);
    if (Array.isArray(e.then)) out.then = expandSteps(e.then, macros, depth);
    if (Array.isArray(e.else)) out.else = expandSteps(e.else, macros, depth);
    if (Array.isArray(e.steps)) out.steps = expandSteps(e.steps, macros, depth);
    return [out];
  });
}

// マクロを使っている命令の名前を集める (記録の生の JSON から)
export function macrosUsedIn(raw: unknown): string[] {
  const found = new Set<string>();
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      if (o.do === "use" && typeof o.macro === "string") found.add(o.macro);
      Object.values(o).forEach(walk);
    }
  };
  walk(raw);
  return [...found];
}
