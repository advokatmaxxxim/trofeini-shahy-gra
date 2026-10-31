// Ключ позиції для дебютної книги: розстановка, черга ходу, права рокіровки, поле взяття на проході.
// Заряди не входять: книга - з класичних партій, а чи підходить хід у позиції із зарядами, вирішує рушій.
// Два 32-бітні FNV-1a з різним зерном - щоб на десятках тисяч позицій не було збігів.
export function bookKey(p) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  const mix = (x) => {
    a = Math.imul(a ^ x, 0x01000193) >>> 0;
    b = Math.imul(b ^ x, 0x5bd1e995) >>> 0;
  };
  for (let sq = 0; sq < 64; sq++) mix(p.board[sq] + 16 * sq);
  mix(1024 + p.side); mix(2048 + p.castle); mix(4096 + (p.ep < 0 ? 64 : p.ep));
  return a.toString(36) + '.' + (b & 0xffff).toString(36);
}
// хід у книзі - два символи: поле «звідки» і поле «куди»
const SQ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const bookMove = (m) => SQ[m.from] + SQ[m.to];
export const bookMoveSquares = (s) => ({ from: SQ.indexOf(s[0]), to: SQ.indexOf(s[1]) });
