// ステップ進行・優先権・スタック・戦闘・コスト。画面なしで、テストから動かせる。このファイルは、外から使う名前を、まとめて出す窓口 (中身は、エンジンの働きごとのファイル)

export { nextPlayer, RuleError, isSick } from "./shared";
export { targetSlots } from "./targets";
export type { TargetSlot } from "./targets";
export { castSpell, playLand, activateAbility, canCastNow, castPrepared, pitchable } from "./cast";
export { resolveTop } from "./stack";
export { passPriority, startGame } from "./turn";
export { canAttackPerm, canAttackWith, attackersAt, declareAttackers, canBlock, declareBlockers, assignDamage } from "./combat";
