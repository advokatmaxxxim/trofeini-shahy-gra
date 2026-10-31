// Рівні складності. Сила задається бюджетом у вузлах, а не в секундах,
// тому один рівень грає однаково на будь-якому пристрої.
//
// Як рушій обирає хід «по-людськи» (src/human.js):
// - book - скільки перших півходів партії рушій грає за книгою майстрів (src/book.js): хід із книги
//   обирається з імовірністю за частотою в партіях майстрів (bookPow > 1 - частіше головні продовження)
//   і отримує надбавку bookPick, інші книжкові ходи - bookOther; якщо в нашому варіанті шахів хід явно
//   гірший (заряди), пошук від нього відмовиться;
// - lambda - вага природності ходу за класичними принципами (розвиток, центр, рокіровка, ферзь не рано...);
// - bookFollow, bookTol - з якою імовірністю рівень грає обраний книжковий хід, якщо пошук не бачить, що той
//   гірший за найкращий більше ніж на bookTol (так люди грають дебют «як учили»);
// - cands - скільки ходів-кандидатів розглядає рівень: людина обирає з кількох правдоподібних, а не з усіх;
// - temp - «температура» в сантипішаках: кандидат обирається з імовірністю ~ exp(-(найкращий - його) / temp),
//   тож слабкий рівень частіше бере гірший, але правдоподібний хід; 0 - завжди найкращий;
// - blind - частка ходів «не подивившись, що відповість суперник»: хід обирається лише за тим, що він бере,
//   і за природністю. Це найлюдськіша помилка слабкого гравця: фігура стає на гарне поле під бій,
//   пішак береться «задарма», хоча його захищено.
// Стара модель (вікно spread і випадковий хід blunder) - bench/legacy-levels.js: там слабкі рівні грали
// a3, h4 і бездумні ходи турою, бо будь-який хід у вікні 1-4 пішаки вважався однаково добрим.
// Восьмого рівня немає: 120 000 вузлів проти 50 000 дали лише 0.575 ± 0.07 (out/levels/L8-vs-L7.json),
// а більший бюджет на телефоні думає понад 5 секунд на хід.
import { typeOf } from './core.js?v=c40509266662';
import { MATERIAL } from './eval.js?v=c40509266662';
import { humanContext, naturalness, bookMoves } from './human.js?v=c40509266662';

export const LEVELS = [
  null,
  { name: 'Новачок',     budget: 150,   temp: 140, cands: 7, blind: 0.6,  lambda: 1.2,  book: 8,  bookPow: 2.0, bookFollow: 0.8,  bookTol: 150 },
  { name: 'Учень',       budget: 400,   temp: 85,  cands: 6, blind: 0.22, lambda: 1.0,  book: 10, bookPow: 1.8, bookFollow: 0.85, bookTol: 120 },
  { name: 'Аматор',      budget: 1200,  temp: 55,  cands: 6, blind: 0.12, lambda: 0.8,  book: 12, bookPow: 1.6, bookFollow: 0.9,  bookTol: 100 },
  { name: 'Клубний',     budget: 3000,  temp: 32,  cands: 6, blind: 0.03, lambda: 0.65, book: 14, bookPow: 1.4, bookFollow: 0.9,  bookTol: 80 },
  { name: 'Досвідчений', budget: 8000,  temp: 22,  cands: 6, blind: 0.02, lambda: 0.55, book: 16, bookPow: 1.2, bookFollow: 0.92, bookTol: 70 },
  { name: 'Сильний',     budget: 20000, temp: 9,   cands: 6, blind: 0,    lambda: 0.35, book: 18, bookPow: 1.0, bookFollow: 0.95, bookTol: 60 },
  { name: 'Експерт',     budget: 50000, temp: 0,   cands: 1, blind: 0,    lambda: 0.22, book: 20, bookPow: 1.0, bookFollow: 1,    bookTol: 60 },
];
const BOOK_PICK = 100, BOOK_OTHER = 35;

const pick = (weights, rng) => {
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
};

export function chooseMove(engine, pos, level, rng = Math.random) {
  engine.budget = level.budget;
  const ctx = humanContext(pos);
  // книга: один хід майстрів обрано наперед за частотою, він і решта книжкових отримують надбавку
  const bonusBook = new Map();
  let chosen = null;
  if (level.book && pos.ply < level.book) {
    const bm = bookMoves(pos);
    if (bm.length) {
      chosen = bm[pick(bm.map((x) => x.n ** level.bookPow), rng)];
      for (const x of bm) bonusBook.set(x.from * 64 + x.to, x === chosen ? BOOK_PICK : BOOK_OTHER);
    }
  }
  // вибір серед кількох ходів і перевірка книжкового ходу потребують точних оцінок кожного
  engine.exactRoot = level.temp > 0 || !!chosen;
  const bonus = (m) => level.lambda * naturalness(pos, m, ctx) + (m.tk || m.promo ? 0 : bonusBook.get(m.from * 64 + m.to) ?? 0);
  const res = engine.bestMove(pos, bonus);
  if (!res.move) return { move: null, res };
  // дебют «як учили»: обраний книжковий хід, якщо пошук не бачить, що він помітно гірший
  if (chosen && rng() < level.bookFollow) {
    const bk = res.rootScores.find((x) => x.m.from === chosen.from && x.m.to === chosen.to && !x.m.tk && !x.m.promo);
    const bestS = Math.max(...res.rootScores.map((x) => x.s));
    if (bk && bk.s >= bestS - level.bookTol) return { move: bk.m, res };
  }
  if (!level.temp || !res.rootScores.length) return { move: res.move, res };
  // «не подивився, що відповість суперник»: лише безпосередній виграш матеріалу і природність
  if (level.blind && rng() < level.blind) {
    const naive = res.rootScores.map((x) => ({
      m: x.m,
      u: (pos.board[x.m.to] ? MATERIAL[typeOf(pos.board[x.m.to])] : x.m.flag === 2 ? MATERIAL[1] : 0)
        + (x.m.promo ? MATERIAL[x.m.promo] - MATERIAL[1] : 0) + x.u - x.s,     // x.u - x.s - уся надбавка ходу
    })).sort((a, b) => b.u - a.u).slice(0, level.cands);
    return { move: naive[pick(naive.map((x) => Math.exp((x.u - naive[0].u) / level.temp)), rng)].m, res };
  }
  // кілька правдоподібних кандидатів і вибір серед них
  const ranked = res.rootScores.slice().sort((a, b) => b.u - a.u).slice(0, level.cands);
  const u = ranked.map((x) => Math.max(-3000, Math.min(3000, x.u)));
  return { move: ranked[pick(u.map((x) => Math.exp((x - u[0]) / level.temp)), rng)].m, res };
}
