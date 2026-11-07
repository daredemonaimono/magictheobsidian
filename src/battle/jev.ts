import { ClaudeError, Http } from "./claude";

// Jev (TypeSafe の System One モデル): 文章を作らず、状態を渡すと、選択肢から選ぶ・はい/いいえの確率を返す。速くて安い (入力 100 万トークン 0.042 ドル。出力は無料)。
// 使うのは、選ぶ仕事だけ: 対戦の判断 (行動・攻撃・ブロック) と、ノードを選ぶ (1段目)。文章を書く仕事 (ルールを書く・メモの下書き) には使えない。
// 仕様 (docs.typesafe.ai): POST https://api.typesafe.ai/v1/systemone、Bearer 認証。questions = { 名前: { type: "choice" | "noul", instructions, criteria } }。
// Jev の癖: 最初の選択肢に偏る (だから、「何もしない」は、最後に置く) / 数えたり、何段も考えるのは苦手 / 状態に関係ない内容が多いと、精度が落ちる (だから、状態は、短くする)
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_JEV_MODEL = "jev-latest";

// 質問の 3 種類 (docs.typesafe.ai / abacus.ai/help/route-llm/systemone): noul = はい/いいえ (criteria の true / false は、何を はい・いいえ とするか。省略できる) / choice = 選択肢のどれか / score = 低い順に並べた段階 (2〜10) のどれか
export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "score"; instructions: string; criteria: string[] };
export interface JevAnswer {
  choice?: string; // choice: 選ばれた名前
  confidence?: number; // choice: 自信 (0〜1)
  probabilities?: Record<string, number>;
  noul?: number; // noul: はい の確率 (0〜1)
  score?: number; // score: 段階の番号 (0 から。確率で重みづけした小数)
}
export interface JevResult {
  answers: Record<string, JevAnswer>;
  input: number; // 使った入力トークン (課金されるのは、こちらだけ)
  output: number;
  ms: number; // かかった時間 (ミリ秒)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 質問を送る。429 (レート制限)・529 (混雑) は、短く待って、2回まで、やり直す。それ以外の失敗は、ClaudeError (キーが無効など)
export async function askJev(o: { apiKey: string; model: string; state: string | Record<string, unknown>; questions: Record<string, JevQuestion>; http: Http; now?: () => number; wait?: (ms: number) => Promise<void> }): Promise<JevResult> {
  const now = o.now ?? Date.now;
  const wait = o.wait ?? sleep;
  const body = JSON.stringify({ model: o.model, state: o.state, questions: o.questions });
  const headers = { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" };
  const t0 = now();
  for (let attempt = 0; ; attempt++) {
    const res = await o.http(JEV_URL, headers, body);
    if ((res.status === 429 || res.status === 529) && attempt < 2) {
      await wait(400 * 2 ** attempt);
      continue;
    }
    const scrub = (s: string) => s.split(o.apiKey).join("***"); // キーはメッセージに出さない
    if (res.status === 401) throw new ClaudeError("Jev の API キーが無効");
    if (res.status === 429) throw new ClaudeError("Jev のレート制限に達した。少し待ってからやり直す");
    if (res.status === 529) throw new ClaudeError("Jev が混雑している。少し待ってからやり直す");
    if (res.status === 402) throw new ClaudeError("Jev の残高が足りない (console.typesafe.ai で確かめる)");
    if (res.status !== 200) throw new ClaudeError(scrub(`Jev: HTTP ${res.status} ${JSON.stringify(res.json ?? "").slice(0, 160)}`));
    const answers = (res.json?.answers ?? {}) as Record<string, JevAnswer>;
    return { answers, input: Number(res.json?.usage?.input_tokens ?? 0), output: Number(res.json?.usage?.output_tokens ?? 0), ms: now() - t0 };
  }
}

// ---- 対戦の判断 ----
export interface JevDecision {
  reply: Record<string, unknown>; // aiRun が読む形 ({choice} / {attackers} / {blocks})
  confidence: number; // 判断全体の自信 (0〜1)。しきい値より低ければ、別の AI に聞き直す
  note: string; // 履歴の裏側に残す短い説明 (確率)
  input: number;
  output: number;
  ms: number;
}
const sure = (p: number) => Math.max(p, 1 - p); // はい/いいえの確率 → 自信 (0.5 = 決めかね、1 = 確実)

// 行動を選ぶ: 選択肢は、番号つき。「何もしない」(0 番) は、最初に置くと偏って選ばれやすいので、最後に置く
export async function jevAct(o: { apiKey: string; model: string; http: Http; state: string; options: { id: number; label: string }[] }): Promise<JevDecision> {
  const ordered = [...o.options.filter((x) => x.id !== 0), ...o.options.filter((x) => x.id === 0)];
  const criteria = Object.fromEntries(ordered.map((x) => [`o${x.id}`, x.label])); // キーは文字 (数字だけのキーは、JS が小さい順に並べ替えて、順番を保てない)
  const r = await askJev({ apiKey: o.apiKey, model: o.model, state: o.state, http: o.http, questions: { action: { type: "choice", instructions: "あなたはマジックの対戦のプレイヤーです。勝つために、いまの最もよい行動を1つ選ぶ。選べる行動は、番号つき。", criteria } } });
  const a = r.answers.action;
  const choice = Number(a?.choice?.replace(/^o/, ""));
  if (!a || Number.isNaN(choice)) throw new ClaudeError("Jev の返事に、行動が無い");
  const p = a.probabilities?.[`o${choice}`];
  return { reply: { choice }, confidence: a.confidence ?? p ?? 0, note: `jev: 行動 ${choice} (確率 ${(p ?? 0).toFixed(2)}・自信 ${(a.confidence ?? 0).toFixed(2)})`, input: r.input, output: r.output, ms: r.ms };
}

// 攻撃: 攻撃できるクリーチャーごとに、「攻撃させるか」を、はい/いいえで聞く。0.5 以上なら攻撃。自信は、いちばん決めかねているものに合わせる
export async function jevAttack(o: { apiKey: string; model: string; http: Http; state: string; attackers: { id: string; label: string }[] }): Promise<JevDecision> {
  const questions: Record<string, JevQuestion> = {};
  o.attackers.forEach((x, i) => (questions[`a${i}`] = { type: "noul", instructions: `あなたはマジックの対戦のプレイヤーです。いま、${x.label} で、相手のプレイヤーに攻撃させるべきですか (攻撃して、損をしないか、ブロックされて失わないか、を考える)` }));
  const r = await askJev({ apiKey: o.apiKey, model: o.model, state: o.state, http: o.http, questions });
  const ps = o.attackers.map((_, i) => r.answers[`a${i}`]?.noul);
  if (ps.some((p) => p === undefined)) throw new ClaudeError("Jev の返事に、攻撃の答えが足りない");
  const ids = o.attackers.filter((_, i) => (ps[i] as number) >= 0.5).map((x) => x.id);
  return { reply: { attackers: ids }, confidence: Math.min(1, ...ps.map((p) => sure(p as number))), note: `jev: 攻撃 ${ids.length}/${o.attackers.length} 体 (確率 ${ps.map((p) => (p as number).toFixed(2)).join("/")})`, input: r.input, output: r.output, ms: r.ms };
}

// ブロック: 攻撃クリーチャーごとに、「どのクリーチャーでブロックするか (しない)」を選ぶ。同じクリーチャーが2つのブロックに選ばれたら、確率の高いほうだけ
export async function jevBlock(o: { apiKey: string; model: string; http: Http; state: string; attackers: { id: string; label: string }[]; blockers: { id: string; label: string }[] }): Promise<JevDecision> {
  const questions: Record<string, JevQuestion> = {};
  o.attackers.forEach((a, i) => {
    const criteria: Record<string, string> = {};
    o.blockers.forEach((b, j) => (criteria[`b${j}`] = `${b.label} でブロックする`));
    criteria.none = "ブロックしない"; // 「しない」は、最後 (最初の選択肢に偏るため)
    questions[`k${i}`] = { type: "choice", instructions: `あなたはマジックの対戦のプレイヤーです。攻撃してくる ${a.label} を、どう受けますか。ブロックは、割に合うときだけ (ライフが危ないときは、守る)。`, criteria };
  });
  const r = await askJev({ apiKey: o.apiKey, model: o.model, state: o.state, http: o.http, questions });
  const used = new Map<string, { attacker: string; p: number }>();
  let conf = 1;
  o.attackers.forEach((a, i) => {
    const ans = r.answers[`k${i}`];
    if (!ans?.choice) throw new ClaudeError("Jev の返事に、ブロックの答えが足りない");
    conf = Math.min(conf, ans.confidence ?? 0);
    const m = ans.choice.match(/^b(\d+)$/);
    const b = m ? o.blockers[Number(m[1])] : undefined;
    if (!b) return; // ブロックしない
    const p = ans.probabilities?.[ans.choice] ?? 0;
    const prev = used.get(b.id);
    if (!prev || p > prev.p) used.set(b.id, { attacker: a.id, p });
  });
  const blocks = [...used].map(([blocker, v]) => ({ blocker, attacker: v.attacker }));
  return { reply: { blocks }, confidence: conf, note: `jev: ブロック ${blocks.length} 組 (自信 ${conf.toFixed(2)})`, input: r.input, output: r.output, ms: r.ms };
}
