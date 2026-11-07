import { CardRule, CastRecord, NodeCall } from "./node";

// ゲームの状態。プレイヤーは2人固定にせず、リストと「相手」という関係で持つ (実装は1対1だけ)
export type PlayerId = string;
export type Step = "untap" | "upkeep" | "draw" | "main1" | "combat" | "main2" | "end";

// 色つきのマナ (W U B R G) と、好きな色のマナ (A)
export type ManaColor = "W" | "U" | "B" | "R" | "G";
export type PoolKey = ManaColor | "A" | `A:${string}`; // A = 好きな色、A:GWU = その中の1色
export type Pool = Record<string, number>; // キーは PoolKey
export interface GameCard {
  id: string;
  name: string;
  typeLine: string;
  mv: number;
  manaCost?: string; // マナコストの表記 ("{1}{U}{U}")。payManaCosts のとき、色まで払う。無ければ、マナ総量の数だけ (色なし)
  owner: PlayerId;
  flash?: boolean;
  power?: number; // クリーチャーのパワー・タフネス・キーワード (もとの値)
  toughness?: number;
  keywords?: string[];
  colors?: string[]; // 色 (W U B R G)
  loyalty?: number; // プレインズウォーカーの初期忠誠度 (戦場に出るとき loyalty カウンターとして置かれる)
  token?: boolean; // トークン (戦場を離れると消える)
}
export interface StackItem {
  id: string;
  card: GameCard;
  controller: PlayerId;
  targets: Record<string, string>; // ノードの as → 対象の StackItem.id
  cast: CastRecord;
  body?: NodeCall[]; // 起動型能力のとき、その効果 (呪文のときは、カードの呪文能力)
  ability?: boolean; // 起動型・誘発型能力 (解決しても、カードは墓地に行かない)
  copy?: boolean; // 呪文のコピー (準備呪文など)。解決しても、打ち消されても、墓地に行かない (消える)。呪文としては、打ち消しの対象になる
  trigger?: string; // 誘発型能力の引き金になったパーマネントの id (eventPerm ノードが返す)
  source?: string; // 能力の発生源のパーマネントの id (self ノードが返す)
  loyalty?: number; // 忠誠度能力の、忠誠度のコスト (+2 → 2、−5 → −5)。どの能力を使ったかを、画面とログに伝える
  loyaltyX?: boolean; // −X の忠誠度能力
  x?: number; // 起動時に選んだ X (忠誠度の −X など。効果の中で $X として参照する)
}
// 修整とキーワードの変更。持続「ターン終了時まで」はターンの終わりに消え、forever は残る
export interface Mod {
  power: number;
  toughness: number;
  keyword?: string;
  until: "endOfTurn" | "forever";
}
// 戦場のパーマネント
// 「〜になる」効果 (becomes)。戦場にあるあいだ、いまの姿を上書きする (継続効果のあとに適用)
export interface Becomes {
  types?: string;
  colors?: string[];
  power?: number;
  toughness?: number;
  lose?: boolean; // すべての能力を失う
  until: "endOfTurn" | "forever";
}
export interface Perm {
  id: string;
  card: GameCard;
  controller: PlayerId;
  tapped?: boolean;
  attacking?: boolean;
  mods?: Mod[];
  becomes?: Becomes[]; // 「〜になる」効果 (Oko の +1 など)
  attachedTo?: string; // 装備品・オーラが付いているパーマネントの id
  loyaltyUsed?: boolean; // このターンに忠誠度能力を起動した (1ターンに1回)
  emblem?: string; // 紋章のとき、その名前 (createEmblem の name)。紋章は戦場の外 (Game.emblems) にある
  damage?: number; // クリーチャーに載っているダメージ (ターン終了時に消える)
  prepared?: boolean; // 準備済 (準備呪文を、追放領域のコピーとして唱えられる。戦場を離れると消える)
  deathtouched?: boolean; // 接死のダメージを受けた (ターン終了時に消える)
  cast?: CastRecord; // 呪文として唱えられて出たとき、その記録 (キッカー・別のコスト)。誘発型能力の if=kicked / if=alt が見る
  enteredTurn?: number; // 戦場に出たターン (Game.turn)。召喚酔いの判定
  attackTarget?: string; // 攻撃しているとき、攻撃先 (プレイヤー、またはプレインズウォーカーの id)
  blocked?: boolean; // 攻撃しているとき、ブロックされた (ブロッカーがいなくなっても、ブロックされたまま)
  blockedBy?: string[]; // 攻撃しているとき、ブロッカーの id (宣言の順 = ダメージを割り振る順)
  assign?: Record<string, number>; // 攻撃しているとき、ブロッカーごとに割り振るダメージ (攻撃側が決める。無ければ、宣言の順に致死ダメージ)
  blocking?: string; // ブロックしているとき、ブロック先の攻撃クリーチャーの id
  exileInstead?: "opponents" | "you" | "all"; // 墓地に行くカードのかわりに追放する置換 (exileInstead)。だれの墓地に行くカードか (Leyline of the Void = opponents)。戦場に出たとき、ルールから写す
  regen?: number; // 再生の盾の数 (破壊・致死ダメージのかわりに、タップして残る。ターン終了時に消える)
  counters?: Record<string, number>; // "+1/+1" (パワー・タフネスに足される) / "stun" (麻痺: アンタップのかわりに1つ取り除く)
}

// エンジンが誘発型能力を探すためのイベント。ノードや処理が積み、エンジンが flush して、条件に合う誘発型能力をスタックに積む
// カードがいる場所 (ゾーン)。moved / enters / leaves のイベントで、どこからどこへ動いたかを表す
export type Zone = "library" | "hand" | "graveyard" | "battlefield" | "stack" | "exile";
// カードを墓地に置く (持ち主の墓地へ)。「墓地に置かれた」(moved) を積む。from = どこから
// スタックを使わない効果が起きたことを、画面の表示用に残す (ログとは別。スタックとは区別して出す)
export function announceEffect(g: Game, text: string, card?: string): void {
  (g.effects ??= []).push({ text, ...(card ? { card } : {}) });
  if (g.effects.length > 30) g.effects.splice(0, g.effects.length - 30);
}

// 置換: 戦場に exileInstead のパーマネントがあれば、墓地に行くかわりに追放される (Leyline of the Void・Rest in Peace)。行き先 ("graveyard" / "exile") を返す
export function putInGraveyard(g: Game, card: GameCard, from: Zone): "graveyard" | "exile" {
  const hit = g.battlefield.some((p) => p.exileInstead && (p.exileInstead === "all" || (p.exileInstead === "opponents" ? card.owner !== p.controller : card.owner === p.controller)));
  if (hit) {
    g.exile[card.owner].push(card);
    g.log.push(`${card.name} は、墓地に行くかわりに追放された`);
    announceEffect(g, `置換: ${card.name} は、墓地に行くかわりに追放された`, card.name);
    g.events.push({ type: "moved", card, from, to: "exile" });
    return "exile";
  }
  g.graveyards[card.owner].push(card);
  if (from === "hand") (g.discarded ??= {})[card.owner] = (g.discarded?.[card.owner] ?? 0) + 1; // 手札から墓地へ = 捨てた
  g.events.push({ type: "moved", card, from, to: "graveyard" });
  return "graveyard";
}

// 遅延誘発 (delay): あとのステップの開始時に、スタックに積む、残りのノード。source = もとの能力の発生源の id
export interface Delayed { step: Step; card: GameCard; controller: PlayerId; source?: string; body: NodeCall[] }

// ライフを得る (そのターンに得た量 gained も、数える)
export function gainLife(g: Game, p: PlayerId, n: number): void {
  g.life[p] += n;
  if (n > 0) (g.gained ??= {})[p] = (g.gained[p] ?? 0) + n;
}

export type GameEvent = { type: "cast"; player: PlayerId; card: GameCard } | { type: "enters"; perm: Perm; from?: Zone } | { type: "leaves"; perm: Perm; to?: Zone } | { type: "moved"; card: GameCard; from: Zone; to: Zone } | { type: "damaged"; source?: Perm; target: string; kind: "player" | "creature" | "planeswalker"; amount: number; combat: boolean } | { type: "step"; step: Step; player: PlayerId } | { type: "attacks"; perm: Perm } | { type: "blocks"; perm: Perm } | { type: "targeted"; perm: Perm; by: StackItem }; // targeted = パーマネントが、呪文・能力の対象になった (護法)
// 人の判断の差し替え口。無ければ決まった動きになる (shortcut: 判断の入力はまだ無い。入力の仕組みを作るときに置き換える)
export interface Decider {
  discard?(g: Game, p: PlayerId, n: number, cleanup?: boolean): GameCard[] | undefined; // 捨てるカード
  may?(g: Game, p: PlayerId, what: string): boolean | undefined; // 「してもよい」をするか (既定はする)
  pay?(g: Game, p: PlayerId, n: number, why?: string): boolean | undefined; // 「支払わないかぎり」を払うか
  choose?(g: Game, p: PlayerId, from: GameCard[], n: number, atMost?: boolean): GameCard[] | undefined; // 選ぶカード (look / choose)
  order?(g: Game, p: PlayerId, cards: GameCard[], to: "top" | "bottom"): GameCard[] | undefined; // ライブラリーの上・底に置く順番 (上から下へ。既定は、並んでいる順)
  legend?(g: Game, p: PlayerId, same: Perm[]): Perm | undefined; // 伝説のルール: 同名の伝説のパーマネントのうち、残す 1 つ (ほかは墓地へ。無ければ、先に出ていたもの)
  dredge?(g: Game, p: PlayerId, options: { card: GameCard; n: number }[]): GameCard | undefined; // 引くかわりに Dredge するカード (しないなら undefined)
  target?(g: Game, item: StackItem, call: NodeCall, legal: string[]): string[] | undefined; // 誘発型能力の対象 (誘発時に選ぶ。既定は合法な対象の先頭から)
}
export interface Game {
  players: PlayerId[];
  active: PlayerId;
  step: Step;
  priority: PlayerId | null;
  passes: PlayerId[]; // 連続でパスした人
  hands: Record<PlayerId, GameCard[]>;
  libraries: Record<PlayerId, GameCard[]>; // 先頭が一番上
  graveyards: Record<PlayerId, GameCard[]>;
  exile: Record<PlayerId, GameCard[]>; // 追放領域 (持ち主ごと)
  battlefield: Perm[];
  mana: Record<PlayerId, number>; // 使えるマナの合計
  pool: Record<PlayerId, Pool>; // そのうち、色のついたもの。合計から引いた残りは、無色のマナ
  decide?: Decider;
  skipUnruled?: boolean; // 真なら、ルールが設定されていないカード (ルールが無い・ノードが空) は、使うと「ルールが設定されていません。スキップします。」とログに出して、効果を飛ばす (唱える・出すことはできる)。shortcut: 偽 (既定) なら、これまでどおり (呪文は RuleError)。対戦の画面が真にする
  payManaCosts?: boolean; // 真なら、呪文を唱えるとき、カード自体のマナコスト (マナ総量 − 軽減) を払う。shortcut: 対戦の画面ができるまでは偽
  stack: StackItem[]; // 末尾が一番上
  log: string[];
  serial: number; // 起動型・誘発型能力の id を作るための通し番号
  events: GameEvent[]; // まだ誘発型能力を探していないイベント
  emblems: Perm[]; // 紋章 (戦場の外に残り続ける。元のカードのルールにある、emblem で始まる誘発型能力が働く)
  rngState?: number; // ゲームの中の乱数の状態 (ライブラリーを切る、など。nextRandom)。対戦を始めるとき、種から決める
  handLook?: { by: PlayerId; of: PlayerId; ids: string[]; n: number }; // 手札を見たとき (lookHand): だれが、だれの手札を、どのカードを見たか。n = 何回目か (画面が、新しい「見た」を見つける)
  restrictedMana: Record<PlayerId, { amount: number; color?: PoolKey; type?: string; notType?: string }[]>; // 使い道に制限のあるマナ (「クリーチャーでない呪文を唱えるためにしか使えない」)
  extraTurns?: PlayerId[]; // 追加のターン (次のターンの前に、順に取る)
  effects?: { text: string; card?: string }[]; // スタックを使わない効果の発動 (Dredge・伝説のルール・置換効果)。画面が、スタックとは別に、一時的に表示する (最後の 30 件)
  activated?: Record<string, number>; // このターンに、起動型能力を起動した回数 (パーマネントの id:番号 / 手札のカードの id:h番号)。暴走防止 (AI は、同じ能力を 1 ターンに 3 回までしか選ばない)。ターンが替わると空
  discarded?: Record<PlayerId, number>; // このターンに捨てた・サイクリングしたカードの数 (手札から墓地へ。プレイヤーごと。ターンが替わると 0)
  gained?: Record<PlayerId, number>; // このターンに得たライフの量 (プレイヤーごと。ターンが替わると 0)
  delayed?: Delayed[]; // 遅延誘発 (あとのステップの開始時に積む)
  drawn?: Record<PlayerId, string[]>; // このターンに引いたカードの id (プレイヤーごと)
  spellsBy?: Record<PlayerId, number>; // このターンに、プレイヤーごとに唱えた呪文の数 (castLimit)
  spellsCast?: number; // このターンに唱えられた呪文の数 (全員。Storm)。ターンが替わると 0
  landsPlayed: number; // このターンに出した土地の数 (1ターンに1枚)
  life: Record<PlayerId, number>;
  strictTurns?: boolean; // 真なら、ターンを厳密に進める: ドロー・ステップに引く (最初のターンを除く)・ステップの終わりにマナが消える・終了ステップの終わりに手札を 7 枚まで捨てる。shortcut: 対戦の画面ができるまでは偽 (startGame が真にする)
  turn: number; // ターン数 (1 から。アクティブ・プレイヤーが替わるたびに +1)
  combatPhase?: "beginning" | "attackers" | "blockers" | "firstStrike" | "damage" | "end"; // 戦闘フェイズの中のステップ (戦闘のあいだだけ)。beginning (戦闘開始) と end (戦闘終了) は、strictTurns のときだけ
  attackersDeclared?: boolean;
  blockersDeclared?: PlayerId[]; // ブロックを宣言した防御側
  drewEmpty: PlayerId[]; // 空のライブラリーから引こうとした人 (次の状況起因処理で負ける)
  lost: PlayerId[]; // 負けた人
  over?: { winner?: PlayerId }; // ゲームが終わった。winner が無ければ引き分け
  mulligan?: { count: number }; // 開始前のマリガンの途中 (count = ここまでにマリガンした回数)。あるあいだ、対戦の画面は、操作・「次へ」を受けない。相手 (CPU) は常にキープ
}
export interface RuleBook {
  get(card: string): CardRule | undefined;
}

export function createGame(players: PlayerId[]): Game {
  const each = <T>(f: () => T) => Object.fromEntries(players.map((p) => [p, f()])) as Record<PlayerId, T>;
  return { players, active: players[0], step: "main1", priority: players[0], passes: [], hands: each<GameCard[]>(() => []), libraries: each<GameCard[]>(() => []), graveyards: each<GameCard[]>(() => []), exile: each<GameCard[]>(() => []), battlefield: [], mana: each(() => 0), pool: each<Pool>(() => ({})), stack: [], log: [], serial: 0, events: [], emblems: [], restrictedMana: each(() => []), landsPlayed: 0, life: each(() => 20), turn: 1, drewEmpty: [], lost: [] };
}

export const opponentsOf = (g: Game, p: PlayerId): PlayerId[] => g.players.filter((x) => x !== p);

// ノードの player 引数: "you" = 呪文のコントローラー、"opponents" = その全相手
export const playersOf = (g: Game, controller: PlayerId, who: string): PlayerId[] => (who === "opponents" ? opponentsOf(g, controller) : [controller]);

// いまのパワー・タフネス (もとの値 + 修整)。パワーの無いカードは null
export function statsOf(p: Perm): { power: number; toughness: number } | null {
  if (p.card.power === undefined || p.card.toughness === undefined) return null;
  const mods = p.mods ?? [];
  const plus = p.counters?.["+1/+1"] ?? 0;
  return { power: p.card.power + plus + mods.reduce((a, m) => a + m.power, 0), toughness: p.card.toughness + plus + mods.reduce((a, m) => a + m.toughness, 0) };
}

// いまのキーワード (もとのもの + 得たもの)。表記ゆれ (Scryfall の "First strike" と、こちらの "firstStrike") をそろえて、小文字・空白なしで返す
export const normKeyword = (k: string): string => k.toLowerCase().replace(/\s+/g, "");
const norm = normKeyword;
export const keywordsOf = (p: Perm): string[] => [...new Set([...(p.card.keywords ?? []), ...(p.mods ?? []).flatMap((m) => (m.keyword ? [m.keyword] : []))].map(norm))];

// アンタップする。麻痺カウンターがあれば、アンタップのかわりに1つ取り除く (置換効果)
export function untapPerm(g: Game, p: Perm): void {
  if (!p.tapped) return;
  if ((p.counters?.stun ?? 0) > 0) {
    p.counters!.stun--;
    g.log.push(`${p.card.name}: 麻痺カウンターを1つ取り除いた (アンタップしない)`);
  } else p.tapped = false;
}

// 型行に、spec (| は「または」) のどれかが含まれるか。type=artifact|creature、notType=creature|land (どちらでもない) の判定に使う
// id をカンマでつないだ文字列を、id の並びに戻す。伝説のカードの名前には、", " (カンマと空白) が入る (Lavinia, Azorius Renegade) ので、その後ろに空白が続くカンマでは割らない
export const splitIds = (s: string): string[] => (s === "" ? [] : s.split(/,(?! )/));

export const typeIn = (typeLine: string, spec: string): boolean => spec.split("|").some((t) => typeLine.toLowerCase().includes(t.trim().toLowerCase()));

// Dredge できるカード: p の墓地にある、常在型能力 dredge amount=N を持つカードのうち、ライブラリーが N 枚以上のもの
export function dredgeOptions(g: Game, p: PlayerId, rules: RuleBook): { card: GameCard; n: number }[] {
  const out: { card: GameCard; n: number }[] = [];
  for (const card of g.graveyards[p]) {
    const call = rules.get(card.name)?.abilities.filter((a) => a.kind === "static").flatMap((a) => a.body).find((c) => c.node === "dredge");
    const n = Number(call?.args.amount);
    if (call && n >= 1 && g.libraries[p].length >= n) out.push({ card, n });
  }
  return out;
}

// カードを n 枚引く。ライブラリーが空で引けなかったら、次の状況起因処理で負ける。
// rules を渡すと、引くたびに、Dredge できるカードがあれば、g.decide.dredge で選ばせる (選ばれたら、引くかわりに、上から N 枚を墓地に置いて、そのカードを手札へ)。ゲーム開始時の手札など、rules を渡さない引きは、Dredge しない
export function drawCards(g: Game, p: PlayerId, n: number, rules?: RuleBook): void {
  for (let i = 0; i < n; i++) {
    const options = rules ? dredgeOptions(g, p, rules) : [];
    const chosen = options.length ? g.decide?.dredge?.(g, p, options) : undefined;
    const pick = options.find((o) => o.card === chosen);
    if (pick) {
      const milled = g.libraries[p].splice(0, pick.n);
      for (const c of milled) putInGraveyard(g, c, "library");
      g.graveyards[p] = g.graveyards[p].filter((c) => c !== pick.card);
      g.hands[p].push(pick.card);
      // どの Dredge か分かるように、カード名・N・落ちたカードを残す (Dredge は置換効果なので、スタックは使わない)
      announceEffect(g, `Dredge ${pick.n}: ${pick.card.name} (上から ${milled.length} 枚を墓地へ)`, pick.card.name);
      g.log.push(`${p === "you" ? "あなた" : p === "opp" ? "相手" : p}は、引くかわりに Dredge ${pick.n} (${pick.card.name}) をした: 上から ${milled.length} 枚 (${milled.map((c) => c.name).join("、") || "なし"}) を墓地に置いて、${pick.card.name} を手札に戻した`);
      continue;
    }
    const top = g.libraries[p].shift();
    if (!top) {
      g.log.push(`${p}: ライブラリーが空で引けなかった`);
      g.drewEmpty.push(p);
      return;
    }
    g.hands[p].push(top);
    ((g.drawn ??= {})[p] ??= []).push(top.id);
  }
}

// 手札を n 枚捨てる (持っている分だけ)。捨てるカードは g.decide.discard で選べる。既定は手札の後ろから (shortcut: 判断の入力を作るときに置き換える)
export function discardCards(g: Game, p: PlayerId, n: number, cleanup = false): void { // cleanup = クリンナップ・ステップの、手札の上限による
  const k = Math.min(n, g.hands[p].length);
  const picked = (g.decide?.discard?.(g, p, k, cleanup) ?? g.hands[p].slice(g.hands[p].length - k)).filter((c) => g.hands[p].includes(c)).slice(0, k);
  g.hands[p] = g.hands[p].filter((c) => !picked.includes(c));
  for (const c of picked) putInGraveyard(g, c, "hand");
  if (picked.length) g.log.push(`${p === "you" ? "あなた" : p === "opp" ? "相手" : p}が ${picked.map((c) => c.name).join("、")} を捨てた${cleanup ? " (手札の上限)" : ""}`);
}

// 準備呪文 (kind=prepare の能力) を持つカードか。持たないクリーチャーは、準備済になれない
export const prepareAbilityOf = (rules: RuleBook, cardName: string) => rules.get(cardName)?.abilities.find((a) => a.kind === "prepare");
