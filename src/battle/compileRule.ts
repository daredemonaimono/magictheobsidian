import { problemsOf } from "./build";
import { JevAnswer, JevQuestion, JevResult } from "./jev";
import { Clause, splitOracle } from "./splitText";

// ルールを、コードと Jev で組む (LLM を使わない道)。効果テキストを、コードで節に切り (splitText)、各節を、決まった型 (plan / lines) に当てはめて、ノートの行を組み立てる。
// Jev の仕事: 「この節は、本当に、その動作だけか」を、はい/いいえの確率で確かめる。数量や「だれが」が、1つに決まらないときは、選択式で聞く。
// 切れない・型が無い・Jev の自信が足りない・検証 (problemsOf) に通らないときは、md を返さず、理由を返す → 呼び出し側が、これまでの LLM の道に回す。
// v1 の範囲: 呪文能力 (インスタント・ソーサリー) だけで、各節が、型のある動作を 1 つだけ持つもの。キーワード・起動型・誘発型・常在型は、LLM のまま
export type JevAsk = (state: string, questions: Record<string, JevQuestion>) => Promise<JevResult>;

export interface CompileResult {
  md?: string;
  reason?: string; // md が無いときの理由 (LLM に回す)
  jev?: { questions: number; input: number; output: number; ms: number };
}

const EFFECT_JA: Record<string, string> = { draw: "カードを引く", discard: "カードを捨てる", gainLife: "ライフを得る", loseLife: "ライフを失う", damage: "ダメージを与える", counter: "呪文を打ち消す", destroy: "破壊する", exile: "追放する", bounce: "手札に戻す", extraTurn: "追加のターンを得る" };
type Who = "you" | "opponents" | "target";

// 対象の句 → target ノードの引数 (対応できない句は undefined)
function targetArgs(c: Clause): string | undefined {
  if (/\bany target\b/i.test(c.text)) return "zone=any kind=any";
  const t = c.targets[0];
  if (!t) return undefined;
  if (t === "player") return "zone=player kind=player";
  if (t === "creature") return "zone=battlefield kind=permanent type=creature";
  if (t === "creature or planeswalker") return "zone=battlefield kind=permanent type=creature|planeswalker";
  if (t === "permanent") return "zone=battlefield kind=permanent";
  if (t === "nonland permanent") return "zone=battlefield kind=permanent notType=land";
  if (t === "artifact" || t === "enchantment" || t === "land" || t === "planeswalker") return `zone=battlefield kind=permanent type=${t}`;
  if (t === "artifact or enchantment") return "zone=battlefield kind=permanent type=artifact|enchantment";
  if (t === "spell") return "zone=stack kind=spell";
  if (t === "noncreature spell") return "zone=stack kind=spell notType=creature";
  if (t === "creature spell") return "zone=stack kind=spell type=creature";
  if (t === "instant or sorcery spell") return "zone=stack kind=spell type=instant|sorcery";
  return undefined;
}

// 「だれが」: 文に書いてあるものから、決まるときは、決める。決まらない (「あなた」も「対象のプレイヤー」も出る) ときは undefined → Jev に聞く
function whoOf(c: Clause): Who | undefined | "unsupported" {
  const p = new Set(c.players);
  if (p.has("each") && !p.has("opponent")) return "unsupported"; // 「each player」は、型が無い
  if (p.has("each") && p.has("opponent")) return "opponents";
  if (p.has("target")) return p.has("you") && !/\btarget (?:player|opponent)\b/.test(c.text.toLowerCase()) ? undefined : "target";
  if (p.has("opponent") && !p.has("you")) return "opponents";
  return "you";
}

interface Plan {
  effect: string;
  clause: Clause;
  verify: string; // 質問のキー (はい/いいえ)
  who?: Who;
  whoKey?: string; // 「だれが」を Jev に聞くときのキー
  amount?: number | "X";
  amountKey?: string; // 数量を Jev に聞くときのキー
  amountChoices?: (number | "X")[];
  target?: string;
}

const needsWho = new Set(["draw", "discard", "gainLife", "loseLife"]);
const needsAmount = new Set(["draw", "gainLife", "loseLife", "damage", "discard"]);

// 条件・限定・選択の言葉が節にあるときは、型に当てはめない (黙って落とすと、誤ったルールになる)。unlessPay (「unless its controller pays {N}」) だけは、型が扱う
const RISKY = /\b(?:if|unless|with|mana value|converge|for each|equal to|up to|may|instead|otherwise|choose|each|another|other|except|that player|its controller|their controller|its owner|that many|the rest|this turn|until|whenever|when)\b|\bX\b/i;
const risky = (text: string): string | undefined => {
  const t = text.replace(/\bunless (?:its controller|that player|they) pays? \{\d+\}/i, "");
  return t.match(RISKY)?.[0];
};

function plan(c: Clause, i: number): Plan | string {
  const r = risky(c.text);
  if (r) return `節 ${i + 1}: 条件・限定の言葉がある (${r})`;
  if (c.effects.length !== 1) return `節 ${i + 1}: 動作が ${c.effects.length} 個 (${c.effects.join(",") || "なし"})`;
  const effect = c.effects[0];
  if (!(effect in EFFECT_JA)) return `節 ${i + 1}: 型の無い動作 (${effect})`;
  const p: Plan = { effect, clause: c, verify: `v${i}` };
  if (needsWho.has(effect)) {
    const w = whoOf(c);
    if (w === "unsupported") return `節 ${i + 1}: 「each player」は、型が無い`;
    if (w) p.who = w;
    else p.whoKey = `w${i}`;
  }
  if (needsAmount.has(effect)) {
    const nums = [...new Set(c.numbers)].filter((n) => n !== 1 || /\b(?:a|an|one|1)\b/i.test(c.text));
    if (nums.length === 1) p.amount = nums[0];
    else if (nums.length > 1) {
      p.amountKey = `n${i}`;
      p.amountChoices = nums;
    } else return `節 ${i + 1}: 数量が見つからない`;
  }
  if (effect === "damage" || effect === "counter" || effect === "destroy" || effect === "exile" || effect === "bounce" || p.who === "target") {
    if (effect === "exile" && !/\bexile target\b/i.test(c.text)) return `節 ${i + 1}: 対象を取らない追放`;
    const t = targetArgs(c);
    if (!t) return `節 ${i + 1}: 対象の句が型に合わない (${c.targets.join("/") || "なし"})`;
    p.target = t;
    if (p.who === "target" && t !== "zone=player kind=player") return `節 ${i + 1}: 「だれが」の対象が、プレイヤーではない`;
  }
  return p;
}

// 質問 (Jev に聞くもの)。1回の依頼に、全部まとめる
function questions(plans: Plan[]): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {};
  for (const p of plans) {
    q[p.verify] = { type: "noul", instructions: `次の文は、「${EFFECT_JA[p.effect]}」という 1 つの動作だけを表していますか (条件・選択・ほかの動作を含まない)。文: ${p.clause.text}` };
    if (p.whoKey) q[p.whoKey] = { type: "choice", instructions: `次の文で、「${EFFECT_JA[p.effect]}」のは、だれですか。文: ${p.clause.text}`, criteria: { target: "対象に取ったプレイヤー", you: "この呪文のコントローラー (あなた)", opponents: "対戦相手" } };
    if (p.amountKey && p.amountChoices) q[p.amountKey] = { type: "choice", instructions: `次の文で、「${EFFECT_JA[p.effect]}」数量 (枚数・点数) は、どれですか。文: ${p.clause.text}`, criteria: Object.fromEntries(p.amountChoices.map((n, k) => [`n${k}`, String(n)])) };
  }
  return q;
}

function lines(p: Plan, who: Who | undefined, amount: number | "X" | undefined, tIndex: { n: number }): string[] {
  const out: string[] = [];
  let ref = "";
  if (p.target) {
    const as = tIndex.n++ === 0 ? "t" : `t${tIndex.n}`;
    out.push(`target as=${as} ${p.target}`);
    ref = `$${as}`;
  }
  const amt = amount === undefined ? "" : String(amount);
  switch (p.effect) {
    case "draw":
    case "discard":
      out.push(who === "target" ? `${p.effect} player=target target=${ref} count=${amt}` : `${p.effect} player=${who} count=${amt}`);
      break;
    case "gainLife":
    case "loseLife":
      out.push(who === "target" ? `${p.effect} player=target target=${ref} amount=${amt}` : `${p.effect} player=${who} amount=${amt}`);
      break;
    case "damage":
      out.push(`damage target=${ref} amount=${amt}`);
      break;
    case "counter": {
      const pay = p.clause.text.match(/unless (?:its controller|that player|they) pays? \{(\d+)\}/i)?.[1];
      out.push(`counter target=${ref}${pay ? ` unlessPay=${pay}` : ""}`);
      break;
    }
    case "destroy":
    case "exile":
    case "bounce":
      out.push(`${p.effect} target=${ref}`);
      break;
    case "extraTurn":
      out.push("extraTurn");
      break;
  }
  return out;
}

export async function compileRule(o: { card: string; oracle: string; ask: JevAsk; minConfidence?: number }): Promise<CompileResult> {
  const min = o.minConfidence ?? 0.8;
  const abilities = splitOracle(o.oracle);
  if (!abilities.length) return { reason: "効果テキストが空" };
  if (abilities.some((a) => a.kind !== "spell")) return { reason: `呪文能力だけが対象 (${abilities.map((a) => a.kind).join(",")})` };
  const plans: Plan[] = [];
  for (const a of abilities) {
    for (const c of a.clauses) {
      const p = plan(c, plans.length);
      if (typeof p === "string") return { reason: p };
      plans.push(p);
    }
  }
  if (!plans.length) return { reason: "動作が無い" };
  const q = questions(plans);
  let answers: Record<string, JevAnswer> = {};
  let jev: CompileResult["jev"];
  try {
    const r = await o.ask(`カード: ${o.card}\n\nテキスト:\n${o.oracle}`, q);
    answers = r.answers;
    jev = { questions: Object.keys(q).length, input: r.input, output: r.output, ms: r.ms };
  } catch (e) {
    return { reason: `Jev が使えない: ${(e as Error).message}` };
  }
  const body: string[] = [];
  const t = { n: 0 };
  for (const p of plans) {
    const v = answers[p.verify]?.noul;
    if (v === undefined || v < min) return { reason: `${p.effect}: Jev の確かさが足りない (${v === undefined ? "答え無し" : v.toFixed(2)})`, jev };
    let who = p.who;
    if (p.whoKey) {
      const a = answers[p.whoKey];
      if (!a?.choice || (a.confidence ?? 0) < min) return { reason: `${p.effect}: 「だれが」の自信が足りない`, jev };
      who = a.choice as Who;
      if (who === "target" && !p.target) {
        const ta = targetArgs(p.clause) ?? (p.clause.targets.includes("player") ? "zone=player kind=player" : undefined);
        if (!ta) return { reason: `${p.effect}: 対象が決まらない`, jev };
        p.target = ta;
      }
    }
    let amount = p.amount;
    if (p.amountKey && p.amountChoices) {
      const a = answers[p.amountKey];
      const k = Number(a?.choice?.replace(/^n/, ""));
      if (!a || Number.isNaN(k) || (a.confidence ?? 0) < min) return { reason: `${p.effect}: 数量の自信が足りない`, jev };
      amount = p.amountChoices[k];
    }
    body.push(...lines(p, who, amount, t));
  }
  const md = `---\nmtg: rule\ncard: "[[${o.card}]]"\n---\n\n## 呪文能力\n\n${body.map((l) => `- ${l}`).join("\n")}\n`;
  const problems = problemsOf(md, o.card);
  if (problems.length) return { reason: `検証を通らない: ${problems.join(" / ")}`, jev };
  return { md, jev };
}
