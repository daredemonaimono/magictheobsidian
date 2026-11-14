// 並べ替え: xs の from 番目を、to 番目の位置に移す (ドラッグで、能力を入れ替える)。動かしたら true
export function moveItem<T>(xs: T[], from: number, to: number): boolean {
  if (from === to || from < 0 || to < 0 || from >= xs.length || to >= xs.length || !Number.isInteger(from) || !Number.isInteger(to)) return false;
  xs.splice(to, 0, ...xs.splice(from, 1));
  return true;
}
