import { App, TFile, normalizePath } from "obsidian";
import { AGENT_NOTE, AgentRules, DEFAULT_AGENT_NOTE, parseAgentRules } from "./battle/agentRules";

// 共通ルールのノート (Rules/_agent.md) を、読む・作る。無ければ、undefined (共通ルールなし)
const PATH = normalizePath(`Rules/${AGENT_NOTE}`);

export async function loadAgentRules(app: App): Promise<AgentRules | undefined> {
  const f = app.vault.getAbstractFileByPath(PATH);
  return f instanceof TFile ? parseAgentRules(await app.vault.cachedRead(f)) : undefined;
}

// 無ければ、初期のノートを作る (あれば、何もしない)。作ったか
export async function createAgentNote(app: App): Promise<boolean> {
  if (app.vault.getAbstractFileByPath(PATH)) return false;
  if (!app.vault.getAbstractFileByPath("Rules")) await app.vault.createFolder("Rules");
  await app.vault.create(PATH, DEFAULT_AGENT_NOTE);
  return true;
}
