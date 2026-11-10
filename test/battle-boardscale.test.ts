import assert from "node:assert";
import { boardScale } from "../src/battle/layout";

assert.equal(boardScale(900, 560), 1, "基準の大きさで 1 倍");
assert.equal(boardScale(1800, 1120), 2.0, "2 倍の大きさで 2 倍");
assert.equal(boardScale(1800, 560), 1, "幅が広くても、高さが足りなければ、小さいほうに合わせる");
assert.equal(boardScale(300, 200), 0.8, "小さすぎる盤でも、0.8 倍まで");
assert.equal(boardScale(4000, 3000), 2.4, "大きすぎる盤でも、2.4 倍まで");
assert.equal(boardScale(0, 0), 1, "大きさが測れないときは 1 倍");

import { isWornFormat, landFactor, pileScatter } from "../src/battle/layout";
assert.equal(landFactor(1), 0.85, "土地が少ないときは、0.85 倍");
assert.equal(landFactor(3), 0.85);
assert.ok(landFactor(8) < landFactor(4), "枚数が増えると、小さくなる");
assert.equal(landFactor(15), 0.55);
assert.equal(landFactor(40), 0.55, "多すぎても 0.55 倍まで");

import { cropUrl } from "../src/battle/layout";
assert.equal(cropUrl("https://cards.scryfall.io/normal/front/a/b/ab12.jpg?1700"), "https://cards.scryfall.io/art_crop/front/a/b/ab12.jpg?1700");
assert.equal(cropUrl("https://cards.scryfall.io/large/front/a/b/ab12.jpg"), "https://cards.scryfall.io/art_crop/front/a/b/ab12.jpg");
assert.equal(cropUrl("https://example.com/x.jpg"), undefined, "別のサイトの画像は、作れない");
assert.equal(cropUrl(undefined), undefined);
assert.deepEqual(pileScatter(3, 5), pileScatter(3, 5), "同じ種と層なら、いつも同じ");
assert.notDeepEqual(pileScatter(3, 5), pileScatter(3, 6), "層が違えば、ずれも違う");
for (let i = 0; i < 50; i++) {
  const s = pileScatter(7, i);
  assert.ok(Math.abs(s.dx) <= 2.4 && Math.abs(s.dy) <= 1.8 && Math.abs(s.r) <= 3, "ずれは、決まった範囲");
}
assert.ok(isWornFormat("Vintage") && isWornFormat("legacy"), "Vintage と Legacy は、使い込んだ見た目");
assert.ok(!isWornFormat("modern") && !isWornFormat(undefined) && !isWornFormat(""), "ほかは、ふつう");
