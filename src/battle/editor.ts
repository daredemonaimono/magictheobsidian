import { AbilityKind, Arg, CardRule, NodeCall } from "./node";
import { checkCall, getNode, placementProblem, structureProblem } from "./registry";

// ノード設定画面の、ルールを組み替える操作。どれも元のルールは変えず、新しいルールを返す (画面は、返ってきたものを描き直すだけ)
const copy = (r: CardRule): CardRule => JSON.parse(JSON.stringify(r));
const bodyOf = (r: CardRule, a: number): NodeCall[] => r.abilities[a].body;

export const blankRule = (card: string): CardRule => ({ card, abilities: [{ kind: "spell", body: [] }] });

// 追加するノードの引数: 必須のものだけ、迷わない既定値を入れる (選択肢は先頭、数値は 1、真偽は false)。つなぐもの (ref) と自由な文字列は空のまま
export function addNode(rule: CardRule, a: number, nodeId: string, at?: number): CardRule {
  const def = getNode(nodeId);
  if (!def) throw new Error(`未知のノード: ${nodeId}`);
  const args: Record<string, Arg> = {};
  for (const [k, p] of Object.entries(def.params)) {
    if (!p.required) continue;
    if (p.choices) args[k] = p.choices[0];
    else if (p.type === "number") args[k] = 1;
    else if (p.type === "boolean") args[k] = false;
  }
  const r = copy(rule);
  bodyOf(r, a).splice(at ?? bodyOf(r, a).length, 0, { node: nodeId, args });
  return r;
}

// 削除。消えたノードの as を指していた参照は外す
export function removeNode(rule: CardRule, a: number, n: number): CardRule {
  const r = copy(rule);
  const [gone] = bodyOf(r, a).splice(n, 1);
  if (gone?.as) for (const c of bodyOf(r, a)) for (const [k, v] of Object.entries(c.args)) if (typeof v === "object" && v.ref === gone.as) delete c.args[k];
  return r;
}

// 並べ替え (実行順が変わる)。参照元が後ろに来ると problems が知らせる
export function moveNode(rule: CardRule, a: number, from: number, to: number): CardRule {
  const r = copy(rule);
  const [c] = bodyOf(r, a).splice(from, 1);
  bodyOf(r, a).splice(to, 0, c);
  return r;
}

export function setArg(rule: CardRule, a: number, n: number, param: string, value: Arg | undefined): CardRule {
  const r = copy(rule);
  if (value === undefined) delete bodyOf(r, a)[n].args[param];
  else bodyOf(r, a)[n].args[param] = value;
  return r;
}

// as の付け替え。参照している引数も一緒に直す
export function setAs(rule: CardRule, a: number, n: number, name: string | undefined): CardRule {
  const r = copy(rule);
  const call = bodyOf(r, a)[n];
  const old = call.as;
  if (name) call.as = name;
  else delete call.as;
  if (old && name) for (const c of bodyOf(r, a)) for (const [k, v] of Object.entries(c.args)) if (typeof v === "object" && v.ref === old) c.args[k] = { ref: name };
  return r;
}

// 条件の付け外し (undefined で外す)。このノードは、その条件のときだけ実行する
export function setIf(rule: CardRule, a: number, n: number, expr: string | undefined): CardRule {
  const r = copy(rule);
  if (expr) bodyOf(r, a)[n].if = expr;
  else delete bodyOf(r, a)[n].if;
  return r;
}

// つなぐ: from の出力を to の param に渡す。from に as が無ければ、重複しない名前 (t, t2, ...) を付ける。出力の無いノードからはつなげない
export function connect(rule: CardRule, a: number, from: number, to: number, param: string): CardRule {
  const r = copy(rule);
  const body = bodyOf(r, a);
  const src = body[from];
  if (!Object.keys(getNode(src.node)?.outputs ?? {}).length) throw new Error(`${src.node} には出力が無い`);
  if (!src.as) {
    const used = new Set(body.map((c) => c.as));
    let name = src.node[0];
    for (let i = 2; used.has(name); i++) name = src.node[0] + i;
    src.as = name;
  }
  body[to].args[param] = { ref: src.as };
  return r;
}

export function addAbility(rule: CardRule, kind: AbilityKind): CardRule {
  const r = copy(rule);
  r.abilities.push({ kind, body: [] });
  return r;
}

export function removeAbility(rule: CardRule, a: number): CardRule {
  const r = copy(rule);
  r.abilities.splice(a, 1);
  return r;
}

// ノードで表せない部分のメモ (## 未対応)。空行は捨て、空なら項目ごと無くす
export function setUnsupported(rule: CardRule, lines: string[]): CardRule {
  const r = copy(rule);
  const kept = lines.map((l) => l.trim()).filter(Boolean);
  if (kept.length) r.unsupported = kept;
  else delete r.unsupported;
  return r;
}

export interface Problem {
  ability: number;
  node: number | null;
  message: string;
}

// 保存できない理由。ノードごとの引数の検証 (checkCall) に加えて、参照が前のノードの as を指しているか・as の重複・md に書けない文字
export function problems(rule: CardRule): Problem[] {
  const out: Problem[] = [];
  rule.abilities.forEach((ab, a) => {
    const defined = new Set<string>();
    const sp = structureProblem(ab);
    if (sp) out.push({ ability: a, node: 0, message: sp });
    ab.body.forEach((c, n) => {
      const add = (message: string) => out.push({ ability: a, node: n, message });
      const bad = checkCall(c) ?? placementProblem(ab.kind, c);
      if (bad) add(bad);
      for (const v of Object.values(c.args)) {
        if (typeof v === "object" && !defined.has(v.ref)) add(`$${v.ref} が見つからない (前のノードの as に無い)`);
        if (typeof v === "string" && v.includes('"')) add("引用符 (\") は md に書けないので使えない");
        if (typeof v === "number" && !Number.isInteger(v)) add("整数だけ使える (md に小数は書けない)");
      }
      if (c.as !== undefined && !/^[A-Za-z_][\w-]*$/.test(c.as)) add("as は英数字・_・- だけ (先頭は英字か _)");
      if (c.as) {
        if (defined.has(c.as)) add(`as=${c.as} が重複している`);
        defined.add(c.as);
      }
    });
  });
  return out;
}
