import assert from "node:assert";
import { TFile, TFolder } from "obsidian";
import { hasBackup, initRuleStore, migrateToRulebook, readMemos, readRuleText, restoreBackup, ruleKeys, writeRuleText } from "../src/rulestore";
import { VOCAB_VERSION, parseRule, ruleText, staleRule } from "../src/cardrules";

// 模擬の vault: 隠しフォルダ (adapter) と、普通のノート (vault) を持つ
const hidden = new Map<string, string>();
const dirs = new Set<string>();
const notes = new Map<string, string>(); // vault のノート
const trashed: string[] = [];
const mkFile = (path: string) => Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.md$/, ""), extension: "md" });
const folder = (path: string) => Object.assign(new TFolder(), { path, get children() { return [...notes.keys()].filter((p) => p.startsWith(path + "/")).map(mkFile); } });
const app = {
  vault: {
    adapter: {
      exists: async (p: string) => hidden.has(p) || dirs.has(p),
      read: async (p: string) => hidden.get(p)!,
      write: async (p: string, t: string) => void hidden.set(p, t),
      mkdir: async (p: string) => void dirs.add(p),
      remove: async (p: string) => void hidden.delete(p),
      list: async (p: string) => ({ files: [...hidden.keys()].filter((k) => k.startsWith(p + "/")), folders: [] }),
    },
    getAbstractFileByPath: (p: string) => (notes.has(p) ? mkFile(p) : [...notes.keys()].some((k) => k.startsWith(p + "/")) ? folder(p) : null),
    getFiles: () => [...notes.keys()].map(mkFile),
    read: async (f: { path: string }) => notes.get(f.path)!,
    cachedRead: async (f: { path: string }) => notes.get(f.path)!,
  },
  fileManager: {
    trashFile: async (f: { path: string }) => {
      trashed.push(f.path);
      for (const k of [...notes.keys()]) if (k === f.path || k.startsWith(f.path + "/")) notes.delete(k);
    },
  },
};

initRuleStore(".obsidian/plugins/test");
assert.equal(await readRuleText(app as never, "Nothing"), undefined, "無ければ undefined");

// 書く・読む・バックアップ (1つ前の分だけ)
await writeRuleText(app as never, "Foo", "v1");
await writeRuleText(app as never, "Foo", "v2", true);
await writeRuleText(app as never, "Foo", "v3", true);
assert.equal(await readRuleText(app as never, "Foo"), "v3");
assert.ok(await hasBackup(app as never, "Foo"));
assert.ok(await restoreBackup(app as never, "Foo") && (await readRuleText(app as never, "Foo")) === "v2", "直す前の版 (1つ前) に戻せる");
assert.deepEqual(await ruleKeys(app as never), ["Foo"]);
assert.ok([...hidden.keys()].every((k) => k.startsWith(".obsidian/plugins/test/rulebook/")), "保存先は、プラグインの専用フォルダ (隠しフォルダ)");

// 記録の本文: 書いて、読み戻せる。status と vocab も読める
const text = ruleText("Bar", "Draw a card.", [{ kind: "spell", effects: [{ do: "move", what: { kind: "cards", zone: "library", owner: "you", top: true, count: 1 }, to: "hand", how: "draw" }] }], [], { by: "test" });
const rule = parseRule(text)!;
assert.equal(rule.abilities.length, 1);
assert.equal(rule.status, "ok");
assert.equal(rule.vocab, VOCAB_VERSION);
assert.ok(!staleRule(rule) && staleRule({ ...rule, status: "partial", vocab: 1 }) && !staleRule({ ...rule, status: "manual", vocab: 1 }), "古い partial だけが、作り直す対象");

// 移行: vault の Bot/Rules と Bot/Types から、隠しフォルダへ
notes.set("Bot/Rules/Baz.md", "baz rule");
notes.set("Bot/Rules/Foo.md", "foo old");
notes.set("Bot/Types/Instructions/move.md", "---\nid: verb.move\n---\n\n## 要望・メモ(自分で書く)\n\nサーチに色も足したい\n");
notes.set("Bot/Types/Instructions/change.md", "---\nid: verb.change\n---\n\n## 要望・メモ(自分で書く)\n\n(この型について、作ってほしいこと\n");
notes.set("Bot/Types/Requests.md", "---\nmtg: bot-requests\n---\n\n# Requests (作ってほしいこと)\n\n[[Index]] と [[Unimplemented]] を見て、…\n\n- [ ] \n\nBowmasters のアマスを作ってほしい\n");
notes.set("Bot/Games/keep.md", "log");
const r = await migrateToRulebook(app as never);
assert.equal(r.rules, 2, "記録を2件移す");
assert.equal(await readRuleText(app as never, "Baz"), "baz rule", "記録が隠しフォルダへ写る");
assert.equal(await readRuleText(app as never, "Foo"), "v2", "既に隠しフォルダにある記録は、上書きしない");
assert.ok(!notes.has("Bot/Rules/Baz.md") && !notes.has("Bot/Types/Instructions/move.md"), "vault の旧いノートは、ゴミ箱へ");
assert.ok(notes.has("Bot/Games/keep.md"), "Bot/Games は、そのまま");
const memos = await readMemos(app as never);
assert.equal(memos["verb.move"].memo, "サーチに色も足したい", "自分で書いたメモが写る");
assert.ok(!memos["verb.change"], "初期の文のままのメモは、写さない");
assert.ok(memos["_requests"].memo.includes("Bowmasters のアマスを作ってほしい") && !memos["_requests"].memo.includes("[[Index]]"), "要望のノートは、案内文を除いて写る");
console.log("rulestore ok");
