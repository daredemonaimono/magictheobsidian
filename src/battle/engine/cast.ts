import { costReduction } from "../continuous";
import { CastRecord, NodeCall } from "../node";
import { getNode } from "../registry";
import { addCosts, emptyCost, ManaCost, parseManaCost } from "../mana";
import { prepareAbilityOf, Game, GameCard, PlayerId, RuleBook, StackItem } from "../state";
import { RuleError, UNRULED, isPermanentCard, live, resolveArgs, spellBody, staticKeywords, unruled } from "./shared";
import { enterBattlefield } from "./battlefield";
import { announceTargets, flushEvents } from "./triggers";
import { checkModes, validate } from "./targets";
import { costOf, costProblem, payCost } from "./costs";
import { declareAttackers, declareBlockers } from "./combat";
import { activationBlocked, castProblem } from "./restrict";

// 呪文を唱える・土地を出す・能力を起動する

// 唱える。手札にある・いま唱えられる・ルールがある・追加コストを払える・対象がすべて合法、のどれかが欠けると RuleError で、状態は変えない。
// cast = 唱えるときの選択 (kicked / teamwork = 追加コストを払う、tap = チームワークでタップするクリーチャー)。宣言 (additionalCost) の無いフラグは選べない
export function castSpell(g: Game, p: PlayerId, cardId: string, targets: Record<string, string>, rules: RuleBook, cast: CastRecord = {}): void {
  live(g);
  const card = g.hands[p]?.find((c) => c.id === cardId);
  if (!card) throw new RuleError(`手札に無い: ${cardId}`);
  if (/\bLand\b/.test(card.typeLine)) throw new RuleError(`土地は唱えられない (playLand で出す): ${card.name}`); // 1ターン1枚の制限は playLand にある
  if (!canCastNow(g, p, card, rules)) throw new RuleError(`いまは唱えられない: ${card.name}`);
  const skipped = unruled(g, rules, card); // ルールが設定されていないカード: 効果は飛ばす
  const body = skipped ? [] : spellBody(rules, card) ?? (rules.get(card.name) && isPermanentCard(card) ? [] : undefined); // 呪文能力の無いパーマネントも、ルールがあれば唱えられる
  if (!body) throw new RuleError(`呪文能力のルールが無い: ${card.name}`);
  castCore(g, p, card, body, targets, rules, cast, () => {
    g.hands[p] = g.hands[p].filter((c) => c !== card);
    if (skipped) g.log.push(`${card.name}: ${UNRULED}`);
  });
}

// 呪文を唱える本体 (手札から・準備呪文のコピーで共通)。条件を確かめ、コストを払い、スタックに積む。afterPay = 払ったあとの、元の場所からの移動。copy = 呪文のコピー
export function castCore(g: Game, p: PlayerId, card: GameCard, body: NodeCall[], targets: Record<string, string>, rules: RuleBook, cast: CastRecord, afterPay: () => void, copy = false): void {
  const item: StackItem = { id: card.id, card, controller: p, targets, cast, ...(copy ? { body, copy: true } : {}) };
  const own = ownCost(card);
  const banned = castProblem(g, rules, p, card);
  if (banned) throw new RuleError(banned);
  checkModes(body, cast, card.name);
  validate(g, item, body, card.name, rules);
  const chosen = (["kicked", "teamwork"] as const).filter((f) => cast[f]);
  const decls = chosen.flatMap((f) => {
    const d = body.filter((c) => c.node === "additionalCost" && c.args.flag === f);
    if (!d.length) throw new RuleError(`${card.name}: ${f} の追加コストが書かれていない`);
    return d;
  });
  const alt = cast.alt ? body.find((c) => c.node === "altCost") : undefined;
  if (cast.alt && !alt) throw new RuleError(`${card.name}: 別のコストが書かれていない`);
  if (alt?.args.notYourTurn === true && g.active === p) throw new RuleError(`${card.name}: 自分のターンには、別のコストで唱えられない`);
  const pitch = alt ? pitchCards(g, p, card, alt, cast) : [];
  const cost = costOf(alt ? [...decls, alt] : decls);
  if (cast.phyLife) cost.preferLife = true;
  let delved: GameCard[] = [];
  if (g.payManaCosts && !alt) {
    // カード自体のマナコスト。コスト軽減は、汎用の分だけ減らす (色は減らない)。manaCost が無いカードは、マナ総量の数だけ (色なし)。{X} の分は、選んだ X だけ汎用が増える
    const generic = Math.max(0, own.generic - costReduction(g, p, card, rules)) + (own.x ?? 0) * Math.max(0, cast.x ?? 0);
    if (cast.delve) {
      if (!body.some((c) => c.node === "delve")) throw new RuleError(`${card.name}: Delve が書かれていない`);
      delved = delveCards(g, p, cast.delve, generic, card);
    }
    cost.sym = addCosts(cost.sym, { ...own, generic: generic - delved.length });
  } else if (cast.delve && !alt) throw new RuleError(`${card.name}: Delve を使えない`);
  const why = costProblem(g, p, cost, undefined, cast.tap ?? [], rules, card);
  if (why) throw new RuleError(`${card.name}: ${why}`);
  payCost(g, p, cost, undefined, cast.tap ?? [], card);
  afterPay();
  for (const c of delved) {
    g.graveyards[p] = g.graveyards[p].filter((x) => x !== c);
    g.exile[c.owner].push(c);
  }
  if (delved.length) g.log.push(`墓地の ${delved.length} 枚を追放した (Delve)`);
  if (g.payManaCosts) item.cast = { ...cast, colors: cost.spent?.colors ?? 0, paid: cost.spent?.mana ?? 0 };
  if (own.x) item.x = Math.max(0, cast.x ?? 0);
  const before = g.spellsCast ?? 0; // この呪文より前に唱えられた数 (Storm)
  g.spellsCast = before + 1;
  (g.spellsBy ??= {})[p] = (g.spellsBy[p] ?? 0) + 1;
  for (const c of pitch) {
    g.hands[p] = g.hands[p].filter((x) => x !== c);
    g.exile[c.owner].push(c);
    g.log.push(`${c.name} を手札から追放した (${card.name} の別のコスト)`);
  }
  g.stack.push(item);
  announceTargets(g, item, rules);
  g.priority = p;
  g.passes = [];
  g.events.push({ type: "cast", player: p, card });
  if (body.some((c) => c.node === "storm")) {
    // Storm: 唱えたとき、その呪文の上に、「それまでに唱えられた数だけ、この呪文をコピーする」誘発型能力が積まれる
    g.serial++;
    g.stack.push({ id: `${card.id}#storm${g.serial}`, card, controller: p, targets: {}, cast: {}, body: [{ node: "copySpell", args: { spell: card.id, count: before } }], ability: true, source: card.id });
  }
  flushEvents(g, rules); // 「呪文を唱えた」ときの誘発型能力は、その呪文の上に積まれる
}

// 呪文自身のマナコスト (マナコストが無いカードは、マナ総量ぶんの汎用)
function ownCost(card: GameCard): ManaCost {
  try {
    return card.manaCost !== undefined ? parseManaCost(card.manaCost) : { ...emptyCost(), generic: card.mv };
  } catch (e) {
    throw new RuleError(`${card.name}: ${(e as Error).message}`);
  }
}

// Delve で追放する墓地のカード。true なら、払うのに要るぶん (汎用の数まで) を先頭から。ids なら、それを確かめる (汎用の数を超えられない)
export function delveCards(g: Game, p: PlayerId, delve: string[] | true, generic: number, spell: GameCard): GameCard[] {
  const gy = g.graveyards[p] ?? [];
  if (delve === true) return gy.slice(0, generic);
  const picked = delve.map((id) => gy.find((c) => c.id === id));
  if (picked.some((c) => !c) || new Set(picked).size !== picked.length) throw new RuleError(`${spell.name}: 墓地に無いカードを選んでいる`);
  if (picked.length > generic) throw new RuleError(`${spell.name}: Delve で追放できるのは、汎用マナの数 (${generic}) まで`);
  return picked as GameCard[];
}

// 別のコストで追放する手札のカード: cast.exile があればそれを確かめ、無ければ条件に合う先頭から選ぶ。足りなければ RuleError
export function pitchCards(g: Game, p: PlayerId, spell: GameCard, alt: NodeCall, cast: CastRecord): GameCard[] {
  const n = Number(alt.args.exile ?? 0);
  if (!n) return [];
  const eligible = pitchable(g, p, spell, alt);
  const picked = cast.exile ? cast.exile.map((id) => eligible.find((c) => c.id === id)) : eligible.slice(0, n);
  if (picked.some((c) => !c) || new Set(picked).size !== n || picked.length !== n) throw new RuleError(`${spell.name}: 追放できるカードが足りない (${typeof alt.args.exileColor === "string" ? alt.args.exileColor + " の" : ""}カードを手札から ${n} 枚)`);
  return picked as GameCard[];
}
// 追放できる手札のカード (唱える呪文自身は除く)。色は、カードの colors、無ければマナコストの色
export function pitchable(g: Game, p: PlayerId, spell: GameCard, alt: NodeCall): GameCard[] {
  const color = typeof alt.args.exileColor === "string" ? alt.args.exileColor : undefined;
  const colorsOf = (c: GameCard) => c.colors ?? [...new Set((c.manaCost ?? "").match(/[WUBRG]/g) ?? [])];
  return (g.hands[p] ?? []).filter((c) => c !== spell && c.id !== spell.id && (!color || colorsOf(c).includes(color)));
}

// 土地を出す。自分のメインフェイズで、スタックが空で、優先権があり、このターンにまだ出していないとき (スタックを使わない特別な動作)
export function playLand(g: Game, p: PlayerId, cardId: string, rules: RuleBook): void {
  live(g);
  const card = g.hands[p]?.find((c) => c.id === cardId);
  if (!card) throw new RuleError(`手札に無い: ${cardId}`);
  if (!/\bLand\b/.test(card.typeLine)) throw new RuleError(`土地ではない: ${card.name}`);
  if (g.priority !== p || p !== g.active || (g.step !== "main1" && g.step !== "main2") || g.stack.length) throw new RuleError(`いまは土地を出せない (自分のメインフェイズで、スタックが空のときだけ)`);
  if (g.landsPlayed >= 1) throw new RuleError("このターンは、もう土地を出した");
  g.hands[p] = g.hands[p].filter((c) => c !== card);
  g.landsPlayed++;
  if (unruled(g, rules, card)) g.log.push(`${card.name}: ${UNRULED}`);
  enterBattlefield(g, card, p, rules);
  flushEvents(g, rules);
}

// 戦場のパーマネントの起動型能力を起動する (index = そのカードの起動型能力の何番目か)。コストを払い、マナだけの能力 (addMana のみ) は即座に実行、
// それ以外はスタックに積む。優先権が必要。払えない・対象が不正なら RuleError で、状態は変えない
export function activateAbility(g: Game, p: PlayerId, permId: string, index: number, targets: Record<string, string>, rules: RuleBook, tapIds: string[] = [], x = 0): void {
  live(g);
  const perm = g.battlefield.find((x) => x.id === permId);
  if (!perm) throw new RuleError(`戦場に無い: ${permId}`);
  if (perm.controller !== p) throw new RuleError(`${p} のコントロールするパーマネントではない: ${permId}`);
  if (g.priority !== p) throw new RuleError(`${p} は優先権を持っていない`);
  const ab = rules.get(perm.card.name)?.abilities.filter((a) => a.kind === "activated")[index];
  if (!ab) throw new RuleError(`起動型能力が無い: ${perm.card.name} (${index} 番目)`);
  const timing = ab.body.find((c) => c.node === "timing");
  const cost = costOf(ab.body.filter((c) => c.node === "cost"));
  if ((timing?.args.sorcery === true || cost.isLoyalty) && !(p === g.active && (g.step === "main1" || g.step === "main2") && g.stack.length === 0)) throw new RuleError(`${perm.card.name}: ソーサリーのタイミングだけ起動できる (自分のメインフェイズで、スタックが空のとき)`);
  const effects = ab.body.filter((c) => c.node !== "cost" && c.node !== "timing");
  const item: StackItem = { id: `${perm.id}#${g.serial + 1}`, card: perm.card, controller: p, targets, cast: {}, body: effects, ability: true, source: perm.id, ...(cost.loyaltyX ? { x, loyaltyX: true } : cost.isLoyalty ? { loyalty: cost.loyalty } : {}) };
  validate(g, item, ab.body, perm.card.name, rules);
  const blocked = activationBlocked(g, rules, perm, p);
  if (blocked) throw new RuleError(`${blocked}: ${perm.card.name} の起動型能力は、起動できない`);
  const why = costProblem(g, p, cost, perm, tapIds, rules, undefined, x);
  if (why) throw new RuleError(`${perm.card.name}: ${why}`);
  payCost(g, p, cost, perm, tapIds, undefined, x);
  g.serial++;
  if (effects.length && !cost.isLoyalty && effects.every((c) => c.node === "addMana")) {
    for (const call of effects) getNode(call.node)!.run!({ game: g, rules, item, vars: {}, call }, resolveArgs(call, {})!); // マナ能力はスタックを使わない
    flushEvents(g, rules);
    return;
  }
  g.stack.push(item);
  announceTargets(g, item, rules);
  g.priority = p;
  g.passes = [];
  flushEvents(g, rules); // 生け贄などで「戦場を離れた」誘発は、この能力の上に積まれる
}

// 唱えられるタイミングは、カードタイプから決まる (ノードにはしない)
export function canCastNow(g: Game, p: PlayerId, card: GameCard, rules?: RuleBook): boolean {
  if (g.priority !== p) return false;
  if (/\bInstant\b/.test(card.typeLine) || card.flash || (rules && staticKeywords(rules, card).includes("flash"))) return true;
  return p === g.active && (g.step === "main1" || g.step === "main2") && g.stack.length === 0;
}

// ---- 戦闘。戦闘ステップは、攻撃クリーチャーの指定 → ブロックの指定 → (先制攻撃ダメージ) → 戦闘ダメージ → 終了 の段階 (Game.combatPhase) で進む。
// 段階は、全員がパスして、スタックが空のときに進む (攻撃が無ければ、そのまま次のステップ)。指定は、declareAttackers / declareBlockers を呼ぶ (castSpell と同じ、人や AI の入口)。
// shortcut: ダメージの割り振りは、宣言の順に致死ダメージを振る (割り振りの選択は、判断の入力を作るときに)。ブロッカー1体につき、ブロック先は1体だけ

// 準備呪文を唱える: 準備済のクリーチャーのコントローラーが、その準備呪文のコピー (追放領域にある) を唱える。唱えると、そのクリーチャーは準備済でなくなる。
// コピーは呪文なので、打ち消しの対象になる。解決しても、打ち消されても、墓地には行かず消える。唱えるタイミングは、準備呪文の型 (Instant なら優先権があるとき、Sorcery ならソーサリーのタイミング)
export function castPrepared(g: Game, p: PlayerId, permId: string, targets: Record<string, string>, rules: RuleBook, cast: CastRecord = {}): void {
  live(g);
  const perm = g.battlefield.find((x) => x.id === permId);
  if (!perm || perm.controller !== p) throw new RuleError(`自分のパーマネントではない: ${permId}`);
  if (!perm.prepared) throw new RuleError(`準備済ではない: ${perm.card.name}`);
  const ab = prepareAbilityOf(rules, perm.card.name);
  const decl = ab?.body[0];
  if (!ab || decl?.node !== "prepareSpell") throw new RuleError(`準備呪文のルールが無い: ${perm.card.name}`);
  let own: ManaCost;
  try {
    own = typeof decl.args.manaCost === "string" ? parseManaCost(decl.args.manaCost) : emptyCost();
  } catch (e) {
    throw new RuleError(`${perm.card.name}: ${(e as Error).message}`);
  }
  const mv = own.generic + Object.values(own.colors).reduce((a, n) => a + (n ?? 0), 0) + own.hybrid.length;
  const card: GameCard = { id: `${perm.id}#prepared${++g.serial}`, name: String(decl.args.name), typeLine: String(decl.args.type), mv, ...(typeof decl.args.manaCost === "string" ? { manaCost: decl.args.manaCost } : {}), owner: perm.card.owner };
  if (!canCastNow(g, p, card, rules)) throw new RuleError(`いまは唱えられない: ${card.name}`);
  castCore(g, p, card, ab.body.slice(1), targets, rules, cast, () => {
    perm.prepared = false;
  }, true);
}
