// Ядро правил трофейних шахів. Не залежить від інтерфейсу й від рушія.
// Кодування фігур: 1=П 2=К 3=С 4=Т 5=Ф 6=Кр, білі +0, чорні +8.
// Трофеї: 1=пішак 2=кінь 3=слон 4=тура 5=ферзь. На полі зберігаються два слоти, відсортовані.
// Що саме дає трофей 1, задає rules.pawnCharge: 'step' - крок у будь-який бік (старі редакції),
// 'pawn' - хід пішака: крок уперед на вільне поле або взяття навскіс уперед (рішення Р10).

export const EMPTY = 0;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 0, BLACK = 8;
export const T_STEP = 1, T_KNIGHT = 2, T_BISHOP = 3, T_ROOK = 4, T_QUEEN = 5;

export const typeOf = (p) => p & 7;
export const colorOf = (p) => p & 8;
export const TROPHY_OF_VICTIM = [0, T_STEP, T_KNIGHT, T_BISHOP, T_ROOK, T_QUEEN, 0];

// --- геометрія -------------------------------------------------------------
const file = (sq) => sq & 7;
const rank = (sq) => sq >> 3;

export const KNIGHT_MOVES = [];
export const KING_MOVES = [];
export const RAYS = [];            // RAYS[sq][dir] = масив полів у напрямку
const DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]]; // N NE E SE S SW W NW
const ROOK_DIRS = [0, 2, 4, 6];
const BISHOP_DIRS = [1, 3, 5, 7];
const ALL_DIRS = [0, 1, 2, 3, 4, 5, 6, 7];

for (let sq = 0; sq < 64; sq++) {
  const f = file(sq), r = rank(sq);
  const km = [];
  for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) km.push(nr * 8 + nf);
  }
  KNIGHT_MOVES.push(km);
  const kg = [];
  for (const [df, dr] of DIRS) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) kg.push(nr * 8 + nf);
  }
  KING_MOVES.push(kg);
  const rs = [];
  for (const [df, dr] of DIRS) {
    const line = [];
    let nf = f + df, nr = r + dr;
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) { line.push(nr * 8 + nf); nf += df; nr += dr; }
    rs.push(line);
  }
  RAYS.push(rs);
}

// хід пішака для заряду «пішак»: [0] - білі, [1] - чорні; уперед - від свого боку
export const PAWN_PUSH = [[], []];     // поле на крок уперед або -1
export const PAWN_CAPS = [[], []];     // поля взяття навскіс уперед
for (let sq = 0; sq < 64; sq++) {
  const f = file(sq), r = rank(sq);
  for (const [ci, dr] of [[0, 1], [1, -1]]) {
    const nr = r + dr;
    PAWN_PUSH[ci].push(nr >= 0 && nr < 8 ? nr * 8 + f : -1);
    PAWN_CAPS[ci].push(nr >= 0 && nr < 8 ? [f - 1, f + 1].filter((x) => x >= 0 && x < 8).map((x) => nr * 8 + x) : []);
  }
}
const ci = (color) => (color === WHITE ? 0 : 1);

const dirsForTrophy = (k) => k === T_BISHOP ? BISHOP_DIRS : k === T_ROOK ? ROOK_DIRS : ALL_DIRS;

// --- Zobrist ---------------------------------------------------------------
function mkRng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}
const zr = mkRng(0x9e3779b9);
const rnd64 = () => (BigInt(zr()) << 32n) | BigInt(zr());
const Z_PIECE = Array.from({ length: 64 }, () => Array.from({ length: 15 }, rnd64));
const Z_TRO = Array.from({ length: 64 }, () => Array.from({ length: 6 }, () => [rnd64(), rnd64()]));
const Z_VET = Array.from({ length: 64 }, rnd64);
const Z_SIDE = rnd64();
const Z_CASTLE = Array.from({ length: 16 }, rnd64);
const Z_EP = Array.from({ length: 65 }, rnd64);

// --- конфігурація правил ---------------------------------------------------
export const DEFAULT_RULES = {
  trophies: true,
  pawnVictimTrophy: true,   // чи дає взятий пішак трофей «крок»
  pawnTakesPawn: false,     // чи отримує трофей пішак, що взяв пішака (П3)
  slots: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 0, 6: 0 },  // за типом фігури-нападника
  veteranAt: 3,             // з якого взяття +1 слот; 0 = без ветеранства
  queenTrophies: false,
  trophyPromotes: false,    // чи може хід трофеєм привести пішака на останню горизонталь
  promoWipes: true,         // чи стирає підвищення заряди пішака
  grantOnCapture: true,     // вимикається в дослідах на вартість трофея
  stepCaptures: true,       // чи може трофей «крок» брати фігури
  pawnCharge: 'step',       // що дає взятий пішак: 'step' - крок у будь-який бік, 'pawn' - хід пішака
  fiftyMoveLimit: 100,      // півходів
};

export const CLASSICAL_RULES = { ...DEFAULT_RULES, trophies: false };

// Ухвалена редакція (рішення Р9): п'ять рядків для гравця, єдиний виняток - король.
// Р10: заряд за пішака - хід пішака, тож пішак за пішака нічого не отримує без окремого винятку.
export const SIMPLE_RULES = {
  ...DEFAULT_RULES,
  pawnTakesPawn: true,
  pawnCharge: 'pawn',
  slots: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 0 },
  veteranAt: 0,
  trophyPromotes: true,
  promoWipes: false,
};

// Правила партії за ідентифікатором, що зберігається в записі партії, в онлайн-партії і в базі.
// 'trofei-simple-r10' - трофейні шахи (ігрова редакція, Р10), 'classical' - звичайні шахи без зарядів.
export const RULESETS = { 'trofei-simple-r10': SIMPLE_RULES, classical: CLASSICAL_RULES };
export const DEFAULT_RULES_ID = 'trofei-simple-r10';
export const rulesOf = (id) => RULESETS[id] ?? SIMPLE_RULES;
export const isClassical = (id) => id === 'classical';

// правило надмножини: чи додає трофей щось до БАЗОВОГО рисунку фігури
// Чиста геометрія: чи додає трофей нові ходи фігурі цього типу.
// Політика (кому взагалі видавати) живе в rules.slots і прапорцях.
const GAINS = [
  null,
  [0, 1, 1, 1, 1, 1],   // пішак:  крок додає хід убік і назад
  [0, 1, 0, 1, 1, 1],   // кінь:   кінь за коня нічого
  [0, 1, 1, 0, 1, 1],   // слон
  [0, 1, 1, 1, 0, 1],   // тура
  [0, 0, 1, 0, 0, 0],   // ферзь:  умієе все, крім стрибка
  [0, 0, 1, 1, 1, 1],   // король: геометрично додає все, крім кроку
];
// те саме, коли заряд за пішака - хід пішака
const GAINS_PAWN = [
  null,
  [0, 0, 1, 1, 1, 1],   // пішак:  пішак за пішака нічого
  [0, 1, 0, 1, 1, 1],   // кінь
  [0, 1, 1, 0, 1, 1],   // слон:   додає крок уперед
  [0, 1, 1, 1, 0, 1],   // тура:   додає взяття навскіс
  [0, 0, 1, 0, 0, 0],   // ферзь:  хід пішака він уже вміє
  [0, 0, 1, 1, 1, 1],   // король: теж уже вміє
];

// --- позиція ---------------------------------------------------------------
export class Position {
  constructor(rules = DEFAULT_RULES) {
    this.rules = rules;
    this.board = new Int8Array(64);
    this.t1 = new Uint8Array(64);
    this.t2 = new Uint8Array(64);
    this.caps = new Uint8Array(64);
    this.side = WHITE;
    this.castle = 0;          // 1=K 2=Q 4=k 8=q
    this.ep = -1;
    this.half = 0;
    this.ply = 0;
    this.key = 0n;
    this.hist = [];           // ключі для повторень
    this.undo = [];
  }

  clone() {
    const p = new Position(this.rules);
    p.board.set(this.board); p.t1.set(this.t1); p.t2.set(this.t2); p.caps.set(this.caps);
    p.side = this.side; p.castle = this.castle; p.ep = this.ep;
    p.half = this.half; p.ply = this.ply; p.key = this.key;
    p.hist = this.hist.slice();
    return p;
  }

  static start(rules) {
    const p = new Position(rules);
    const back = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
    for (let f = 0; f < 8; f++) {
      p.board[f] = back[f] | WHITE;
      p.board[8 + f] = PAWN | WHITE;
      p.board[48 + f] = PAWN | BLACK;
      p.board[56 + f] = back[f] | BLACK;
    }
    p.castle = 15;
    p.key = p.computeKey();
    p.hist.push(p.key);
    return p;
  }

  computeKey() {
    let k = 0n;
    for (let sq = 0; sq < 64; sq++) {
      const pc = this.board[sq];
      if (pc) {
        k ^= Z_PIECE[sq][pc];
        if (this.t1[sq]) k ^= Z_TRO[sq][this.t1[sq]][0];
        if (this.t2[sq]) k ^= Z_TRO[sq][this.t2[sq]][1];
        if (this.rules.veteranAt && this.caps[sq] >= this.rules.veteranAt) k ^= Z_VET[sq];
      }
    }
    if (this.side === BLACK) k ^= Z_SIDE;
    k ^= Z_CASTLE[this.castle];
    k ^= Z_EP[this.ep < 0 ? 64 : this.ep];
    return k;
  }

  kingSquare(color) {
    const want = KING | color;
    for (let sq = 0; sq < 64; sq++) if (this.board[sq] === want) return sq;
    return -1;
  }

  trophyCount(sq) { return (this.t1[sq] ? 1 : 0) + (this.t2[sq] ? 1 : 0); }

  capacity(sq) {
    const t = typeOf(this.board[sq]);
    const base = this.rules.slots[t] ?? 0;
    const vet = this.rules.veteranAt && this.caps[sq] >= this.rules.veteranAt ? 1 : 0;
    return base + vet;
  }

  // чи атакує поле target фігура кольору bySide (включно з ходами трофеями, П8)
  isAttacked(target, bySide, withTrophies = true) {
    const tf = file(target), tr = rank(target);
    // пішаки
    const pdir = bySide === WHITE ? -1 : 1;   // звідки міг би прийти пішак
    for (const df of [-1, 1]) {
      const f = tf + df, r = tr + pdir;
      if (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const sq = r * 8 + f;
        if (this.board[sq] === (PAWN | bySide)) return true;
      }
    }
    // кінь
    for (const sq of KNIGHT_MOVES[target]) if (this.board[sq] === (KNIGHT | bySide)) return true;
    // король
    for (const sq of KING_MOVES[target]) if (this.board[sq] === (KING | bySide)) return true;
    // слизькі
    for (const d of ALL_DIRS) {
      const line = RAYS[target][d];
      for (let i = 0; i < line.length; i++) {
        const pc = this.board[line[i]];
        if (!pc) continue;
        if (colorOf(pc) === bySide) {
          const t = typeOf(pc);
          if (t === QUEEN) return true;
          if (t === ROOK && (d & 1) === 0) return true;
          if (t === BISHOP && (d & 1) === 1) return true;
        }
        break;
      }
    }
    if (withTrophies && this.rules.trophies && this.trophyAttacks(target, bySide)) return true;
    return false;
  }

  // атака ходом трофея
  trophyAttacks(target, bySide) {
    for (let sq = 0; sq < 64; sq++) {
      const pc = this.board[sq];
      if (!pc || colorOf(pc) !== bySide) continue;
      const a = this.t1[sq], b = this.t2[sq];
      if (!a && !b) continue;
      // пішак не може ходом трофея стати на останню горизонталь, отже й не бє там (П10)
      if (!this.rules.trophyPromotes && typeOf(pc) === PAWN) {
        const lastRank = bySide === WHITE ? 7 : 0;
        if (rank(target) === lastRank) continue;
      }
      for (const k of (a === b ? [a] : [a, b])) {
        if (!k) continue;
        if (k === T_STEP && this.rules.pawnCharge === 'pawn') {
          if (PAWN_CAPS[ci(bySide)][sq].includes(target)) return true;
          continue;
        }
        if (k === T_STEP) {
          if (this.rules.stepCaptures === false) continue;
          if (KING_MOVES[sq].includes(target)) return true;
          continue;
        }
        if (k === T_KNIGHT) { if (KNIGHT_MOVES[sq].includes(target)) return true; continue; }
        for (const d of dirsForTrophy(k)) {
          const line = RAYS[sq][d];
          for (let i = 0; i < line.length; i++) {
            if (line[i] === target) return true;
            if (this.board[line[i]]) break;
          }
        }
      }
    }
    return false;
  }

  // [{sq, kind}] - фігури bySide, чий ЗАРЯД атакує target
  chargeAttackers(target, bySide) {
    const res = [];
    for (let sq = 0; sq < 64; sq++) {
      const pc = this.board[sq];
      if (!pc || colorOf(pc) !== bySide) continue;
      for (const k of [this.t1[sq], this.t2[sq]]) {
        if (!k) continue;
        const only = new Position(this.rules);
        only.board.set(this.board);
        only.t1[sq] = k;
        if (only.trophyAttacks(target, bySide)) { res.push({ sq, kind: k }); break; }
      }
    }
    return res;
  }

  // Поля, які атакують заряди сторони bySide - для підсвітки загроз в інтерфейсі
  chargeAttackSquares(bySide) {
    const hit = new Uint8Array(64);
    if (!this.rules.trophies) return hit;
    for (let sq = 0; sq < 64; sq++) {
      const pc = this.board[sq];
      if (!pc || colorOf(pc) !== bySide) continue;
      const isPawn = typeOf(pc) === PAWN;
      const lastRank = bySide === WHITE ? 7 : 0;
      for (const k of [this.t1[sq], this.t2[sq]]) {
        if (!k) continue;
        const pawnMode = k === T_STEP && this.rules.pawnCharge === 'pawn';
        if (k === T_STEP && !pawnMode && this.rules.stepCaptures === false) continue;
        let targets;
        if (pawnMode) targets = PAWN_CAPS[ci(bySide)][sq];
        else if (k === T_STEP) targets = KING_MOVES[sq];
        else if (k === T_KNIGHT) targets = KNIGHT_MOVES[sq];
        else {
          targets = [];
          for (const d of dirsForTrophy(k)) {
            for (const t of RAYS[sq][d]) { targets.push(t); if (this.board[t]) break; }
          }
        }
        for (const t of targets) {
          if (isPawn && !this.rules.trophyPromotes && rank(t) === lastRank) continue;
          hit[t] = 1;
        }
      }
    }
    return hit;
  }

  inCheckClassical(color = this.side) {
    const ks = this.kingSquare(color);
    return ks >= 0 && this.isAttacked(ks, color ^ 8, false);
  }

  inCheck(color = this.side) {
    const ks = this.kingSquare(color);
    if (ks < 0) return false;
    return this.isAttacked(ks, color ^ 8);
  }

  // --- генерація ходів ----------------------------------------------------
  // хід: {from,to,promo,tk,flag}  tk = тип витраченого трофея (0 = звичайний хід)
  generate(capturesOnly = false) {
    const me = this.side;
    const res = [];
    for (const m of this.generatePseudo(capturesOnly)) {
      this.make(m, true);
      const ok = !this.inCheck(me);
      this.unmake();
      if (ok) res.push(m);
    }
    return res;
  }

  // Ходи, які були б законні в класиці, але заборонені, бо король опинився б під зарядом.
  // Інтерфейс показує їх окремо, щоб гравець бачив, ЧОМУ хода немає.
  blockedByCharges() {
    const me = this.side;
    const res = [];
    if (!this.rules.trophies) return res;
    for (const m of this.generatePseudo(false)) {
      this.make(m, true);
      const bad = this.inCheck(me) && !this.inCheckClassical(me);
      this.unmake();
      if (bad) res.push(m);
    }
    return res;
  }

  generatePseudo(capturesOnly = false) {
    const out = [];
    const me = this.side, opp = me ^ 8;
    for (let sq = 0; sq < 64; sq++) {
      const pc = this.board[sq];
      if (!pc || colorOf(pc) !== me) continue;
      const t = typeOf(pc);
      if (t === PAWN) this.genPawn(sq, out, capturesOnly);
      else if (t === KNIGHT) this.genJump(sq, KNIGHT_MOVES[sq], out, capturesOnly);
      else if (t === KING) { this.genJump(sq, KING_MOVES[sq], out, capturesOnly); if (!capturesOnly) this.genCastle(sq, out); }
      else this.genSlide(sq, t === BISHOP ? BISHOP_DIRS : t === ROOK ? ROOK_DIRS : ALL_DIRS, out, capturesOnly);
    }
    if (this.rules.trophies) this.genTrophy(out, capturesOnly);
    return out;
  }

  genPawn(sq, out, capturesOnly) {
    const me = this.side, opp = me ^ 8;
    const up = me === WHITE ? 8 : -8;
    const startRank = me === WHITE ? 1 : 6;
    const lastRank = me === WHITE ? 7 : 0;
    const r = rank(sq), f = file(sq);
    const one = sq + up;
    if (one >= 0 && one < 64 && !this.board[one]) {
      if (!capturesOnly) {
        if (rank(one) === lastRank) for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) out.push({ from: sq, to: one, promo: pr, tk: 0, flag: 5 });
        else {
          out.push({ from: sq, to: one, promo: 0, tk: 0, flag: 0 });
          if (r === startRank) {
            const two = sq + 2 * up;
            if (!this.board[two]) out.push({ from: sq, to: two, promo: 0, tk: 0, flag: 1 });
          }
        }
      }
    }
    for (const df of [-1, 1]) {
      const nf = f + df, nr = r + (me === WHITE ? 1 : -1);
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      const to = nr * 8 + nf;
      const tp = this.board[to];
      if (tp && colorOf(tp) === opp) {
        if (rank(to) === lastRank) for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) out.push({ from: sq, to, promo: pr, tk: 0, flag: 5 });
        else out.push({ from: sq, to, promo: 0, tk: 0, flag: 0 });
      } else if (to === this.ep && !tp) {
        out.push({ from: sq, to, promo: 0, tk: 0, flag: 2 });
      }
    }
  }

  genJump(sq, targets, out, capturesOnly) {
    const me = this.side;
    for (const to of targets) {
      const tp = this.board[to];
      if (tp && colorOf(tp) === me) continue;
      if (capturesOnly && !tp) continue;
      out.push({ from: sq, to, promo: 0, tk: 0, flag: 0 });
    }
  }

  genSlide(sq, dirs, out, capturesOnly) {
    const me = this.side;
    for (const d of dirs) {
      const line = RAYS[sq][d];
      for (let i = 0; i < line.length; i++) {
        const to = line[i], tp = this.board[to];
        if (tp && colorOf(tp) === me) break;
        if (!capturesOnly || tp) out.push({ from: sq, to, promo: 0, tk: 0, flag: 0 });
        if (tp) break;
      }
    }
  }

  genTrophy(out, capturesOnly) {
    const me = this.side;
    // поля, досяжні звичайним ходом - туди трофей не витрачаємо (П7)
    const conv = new Set();
    for (const m of out) conv.add(m.from * 64 + m.to);
    for (let sq = 0; sq < 64; sq++) {
      const pc = this.board[sq];
      if (!pc || colorOf(pc) !== me) continue;
      const a = this.t1[sq], b = this.t2[sq];
      if (!a && !b) continue;
      const isPawn = typeOf(pc) === PAWN;
      const lastRank = me === WHITE ? 7 : 0;
      const kinds = a === b ? [a] : [a, b].filter(Boolean);
      for (const k of kinds) {
        const targets = [];
        if (k === T_STEP && this.rules.pawnCharge === 'pawn') {
          const up = PAWN_PUSH[ci(me)][sq];
          if (up >= 0 && !this.board[up]) targets.push(up);          // крок - лише на вільне поле
          for (const c of PAWN_CAPS[ci(me)][sq]) if (this.board[c]) targets.push(c);   // навскіс - лише взяття
        } else if (k === T_STEP) targets.push(...KING_MOVES[sq]);
        else if (k === T_KNIGHT) targets.push(...KNIGHT_MOVES[sq]);
        else {
          for (const d of dirsForTrophy(k)) {
            const line = RAYS[sq][d];
            for (let i = 0; i < line.length; i++) {
              const tp = this.board[line[i]];
              if (tp && colorOf(tp) === me) break;
              targets.push(line[i]);
              if (tp) break;
            }
          }
        }
        for (const to of targets) {
          const tp = this.board[to];
          if (tp && colorOf(tp) === me) continue;
          if (tp && k === T_STEP && this.rules.stepCaptures === false) continue;   // крок не бере
          if (capturesOnly && !tp) continue;
          if (conv.has(sq * 64 + to)) continue;              // П7
          if (isPawn && rank(to) === lastRank) {
            if (!this.rules.trophyPromotes) continue;                      // П10: не дійти
            for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) out.push({ from: sq, to, promo: pr, tk: k, flag: 5 });
            continue;
          }
          out.push({ from: sq, to, promo: 0, tk: k, flag: 0 });
        }
      }
    }
  }

  genCastle(sq, out) {
    const me = this.side, opp = me ^ 8;
    if (this.inCheck(me)) return;
    if (me === WHITE && sq === 4) {
      if ((this.castle & 1) && !this.board[5] && !this.board[6] && this.board[7] === (ROOK | WHITE)
        && !this.isAttacked(5, opp) && !this.isAttacked(6, opp)) out.push({ from: 4, to: 6, promo: 0, tk: 0, flag: 3 });
      if ((this.castle & 2) && !this.board[3] && !this.board[2] && !this.board[1] && this.board[0] === (ROOK | WHITE)
        && !this.isAttacked(3, opp) && !this.isAttacked(2, opp)) out.push({ from: 4, to: 2, promo: 0, tk: 0, flag: 4 });
    } else if (me === BLACK && sq === 60) {
      if ((this.castle & 4) && !this.board[61] && !this.board[62] && this.board[63] === (ROOK | BLACK)
        && !this.isAttacked(61, opp) && !this.isAttacked(62, opp)) out.push({ from: 60, to: 62, promo: 0, tk: 0, flag: 3 });
      if ((this.castle & 8) && !this.board[59] && !this.board[58] && !this.board[57] && this.board[56] === (ROOK | BLACK)
        && !this.isAttacked(59, opp) && !this.isAttacked(58, opp)) out.push({ from: 60, to: 58, promo: 0, tk: 0, flag: 4 });
    }
  }

  // --- виконання ходу -----------------------------------------------------
  make(m, light = false) {
    const me = this.side, opp = me ^ 8;
    const from = m.from, to = m.to;
    const pc = this.board[from];
    const t = typeOf(pc);
    let capSq = -1, capPc = 0;
    if (m.flag === 2) { capSq = me === WHITE ? to - 8 : to + 8; capPc = this.board[capSq]; }
    else if (this.board[to]) { capSq = to; capPc = this.board[to]; }

    this.undo.push({
      m, capSq, capPc,
      capT1: capSq >= 0 ? this.t1[capSq] : 0, capT2: capSq >= 0 ? this.t2[capSq] : 0,
      capCaps: capSq >= 0 ? this.caps[capSq] : 0,
      fromT1: this.t1[from], fromT2: this.t2[from], fromCaps: this.caps[from],
      toT1: this.t1[to], toT2: this.t2[to], toCaps: this.caps[to],
      castle: this.castle, ep: this.ep, half: this.half, key: this.key, light,
    });

    if (capSq >= 0) { this.board[capSq] = 0; this.t1[capSq] = 0; this.t2[capSq] = 0; this.caps[capSq] = 0; }

    // перенесення фігури разом із трофеями
    this.board[to] = pc;
    this.t1[to] = this.t1[from]; this.t2[to] = this.t2[from]; this.caps[to] = this.caps[from];
    this.board[from] = 0; this.t1[from] = 0; this.t2[from] = 0; this.caps[from] = 0;

    // рокіровка рухає й туру
    if (m.flag === 3) { const rf = me === WHITE ? 7 : 63, rt = me === WHITE ? 5 : 61; this.moveRookForCastle(rf, rt); }
    if (m.flag === 4) { const rf = me === WHITE ? 0 : 56, rt = me === WHITE ? 3 : 59; this.moveRookForCastle(rf, rt); }

    // витрата трофея (П7, П9)
    if (m.tk) this.removeTrophy(to, m.tk);

    // трофей за взяття (П2, П3, П6, П9, П10, П11)
    if (this.rules.trophies && capPc && this.rules.grantOnCapture !== false) {
      if (this.caps[to] < 250) this.caps[to]++;
      const vt = typeOf(capPc);
      const kind = TROPHY_OF_VICTIM[vt];
      if (kind && this.grantAllowed(t, kind)) {
        if (this.trophyCount(to) < this.capacity(to)) this.addTrophy(to, kind);
      }
    }

    if (m.promo) {
      this.board[to] = m.promo | me;
      if (this.rules.promoWipes !== false) { this.t1[to] = 0; this.t2[to] = 0; }
      else this.pruneRedundant(to);
    }

    // права рокіровки
    if (t === KING) this.castle &= me === WHITE ? ~3 : ~12;
    if (from === 0 || to === 0) this.castle &= ~2;
    if (from === 7 || to === 7) this.castle &= ~1;
    if (from === 56 || to === 56) this.castle &= ~8;
    if (from === 63 || to === 63) this.castle &= ~4;

    this.ep = m.flag === 1 ? (me === WHITE ? from + 8 : from - 8) : -1;
    this.half = (capPc || t === PAWN) ? 0 : this.half + 1;   // П12: витрата трофея не скидає
    this.side = opp;
    this.ply++;
    if (!light) { this.key = this.computeKey(); this.hist.push(this.key); }
  }

  moveRookForCastle(rf, rt) {
    this.board[rt] = this.board[rf]; this.t1[rt] = this.t1[rf]; this.t2[rt] = this.t2[rf]; this.caps[rt] = this.caps[rf];
    this.board[rf] = 0; this.t1[rf] = 0; this.t2[rf] = 0; this.caps[rf] = 0;
  }

  grantAllowed(moverType, kind) {
    if (kind === T_STEP && !this.rules.pawnVictimTrophy) return false;
    if (moverType === PAWN && kind === T_STEP && this.rules.pawnCharge !== 'pawn') return this.rules.pawnTakesPawn !== false;
    return !!this.gains(moverType, kind);
  }

  gains(t, k) { return (this.rules.pawnCharge === 'pawn' ? GAINS_PAWN : GAINS)[t][k]; }

  // Заряд, що після зміни типу фігури вже нічого не додає, зникає.
  pruneRedundant(sq) {
    const t = typeOf(this.board[sq]);
    if (this.t1[sq] && !this.gains(t, this.t1[sq])) this.t1[sq] = 0;
    if (this.t2[sq] && !this.gains(t, this.t2[sq])) this.t2[sq] = 0;
    if (!this.t1[sq] && this.t2[sq]) { this.t1[sq] = this.t2[sq]; this.t2[sq] = 0; }
  }

  addTrophy(sq, k) {
    if (!this.t1[sq]) { this.t1[sq] = k; return; }
    if (!this.t2[sq]) { this.t2[sq] = k; }
    if (this.t2[sq] && this.t1[sq] > this.t2[sq]) { const x = this.t1[sq]; this.t1[sq] = this.t2[sq]; this.t2[sq] = x; }
  }

  removeTrophy(sq, k) {
    if (this.t1[sq] === k) { this.t1[sq] = this.t2[sq]; this.t2[sq] = 0; return; }
    if (this.t2[sq] === k) { this.t2[sq] = 0; }
  }

  unmake() {
    const u = this.undo.pop();
    const m = u.m;
    const opp = this.side, me = opp ^ 8;
    this.side = me; this.ply--;
    if (!u.light) this.hist.pop();
    const from = m.from, to = m.to;

    let pc = this.board[to];
    if (m.promo) pc = PAWN | me;
    this.board[from] = pc;
    this.t1[from] = u.fromT1; this.t2[from] = u.fromT2; this.caps[from] = u.fromCaps;
    this.board[to] = 0; this.t1[to] = u.toT1; this.t2[to] = u.toT2; this.caps[to] = u.toCaps;

    if (m.flag === 3) { const rf = me === WHITE ? 7 : 63, rt = me === WHITE ? 5 : 61; this.moveRookForCastle(rt, rf); }
    if (m.flag === 4) { const rf = me === WHITE ? 0 : 56, rt = me === WHITE ? 3 : 59; this.moveRookForCastle(rt, rf); }

    if (u.capSq >= 0) {
      this.board[u.capSq] = u.capPc; this.t1[u.capSq] = u.capT1; this.t2[u.capSq] = u.capT2; this.caps[u.capSq] = u.capCaps;
    }
    this.castle = u.castle; this.ep = u.ep; this.half = u.half; this.key = u.key;
  }

  // --- завершення партії --------------------------------------------------
  isRepetition() {
    const k = this.key;
    let n = 0;
    for (let i = this.hist.length - 1; i >= 0 && i >= this.hist.length - 1 - this.half; i--) {
      if (this.hist[i] === k) n++;
      if (n >= 3) return true;
    }
    return false;
  }

  // 'white' | 'black' | 'draw' | null
  outcome(legalCount = null) {
    const n = legalCount ?? this.generate().length;
    if (n === 0) return this.inCheck() ? (this.side === WHITE ? 'black' : 'white') : 'draw';
    if (this.half >= this.rules.fiftyMoveLimit) return 'draw';
    if (this.isRepetition()) return 'draw';
    return null;
  }
}

// --- FEN+ ------------------------------------------------------------------
const FEN_CHARS = { 1: 'p', 2: 'n', 3: 'b', 4: 'r', 5: 'q', 6: 'k' };
const TRO_CHARS = { 1: 's', 2: 'n', 3: 'b', 4: 'r', 5: 'q' };

export function toFenPlus(p) {
  let s = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const pc = p.board[r * 8 + f];
      if (!pc) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      const ch = FEN_CHARS[typeOf(pc)];
      s += colorOf(pc) === WHITE ? ch.toUpperCase() : ch;
    }
    if (empty) s += empty;
    if (r) s += '/';
  }
  s += p.side === WHITE ? ' w ' : ' b ';
  let c = '';
  if (p.castle & 1) c += 'K'; if (p.castle & 2) c += 'Q';
  if (p.castle & 4) c += 'k'; if (p.castle & 8) c += 'q';
  s += (c || '-') + ' ';
  s += (p.ep < 0 ? '-' : 'abcdefgh'[file(p.ep)] + (rank(p.ep) + 1)) + ' ';
  s += p.half + ' ' + (1 + (p.ply >> 1));
  const tro = [];
  for (let sq = 0; sq < 64; sq++) {
    if (!p.board[sq] || (!p.t1[sq] && !p.caps[sq])) continue;
    const name = 'abcdefgh'[file(sq)] + (rank(sq) + 1);
    let v = '';
    if (p.t1[sq]) v += TRO_CHARS[p.t1[sq]];
    if (p.t2[sq]) v += TRO_CHARS[p.t2[sq]];
    if (p.rules.veteranAt && p.caps[sq] >= p.rules.veteranAt) v += '*';
    if (v) tro.push(name + ':' + v);
  }
  if (tro.length) s += ' | ' + tro.join(' ');
  return s;
}

export function moveToStr(m) {
  const sqn = (s) => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
  return sqn(m.from) + sqn(m.to) + (m.promo ? FEN_CHARS[m.promo] : '') + (m.tk ? '*' + TRO_CHARS[m.tk] : '');
}

export function perft(p, depth) {
  if (depth === 0) return 1;
  const moves = p.generate();
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) { p.make(m); n += perft(p, depth - 1); p.unmake(); }
  return n;
}
