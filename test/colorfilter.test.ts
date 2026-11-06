import assert from "node:assert";
import { COLORLESS, matchesColors, toggleColor } from "../src/symbols";

// 色の絞り込み: 五色と無色
{
  const sel = new Set<string>();
  toggleColor(sel, "W");
  toggleColor(sel, "U");
  assert.deepEqual([...sel], ["W", "U"], "色は、重ねて選べる");
  toggleColor(sel, COLORLESS);
  assert.deepEqual([...sel], ["C"], "無色を選ぶと、色の選択は外れる");
  toggleColor(sel, "G");
  assert.deepEqual([...sel], ["G"], "色を選ぶと、無色は外れる");
  toggleColor(sel, "G");
  assert.deepEqual([...sel], [], "もう一度押すと外れる");
  toggleColor(sel, "C");
  toggleColor(sel, "C");
  assert.equal(sel.size, 0);
}
{
  const none = new Set<string>();
  const w = new Set(["W"]);
  const wu = new Set(["W", "U"]);
  const c = new Set(["C"]);
  assert.ok(matchesColors([], none) && matchesColors(["W"], none), "選んでいなければ、全部");
  assert.ok(matchesColors(["W", "U"], wu) && !matchesColors(["W"], wu), "選んだ色をすべて持つ");
  assert.ok(matchesColors(["W", "G"], w), "ほかの色が混ざっていてもよい (これまでどおり)");
  assert.ok(matchesColors([], c), "無色: 色が1つも無いカード");
  assert.ok(!matchesColors(["W"], c) && !matchesColors(["W", "U"], c), "無色: 色のあるカードは出ない");
}
console.log("colorfilter ok");
