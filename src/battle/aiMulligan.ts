import { AI_SYSTEM, AskAi, aiParse, matchIds, withMemo } from "./ai";
import { CPU_MAX_MULLIGANS, cpuBottom, cpuKeeps } from "./cpu";
import { putBottom, redraw } from "./mulligan";
import { Game, PlayerId } from "./state";

// AI の相手のマリガン (ロンドン)。手札を見せて、キープ / マリガンを、AI に決めさせる (デッキのメモに、基準があれば、それに沿う。無ければ、AI の自己判断)。
// 途中で、返事が使えない・通信が失敗したら、そこから先は、雑魚 CPU の決まり (cpuKeeps / cpuBottom) で済ませる。結果 (回数と、底に置いたカード) を返す: 履歴のリプレイで、同じ手札を作り直すため
export interface MulliganResult {
  count: number;
  bottom: string[];
}

const handText = (g: Game, p: PlayerId) => g.hands[p].map((c) => `${c.name} (${c.typeLine}, マナ総量 ${c.mv}, id:${c.id})`).join("\n");

export async function aiMulligan(g: Game, p: PlayerId, rng: () => number, ask: AskAi, memo = "", decks?: { mine: string; foe: string }): Promise<MulliganResult> {
  const system = withMemo(AI_SYSTEM, memo, decks);
  let count = 0;
  let broken = false; // 返事が使えなかった: 以降は、雑魚 CPU の決まり
  const query = async (prompt: string): Promise<Record<string, unknown> | undefined> => {
    for (let attempt = 0; attempt < 2 && !broken; attempt++) {
      try {
        const r = await ask(system, attempt ? `${prompt}\n\n前の返事は、JSON として読めませんでした。JSON だけで答えてください。` : prompt);
        const v = aiParse(r.text);
        if (v) return v;
      } catch {
        break;
      }
    }
    broken = true;
    return undefined;
  };
  for (;;) {
    let keep: boolean;
    if (count >= CPU_MAX_MULLIGANS) keep = true;
    else if (broken) keep = cpuKeeps(g.hands[p], count);
    else {
      const v = await query(`対戦の始まりの、手札のマリガンです (ロンドン・マリガン: マリガンすると、7枚引き直して、引き直した回数ぶん、手札から底に置きます)。\nいまの手札 (${count} 回マリガン済み):\n${handText(g, p)}\n\nキープしますか? {"keep": true か false, "why": "..."} だけで答えてください。`);
      keep = typeof v?.keep === "boolean" ? v.keep : broken ? cpuKeeps(g.hands[p], count) : true;
    }
    if (keep) break;
    redraw(g, p, rng);
    count++;
  }
  let bottom: string[] = [];
  if (count > 0) {
    if (!broken) {
      const v = await query(`キープしました。手札から、ライブラリーの底に置くカードを ${count} 枚、選んでください。\n手札:\n${handText(g, p)}\n\n{"bottom": ["id", ...], "why": "..."} だけで答えてください (id は、(id:〜) の〜の部分)。`);
      const ids = Array.isArray(v?.bottom) ? matchIds(v!.bottom as unknown[], g.hands[p].map((c) => ({ id: c.id, name: c.name }))).ids : [];
      if (ids.length === count) bottom = ids;
    }
    if (bottom.length !== count) bottom = cpuBottom(g.hands[p], count);
    putBottom(g, p, bottom);
  }
  g.log.push(count ? `相手はマリガンした (${count} 回)` : "相手はキープした");
  return { count, bottom };
}

// 記録した結果から、同じ手札を作り直す (リプレイ。API は呼ばない)
export function applyMulligan(g: Game, p: PlayerId, rng: () => number, m: MulliganResult): void {
  for (let i = 0; i < m.count; i++) redraw(g, p, rng);
  if (m.count > 0) putBottom(g, p, m.bottom);
  g.log.push(m.count ? `相手はマリガンした (${m.count} 回)` : "相手はキープした");
}
