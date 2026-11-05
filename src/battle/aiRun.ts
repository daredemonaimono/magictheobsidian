import { AI_SYSTEM, AskAi, aiActPrompt, aiAttackPrompt, aiAttackers, aiBlockPrompt, aiParse } from "./ai";
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
      const r = await ask(AI_SYSTEM, attempt === 0 ? prompt : `${prompt}\n\n前の返事は使えませんでした (${problem})。選択肢の番号・id を確かめて、もう一度、JSON だけで答えてください。`);
      text = r.text;
      if (r.input !== undefined || r.output !== undefined) {
        ctl.aiTokens.input += r.input ?? 0;
        ctl.aiTokens.output += r.output ?? 0;
        g.log.push(`相手 (Claude) のトークン: 入力 ${r.input ?? "?"} / 出力 ${r.output ?? "?"} (この対戦の合計 ${ctl.aiTokens.input + ctl.aiTokens.output})`);
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
        if (why) g.log.push(`相手の考え: ${why}`);
        err = ctl.aiDo(o);
      }
    } else if (w === "attack") {
      const able = new Set(aiAttackers(g, rules, ai).map((x) => x.id));
      const ids = Array.isArray(reply.attackers) ? (reply.attackers as unknown[]).filter((x): x is string => typeof x === "string" && able.has(x)) : undefined;
      if (!ids) err = "attackers の配列が無い";
      else {
        if (why) g.log.push(`相手の考え: ${why}`);
        err = ctl.aiAttack(ids);
      }
    } else {
      const pairs = Array.isArray(reply.blocks) ? (reply.blocks as { blocker?: unknown; attacker?: unknown }[]).filter((q) => typeof q?.blocker === "string" && typeof q?.attacker === "string").map((q) => ({ blocker: q.blocker as string, attacker: q.attacker as string })) : undefined;
      if (!pairs) err = "blocks の配列が無い";
      else {
        if (why) g.log.push(`相手の考え: ${why}`);
        err = ctl.aiBlock(pairs);
      }
    }
    if (!err) return "acted";
    problem = err;
  }
  ctl.aiFail(w, problem, false); // 2回とも使えなかった: この判断だけ、雑魚 CPU の決まり
  return "acted";
}
