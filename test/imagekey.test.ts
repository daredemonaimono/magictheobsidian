import assert from "node:assert";
import { cacheable, imageKey } from "../src/imageKey";
import { SYMBOL_SVGS } from "../src/symbolSvgs";
import { manaCodes } from "../src/symbols";

const id = "3462a3d0-5552-49fa-9eb7-100960c55891";
assert.equal(imageKey(`https://cards.scryfall.io/normal/front/3/4/${id}.jpg?1791803810`), `normal-front-${id}.jpg`, "? 以降 (更新の印) は、名前に入れない");
assert.equal(imageKey(`https://cards.scryfall.io/normal/front/3/4/${id}.jpg`), `normal-front-${id}.jpg`, "同じ画像は、同じ名前 (ノートの URL と、版から作る URL が、同じファイルになる)");
assert.equal(imageKey(`https://cards.scryfall.io/art_crop/front/3/4/${id}.jpg`), `art_crop-front-${id}.jpg`);
assert.equal(imageKey(`https://cards.scryfall.io/normal/back/3/4/${id}.jpg`), `normal-back-${id}.jpg`, "裏面は、別のファイル");
assert.equal(imageKey("https://backs.scryfall.io/small/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg"), "cardback-small-0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg");
const other = imageKey("https://example.com/a.png?x=1");
assert.ok(/^h[0-9a-f]{8}\.img$/.test(other) && other === imageKey("https://example.com/a.png?x=2"), "それ以外は、URL の値で名前を付ける (? 以降は無視)");
assert.notEqual(imageKey("https://example.com/a.png"), imageKey("https://example.com/b.png"));
assert.ok(cacheable(`https://cards.scryfall.io/normal/front/3/4/${id}.jpg`) && !cacheable("https://example.com/a.png"), "保存するのは、Scryfall の画像だけ");

// マナシンボル: 埋め込んだ SVG で、通信せずに描ける。よく使うコストの記号は、すべて入っている
for (const cost of ["{2}{W}{W}", "{X}{W}", "{U/P}", "{W/U}", "{2/W}", "{1}{G}{U}", "{C}", "{S}", "{T}", "{B/R/P}", "{10}", "{0}"]) {
  for (const code of manaCodes(cost)) assert.ok(SYMBOL_SVGS[code]?.startsWith("<svg"), `シンボル ${code} (${cost}) が埋め込まれていない`);
}
console.log("imagekey ok");
