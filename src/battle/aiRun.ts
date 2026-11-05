import { AI_SYSTEM, AskAi, aiActPrompt, aiAttackPrompt, aiAttackers, aiBlockPrompt, aiBlockers, aiParse, matchIds, withMemo } from "./ai";
import { attackersAt } from "./engine";
import { BattleController } from "./play";

// Claude の AI の、1回ぶんの判断 (画面 BattleView.driveAi と、テストが使う)。判断が要らない優先権はパスして、要る場面では API を呼んで、返事を実行する。
// 戻り値: "none" = 判断が要らない (人の番) / "acted" = 1つ実行した (続きがあるかもしれない) / "failed" = 失敗した (以降は、雑魚 CPU の決まり。理由はログに)
export async function aiStep(ctl: BattleController, ask: AskAi | undefined, ai: string): Promise<"none" | "acted" | "failed"> {
  if (!ctl.aiActive || ctl.game.over || ctl.pending) return "none";
  let w = ctl.aiWaiting();
  if (!w) {
    ctl.aiAuto(); // 判断が要らない優先権は、パス
    w = ctl.aiWaiting();
    if (!w) return "none";
  }
  const g = ctl.game;
  const rules = ctl.rules;
  if (!ask) {
    ctl.aiFail(w, "API キーが未設定");
    return "failed";
  }
  const opts = w === "act" ? ctl.aiOptions() : [];
  const prompt = w === "act" ? aiActPrompt(g, rules, ai, opts) : w === "attack" ? aiAttackPrompt(g, rules, ai) : aiBlockPrompt(g, rules, ai);
  let problem = "";
  // 返事が使えなかったら (形が違う・できない行動)、理由を添えて、1回だけ聞き直す。それでもだめなら、この判断だけ雑魚 CPU の決まりで (次は、また Claude)
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      const r = await ask(withMemo(AI_SYSTEM, ctl.aiMemo, ctl.aiDecks), attempt === 0 ? prompt : `${prompt}\n\n前の返事は使えませんでした (${problem})。選択肢の番号・id を確かめて、もう一度、JSON だけで答えてください。`);
      text = r.text;
      if (r.input !== undefined || r.output !== undefined) {
        ctl.aiTokens.input += r.input ?? 0;
        ctl.aiTokens.output += r.output ?? 0;
        g.log.push(`相手 (AI) のトークン: 入力 ${r.input ?? "?"} / 出力 ${r.output ?? "?"} (この対戦の合計 ${ctl.aiTokens.input + ctl.aiTokens.output})`);
      }
    } catch (e) {
      ctl.aiFail(w, (e as Error).message); // API そのものの失敗: 以降は、雑魚 CPU
      return "failed";
    }
    if (!ctl.aiActive) return "none"; // 待っている間に、状況が変わった (新しい対戦など)
    const reply = aiParse(text);
    if (!reply) {
      problem = `JSON として読めない: ${text.slice(0, 60).replace(/\s+/g, " ")}`;
      continue;
    }
    const why = typeof reply.why === "string" ? reply.why.trim() : "";
    let err: string | undefined;
    if (w === "act") {
      const o = opts[Number(reply.choice)];
      if (!o) err = `選択肢の番号が不正 (${String(reply.choice)})`;
      else {
        if (why) ctl.aiNotes.push({ n: ctl.record.length, why }); // 理由は、ログには出さない (履歴の「裏側」に残す。あとで学ぶのに使える)
        err = ctl.aiDo(o);
      }
    } else if (w === "attack") {
      const ableList = aiAttackers(g, rules, ai).map((x) => ({ id: x.id, name: x.card.name }));
      const m = Array.isArray(reply.attackers) ? matchIds(reply.attackers as unknown[], ableList) : undefined;
      const ids = m?.ids;
      if (!m || !ids) err = "attackers の配列が無い";
      else if ((reply.attackers as unknown[]).length > 0 && !ids.length) err = `attackers の id が合わない (${m.unknown.join("、")})。攻撃できるのは: ${ableList.map((x) => `${x.id}`).join("、")}`; // 「攻撃する」と言いながら、無効な id: 黙って攻撃しないのではなく、聞き直す
      else {
        if (why) ctl.aiNotes.push({ n: ctl.record.length, why }); // 理由は、ログには出さない (履歴の「裏側」に残す。あとで学ぶのに使える)
        err = ctl.aiAttack(ids);
      }
    } else {
      const rawBlocks = Array.isArray(reply.blocks) ? (reply.blocks as { blocker?: unknown; attacker?: unknown }[]) : undefined;
      const blockerList = aiBlockers(g, rules, ai).map((x) => ({ id: x.id, name: x.card.name }));
      const attackerList = attackersAt(g, ai).map((x) => ({ id: x.id, name: x.card.name }));
      const pairs = rawBlocks?.flatMap((q) => {
        const b = matchIds([q?.blocker], blockerList).ids[0];
        const a = matchIds([q?.attacker], attackerList).ids[0];
        return b && a ? [{ blocker: b, attacker: a }] : [];
      });
      if (!rawBlocks || !pairs) err = "blocks の配列が無い";
      else if (rawBlocks.length > 0 && !pairs.length) err = `blocks の id が合わない。ブロックできるのは: ${blockerList.map((x) => x.id).join("、")} / 攻撃しているのは: ${attackerList.map((x) => x.id).join("、")}`;
      else {
        if (why) ctl.aiNotes.push({ n: ctl.record.length, why }); // 理由は、ログには出さない (履歴の「裏側」に残す。あとで学ぶのに使える)
        err = ctl.aiBlock(pairs);
      }
    }
    if (!err) return "acted";
    problem = err;
  }
  ctl.aiFail(w, problem, false); // 2回とも使えなかった: この判断だけ、雑魚 CPU の決まり
  return "acted";
}
