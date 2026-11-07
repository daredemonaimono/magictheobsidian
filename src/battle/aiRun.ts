import { AI_SYSTEM, AskAi, aiActPrompt, aiAttackPrompt, aiAttackers, aiBlockPrompt, aiBlockers, aiDescribe, aiParse, matchIds, permLine, withMemo } from "./ai";
import type { Game, RuleBook } from "./state";
import type { AiOption } from "./ai";
import { attackersAt } from "./engine";
import { BattleController } from "./play";

// 判断の材料 (コードが計算した行動の分析) を、AI に渡す道具。画面 (main.ts) が作る。mode = on (材料を添える) / compare (添えた場合と、添えない場合の答えを比べて、履歴の裏側に残す。AI の呼び出しは 2 倍)
export interface Judged {
  text: string; // AI への指示に添える文章
  input: number;
  output: number;
  ms: number;
}
export interface AiAdvisor {
  mode: "on" | "compare";
  judge(w: "act" | "attack" | "block", g: Game, rules: RuleBook, ai: string, opts?: AiOption[]): Promise<Judged>;
}

// 2 つの返事 (助言あり・なし) が、同じ行動か。act = 同じ番号 / attack = 同じ id の集合 / block = 同じ組の集合
function sameReply(w: "act" | "attack" | "block", a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const set = (v: unknown) => JSON.stringify((Array.isArray(v) ? v : []).map((x) => (typeof x === "object" ? `${(x as { blocker?: unknown }).blocker}>${(x as { attacker?: unknown }).attacker}` : String(x))).sort());
  return w === "act" ? String(a.choice) === String(b.choice) : w === "attack" ? set(a.attackers) === set(b.attackers) : set(a.blocks) === set(b.blocks);
}
const brief = (w: "act" | "attack" | "block", r: Record<string, unknown>, opts: { id: number; label: string }[]): string =>
  w === "act" ? opts[Number(r.choice)]?.label ?? `番号 ${String(r.choice)}` : w === "attack" ? `攻撃 [${((r.attackers as unknown[]) ?? []).join(", ")}]` : `ブロック [${((r.blocks as { blocker?: unknown; attacker?: unknown }[]) ?? []).map((x) => `${x.blocker}>${x.attacker}`).join(", ")}]`;

// Claude の AI の、1回ぶんの判断 (画面 BattleView.driveAi と、テストが使う)。判断が要らない優先権はパスして、要る場面では API を呼んで、返事を実行する。
// 戻り値: "none" = 判断が要らない (人の番) / "acted" = 1つ実行した (続きがあるかもしれない) / "failed" = 失敗した (以降は、雑魚 CPU の決まり。理由はログに)
// 人への質問が出ているか (AI の相手への質問 (for) は、人の質問ではない)
export const humanAsking = (ctl: BattleController): boolean => !!ctl.pending && !(ctl.pending.request.kind === "choose" && ctl.pending.request.for);

// AI の相手への質問 (エンジンの途中: Dredge など) に、答える。API (ask) に聞いて、カードの id を選ばせる。使えない返事・失敗は、「選ばない」(Dredge しない)。答えは、記録に残る (リプレイで再生される)
async function answerAiQuestion(ctl: BattleController, ask: AskAi | undefined, ai: string): Promise<"acted"> {
  const g = ctl.game;
  const req = ctl.pending!.request;
  if (req.kind !== "choose") {
    ctl.answer([]);
    return "acted";
  }
  let ids: string[] = [];
  const cached = req.key ? ctl.aiDredgeCache.get(req.key) : undefined;
  if (cached && cached.every((id) => req.cards.some((c) => c.id === id))) {
    ids = cached; // 同じ状況の答えを使い回す (AI を呼ばない)
  } else if (ask) {
    try {
      const prompt = `${aiDescribe(g, ctl.rules, ai)}\n\n${req.label ?? "選んでください"}\n選べるカード:\n${req.cards.map((c) => `${c.id}: ${c.name}`).join("\n")}\n\n選ぶカードの id を、最大 ${req.max} 枚、{"ids": ["id", ...], "why": "短い理由"} で答えてください。選ばない (ふつうに引く) なら、空の配列です。`;
      const r = await ask(withMemo(AI_SYSTEM, ctl.aiMemo, ctl.aiDecks, ctl.aiShared), prompt);
      ctl.aiTokens.input += r.input ?? 0;
      ctl.aiTokens.output += r.output ?? 0;
      const v = aiParse(r.text);
      const got = Array.isArray(v?.ids) ? matchIds(v!.ids as unknown[], req.cards).ids.slice(0, req.max) : [];
      if (got.length >= req.min) ids = got;
      if (typeof v?.why === "string" && v.why.trim()) ctl.aiNotes.push({ n: ctl.record.length, why: `${ids.length ? "Dredge する" : "Dredge しない"}: ${v.why.trim()}` });
      if (req.key) ctl.aiDredgeCache.set(req.key, ids);
    } catch (e) {
      g.log.push(`相手 (AI) の Dredge の判断に失敗した (${(e as Error).message})。ふつうに引く`);
    }
  }
  if (ids.length < req.min) ids = req.cards.slice(0, req.min).map((c) => c.id);
  ctl.answer(ids);
  return "acted";
}

export async function aiStep(ctl: BattleController, ask: AskAi | undefined, ai: string, advisor?: AiAdvisor): Promise<"none" | "acted" | "failed"> {
  if (!ctl.aiActive || ctl.game.over) return "none";
  if (ctl.pending) return humanAsking(ctl) ? "none" : answerAiQuestion(ctl, ask, ai); // AI の相手への質問は、ここで答える
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
  // 判断の材料 (行動の分析) を、AI への指示に添える。失敗しても、材料なしで続ける
  let advice = "";
  if (advisor) {
    try {
      const a = await advisor.judge(w, g, rules, ai, opts);
      advice = `\n\n${a.text}`;
      ctl.aiTokens.input += a.input;
      ctl.aiTokens.output += a.output;
      g.log.push(`相手 (AI) に、判断の材料を渡した (${a.ms}ms${a.input ? ` · 入力 ${a.input} トークン` : ""})`);
    } catch (e) {
      g.log.push(`判断の材料を、AI に渡せなかった (${(e as Error).message})。材料なしで続ける`);
    }
  }
  let problem = "";
  // 返事が使えなかったら (形が違う・できない行動)、理由を添えて、1回だけ聞き直す。それでもだめなら、この判断だけ雑魚 CPU の決まりで (次は、また Claude)
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string | undefined;
    try {
      if (text === undefined) {
      const r = await ask(withMemo(AI_SYSTEM, ctl.aiMemo, ctl.aiDecks, ctl.aiShared), attempt === 0 ? `${prompt}${advice}` : `${prompt}${advice}\n\n前の返事は使えませんでした (${problem})。選択肢の番号・id を確かめて、もう一度、JSON だけで答えてください。`);
      text = r.text;
      if (r.input !== undefined || r.output !== undefined) {
        ctl.aiTokens.input += r.input ?? 0;
        ctl.aiTokens.output += r.output ?? 0;
        g.log.push(`相手 (AI) のトークン: 入力 ${r.input ?? "?"} / 出力 ${r.output ?? "?"} (この対戦の合計 ${ctl.aiTokens.input + ctl.aiTokens.output})`);
      }
      }
    } catch (e) {
      ctl.aiFail(w, (e as Error).message); // API そのものの失敗: 以降は、雑魚 CPU
      return "failed";
    }
    if (!ctl.aiActive) return "none"; // 待っている間に、状況が変わった (新しい対戦など)
    if (text === undefined) {
      ctl.aiFail(w, "聞き直す AI が使えない");
      return "failed";
    }
    const reply = aiParse(text);
    if (!reply) {
      problem = `JSON として読めない: ${text.slice(0, 60).replace(/\s+/g, " ")}`;
      continue;
    }
    // 比較: 判断の材料を添えなかったら、AI の答えが変わったか (履歴の裏側に残す。AI の学習 (デッキのメモ・判断の材料) を決める手がかり)
    if (advisor?.mode === "compare" && advice && attempt === 0) {
      try {
        const plain = await ask(withMemo(AI_SYSTEM, ctl.aiMemo, ctl.aiDecks, ctl.aiShared), prompt);
        ctl.aiTokens.input += plain.input ?? 0;
        ctl.aiTokens.output += plain.output ?? 0;
        const other = aiParse(plain.text);
        if (other) ctl.aiNotes.push({ n: ctl.record.length, why: `[材料の比較] ${sameReply(w, reply, other) ? "同じ" : "変わった"} — 助言あり: ${brief(w, reply, opts)} / 助言なし: ${brief(w, other, opts)}` });
      } catch {
        /* 比較に失敗しても、本番の判断は続ける */
      }
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
