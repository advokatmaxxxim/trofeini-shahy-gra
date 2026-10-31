// Пошук: альфа-бета з ітеративним заглибленням, таблицею транспозицій,
// форсованим доглядом і впорядкуванням ходів. Бюджет - у вузлах, щоб обидві
// конфігурації правил порівнювалися за однакової кількості обчислень.
import { typeOf, WHITE } from './core.js?v=c40509266662';
import { evaluate, MATERIAL, TROPHY_VALUE } from './eval.js?v=c40509266662';

const MATE = 30000;
const TT_BITS = 19, TT_SIZE = 1 << TT_BITS, TT_MASK = BigInt(TT_SIZE - 1);

export const packMove = (m) => m.from | (m.to << 6) | (m.promo << 12) | (m.tk << 15) | (m.flag << 18);

export class Engine {
  constructor(opts = {}) {
    this.budget = opts.budget ?? 20000;
    this.maxDepth = opts.maxDepth ?? 32;
    this.trophyValue = opts.trophyValue ?? TROPHY_VALUE;
    this.ttKey = new BigInt64Array(TT_SIZE);
    this.ttDepth = new Int8Array(TT_SIZE);
    this.ttFlag = new Int8Array(TT_SIZE);
    this.ttScore = new Int16Array(TT_SIZE);
    this.ttMove = new Int32Array(TT_SIZE);
    this.killers = new Int32Array(64 * 2);
    this.history = new Int32Array(64 * 64);
    this.nodes = 0;
    this.abort = false;
    // true - кожен корінний хід доглядається з повним вікном і отримує ТОЧНУ оцінку.
    // Потрібно, коли хід обирають серед кількох кращих: при звичайному вузькому вікні
    // гірші ходи повертають лише межу, яка може збігатися з оцінкою найкращого.
    this.exactRoot = opts.exactRoot ?? false;
  }

  clearTT() { this.ttKey.fill(0n); this.ttDepth.fill(0); this.ttMove.fill(0); }

  // --- впорядкування ------------------------------------------------------
  scoreMove(p, m, ply, ttm) {
    const pm = packMove(m);
    if (pm === ttm) return 1 << 24;
    const victim = p.board[m.to];
    if (victim || m.flag === 2) {
      const vv = victim ? MATERIAL[typeOf(victim)] : MATERIAL[1];
      const av = MATERIAL[typeOf(p.board[m.from])];
      return (1 << 20) + vv * 16 - av;
    }
    if (m.promo) return (1 << 19) + MATERIAL[m.promo];
    if (this.killers[ply * 2] === pm) return 1 << 18;
    if (this.killers[ply * 2 + 1] === pm) return (1 << 18) - 1;
    return this.history[m.from * 64 + m.to];
  }

  order(p, moves, ply, ttm) {
    const sc = moves.map((m) => this.scoreMove(p, m, ply, ttm));
    const idx = moves.map((_, i) => i);
    idx.sort((a, b) => sc[b] - sc[a]);
    return idx.map((i) => moves[i]);
  }

  // --- форсований догляд --------------------------------------------------
  quiesce(p, alpha, beta, ply) {
    if (++this.nodes > this.budget) { this.abort = true; return alpha; }
    const check = p.inCheck();
    if (!check) {
      const stand = evaluate(p, this.trophyValue);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
    }
    const moves = check ? p.generate() : p.generate(true);
    if (check && moves.length === 0) return -MATE + ply;
    for (const m of this.order(p, moves, ply, 0)) {
      p.make(m);
      const s = -this.quiesce(p, -beta, -alpha, ply + 1);
      p.unmake();
      if (this.abort) return alpha;
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  // --- основний пошук -----------------------------------------------------
  search(p, depth, alpha, beta, ply) {
    if (++this.nodes > this.budget) { this.abort = true; return alpha; }
    if (ply > 0 && (p.half >= p.rules.fiftyMoveLimit || p.isRepetition())) return 0;

    const ti = Number(p.key & TT_MASK);
    let ttm = 0;
    if (this.ttKey[ti] === BigInt.asIntN(64, p.key)) {
      ttm = this.ttMove[ti];
      if (ply > 0 && this.ttDepth[ti] >= depth) {
        const s = this.ttScore[ti], f = this.ttFlag[ti];
        if (f === 0) return s;
        if (f === 1 && s >= beta) return beta;
        if (f === 2 && s <= alpha) return alpha;
      }
    }
    if (depth <= 0) return this.quiesce(p, alpha, beta, ply);

    const moves = p.generate();
    if (moves.length === 0) return p.inCheck() ? -MATE + ply : 0;

    const a0 = alpha;
    let best = -MATE * 2, bestMove = 0;
    for (const m of this.order(p, moves, ply, ttm)) {
      p.make(m);
      const s = -this.search(p, depth - 1, -beta, -alpha, ply + 1);
      p.unmake();
      if (this.abort) return best > -MATE * 2 ? best : alpha;
      if (s > best) { best = s; bestMove = packMove(m); }
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (!p.board[m.to] && m.flag !== 2) {
          this.killers[ply * 2 + 1] = this.killers[ply * 2];
          this.killers[ply * 2] = packMove(m);
          this.history[m.from * 64 + m.to] += depth * depth;
        }
        break;
      }
    }
    this.ttKey[ti] = BigInt.asIntN(64, p.key);
    this.ttDepth[ti] = depth;
    this.ttScore[ti] = Math.max(-32000, Math.min(32000, best));
    this.ttFlag[ti] = best >= beta ? 1 : best <= a0 ? 2 : 0;
    this.ttMove[ti] = bestMove;
    return best;
  }

  // Повертає {move, score, depth, rootScores}.
  // bonus(m) - необов’язкова надбавка до корінного ходу (сантипішаки, з погляду сторони, що ходить):
  // шукається хід із найбільшою сумою «оцінка + надбавка»; rootScores містять обидві (s і u = s + надбавка).
  // Щоб альфа-бета лишалася точною, вікно кожного ходу зсувається на його надбавку.
  bestMove(p, bonus = null) {
    this.nodes = 0; this.abort = false;
    this.killers.fill(0); this.history.fill(0);
    const rootMoves = p.generate();
    if (rootMoves.length === 0) return { move: null, score: 0, depth: 0, rootScores: [] };
    // надбавка - ціла: інакше межа вікна з дробом через похибку округлення «перемагала» б найкращий хід
    const extra = new Map(rootMoves.map((m) => [m, bonus ? Math.round(bonus(m)) : 0]));
    let best = rootMoves[0], bestScore = 0, reached = 0, rootScores = [];
    const hardBudget = this.budget;
    for (let d = 1; d <= this.maxDepth; d++) {
      // перший напівхід доглядаємо завжди повністю, інакше на малих бюджетах
      // рушій повертав би перший згенерований хід
      this.budget = d === 1 ? Number.MAX_SAFE_INTEGER : hardBudget;
      const scores = [];
      let localBest = null, localBestScore = -MATE * 2, localBestRaw = 0;
      let alpha = -MATE * 2;
      const ti = Number(p.key & TT_MASK);
      const ttm = this.ttKey[ti] === BigInt.asIntN(64, p.key) ? this.ttMove[ti] : 0;
      for (const m of this.order(p, rootMoves, 0, ttm)) {
        const b = extra.get(m);
        p.make(m);
        const s = -this.search(p, d - 1, -MATE * 2, this.exactRoot ? MATE * 2 : -(alpha - b), 1);
        p.unmake();
        if (this.abort) break;
        scores.push({ m, s, u: s + b });
        if (s + b > localBestScore) { localBestScore = s + b; localBest = m; localBestRaw = s; }
        if (s + b > alpha) alpha = s + b;
      }
      if (this.abort && scores.length < rootMoves.length) break;
      best = localBest; bestScore = localBestRaw; reached = d; rootScores = scores;
      if (Math.abs(bestScore) > MATE - 100) break;
      if (this.nodes > hardBudget) break;
    }
    this.budget = hardBudget;
    return { move: best, score: bestScore, depth: reached, rootScores };
  }
}

// Вибір ходу з розкидом: серед ходів у вікні window сантипішаків від найкращого.
export function pickWithSpread(res, window, rng) {
  if (!res.rootScores.length) return res.move;
  const top = Math.max(...res.rootScores.map((x) => x.s));
  const pool = res.rootScores.filter((x) => x.s >= top - window);
  return pool[Math.floor(rng() * pool.length)].m;
}
