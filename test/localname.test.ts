import assert from "node:assert";
import { applyLocalName, normLocalName } from "../src/localName";

// ローカルネーム: name_local と aliases を、いっしょに直す
{
  const fm: Record<string, unknown> = { name: "Noble Hierarch", name_local: "高貴な教主", aliases: ["高貴な教主", "ヒエラルク"] };
  applyLocalName(fm, "  気高き   指導者 ");
  assert.equal(fm.name_local, "気高き 指導者", "空白は、ひとつにまとめて、前後は削る");
  assert.deepEqual(fm.aliases, ["気高き 指導者", "ヒエラルク"], "以前のローカルネームは外し、新しい名前を先頭に。ほかの別名は残す");
}
{
  // まだ無いカード: 追加する
  const fm: Record<string, unknown> = { name: "Mox Emerald" };
  applyLocalName(fm, "魔力の石");
  assert.deepEqual([fm.name_local, fm.aliases], ["魔力の石", ["魔力の石"]]);
}
{
  // 空にすると消える (別名が残れば、aliases は残る)
  const a: Record<string, unknown> = { name: "X", name_local: "え", aliases: ["え"] };
  applyLocalName(a, "");
  assert.deepEqual(Object.keys(a), ["name"]);
  const b: Record<string, unknown> = { name: "X", name_local: "え", aliases: ["え", "別名"] };
  applyLocalName(b, "  ");
  assert.deepEqual([b.name_local, b.aliases], [undefined, ["別名"]]);
  // 英語名と同じなら、ローカルネームとしては持たない
  const c: Record<string, unknown> = { name: "Opt", name_local: "選択" };
  applyLocalName(c, "Opt");
  assert.equal(c.name_local, undefined);
}
assert.equal(normLocalName("\n a  b\t"), "a b");
console.log("localname ok");
