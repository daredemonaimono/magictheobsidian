import { Action, abilityLabels, actionsFor, autoTargets, manaOnly, slotsOf, tryAction, uselessMana, withAllMana } from "./actions";
import { RuleError, TargetSlot, activateAbility, attackersAt, canAttackWith, castSpell, declareAttackers, declareBlockers, assignDamage, passPriority, playLand } from "./engine";
import { AiOption, aiAttackers, aiBlockers, aiOptions } from "./ai";
import { cpuAct, cpuAttack, cpuBlock, cpuDo, tapFor, tapOne } from "./cpu";
import { Answer, InputRequest, NeedInput, makeDecider } from "./input";
import { HAND_SIZE, putBottom, redraw } from "./mulligan";
import { CastRecord } from "./node";
import { Game, PlayerId, RuleBook } from "./state";

// 記録の1件: 入口の呼び出し (op と引数) と、途中の質問への答え
export interface RecordEntry {
  op: string;
  args: unknown[];
  answers?: Answer[];
}

export type StopMode = "always" | "smart"; // 優先権の止まり方 (設定)。smart = 何もできないとき、時間ゲージで自動で進む。always = 自分で「次へ」

const MAX_PASSES = 100; // 無限ループ防止

// 対戦の画面の操作の入口。画面は、これを呼んで描き直すだけ。失敗は、理由を返して、ログにも1行書く (局面は変わらない)。
// 操作は、コピーした局面で実行して、成功したら元に書き戻す。途中で自分への質問 (捨てる・選ぶ・してもよい・支払う・誘発の対象) があって、答えが無ければ、pending に質問を置いて止まる
// (元の局面は、まだ変わっていない)。answer() で答えを足すと、最初からやり直す。cancel() で、何も起きなかったことになる
export class BattleController {
  pending?: { request: InputRequest };
  private redo?: (answers: Answer[]) => string | undefined;
  private answers: Answer[] = [];

  // 対戦の記録 (履歴の保存とリプレイ用): 成功した操作を、入口の呼び出しの並びとして残す。同じ初期状態 (同じ乱数の種) から、この並びを呼び直せば、同じ局面になる
  record: RecordEntry[] = [];
  private cur?: { op: string; args: unknown[] };
  private rec(op: string, args: unknown[]) {
    this.cur = { op, args };
  }

  constructor(readonly game: Game, readonly rules: RuleBook, readonly me: PlayerId = "you", private rng: () => number = Math.random, private cpu?: PlayerId, private ai?: PlayerId) {}

  // ---- Claude の AI の相手 (段階7)。API を呼ぶのは画面。ここは、「いま AI の判断が要るか」と、判断の実行だけ (API は呼ばない)
  aiTokens = { input: 0, output: 0 }; // この対戦で、AI が使ったトークン数
  private aiDone = new Set<string>(); // 攻撃・ブロックを、ターンごとに1回だけ聞く
  get aiActive(): boolean {
    return !!this.ai;
  }
  // 判断が要るとき、その種類。act = 行動を選ぶ (土地・呪文・能力。選択肢が「何もしない」だけなら、聞かない。相手のターンは、スタックに何かあるか戦闘中だけ聞く) / attack / block
  aiWaiting(g: Game = this.game): "act" | "attack" | "block" | undefined {
    const ai = this.ai;
    if (!ai || g.over || g.mulligan) return undefined; // 人への質問 (pending) は、画面 (driveAi) が見る。ここで見ると、答えを再生している最中に、AI の判断を飛ばしてしまう
    if (g.step === "combat" && !g.stack.length) {
      if (g.combatPhase === "attackers" && g.active === ai && g.priority === ai && !g.attackersDeclared && !this.aiDone.has(`${g.turn}:attack`) && aiAttackers(g, this.rules, ai).length) return "attack";
      if (g.combatPhase === "blockers" && g.active !== ai && !(g.blockersDeclared ?? []).includes(ai) && !this.aiDone.has(`${g.turn}:block`) && attackersAt(g, ai).length && aiBlockers(g, this.rules, ai).length) return "block";
    }
    if (g.priority !== ai) return undefined;
    const own = g.active === ai && (g.step === "main1" || g.step === "main2");
    if (!g.stack.length && !own && !(g.active !== ai && g.step === "combat")) return undefined;
    return aiOptions(g, this.rules, ai).length > 1 ? "act" : undefined;
  }
  aiOptions(): AiOption[] {
    return this.ai ? aiOptions(this.game, this.rules, this.ai) : [];
  }
  // 選んだ行動を実行する (option.action が無ければ、パス)。唱えた・スタックに積んだあとは、パスして、人に応答させる
  aiDo(o: AiOption): string | undefined {
    const ai = this.ai;
    if (!ai) return undefined;
    if (!o.action) return this.aiPass();
    const a = o.action;
    this.rec("aiDo", [o]);
    return this.perform("相手", (x) => {
      const before = x.stack.length;
      cpuDo(x, this.rules, ai, a, o.targets);
      if (x.stack.length > before && x.priority === ai) passPriority(x, ai, this.rules);
    }, []);
  }
  aiPass(): string | undefined {
    const ai = this.ai;
    if (ai) this.rec("aiPass", []);
    return ai ? this.perform("相手", (x) => void (x.priority === ai && passPriority(x, ai, this.rules)), []) : undefined;
  }
  // 判断が要らない優先権は、パスし続ける (人に優先権が渡るか、判断が要るところまで)
  aiAuto(): void {
    const ai = this.ai;
    if (!ai || this.pending) return; // 人への質問が出ている間は、何もしない (質問を消さない)
    this.rec("aiAuto", []);
    this.perform("相手", (x) => {
      for (let n = 0; n < MAX_PASSES && !x.over && x.priority === ai; n++) {
        if (this.aiWaiting(x)) return;
        if (passPriority(x, ai, this.rules) === "passed") return;
      }
    }, []);
  }
  // 攻撃クリーチャーを、AI が指定する (攻撃先は、人のプレイヤー)。不正なら理由を返す (局面は変わらない)
  aiAttack(ids: string[]): string | undefined {
    const ai = this.ai;
    const foe = this.game.players.find((p) => p !== ai);
    if (!ai || foe === undefined) return undefined;
    this.aiDone.add(`${this.game.turn}:attack`);
    this.rec("aiAttack", [ids]);
    return this.perform("相手", (x) => {
      if (ids.length) {
        declareAttackers(x, ai, ids.map((id) => ({ id, target: foe })), this.rules);
        x.log.push(`相手が ${ids.map((id) => x.battlefield.find((p) => p.id === id)?.card.name ?? id).join("、")} で攻撃した`);
      }
      passPriority(x, ai, this.rules);
    }, []);
  }
  aiBlock(pairs: { blocker: string; attacker: string }[]): string | undefined {
    const ai = this.ai;
    if (!ai) return undefined;
    this.aiDone.add(`${this.game.turn}:block`);
    const name = (id: string) => this.game.battlefield.find((p) => p.id === id)?.card.name ?? id;
    this.rec("aiBlock", [pairs]);
    return this.perform("相手", (x) => {
      declareBlockers(x, ai, pairs, this.rules); // 空でも呼ぶ (エンジンが、宣言済みを覚える)
      if (!pairs.length) return;
      x.log.push(`相手が ${pairs.map((q) => `${name(q.blocker)} で ${name(q.attacker)} を`).join("、")}ブロックした`);
    }, []);
  }
  // API が使えなかったとき: 以降は雑魚 CPU の決まりで動く。いまの判断も、その決まりで1回ぶん済ませる
  // permanent = API そのものが使えない (キー未設定・通信の失敗): 以降ずっと雑魚 CPU。そうでなければ (返事が使えなかった): この判断だけ、雑魚 CPU の決まりで済ませて、次はまた Claude
  aiFail(kind: "act" | "attack" | "block", reason: string, permanent = true): void {
    const ai = this.ai;
    if (!ai) return;
    this.game.log.push(`相手 (Claude) は使えない: ${reason}。${permanent ? "以降は、雑魚 CPU の決まりで動く" : "この判断だけ、雑魚 CPU の決まりで動く"}`);
    if (permanent) {
      this.ai = undefined;
      this.cpu = ai;
    } else this.aiDone.add(`${this.game.turn}:${kind}`); // 攻撃・ブロックは、この判断のあと、聞き直さない
    this.rec("aiFail", [kind, reason, permanent]);
    this.perform("相手", (x) => {
      if (kind === "block") cpuBlock(x, this.rules, ai);
      else if (kind === "attack") {
        cpuAttack(x, this.rules, ai);
        passPriority(x, ai, this.rules);
      } else {
        for (let k = 0; k < 20 && x.priority === ai; k++) {
          const r = cpuAct(x, this.rules, ai);
          if (r === "land") continue;
          passPriority(x, ai, this.rules);
          if (x.step === "combat" && x.combatPhase === "blockers" && x.active !== ai && attackersAt(x, ai).length) cpuBlock(x, this.rules, ai); // パスで、ブロックの段階に入った
          return;
        }
      }
    }, []);
  }

  // ---- マリガン (ロンドン)。game.mulligan があるあいだ、操作・「次へ」は受けない
  mulligan(): string | undefined {
    const g = this.game;
    if (!g.mulligan) return undefined;
    if (g.mulligan.count >= HAND_SIZE) return this.fail("マリガン", "これ以上は、マリガンできない");
    g.mulligan.count++;
    redraw(g, this.me, this.rng);
    g.log.push(`あなたはマリガンした (${g.mulligan.count} 回目)`);
    this.record.push({ op: "mulligan", args: [] });
    return undefined;
  }
  // キープする。マリガンした回数ぶん、底に置くカードが要るなら "bottom" (画面が選ばせて、bottom() を呼ぶ)。要らなければ、すぐ始まる
  keep(): "bottom" | "done" {
    const g = this.game;
    if (!g.mulligan) return "done";
    if (g.mulligan.count > 0) return "bottom";
    g.mulligan = undefined;
    g.log.push("あなたはキープした");
    this.record.push({ op: "keep", args: [] });
    return "done";
  }
  // 底に置くカード (マリガンした回数ぶん) を決めて、始める
  bottom(ids: string[]): string | undefined {
    const g = this.game;
    if (!g.mulligan) return undefined;
    if (ids.length !== g.mulligan.count) return this.fail("マリガン", `底に置くカードは ${g.mulligan.count} 枚`);
    if (!putBottom(g, this.me, ids)) return this.fail("マリガン", "手札に無いカードが含まれている");
    g.log.push(`あなたはキープして、${ids.length} 枚を底に置いた`);
    g.mulligan = undefined;
    this.record.push({ op: "bottom", args: [ids] });
    return undefined;
  }

  private fail(label: string, why: string): string {
    const msg = `${label}: ${why}`;
    this.game.log.push(msg);
    return msg;
  }

  // fn をコピーの局面で実行する。成功すれば元に書き戻す。質問が出たら、pending に置く
  private perform(label: string, fn: (g: Game) => void, answers: Answer[]): string | undefined {
    const copy = structuredClone({ ...this.game, decide: undefined }) as Game;
    copy.decide = makeDecider(this.me, answers);
    try {
      fn(copy);
    } catch (e) {
      if (e instanceof NeedInput) {
        this.answers = answers;
        this.pending = { request: e.request };
        this.redo = (a) => this.perform(label, fn, a);
        return undefined;
      }
      this.pending = this.redo = undefined;
      this.cur = undefined;
      if (e instanceof RuleError) return this.fail(label, e.message);
      throw e;
    }
    copy.decide = undefined;
    this.pending = this.redo = undefined;
    if (this.cur) this.record.push({ op: this.cur.op, args: this.cur.args, ...(answers.length ? { answers: [...answers] } : {}) });
    this.cur = undefined;
    for (const k of Object.keys(this.game)) if (!(k in copy)) delete (this.game as unknown as Record<string, unknown>)[k];
    Object.assign(this.game, copy);
    return undefined;
  }

  // 質問に答える (カード・対象の id の並び / はい・いいえ)。まだ質問があれば、pending が替わる
  answer(value: Answer): string | undefined {
    if (!this.redo) return undefined;
    return this.redo([...this.answers, value]);
  }
  // 質問を取り消す (何も起きなかったことになる)
  cancel(): void {
    this.cur = undefined;
    this.pending = this.redo = undefined;
    this.answers = [];
  }

  actions(): Action[] {
    return actionsFor(this.game, this.rules, this.me);
  }

  // 攻撃クリーチャーを指定する (戦闘ステップの最初の段階。ids = 攻撃するクリーチャー。攻撃先は相手のプレイヤー)
  declareAttackers(ids: string[]): string | undefined {
    if (this.game.mulligan) return this.fail("攻撃", "マリガンを終えてください");
    const g = this.game;
    const names = ids.map((id) => g.battlefield.find((p) => p.id === id)?.card.name ?? id);
    this.rec("declareAttackers", [ids]);
    return this.perform("攻撃", (x) => {
      declareAttackers(x, this.me, ids.map((id) => ({ id })), this.rules);
      if (ids.length) x.log.push(`あなたが ${names.join("、")} で攻撃した`);
    }, []);
  }
  // ブロックを指定する (pairs = [{ blocker, attacker }])。指定したら、(相手のターンなら) 相手がパスして、自分に優先権が戻る
  declareBlockers(pairs: { blocker: string; attacker: string }[]): string | undefined {
    if (this.game.mulligan) return this.fail("ブロック", "マリガンを終えてください");
    const g = this.game;
    const name = (id: string) => g.battlefield.find((p) => p.id === id)?.card.name ?? id;
    this.rec("declareBlockers", [pairs]);
    return this.perform("ブロック", (x) => {
      declareBlockers(x, this.me, pairs, this.rules);
      if (pairs.length) x.log.push(`あなたが ${pairs.map((q) => `${name(q.blocker)} で ${name(q.attacker)} を`).join("、")}ブロックした`);
      if (x.active !== this.me && x.priority !== this.me && x.priority) passPriority(x, x.priority, this.rules); // 相手がパスして、自分に優先権を渡す
    }, []);
  }

  // ダメージの割り振り (自分の攻撃クリーチャーごと: ブロッカー id → ダメージ)。割り振らずに「次へ」なら、宣言の順に致死ダメージ
  assign(all: Record<string, Record<string, number>>): string | undefined {
    this.rec("assign", [all]);
    return this.perform("割り振り", (x) => {
      for (const [a, amounts] of Object.entries(all)) assignDamage(x, this.me, a, amounts, this.rules);
    }, []);
  }

  // 手札のカードを使うとき、選ばせる対象 (対象を取らなければ空)
  needsForCard(cardId: string): TargetSlot[] {
    const c = this.game.hands[this.me].find((x) => x.id === cardId);
    return c && !/\bLand\b/.test(c.typeLine) ? slotsOf(this.game, this.rules, this.me, { kind: "cast", card: cardId }) : [];
  }
  needsForAbility(permId: string, index: number): TargetSlot[] {
    return slotsOf(this.game, this.rules, this.me, { kind: "activate", perm: permId, index });
  }

  // 手札のカードを、いま使えない理由 (使えるなら undefined)。カードを選んだときに、画面が見せる (「マナが足りません」など)。土地・マナ能力のマナを全部出せるとして、調べる
  whyNot(cardId: string): string | undefined {
    const g = this.game;
    if (g.mulligan) return "マリガンを終えてください";
    const card = g.hands[this.me].find((c) => c.id === cardId);
    if (!card) return "手札に無い";
    const a: Action = /\bLand\b/.test(card.typeLine) ? { kind: "land", card: cardId } : { kind: "cast", card: cardId };
    const why = tryAction(withAllMana(g, this.rules, this.me), this.rules, this.me, a, autoTargets(slotsOf(g, this.rules, this.me, a)));
    const msg = why?.replace("マナが足りない", "マナが足りません");
    return msg ? (msg.startsWith(card.name) ? msg : `${card.name}: ${msg}`) : undefined;
  }

  // ---- 払うマナの選択。足りないマナを自動でタップするとき、タップする土地に選べる余地があれば、選ばせる
  private manaIndexOf(g: Game, perm: { card: { name: string } }): number {
    return this.rules.get(perm.card.name)?.abilities.filter((a) => a.kind === "activated").findIndex((a) => manaOnly(a.body)) ?? -1;
  }
  // マナを出せる自分のパーマネント (タップしていない・いま使える)。label = 出るマナ ("U" など)
  manaSources(g: Game = this.game): { id: string; name: string; label: string }[] {
    const out: { id: string; name: string; label: string }[] = [];
    for (const p of g.battlefield) {
      if (p.controller !== this.me || p.tapped) continue;
      const i = this.manaIndexOf(g, p);
      if (i < 0 || tryAction(g, this.rules, this.me, { kind: "activate", perm: p.id, index: i }) !== undefined) continue;
      const ab = this.rules.get(p.card.name)!.abilities.filter((a) => a.kind === "activated")[i];
      const m = ab.body.find((c) => c.node === "addMana");
      out.push({ id: p.id, name: p.card.name, label: `${Number(m?.args.amount ?? 1) > 1 ? Number(m?.args.amount) : ""}${String(m?.args.color ?? "C")}` });
    }
    return out;
  }
  // 行動 a を、いまのプールだけでは払えず、足りないぶんを、種類の違うマナ源のどれかから選べるとき、その一覧 (選ぶ余地が無ければ undefined)
  payChoice(a: Action, targets: Record<string, string> | undefined, cast?: CastRecord): { id: string; name: string; label: string }[] | undefined {
    const g = this.game;
    const src = this.manaSources(g);
    if (src.length < 2 || tryAction(g, this.rules, this.me, a, targets, cast) === undefined) return undefined; // 選べない / もう払える
    if (new Set(src.map((s) => `${s.name}|${s.label}`)).size < 2) return undefined; // 全部同じ種類 (島だけ、など): どれでも同じ
    const x = structuredClone({ ...g, decide: undefined }) as Game;
    let k = 0;
    while (tryAction(x, this.rules, this.me, a, targets, cast) !== undefined && tapOne(x, this.me, this.rules)) k++;
    if (tryAction(x, this.rules, this.me, a, targets, cast) !== undefined || k >= src.length) return undefined; // 払えない / 全部タップが要る
    return src;
  }
  // 選んだマナ源 (ids) をタップすれば、払えるか
  payableWith(a: Action, targets: Record<string, string> | undefined, cast: CastRecord | undefined, ids: string[]): boolean {
    const x = structuredClone({ ...this.game, decide: undefined }) as Game;
    for (const id of ids) {
      const p = x.battlefield.find((q) => q.id === id);
      const i = p ? this.manaIndexOf(x, p) : -1;
      if (!p || i < 0) return false;
      try {
        activateAbility(x, this.me, id, i, {}, this.rules);
      } catch {
        return false;
      }
    }
    return tryAction(x, this.rules, this.me, a, targets, cast) === undefined;
  }
  private tapChosen(x: Game, ids: string[] | undefined) {
    for (const id of ids ?? []) {
      const p = x.battlefield.find((q) => q.id === id && q.controller === this.me && !q.tapped);
      const i = p ? this.manaIndexOf(x, p) : -1;
      if (p && i >= 0) activateAbility(x, this.me, id, i, {}, this.rules);
    }
  }

  // 唱えるときに選べる、マナだけの追加コスト (キッカーなど)のうち、いまの (出せるマナを全部使った) マナで払えるもの。払える (=唱えるときに、払うか選べる) ときだけ返す
  // 払うかどうかを選ぶのは、「総コストを決める」とき (対象を選ぶより前)。マナは、そのあと、払う
  kickChoices(cardId: string): { flag: "kicked" | "teamwork"; cost: string }[] {
    const g = this.game;
    const card = g.hands[this.me].find((x) => x.id === cardId);
    const body = card && !/\bLand\b/.test(card.typeLine) ? this.rules.get(card.name)?.abilities.find((a) => a.kind === "spell")?.body : undefined;
    if (!card || !body) return [];
    const act: Action = { kind: "cast", card: cardId };
    const t = autoTargets(slotsOf(g, this.rules, this.me, act));
    const sim = withAllMana(g, this.rules, this.me); // 土地・マナ能力のマナを全部出せるとして、払えるか (足りないマナは、唱えるとき、自動でタップする)
    if (tryAction(sim, this.rules, this.me, act, t) !== undefined) return []; // 払わずに唱えることも、できなければ、聞かない
    const out: { flag: "kicked" | "teamwork"; cost: string }[] = [];
    for (const flag of ["kicked", "teamwork"] as const) {
      const d = body.filter((c) => c.node === "additionalCost" && c.args.flag === flag);
      if (!d.length || d.some((c) => c.args.tapCreatures !== undefined)) continue; // クリーチャーをタップする追加コストは、まだ選ばせない
      if (tryAction(sim, this.rules, this.me, act, t, { [flag]: true }) === undefined) out.push({ flag, cost: d.map((c) => (typeof c.args.manaCost === "string" ? c.args.manaCost : `{${Number(c.args.mana ?? 0)}}`)).join("") });
    }
    return out;
  }

  // 手札のカードを使う (土地は出す、それ以外は唱える)。targets = 選んだ対象 (as → id をカンマでつなぐ)。cast = 払う追加コスト (kicked など)
  use(cardId: string, targets?: Record<string, string>, cast?: CastRecord, tapIds?: string[]): string | undefined {
    const g = this.game;
    if (g.mulligan) return this.fail("使えない", "マリガンを終えてください");
    const card = g.hands[this.me].find((c) => c.id === cardId);
    if (!card) return this.fail(cardId, "手札に無い");
    const land = /\bLand\b/.test(card.typeLine);
    const a: Action = land ? { kind: "land", card: cardId } : { kind: "cast", card: cardId };
    const t = targets ?? autoTargets(slotsOf(g, this.rules, this.me, a)); // 試し撃ちと本番で、同じ対象を使う
    // 土地・マナ能力のマナを全部出せるとして、払えるか。払えれば、足りないぶんは、唱えるとき、自動でタップする (先にタップしておいたぶんは、そのまま使う)
    const why = tryAction(withAllMana(g, this.rules, this.me), this.rules, this.me, a, t, cast);
    if (why) return this.fail(card.name, why.replace("マナが足りない", "マナが足りません"));
    this.rec("use", [cardId, targets, cast, tapIds]);
    return this.perform(card.name, (x) => {
      x.log.push(`あなたが ${card.name} を${land ? "出した" : cast?.kicked ? "キッカーを払って唱えた" : cast?.teamwork ? "チームワークで唱えた" : "唱えた"}`);
      if (land) playLand(x, this.me, cardId, this.rules);
      else {
        this.tapChosen(x, tapIds); // 選んだ土地を、先にタップ (選ばなければ、自動)
        tapFor(x, this.rules, this.me, a, t, cast);
        castSpell(x, this.me, cardId, t, this.rules, cast);
      }
    }, []);
  }

  private abilityOf(permId: string, index: number) {
    const perm = this.game.battlefield.find((p) => p.id === permId && p.controller === this.me);
    const ab = perm && this.rules.get(perm.card.name)?.abilities.filter((a) => a.kind === "activated")[index];
    return { perm, ab };
  }

  // 戦場の自分のパーマネントの、index 番目の起動型能力
  activate(permId: string, index: number, targets?: Record<string, string>, tapIds?: string[]): string | undefined {
    const g = this.game;
    if (g.mulligan) return this.fail("使えない", "マリガンを終えてください");
    const { perm, ab } = this.abilityOf(permId, index);
    if (!perm || !ab) return this.fail(permId, "起動できる能力が無い");
    const act: Action = { kind: "activate", perm: permId, index };
    const t = targets ?? autoTargets(slotsOf(g, this.rules, this.me, act));
    const manaOnly = ab.body.some((c) => c.node === "addMana") && ab.body.every((c) => c.node === "addMana" || c.node === "cost");
    // マナを出す能力はそのまま。マナを払う能力 (装備など) は、出せるマナを全部使えるとして調べ、足りないぶんは、自動でタップする
    const why = tryAction(manaOnly ? g : withAllMana(g, this.rules, this.me), this.rules, this.me, act, t);
    if (why) return this.fail(perm.card.name, why.replace("マナが足りない", "マナが足りません"));
    if (uselessMana(g, this.rules, this.me, act)) return this.fail(perm.card.name, "いまは、このマナの使い道が無い (唱えられる呪文・使える能力が無い)");
    const name = perm.card.name;
    this.rec("activate", [permId, index, targets, tapIds]);
    return this.perform(name, (x) => {
      x.log.push(manaOnly ? `あなたが ${name} をタップしてマナを出した` : `あなたが ${name} の能力を起動した`);
      if (!manaOnly) {
        this.tapChosen(x, tapIds);
        tapFor(x, this.rules, this.me, act, t);
      }
      activateAbility(x, this.me, permId, index, t, this.rules);
    }, []);
  }

  // 能力の一覧 (クリックで出すメニュー用)
  abilities(permId: string): { index: number; label: string; usable: boolean }[] {
    const perm = this.game.battlefield.find((p) => p.id === permId && p.controller === this.me);
    if (!perm) return [];
    const defs = this.rules.get(perm.card.name)?.abilities.filter((a) => a.kind === "activated") ?? [];
    return abilityLabels(this.rules, perm.card.name).map((label, index) => ({ index, label, mana: !!defs[index] && manaOnly(defs[index].body), usable: tryAction(this.game, this.rules, this.me, { kind: "activate", perm: permId, index }) === undefined && !uselessMana(this.game, this.rules, this.me, { kind: "activate", perm: permId, index }) })).filter((a) => !a.mana).map(({ mana: _m, ...rest }) => rest); // マナを出すだけの能力は、手では使わない (カードを使うとき、自動で払う)
  }

  // 「次へ」: 次のステップへ進む (次の「できること」までではない)。ただし、攻撃できるクリーチャーがいない戦闘ステップは飛ばす。自分がパスして、相手も自動でパスする。
  // ステップ (戦闘は、その中の段階) が進んだとき、または、スタックのものが1つ解決したときに止まる。手札が 7 枚を超えて終了するときは、残すカードを聞く。
  // 雑魚 CPU (cpu) がいれば、相手のターンのメインフェイズで、優先権を持ったときに動く (土地を出す・呪文を唱える)。呪文を唱えたら、スタックに積んで止まる (自分が応答できる)。
  // 何もできないときに、時間ゲージで自動で進めるかは、画面の設定 (止まり方) による
  next(): string | undefined {
    if (this.game.over) return undefined;
    if (this.game.mulligan) return this.fail("次へ", "マリガンを終えてください");
    this.rec("next", []);
    return this.perform("次へ", (g) => {
      const cpu = this.cpu;
      // CPU が優先権を持っているとき、動く。呪文を唱えたら、パスして (自分に応答させて)、真を返す
      const cpuTurn = (): boolean => {
        if (!cpu) return false;
        for (let k = 0; k < 20 && g.priority === cpu; k++) {
          const a = cpuAct(g, this.rules, cpu);
          if (a === "land") continue;
          if (a === "cast") passPriority(g, cpu, this.rules);
          return a === "cast";
        }
        return false;
      };
      for (let n = 0; n < MAX_PASSES && !g.over && g.priority; n++) {
        if (this.ai && this.aiWaiting(g)) return; // Claude の判断が要る: ここで止まる (画面が、API を呼ぶ)
        if (g.priority === cpu && cpuTurn()) return;
        const r = passPriority(g, g.priority!, this.rules);
        if (r === "passed") continue;
        if (g.over) return;
        if (r === "stepEnded" && g.step === "combat" && cpu) {
          // CPU の攻撃: 攻撃クリーチャーの指定の段階で、攻撃するなら宣言して、止まる (自分が応答できる)。CPU のブロック: ブロックの段階で宣言して、止まる
          if (g.combatPhase === "attackers" && g.active === cpu && !g.attackersDeclared && cpuAttack(g, this.rules, cpu) > 0) {
            passPriority(g, cpu, this.rules);
            return;
          }
          if (g.combatPhase === "blockers" && g.active !== cpu) cpuBlock(g, this.rules, cpu);
        }
        // 攻撃できるクリーチャーがいなければ、戦闘ステップは飛ばす (戦闘開始・攻撃クリーチャー指定・戦闘終了のあいだも)。CPU は、攻撃の段階で攻撃しなかったら、そのあとも飛ばす
        if (r === "stepEnded" && g.step === "combat" && !g.attackersDeclared && !g.battlefield.some((x) => x.attacking) && (!canAttackWith(g, g.active, this.rules) || (g.active === (cpu ?? this.ai) && g.combatPhase !== "beginning"))) continue;
        if (this.ai && this.aiWaiting(g)) return;
        if (g.active !== this.me && g.priority !== this.me) {
          if (cpuTurn()) return; // 相手のターンの始まり・解決のあと: CPU が先に動く
          if (g.priority !== this.me) passPriority(g, g.priority!, this.rules); // 動かなければ、パスして、自分に優先権を渡す
        }
        return;
      }
    }, []);
  }
}
