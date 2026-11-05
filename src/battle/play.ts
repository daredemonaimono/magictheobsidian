import { Action, abilityLabels, actionsFor, autoTargets, slotsOf, tryAction } from "./actions";
import { RuleError, TargetSlot, activateAbility, castSpell, passPriority, playLand } from "./engine";
import { Answer, InputRequest, NeedInput, makeDecider } from "./input";
import { Game, PlayerId, RuleBook } from "./state";

const MAX_PASSES = 100; // 無限ループ防止

// 対戦の画面の操作の入口。画面は、これを呼んで描き直すだけ。失敗は、理由を返して、ログにも1行書く (局面は変わらない)。
// 操作は、コピーした局面で実行して、成功したら元に書き戻す。途中で自分への質問 (捨てる・選ぶ・してもよい・支払う・誘発の対象) があって、答えが無ければ、pending に質問を置いて止まる
// (元の局面は、まだ変わっていない)。answer() で答えを足すと、最初からやり直す。cancel() で、何も起きなかったことになる
export class BattleController {
  pending?: { request: InputRequest };
  private redo?: (answers: Answer[]) => string | undefined;
  private answers: Answer[] = [];

  constructor(readonly game: Game, readonly rules: RuleBook, readonly me: PlayerId = "you") {}

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
      if (e instanceof RuleError) return this.fail(label, e.message);
      throw e;
    }
    copy.decide = undefined;
    this.pending = this.redo = undefined;
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
    this.pending = this.redo = undefined;
    this.answers = [];
  }

  actions(): Action[] {
    return actionsFor(this.game, this.rules, this.me);
  }

  // 手札のカードを使うとき、選ばせる対象 (対象を取らなければ空)
  needsForCard(cardId: string): TargetSlot[] {
    const c = this.game.hands[this.me].find((x) => x.id === cardId);
    return c && !/\bLand\b/.test(c.typeLine) ? slotsOf(this.game, this.rules, this.me, { kind: "cast", card: cardId }) : [];
  }
  needsForAbility(permId: string, index: number): TargetSlot[] {
    return slotsOf(this.game, this.rules, this.me, { kind: "activate", perm: permId, index });
  }

  // 手札のカードを使う (土地は出す、それ以外は唱える)。targets = 選んだ対象 (as → id をカンマでつなぐ)
  use(cardId: string, targets?: Record<string, string>): string | undefined {
    const g = this.game;
    const card = g.hands[this.me].find((c) => c.id === cardId);
    if (!card) return this.fail(cardId, "手札に無い");
    const land = /\bLand\b/.test(card.typeLine);
    const a: Action = land ? { kind: "land", card: cardId } : { kind: "cast", card: cardId };
    const t = targets ?? autoTargets(slotsOf(g, this.rules, this.me, a)); // 試し撃ちと本番で、同じ対象を使う
    const why = tryAction(g, this.rules, this.me, a, t);
    if (why) return this.fail(card.name, why);
    return this.perform(card.name, (x) => {
      x.log.push(`あなたが ${card.name} を${land ? "出した" : "唱えた"}`);
      if (land) playLand(x, this.me, cardId, this.rules);
      else castSpell(x, this.me, cardId, t, this.rules);
    }, []);
  }

  private abilityOf(permId: string, index: number) {
    const perm = this.game.battlefield.find((p) => p.id === permId && p.controller === this.me);
    const ab = perm && this.rules.get(perm.card.name)?.abilities.filter((a) => a.kind === "activated")[index];
    return { perm, ab };
  }

  // 戦場の自分のパーマネントの、index 番目の起動型能力
  activate(permId: string, index: number, targets?: Record<string, string>): string | undefined {
    const g = this.game;
    const { perm, ab } = this.abilityOf(permId, index);
    if (!perm || !ab) return this.fail(permId, "起動できる能力が無い");
    const act: Action = { kind: "activate", perm: permId, index };
    const t = targets ?? autoTargets(slotsOf(g, this.rules, this.me, act));
    const why = tryAction(g, this.rules, this.me, act, t);
    if (why) return this.fail(perm.card.name, why);
    const manaOnly = ab.body.some((c) => c.node === "addMana") && ab.body.every((c) => c.node === "addMana" || c.node === "cost");
    const name = perm.card.name;
    return this.perform(name, (x) => {
      x.log.push(manaOnly ? `あなたが ${name} をタップしてマナを出した` : `あなたが ${name} の能力を起動した`);
      activateAbility(x, this.me, permId, index, t, this.rules);
    }, []);
  }

  // 能力の一覧 (クリックで出すメニュー用)
  abilities(permId: string): { index: number; label: string; usable: boolean }[] {
    const perm = this.game.battlefield.find((p) => p.id === permId && p.controller === this.me);
    if (!perm) return [];
    return abilityLabels(this.rules, perm.card.name).map((label, index) => ({ index, label, usable: tryAction(this.game, this.rules, this.me, { kind: "activate", perm: permId, index }) === undefined }));
  }

  // 「次へ」: 自分がパスして、相手も自動でパスする。スタックのものが1つ解決したら止まる。ステップが進んだら、自分のターンのうちは止まる。
  // 相手のターンは、(相手は何もしないので) 自分のターンになるまで自動で進める。手札が 7 枚を超えて終了するときは、捨てるカードを聞く
  next(): string | undefined {
    if (this.game.over) return undefined;
    return this.perform("次へ", (g) => {
      for (let n = 0; n < MAX_PASSES && !g.over && g.priority; n++) {
        const r = passPriority(g, g.priority, this.rules);
        if (r === "passed") continue;
        if (g.active === this.me) return;
      }
    }, []);
  }
}
