import type { BCard } from "./botgame";

// ボット画面 (メイン) とログ画面 (右サイドバー) をつなぐ。仮の実装
class BotBus {
  log: string[] = [];
  hover?: BCard;
  onLog = new Set<(line: string) => void>();
  onHover = new Set<() => void>();
  addLog(line: string) {
    this.log.push(line);
    this.onLog.forEach((f) => f(line));
  }
  clear() {
    this.log = [];
    this.onLog.forEach((f) => f(""));
  }
  setHover(c?: BCard) {
    this.hover = c;
    this.onHover.forEach((f) => f());
  }
}
export const botBus = new BotBus();
