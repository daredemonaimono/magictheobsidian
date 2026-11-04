import { Action, abilityLabels, actionsFor, tryAction } from "./actions";
import { activateAbility, castSpell, passPriority, playLand } from "./engine";
import { Game, PlayerId, RuleBook } from "./state";

const HAND_LIMIT = 7;
const MAX_PASSES = 100; // 無限ループ防止

// 対戦の画面の操作の入口。画面は、これを呼んで描き直すだけ。失敗は、理由を返して、ログにも1行書く (局面は変わらない)
export class BattleController {
  constructor(readonly game: Game, readonly rules: RuleBook, readonly me: PlayerId = "you") {}

  private fail(label: string, why: string): string {
    const msg = `${label}: ${why}`;
    this.game.log.push(msg);
    return msg;
  }

  actions(): Action[] {
    return actionsFor(this.game, this.rules, this.me);
  }

  // 手札のカードを使う (土地は出す、それ以外は唱える)
  use(cardId: string): string | undefined {
    const g = this.game;
    const card = g.hands[this.me].find((c) => c.id === cardId);
    if (!card) return this.fail(cardId, "手札に無い");
    const land = /\bLand\b/.test(card.typeLine);
    const a: Action = { kind: land ? "land" : "cast", card: cardId };
    const why = tryAction(g, this.rules, this.me, a);
    if (why) return this.fail(card.name, why);
    g.log.push(`あなたが ${card.name} を${land ? "出した" : "唱えた"}`);
    if (land) playLand(g, this.me, cardId, this.rules);
    else castSpell(g, this.me, cardId, {}, this.rules);
    return undefined;
  }

  private abilityOf(permId: string, index: number) {
    const perm = this.game.battlefield.find((p) => p.id === permId && p.controller === this.me);
    const ab = perm && this.rules.get(perm.card.name)?.abilities.filter((a) => a.kind === "activated")[index];
    return { perm, ab };
  }

  // 戦場の自分のパーマネントの、index 番目の起動型能力
  activate(permId: string, index: number): string | undefined {
    const g = this.game;
    const { perm, ab } = this.abilityOf(permId, index);
    if (!perm || !ab) return this.fail(permId, "起動できる能力が無い");
    const why = tryAction(g, this.rules, this.me, { kind: "activate", perm: permId, index });
    if (why) return this.fail(perm.card.name, why);
    const manaOnly = ab.body.some((c) => c.node === "addMana") && ab.body.every((c) => c.node === "addMana" || c.node === "cost");
    g.log.push(manaOnly ? `あなたが ${perm.card.name} をタップしてマナを出した` : `あなたが ${perm.card.name} の能力を起動した`);
    activateAbility(g, this.me, permId, index, {}, this.rules);
    return undefined;
  }

  // 能力の一覧 (クリックで出すメニュー用)
  abilities(permId: string): { index: number; label: string; usable: boolean }[] {
    const perm = this.game.battlefield.find((p) => p.id === permId && p.controller === this.me);
    if (!perm) return [];
    return abilityLabels(this.rules, perm.card.name).map((label, index) => ({ index, label, usable: tryAction(this.game, this.rules, this.me, { kind: "activate", perm: permId, index }) === undefined }));
  }

  // 「次へ」: 自分がパスして、相手も自動でパスする。スタックのものが1つ解決したら止まる。ステップが進んだら、自分のターンのうちは止まる。
  // 相手のターンは、(相手は何もしないので) 自分のターンになるまで自動で進める
  next(): void {
    const g = this.game;
    const over = g.step === "end" && g.active === this.me ? g.hands[this.me].length - HAND_LIMIT : 0;
    for (let n = 0; n < MAX_PASSES && !g.over && g.priority; n++) {
      const r = passPriority(g, g.priority, this.rules);
      if (r === "passed") continue;
      if (r === "stepEnded" && over > 0) g.log.push(`手札が ${HAND_LIMIT} 枚を超えたので、後ろから ${over} 枚捨てた`);
      if (g.active === this.me) return;
    }
  }
}
