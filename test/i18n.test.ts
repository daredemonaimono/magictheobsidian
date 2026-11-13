import assert from "node:assert/strict";
import { asLang, setLang, t } from "../src/i18n";
import { ACTIONS, CONDITIONS } from "../src/node/actions";
import { KINDS } from "../src/node/kinds";
import { loadSettings } from "../src/settings";

// 設定: 保存された言語を読む。無い・不正なら、既定 (テストでは window が無いので English)
assert.equal(loadSettings({ language: "ja" }).language, "ja");
assert.equal(loadSettings({ language: "fr" }).language, "en");
assert.equal(loadSettings(null).language, "en");
assert.equal(asLang("en"), "en");

// 文字の切り替え
setLang("ja");
assert.equal(t("saved", "Nodes/a.md"), "保存した: Nodes/a.md");
setLang("en");
assert.equal(t("saved", "Nodes/a.md"), "Saved: Nodes/a.md");

// ラベルが、どの言語でも空でなく、id が重ならない
const all = [...KINDS, ...KINDS.flatMap((k) => k.timings), ...ACTIONS, ...CONDITIONS, ...[...ACTIONS, ...CONDITIONS].flatMap((d) => d.params.flatMap((p) => [p, ...(p.choices ?? [])]))];
for (const x of all) assert.ok(x.label.ja && x.label.en, x.id);
assert.equal(new Set(KINDS.map((k) => k.id)).size, KINDS.length);
for (const k of KINDS) assert.equal(new Set(k.timings.map((x) => x.id)).size, k.timings.length, k.id);
assert.equal(new Set([...ACTIONS, ...CONDITIONS].map((d) => d.id)).size, ACTIONS.length + CONDITIONS.length);
console.log("i18n ok");
