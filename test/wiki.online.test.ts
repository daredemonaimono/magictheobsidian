import assert from "node:assert";
import { wikiUrl } from "../src/wiki";

// MTG Wiki に実際に問い合わせる
const d = decodeURIComponent;
assert.equal(d(await wikiUrl("Lightning Bolt", "稲妻")), "https://mtgwiki.com/wiki/稲妻/Lightning_Bolt");
assert.equal(d(await wikiUrl("Nissa, Worldwaker", "世界を目覚めさせる者、ニッサ")), "https://mtgwiki.com/wiki/世界を目覚めさせる者、ニッサ/Nissa,_Worldwaker");
assert.equal(d(await wikiUrl("Black Lotus")), "https://mtgwiki.com/wiki/ブラック・ロータス/Black_Lotus", "リダイレクトの先");
assert.ok(d(await wikiUrl("Jace Beleren", "ジェイス・ベレレン")).endsWith("ジェイス・ベレレン/Jace_Beleren"));
assert.ok(d(await wikiUrl("Delver of Secrets // Insectile Aberration", "秘密を掘り下げる者 // 突然変異体")).includes("Delver_of_Secrets"), "両面は表面で探す");
assert.ok((await wikiUrl("Zzzz Not A Card")).includes("index.php?search="), "見つからなければ検索ページ");
