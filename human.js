// «Людяність» ходу: поправка в сантипішаках за класичними принципами гри. Рівні додають її (з вагою
// lambda) до оцінки пошуку на корені, тож серед рівноцінних ходів рушій обирає той, що зробила б людина,
// а слабкі рівні помиляються правдоподібно: недоглядають, а не грають a3, h4 чи бездумною турою.
// Принципи - звичайні дебютні й мідлшпільні правила: розвиток легких фігур, центр, рокіровка, ферзя
// не виводити рано, короля не водити, фігуру двічі в дебюті не ходити, на взяття - відповідати взяттям.
import { typeOf, colorOf, WHITE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from './core.js?v=c40509266662';
import { bookKey, bookMoveSquares } from './bookkey.js?v=c40509266662';
import { BOOK_DATA } from './book.js?v=c40509266662';

const VAL = [0, 0, 3, 3, 5, 9, 0];

// усе, що не залежить від ходу, - один раз на позицію
export function humanContext(p) {
  const me = p.side;
  let npm = 0, queens = 0, minorsHome = 0, kingSq = -1;
  for (let sq = 0; sq < 64; sq++) {
    const pc = p.board[sq];
    if (!pc) continue;
    const t = typeOf(pc);
    npm += VAL[t];
    if (t === QUEEN) queens++;
    if (colorOf(pc) === me) {
      if (t === KING) kingSq = sq;
      const r = me === WHITE ? sq : sq ^ 56;
      if ((t === KNIGHT && (r === 1 || r === 6)) || (t === BISHOP && (r === 2 || r === 5))) minorsHome++;
    }
  }
  const u = p.undo ?? [];
  const kRel = kingSq < 0 ? -1 : me === WHITE ? kingSq : kingSq ^ 56;
  return {
    me, npm, queens, minorsHome, kingSq,
    moveNo: (p.ply >> 1) + 1,
    opening: (p.ply >> 1) + 1 <= 12 && npm >= 40,
    endgame: npm <= 26,
    inCheck: p.inCheck(),
    canCastle: (p.castle & (me === WHITE ? 3 : 12)) !== 0 && kRel === 4,
    // король уже сховався (рокіровка або сам пішов на фланг першого ряду)
    sheltered: kRel >= 0 && (kRel >> 3) === 0 && ((kRel & 7) <= 2 || (kRel & 7) >= 6),
    last: u[u.length - 1] ?? null,          // останній хід суперника
    myLast: u[u.length - 2] ?? null,        // наш попередній хід
  };
}

export function naturalness(p, m, ctx) {
  const t = typeOf(p.board[m.from]);
  const capture = !!p.board[m.to] || m.flag === 2;
  const fr = ctx.me === WHITE ? m.from : m.from ^ 56, tr = ctx.me === WHITE ? m.to : m.to ^ 56;
  const fromRank = fr >> 3, toRank = tr >> 3, toFile = m.to & 7;
  if (m.flag === 3 || m.flag === 4) return ctx.endgame ? 10 : 45;
  let b = 0;
  if (capture) {
    b += 8;
    if (ctx.last && ctx.last.capSq === m.to) b += 30;            // відповісти взяттям на взяття
  }
  // туди й назад тією самою фігурою
  if (!capture && ctx.myLast && ctx.myLast.m.to === m.from && ctx.myLast.m.from === m.to) b -= 30;
  if (t === PAWN) {
    if (ctx.endgame) b += 3 + toRank;                          // у закінченні пішаки йдуть уперед
    else {
      if (!capture && (toFile === 0 || toFile === 7)) b -= ctx.opening ? 22 : 8;
      else if (ctx.opening && (toFile === 3 || toFile === 4)) b += 14;
      else if (ctx.opening && toFile === 2) b += 5;
      else if (ctx.opening && toFile === 5) b -= 6;
      // не розкривати власного короля
      if (ctx.sheltered && !capture && Math.abs(toFile - (ctx.kingSq & 7)) <= 1) b -= 14;
    }
  } else if (t === KNIGHT || t === BISHOP) {
    if (ctx.opening) {
      if (fromRank === 0) b += 22;                             // розвиток
      else if (!capture) b -= 12;                              // та сама фігура вдруге
      if (toRank === 0 && !capture) b -= 18;                   // назад на свій перший ряд
      if (t === KNIGHT && (toFile === 0 || toFile === 7)) b -= 16;   // «кінь на краю дошки»
    }
  } else if (t === ROOK) {
    if (ctx.opening && !capture && ctx.canCastle) b -= 22;     // тура раніше за рокіровку
  } else if (t === QUEEN) {
    if (!capture) {
      if (ctx.moveNo <= 8) b -= 28;                            // ферзь рано
      if (ctx.opening && ctx.minorsHome >= 2) b -= 10;
    }
  } else if (t === KING) {
    if (ctx.endgame) {
      const d = (sq) => Math.max(Math.abs((sq & 7) - 3.5), Math.abs((sq >> 3) - 3.5));
      if (d(m.to) < d(m.from)) b += 8;                         // у закінченні король іде до центру
    } else if (!ctx.inCheck && !capture) b -= 40;
  }
  return b;
}

// --- дебютна книга -----------------------------------------------------------------
let BOOK = null;
function book() {
  if (BOOK) return BOOK;
  BOOK = new Map();
  for (const rec of BOOK_DATA.split(';')) {
    const i = rec.indexOf(':');
    BOOK.set(rec.slice(0, i), rec.slice(i + 1).split(',').map((x) => [x.slice(0, 2), Number(x.slice(2))]));
  }
  return BOOK;
}
// ходи майстрів у цій позиції, які законні в ній і за нашими правилами: [{from, to, n}]
export function bookMoves(p, legal = p.generate()) {
  const e = book().get(bookKey(p));
  if (!e) return [];
  const out = [];
  for (const [mv, n] of e) {
    const { from, to } = bookMoveSquares(mv);
    if (legal.some((m) => m.from === from && m.to === to && !m.tk && !m.promo)) out.push({ from, to, n });
  }
  return out;
}
