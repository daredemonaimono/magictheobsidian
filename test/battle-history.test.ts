import assert from "node:assert";
import { freeName, parseVersion, sortNewestFirst, versionName } from "../src/battle/history";

// 履歴のファイル名: 日時 (ローカル時刻) と種類
assert.equal(versionName(new Date(2026, 10, 5, 15, 30, 12), "ai"), "2026-11-05-153012-ai.md");
assert.equal(versionName(new Date(2026, 0, 2, 3, 4, 5), "edit"), "2026-01-02-030405-edit.md");
assert.deepEqual(parseVersion("2026-11-05-153012-ai.md"), { stamp: "2026-11-05-153012", kind: "ai" });
assert.deepEqual(parseVersion("2026-11-05-153012-restore-2.md"), { stamp: "2026-11-05-153012", kind: "restore" }, "同じ秒の重複は -2 などが付く");
assert.equal(parseVersion("memo.md"), null);
assert.equal(parseVersion("2026-11-05-153012-unknown.md"), null, "知らない種類は履歴ではない");

// 同じ秒に2つできるとき: 空いている名前にする
const t = new Date(2026, 10, 5, 15, 30, 12);
assert.equal(freeName(t, "ai", new Set()), "2026-11-05-153012-ai.md");
assert.equal(freeName(t, "ai", new Set(["2026-11-05-153012-ai.md"])), "2026-11-05-153012-ai-2.md");
assert.equal(freeName(t, "ai", new Set(["2026-11-05-153012-ai.md", "2026-11-05-153012-ai-2.md"])), "2026-11-05-153012-ai-3.md");

// 新しい順。知らないファイルは入れない
assert.deepEqual(sortNewestFirst(["2026-11-05-100000-ai.md", "x.md", "2026-11-06-090000-edit.md", "2026-11-05-153012-restore.md"]), ["2026-11-06-090000-edit.md", "2026-11-05-153012-restore.md", "2026-11-05-100000-ai.md"]);
