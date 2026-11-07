import assert from "node:assert";
import { addVariant, changeVariant, takeOne, variantsOf, emptyDeck, foldCommander, parseDeck, parseMoxfield, writeDeck } from "../src/deck";

// 読み書き: 版の指定 (set 番号) を保ち、「動き方」など他の見出しには触らない
const src = "---\nmtg: deck\n---\n\n## Main\n4 [[Lightning Bolt]] (m11 149)\n2 [[Mountain]]\n\n## Side\n\n## 動き方\nメモ\n";
const d = parseDeck(src);
assert.deepEqual(d.main.get("Lightning Bolt"), { n: 4, print: "m11 149" });
assert.equal(d.main.get("Mountain")?.print, undefined);
d.main.set("Goblin Guide", { n: 4 });
d.side.set("Smash", { n: 3 });
const out = writeDeck(src, d);
assert.ok(out.includes("4 [[Goblin Guide]]") && out.includes("3 [[Smash]]") && out.includes("## 動き方\nメモ"));
assert.equal(writeDeck(out, parseDeck(out)), out, "読んで書いても変わらない");

// 統率戦: Commander 欄。見出しが無く中身も空の欄は作らない
const cmd = "---\nformat: commander\n---\n\n## Commander\n1 [[Atraxa]]\n\n## Main\n1 [[Sol Ring]] (cmm 400)\n\n## 動き方\nメモ\n";
const c = parseDeck(cmd);
assert.equal(c.commander.get("Atraxa")?.n, 1);
assert.equal(writeDeck(cmd, c), cmd);
assert.ok(!writeDeck("## Main\n\n## Side\n", emptyDeck()).includes("Commander"));
assert.ok(!writeDeck("## Commander\n\n## Main\n", emptyDeck()).includes("## Side"));

// Moxfield 形式: 版 (set 番号)、SIDEBOARD:、COMMANDER: 欄 (空行まで)
// セットの無い形式: 空行 (何行でも) から、サイドボード
{
  const d = parseMoxfield("4 Hired Claw\n1 Kellan, Planar Trailblazer\n20 Mountain\n\n\n\n3 Magebane Lizard\n2 Abrade\n");
  assert.deepEqual([...d.main], [["Hired Claw", { n: 4 }], ["Kellan, Planar Trailblazer", { n: 1 }], ["Mountain", { n: 20 }]]);
  assert.deepEqual([...d.side.keys()], ["Magebane Lizard", "Abrade"]);
  assert.equal(parseMoxfield("Deck\n4 A\n\n4 B\nSideboard\n2 C").main.size, 2, "見出しのある形式では、空行は区切りにならない");
  assert.equal(parseMoxfield("4 A (M11) 1\n\nSIDEBOARD:\n2 C (M11) 2").side.size, 1, "Moxfield 形式 (空行 + SIDEBOARD:) は、今までどおり");
}
// 絵違い・フォイル: 同じカードの行を分けて持つ。n は合計
{
  const d = parseDeck("## Main\n2 [[Island]] (eld 250)\n1 [[Island]] (eld 251) *F*\n1 [[Island]] (eld 251) *F*\n3 [[Bolt]]\n");
  const isl = d.main.get("Island")!;
  assert.equal(isl.n, 4);
  assert.deepEqual(variantsOf(isl), [{ n: 2, print: "eld 250", foil: undefined }, { n: 2, print: "eld 251", foil: true }], "同じ版・フォイルの行は、まとまる");
  assert.equal(d.main.get("Bolt")!.n, 3);
  const text = writeDeck("## Main\n\n## Side\n", d);
  assert.ok(text.includes("2 [[Island]] (eld 250)\n2 [[Island]] (eld 251) *F*"), "書き出しは、行ごと。フォイルは *F*");
  assert.deepEqual(parseDeck(text).main.get("Island"), isl, "書いて読み直しても同じ");
  // 1 枚だけ版を変える / フォイルにする
  let e = d.main.get("Bolt")!;
  e = changeVariant(e, 0, { foil: true });
  assert.deepEqual(variantsOf(e).map((v) => [v.n, !!v.foil]), [[2, false], [1, true]], "3 枚のうち 1 枚だけフォイル");
  e = changeVariant(e, 0, { foil: true });
  assert.deepEqual(variantsOf(e).map((v) => [v.n, !!v.foil]), [[1, false], [2, true]]);
  e = changeVariant(e, 1, { foil: false }, true);
  assert.deepEqual(variantsOf(e).map((v) => [v.n, !!v.foil]), [[3, false]], "全部戻すと、1 行にまとまる");
  assert.equal(changeVariant({ n: 2, print: "a 1" }, 0, { print: "b 2" }, true).print, "b 2");
  // 取り出す・足す
  const t = takeOne(isl);
  assert.equal(t.rest!.n, 3);
  assert.deepEqual(t.taken, { n: 1, print: "eld 251", foil: true });
  assert.equal(takeOne({ n: 1 }).rest, undefined, "最後の 1 枚を取ると、空");
  assert.equal(addVariant(isl, { n: 1, print: "eld 250" }).n, 5);
  assert.equal(addVariant(undefined, { n: 2 }).n, 2);
}
const m = parseMoxfield(`4 Bazaar of Baghdad (ARN) 70
1 Chalice of the Void (TSR) 390
1 Strip Mine (ATQ) 82b

SIDEBOARD:
4 Force of Vigor (MH1) 164
`);
assert.deepEqual(m.main.get("Bazaar of Baghdad"), { n: 4, print: "arn 70" });
assert.equal(m.main.size, 3);
assert.deepEqual(m.side.get("Force of Vigor"), { n: 4, print: "mh1 164" });
assert.equal(m.main.get("Strip Mine")?.print, "atq 82b");
const cm = parseMoxfield("COMMANDER:\n1 Atraxa, Praetors' Voice (C16) 28\n\n1 Sol Ring (CMM) 400\n");
assert.equal(cm.commander.size, 1);
assert.equal(cm.main.size, 1);
assert.equal(foldCommander(cm).main.size, 2, "コマンダー欄が無いフォーマットではメインに入れる");

// カバー写真 (サムネイル): デッキ一覧とデッキ画面で、同じ決め方
{
  const { thumbnailKey, parseDeck } = await import("../src/deck");
  const deck = parseDeck("## Main\n\n4 [[Island]]\n4 [[Opt]]\n\n## Side\n\n2 [[Negate]]\n");
  assert.equal(thumbnailKey("Opt", deck), "Opt", "設定したカード");
  assert.equal(thumbnailKey("Negate", deck), "Negate", "サイドのカードも、選べる");
  assert.equal(thumbnailKey(undefined, deck), "Island", "無ければ、メインの先頭");
  assert.equal(thumbnailKey("Gone", deck), "Island", "デッキから抜けたカードを指していたら、メインの先頭");
  assert.equal(thumbnailKey("Opt", parseDeck("")), undefined, "空のデッキは、なし");
}
