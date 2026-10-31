// Рушій у фоновому потоці, щоб дошка не завмирала, поки машина думає.
import { Position, rulesOf } from './core.js?v=c40509266662';
import { Engine } from './engine.js?v=c40509266662';
import { LEVELS, chooseMove } from './levels.js?v=c40509266662';

const engine = new Engine({});
const same = (a, b) => a.from === b.from && a.to === b.to && a.promo === b.promo && a.tk === b.tk;
let lastRules = null;

self.onmessage = (e) => {
  const { id, moves, level, seed, rules } = e.data;
  // таблиця транспозицій зберігає оцінки за правилами попередньої партії: для інших правил вони хибні
  if (rules !== lastRules) { engine.clearTT(); lastRules = rules; }
  const p = Position.start(rulesOf(rules));
  for (const m of moves) {
    const lm = p.generate().find((x) => same(x, m));
    if (!lm) { self.postMessage({ id, error: 'replay' }); return; }
    p.make(lm);
  }
  let s = (seed >>> 0) || 1;
  const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const { move } = chooseMove(engine, p, LEVELS[level], rng);
  self.postMessage({ id, move: move && { from: move.from, to: move.to, promo: move.promo, tk: move.tk, flag: move.flag } });
};
