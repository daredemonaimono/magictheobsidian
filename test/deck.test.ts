import assert from "node:assert";
import { emptyDeck, foldCommander, parseDeck, parseMoxfield, writeDeck } from "../src/deck";

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
