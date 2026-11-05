import { AiOption } from "./ai";
import { BattleController, RecordEntry } from "./play";

// 対戦の記録 (BattleController.record) を、新しいコントローラーに、順に呼び直す。同じ初期状態 (同じ乱数の種のデッキ) から始めれば、同じ局面になる。
// 失敗した呼び出し (記録と食い違った) の数を返す。upTo = 最初の何件まで再生するか
export function replay(ctl: BattleController, entries: RecordEntry[], upTo = entries.length): number {
  let bad = 0;
  for (const e of entries.slice(0, upTo)) {
    const a = e.args.map((x) => (x === null ? undefined : x)) as any[];
    let r: unknown;
    switch (e.op) {
      case "mulligan": r = ctl.mulligan(); break;
      case "keep": r = ctl.keep(); break;
      case "bottom": r = ctl.bottom(a[0]); break;
      case "next": r = ctl.next(); break;
      case "use": r = ctl.use(a[0], a[1], a[2], a[3]); break;
      case "activate": r = ctl.activate(a[0], a[1], a[2], a[3]); break;
      case "declareAttackers": r = ctl.declareAttackers(a[0]); break;
      case "declareBlockers": r = ctl.declareBlockers(a[0]); break;
      case "assign": r = ctl.assign(a[0]); break;
      case "aiDo": r = ctl.aiDo(a[0] as AiOption); break;
      case "aiPass": r = ctl.aiPass(); break;
      case "aiAuto": ctl.aiAuto(); break;
      case "aiAttack": r = ctl.aiAttack(a[0]); break;
      case "aiBlock": r = ctl.aiBlock(a[0]); break;
      case "aiFail": ctl.aiFail(a[0], a[1], a[2]); break;
      default: bad++;
    }
    for (const ans of e.answers ?? []) r = ctl.answer(ans);
    if (typeof r === "string" && r) bad++;
  }
  return bad;
}
