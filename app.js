// Трофейні шахи: інтерфейс партії.
// Правила - у core.js (те саме ядро, що пройшло perft і самоігри), рушій - у worker.js.
import {
  Position, RULESETS, DEFAULT_RULES_ID, rulesOf, isClassical, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  typeOf, colorOf, TROPHY_OF_VICTIM,
} from './core.js?v=c40509266662';
import { Engine, packMove } from './engine.js?v=c40509266662';
import { LEVELS, chooseMove } from './levels.js?v=c40509266662';
import * as net from './online.js?v=c40509266662';
import * as archive from './history.js?v=c40509266662';
import * as cloud from './cloud.js?v=c40509266662';

const FILES = 'abcdefgh';
const sqName = (s) => FILES[s & 7] + ((s >> 3) + 1);
// фігура - порожній span, малюнок дає CSS-клас (набір фігур вбудовано в index.html)
// клас фігури з префіксом f, бо клас кольору b (чорні) інакше збігся б зі слоном
const PIECE_LETTER = { 1: 'fp', 2: 'fn', 3: 'fb', 4: 'fr', 5: 'fq', 6: 'fk' };
const pieceHtml = (type, color, extra = '') => `<span class="pc ${color === WHITE ? 'w' : 'b'} ${PIECE_LETTER[type]}${extra}"></span>`;
const badgeHtml = (kind, cls = 'badge') => `<span class="${cls}">${pieceHtml(kind, BLACK)}</span>`;
const LETTER = { 1: '', 2: 'К', 3: 'С', 4: 'Т', 5: 'Ф', 6: 'Кр' };
const NOM = { 1: 'пішак', 2: 'кінь', 3: 'слон', 4: 'тура', 5: 'ферзь', 6: 'король' };
const ACC = { 1: 'пішака', 2: 'коня', 3: 'слона', 4: 'туру', 5: 'ферзя' };
const TRO_GEN = { 1: 'пішака', 2: 'коня', 3: 'слона', 4: 'тури', 5: 'ферзя' };
const TRO_ACT = { 1: 'раз сходити пішаком (на клітинку вперед або взяти навскіс уперед)', 2: 'раз сходити конем', 3: 'раз сходити слоном', 4: 'раз сходити турою', 5: 'раз сходити ферзем' };
const TRO_SUFFIX = { 1: 'п', 2: 'К', 3: 'С', 4: 'Т', 5: 'Ф' };
const FEM = { 4: true };
const unpack = (x) => ({ from: x & 63, to: (x >> 6) & 63, promo: (x >> 12) & 7, tk: (x >> 15) & 7, flag: (x >> 18) & 7 });
const sameMove = (a, b) => a.from === b.from && a.to === b.to && a.promo === b.promo && a.tk === b.tk;

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('tsh:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tsh:' + k, JSON.stringify(v)); } catch { /* сховище недоступне - працюємо без нього */ } },
};

// --- стан партії ------------------------------------------------------------
const S = {
  rules: DEFAULT_RULES_ID, // правила партії: трофейні або 'classical' (src/core.js, RULESETS)
  mode: 'ai',            // ai | local | online
  level: 3,
  me: WHITE,             // мій колір у режимах ai і online
  orient: WHITE,
  control: { base: 600, inc: 2 },   // секунди; null - без годинника
  pos: null,
  moves: [],             // упаковані ходи
  sans: [],
  tks: [],               // чи був хід зарядом - для запису
  durations: [],         // час обдумування кожного ходу, мс; перший хід кожної сторони - 0
  turnStart: 0,          // локальний час початку поточного ходу
  over: null,            // {result: 'white'|'black'|'draw', reason}
  sel: -1,
  showThreats: false,
  undos: 1,
  thinking: false,
  aiReq: 0,
  event: null,           // {text, cls}
  lastMove: null,
  gid: null,             // онлайн-партія
  drawOffer: null,       // колір, що запропонував нічию (WHITE = 0, тож перевіряти через != null)
  joinedSeen: false,     // уже показали, що суперник приєднався
  connLost: false,       // онлайн: немає зв’язку із сервером
};
const classical = () => isClassical(S.rules);
const hasDrawOffer = () => S.drawOffer != null && !S.over;
const theirDrawOffer = () => hasDrawOffer() && S.drawOffer !== S.me;

// --- дошка ------------------------------------------------------------------
const boardEl = $('board');
const cells = [];
for (let i = 0; i < 64; i++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sq';
  b.addEventListener('click', () => {
    const sq = cellToSq(i);
    if (sq === DRAG.skipSq && performance.now() < DRAG.skipUntil) { DRAG.skipSq = -1; return; }   // уже оброблено натисканням
    onSquare(sq);
  });
  boardEl.appendChild(b);
  cells.push(b);
}
function cellToSq(i) {
  const row = i >> 3, col = i & 7;
  return S.orient === WHITE ? (7 - row) * 8 + col : row * 8 + (7 - col);
}
function sqToCell(sq) {
  const r = sq >> 3, f = sq & 7;
  return S.orient === WHITE ? (7 - r) * 8 + f : r * 8 + (7 - f);
}
// вміст клітинки переписуємо, лише коли він змінився, - так анімація ходу не обривається
const cellHtml = new Array(64).fill(null);

function legalMoves() { return S.over ? [] : S.pos.generate(); }

function myTurn() {
  if (S.over || S.thinking) return false;
  if (S.mode === 'local') return true;
  return S.pos.side === S.me;
}

function render() {
  const view = VIEW_LIVE.ply != null;                 // перегляд ходу партії, що йде: дошка показує ту позицію
  const p = view ? VIEW_LIVE.pos : S.pos;
  const lastMove = view ? VIEW_LIVE.last : S.lastMove;
  const legal = view ? [] : legalMoves();
  const fromSel = S.sel >= 0 ? legal.filter((m) => m.from === S.sel) : [];
  const blocked = S.sel >= 0 && myTurn() ? p.blockedByCharges().filter((m) => m.from === S.sel && !fromSel.some((x) => x.to === m.to)) : [];
  const threat = S.showThreats ? p.chargeAttackSquares(p.side ^ 8) : null;
  const checkSq = p.inCheck() ? p.kingSquare(p.side) : -1;

  for (let i = 0; i < 64; i++) {
    const sq = cellToSq(i);
    const el = cells[i];
    const dark = ((sq >> 3) + (sq & 7)) % 2 === 0;
    const cls = ['sq'];
    if (dark) cls.push('dark');
    if (lastMove && lastMove.from === sq) cls.push('last', 'from');
    if (lastMove && lastMove.to === sq) cls.push('last', 'to');
    if (sq === S.sel) cls.push('sel');
    if (threat && threat[sq]) cls.push('threat');
    if (sq === checkSq) cls.push('check');
    if (DRAG.ghost && DRAG.press?.sq === sq) cls.push('drag-src');
    if (DRAG.ghost && DRAG.over === sq) cls.push('drag-over');
    el.className = cls.join(' ');
    let html = '';
    const pc = p.board[sq];
    if (pc) {
      html += pieceHtml(typeOf(pc), colorOf(pc), p.t1[sq] ? ' charged' : '');
      if (p.t1[sq]) html += badgeHtml(p.t1[sq]);
    }
    const tgt = fromSel.filter((m) => m.to === sq);
    if (tgt.length) {
      const cap = !!pc || tgt[0].flag === 2;
      html += `<span class="mk ${tgt[0].tk ? 't' : 'n'}${cap ? ' cap' : ''}"></span>`;
    } else if (blocked.some((m) => m.to === sq)) {
      html += '<span class="mk x">×</span>';
    }
    const row = i >> 3, col = i & 7;
    if (row === 7) html += `<span class="coord f">${FILES[sq & 7]}</span>`;
    if (col === 0) html += `<span class="coord r">${(sq >> 3) + 1}</span>`;
    if (cellHtml[i] !== html) { el.innerHTML = html; cellHtml[i] = html; }
    el.setAttribute('aria-label', sqName(sq) + (pc ? ' ' + NOM[typeOf(pc)] + (p.t1[sq] ? ', заряд ' + TRO_GEN[p.t1[sq]] : '') : ''));
  }
  boardEl.classList.toggle('viewing', view);
  renderPlayers();
  renderStatus(legal);
  renderMoves();
  renderButtons();
  updateTitle();
  syncAwake();
}

// онлайн: поки вкладка чи застосунок у фоні, а хід ваш - це видно в заголовку
const TITLE = document.title;
function updateTitle() {
  const mine = S.mode === 'online' && !S.over && net.opponentJoined() && S.pos.side === S.me;
  const t = mine && document.hidden ? '● Ваш хід – ' + TITLE : TITLE;
  if (document.title !== t) document.title = t;
}
document.addEventListener('visibilitychange', () => { if (S.pos) updateTitle(); });

function sideLabel(color) {
  const name = color === WHITE ? 'Білі' : 'Чорні';
  if (S.mode === 'ai') return color === S.me ? 'Ви · ' + name.toLowerCase() : `Машина · ${LEVELS[S.level].name}`;
  if (S.mode === 'online') {
    const p = S.players?.[color === WHITE ? 'white' : 'black'];
    const r = p?.rating ? ` (${Math.round(p.rating.rating)})` : '';
    if (color === S.me) return 'Ви · ' + name.toLowerCase() + r;
    return (p?.name || 'Суперник') + ' · ' + name.toLowerCase() + r;
  }
  return name;
}

function renderPlayers() {
  const top = S.orient === WHITE ? BLACK : WHITE;
  const bottom = top ^ 8;
  for (const [id, color] of [['p-top', top], ['p-bottom', bottom]]) {
    const box = $(id);
    box.querySelector('.label').textContent = sideLabel(color);
    const av = box.querySelector('.avatar');
    const avHtml = pieceHtml(KING, color);
    if (av.innerHTML !== avHtml) av.innerHTML = avHtml;
    box.querySelector('.clock').classList.toggle('cw', color === WHITE);   // годинник білих світлий, чорних темний
    box.classList.toggle('active', !S.over && S.pos.side === color);
    const charges = [];
    for (let sq = 0; sq < 64; sq++) {
      const pc = S.pos.board[sq];
      if (pc && colorOf(pc) === color && S.pos.t1[sq]) charges.push(badgeHtml(S.pos.t1[sq], 'chg'));
    }
    const chEl = box.querySelector('.charges'), chHtml = charges.join('');
    if (chEl.innerHTML !== chHtml) chEl.innerHTML = chHtml;
    renderCaptured(box.querySelector('.captured'), color);
  }
  renderClocks();
}

// Узяті фігури беремо з історії ходів (стек undo позиції), а не з різниці на дошці,
// тож перетворення пішака список не псує. Перевага - за матеріалом на дошці.
const PIECE_POINTS = [0, 1, 3, 3, 5, 9, 0];
function renderCaptured(el, color) {
  const took = [];
  for (const u of S.pos.undo) if (u.capPc && colorOf(u.capPc) !== color) took.push(typeOf(u.capPc));
  took.sort((a, b) => a - b);
  let adv = 0;
  for (let sq = 0; sq < 64; sq++) {
    const pc = S.pos.board[sq];
    if (pc) adv += (colorOf(pc) === color ? 1 : -1) * PIECE_POINTS[typeOf(pc)];
  }
  let html = '';
  for (let i = 0; i < took.length;) {
    let j = i; while (j < took.length && took[j] === took[i]) j++;
    html += '<span class="grp">' + pieceHtml(took[i], color ^ 8).repeat(j - i) + '</span>';
    i = j;
  }
  if (adv > 0) html += `<span class="adv">+${adv}</span>`;
  el.innerHTML = html;
  el.setAttribute('aria-label', took.length ? 'Узято: ' + took.map((t) => NOM[t]).join(', ') : 'Узятих фігур немає');
}

// --- годинник ---------------------------------------------------------------
function clockState(now = performance.now()) {
  if (!S.control) return null;
  const base = S.control.base * 1000, inc = S.control.inc * 1000;
  const used = { [WHITE]: 0, [BLACK]: 0 }, made = { [WHITE]: 0, [BLACK]: 0 };
  S.durations.forEach((d, i) => {
    const side = i % 2 === 0 ? WHITE : BLACK;
    used[side] += d; made[side]++;
  });
  const run = S.pos.side;
  if (!S.over && made[run] > 0 && S.turnStart) used[run] += now - S.turnStart;
  return {
    [WHITE]: base - used[WHITE] + inc * made[WHITE],
    [BLACK]: base - used[BLACK] + inc * made[BLACK],
  };
}

function fmt(ms) {
  ms = Math.max(0, ms);
  if (ms < 20000) return (Math.floor(ms / 100) / 10).toFixed(1);
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
}

function renderClocks() {
  const st = clockState();
  const top = S.orient === WHITE ? BLACK : WHITE;
  for (const [id, color] of [['clock-top', top], ['clock-bottom', top ^ 8]]) {
    const el = $(id);
    el.hidden = !st;
    if (!st) continue;
    el.textContent = fmt(st[color]);
    el.classList.toggle('low', st[color] < 20000 && !S.over && S.pos.side === color);
  }
}

setInterval(() => {
  if (!S.control || S.over || !S.pos) return;
  renderClocks();
  const st = clockState();
  const run = S.pos.side;
  if (S.mode === 'online') {
    // свій прапорець фіксує суперник; без зв’язку не фіксуємо: його хід міг просто не дійти
    if (run === S.me || !net.opponentJoined() || S.connLost || net.connected?.() === false) return;
    if (st[run] <= -1500) flag(run);                       // запас на затримку мережі
  } else if (st[run] <= 0) flag(run);
}, 100);

function onlyKing(color) {
  for (let sq = 0; sq < 64; sq++) {
    const pc = S.pos.board[sq];
    if (pc && colorOf(pc) === color && typeOf(pc) !== KING) return false;
  }
  return true;
}

function flag(loser) {
  const winner = loser ^ 8;
  if (onlyKing(winner)) finish({ result: 'draw', reason: 'час вийшов, але в суперника лишився сам король' });
  else finish({ result: winner === WHITE ? 'white' : 'black', reason: 'час вийшов' });
  if (S.mode === 'online') net.writeResult(S.over);
}

// --- хід ----------------------------------------------------------------------
function sanOf(m, legal, p = S.pos) {
  if (m.flag === 3) return 'O-O';
  if (m.flag === 4) return 'O-O-O';
  const t = typeOf(p.board[m.from]);
  const cap = !!p.board[m.to] || m.flag === 2;
  let s = '';
  if (t === PAWN && !m.tk) {
    s = cap ? FILES[m.from & 7] + ':' : '';
  } else {
    s = LETTER[t] || '';
    const rivals = legal.filter((x) => x.to === m.to && x.from !== m.from && !!x.tk === !!m.tk && typeOf(p.board[x.from]) === t);
    if (rivals.length) {
      const sameFile = rivals.some((x) => (x.from & 7) === (m.from & 7));
      const sameRank = rivals.some((x) => (x.from >> 3) === (m.from >> 3));
      if (!sameFile) s += FILES[m.from & 7];
      else if (!sameRank) s += (m.from >> 3) + 1;
      else s += sqName(m.from);
    }
    if (t === PAWN && cap) s = FILES[m.from & 7];      // пішак, що бере зарядом, - як звичайне взяття пішаком
    if (cap) s += ':';
  }
  s += sqName(m.to);
  if (m.promo) s += '=' + LETTER[m.promo];
  if (m.tk) s += '*' + TRO_SUFFIX[m.tk];
  return s;
}

function describeCapture(m, before) {
  if (classical()) return null;                       // у класичних шахах про взяття нічого пояснювати
  const p = S.pos;
  const moverColor = before.color;
  const own = S.mode === 'local' ? null : moverColor === S.me;
  const moverName = NOM[before.type];
  const fem = FEM[before.type];
  const adj = own === null ? (moverColor === WHITE ? (fem ? 'Біла ' : 'Білий ') : (fem ? 'Чорна ' : 'Чорний '))
    : own ? (fem ? 'Ваша ' : 'Ваш ') : (fem ? 'Чужа ' : 'Чужий ');
  const who = adj + moverName;
  const vt = before.victimType;
  if (!vt) return before.spent ? { text: `${who} витратив${fem ? 'ла' : ''} заряд ${TRO_GEN[before.spent]}.`, cls: '' } : null;
  const kind = TROPHY_OF_VICTIM[vt];
  const nowCount = p.trophyCount(m.to);
  const granted = nowCount > before.count - (m.tk ? 1 : 0);
  const took = `${who} узя${fem ? 'ла' : 'в'} ${ACC[vt]}`;
  let tail = '';
  if (before.victimCharged) tail = ' Її заряд згорів разом із нею.';
  if (granted) {
    const verb = own === false ? 'тепер може' : 'тепер може';
    return { text: `${took}: ${verb} <b>${TRO_ACT[kind]}</b>.${tail}`, cls: 'charge' };
  }
  let why;
  if (before.type === KING) why = 'король зарядів не отримує';
  else if (m.promo) why = 'новій фігурі цей хід нічого не додає';
  else if (before.count - (m.tk ? 1 : 0) >= 1) why = `у ${fem ? 'неї' : 'нього'} уже є заряд`;
  else why = `${moverName} і так так ходить`;
  return { text: `${took}. Заряду немає: ${why}.${tail}`, cls: '' };
}

function applyMove(m, { duration = null, remote = false, dragged = false } = {}) {
  const p = S.pos;
  const legal = p.generate();
  const lm = legal.find((x) => sameMove(x, m));
  if (!lm) return false;
  if (VIEW_LIVE.ply != null) { VIEW_LIVE.ply = null; VIEW_LIVE.pos = null; }   // новий хід - назад до партії
  const now = performance.now();
  const side = p.side;
  const madeBySide = S.moves.filter((_, i) => (i % 2 === 0 ? WHITE : BLACK) === side).length;
  const dur = duration ?? (madeBySide === 0 || !S.turnStart ? 0 : now - S.turnStart);
  const san = sanOf(lm, legal);
  const vsq = lm.flag === 2 ? (side === WHITE ? lm.to - 8 : lm.to + 8) : lm.to;
  const victim = p.board[vsq];
  const before = {
    color: side, type: typeOf(p.board[lm.from]), count: p.trophyCount(lm.from), spent: lm.tk,
    victimType: victim ? typeOf(victim) : 0, victimCharged: victim ? p.trophyCount(vsq) > 0 : false,
  };
  const who = remote || (S.mode === 'ai' && side !== S.me) ? 'opp' : S.mode === 'local' ? 'local' : 'me';
  const anim = {
    from: lm.from, to: lm.to, vsq, victim, tk: lm.tk, who, dragged,
    rook: lm.flag === 3 ? (side === WHITE ? [7, 5] : [63, 61]) : lm.flag === 4 ? (side === WHITE ? [0, 3] : [56, 59]) : null,
  };
  p.make(lm);
  anim.granted = !!victim && p.trophyCount(lm.to) > before.count - (lm.tk ? 1 : 0);   // новий заряд за це взяття
  const suffix = p.inCheck() ? (p.generate().length ? '+' : '#') : '';
  S.moves.push(packMove(lm));
  S.sans.push(san + suffix);
  S.tks.push(!!lm.tk);
  S.durations.push(dur);
  S.turnStart = now;
  S.lastMove = { from: lm.from, to: lm.to };
  S.sel = -1;
  S.drawOffer = null;
  S.event = describeCapture(lm, before);
  AWAKE.last = now;
  checkOutcome();
  if (S.mode === 'online' && !remote) net.sendMove(S.moves.slice(), S.durations.slice());
  // мат, пат, повторення, 50 ходів - результат на сервер (першим записаний - остаточний; пишуть обидва)
  if (S.mode === 'online' && S.over) net.writeResult(S.over);
  save();
  render();
  animateMove(anim);
  sound(anim.granted ? 'charge' : victim ? 'capture' : suffix ? 'check' : 'move');
  if (remote) buzz(30);
  if (!S.over) maybeAI();
  return true;
}

// --- анімація ходу -------------------------------------------------------------
// Фігура їде з поля на поле, узята гасне під нею, тура в рокіровці їде разом із королем.
// Хід суперника повільніший і закінчується спалахом рамки, щоб його не проґавити.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(.22,.8,.26,1)';
let animBusyUntil = 0;
function animateMove(a) {
  if (reduceMotion.matches || !cells[0].isConnected) return;
  const dur = a.who === 'opp' ? 360 : a.who === 'local' ? 260 : 190;
  animBusyUntil = performance.now() + dur + 450;
  const cellOf = (sq) => cells[sqToCell(sq)];
  const slide = (fromSq, toSq, skipBadge) => {
    const toEl = cellOf(toSq);
    const f = cellOf(fromSq).getBoundingClientRect(), t = toEl.getBoundingClientRect();
    const dx = f.left - t.left, dy = f.top - t.top;
    toEl.classList.add('lift');
    for (const el of toEl.querySelectorAll(':scope > .pc, :scope > .badge')) {
      if (skipBadge && el.classList.contains('badge')) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: dur, easing: EASE });
    }
    setTimeout(() => toEl.classList.remove('lift'), dur + 30);
  };
  if (a.victim) {
    const cell = cellOf(a.vsq);
    const g = document.createElement('span');
    g.className = `pc ghost ${colorOf(a.victim) === WHITE ? 'w' : 'b'} ${PIECE_LETTER[typeOf(a.victim)]}`;
    cell.prepend(g);
    g.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 1, offset: 0.6 }, { opacity: 0, transform: 'scale(.6)' }],
      { duration: dur + 160, easing: 'ease-in', fill: 'forwards' }).finished.finally(() => g.remove());
  }
  if (!a.dragged) slide(a.from, a.to, a.granted);        // перетягнута фігура вже на місці
  if (a.rook) slide(a.rook[0], a.rook[1], false);
  const toEl = cellOf(a.to);
  if (a.granted) {
    toEl.querySelector(':scope > .badge')?.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.25)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }],
      { duration: 420, delay: dur, easing: 'ease-out', fill: 'backwards' });
  }
  if (a.who !== 'me' || a.tk) {
    const ring = document.createElement('span');
    ring.className = 'land' + (a.tk ? ' charge' : '');
    toEl.appendChild(ring);
    ring.animate([{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)', offset: 0.35 }, { opacity: 0, transform: 'scale(1.06)' }],
      { duration: 700, delay: dur * 0.75, easing: 'ease-out', fill: 'both' }).finished.finally(() => ring.remove());
  }
}

function checkOutcome() {
  const p = S.pos;
  const n = p.generate().length;
  if (n === 0) {
    if (p.inCheck()) finish({ result: p.side === WHITE ? 'black' : 'white', reason: 'мат' });
    else finish({ result: 'draw', reason: 'пат' });
  } else if (p.half >= p.rules.fiftyMoveLimit) finish({ result: 'draw', reason: 'правило 50 ходів' });
  else if (p.isRepetition()) finish({ result: 'draw', reason: 'трикратне повторення позиції' });
}

function finish(o, { quiet = false } = {}) {
  if (S.over) return;
  S.over = o;
  S.thinking = false;
  recordGame();
  save();
  render();
  if (quiet) return;
  // вікно результату - коли останній хід уже доїхав
  const show = () => {
    const wait = animBusyUntil - performance.now();
    if (wait > 0) { setTimeout(show, wait); return; }
    if (S.over === o) showEnd();
  };
  setTimeout(show, 0);
}

function showEnd() {
  const o = S.over;
  let title, text;
  if (o.result === 'draw') { title = 'Нічия'; text = o.reason[0].toUpperCase() + o.reason.slice(1) + '.'; }
  else {
    const winner = o.result === 'white' ? WHITE : BLACK;
    const wn = winner === WHITE ? 'білих' : 'чорних';
    if (S.mode === 'local') title = `Перемога ${wn}`;
    else title = winner === S.me ? 'Ви виграли' : 'Ви програли';
    text = `${o.reason[0].toUpperCase() + o.reason.slice(1)}. Перемога ${wn}.`;
  }
  const best = bestPiece();
  if (best) text += ` ${best}`;
  $('end-title').textContent = title;
  $('end-text').textContent = text;
  $('end-save').hidden = !(cloud.enabled && cloud.me()?.isGuest);
  openDialog('dlg-end');
  sound('end');
}

// --- архів і статистика ----------------------------------------------------------
// Завершена партія записується в архів пристрою (src/history.js); порожні партії не пишемо.
function recordGame() {
  if (S.moves.length < 2 || !S.over) return;
  const rec = archive.buildRecord({
    id: S.gameId, mode: S.mode, level: S.level, control: S.control,
    myColor: S.mode === 'local' ? null : S.me, over: S.over, moves: S.moves, durations: S.durations,
    gid: S.gid, startedAt: S.startedAt, rules: S.rules,
  });
  archive.putGame(rec).catch(() => {});
}

const TRO_NOM = { 1: 'пішак', 2: 'кінь', 3: 'слон', 4: 'тура', 5: 'ферзь' };
const OUT = { win: ['В', 'перемога'], draw: ['Н', 'нічия'], loss: ['П', 'поразка'] };
// українські відмінки після числа: 1 хід, 2 ходи, 5 ходів
const plural = (n, [one, few, many]) => { const t = n % 10, h = n % 100; return t === 1 && h !== 11 ? one : t >= 2 && t <= 4 && (h < 12 || h > 14) ? few : many; };
const pct = (n, d) => (d ? Math.round((100 * n) / d) + '%' : '0%');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tcText = (c) => (c ? `${Math.round(c.base / 60)}|${c.inc}` : 'без годинника');
const opponentText = (r) => (r.mode === 'ai' ? `Машина · ${LEVELS[r.level]?.name ?? r.level}` : r.mode === 'online' ? 'Друг онлайн' : 'Удвох на пристрої')
  + (isClassical(r.rules) ? ' · класичні' : '');
const dateText = (iso) => { try { return new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
let statsGames = [];

let myRatings = {};
async function openStats() {
  $('stats-body').innerHTML = '<p class="note">Завантажуємо…</p>';
  VIEW.rec = null;
  openDialog('dlg-stats');
  if (cloud.enabled) await Promise.race([cloud.sync().catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
  statsGames = await archive.listGames().catch(() => []);
  const u = cloud.me();
  if (u) myRatings = (await cloud.ratingsOf([u.id]).catch(() => ({})))[u.id]?.ratings ?? {};
  renderStats();
}
// коли змінився акаунт або архів - перемалювати відкриту статистику (але не перегляд партії)
const restats = async () => {
  if (!$('dlg-stats').open || $('stats-body').querySelector('.mini')) return;
  statsGames = await archive.listGames().catch(() => []);
  renderStats();
};
cloud.onChange(restats);
archive.onChange(restats);

function accountHtml() {
  if (!cloud.enabled) return '';
  const u = cloud.me();
  const err = cloud.error();
  const errHtml = err ? `<p class="acc-err">${esc(err.text)}${err.retryGoogle ? ' <button type="button" class="btn" data-act="google-existing">Увійти через Google</button>' : ''}</p>` : '';
  if (!u) return `<section class="account">${errHtml || '<p class="note">Підключаємося до сервера гри…</p>'}</section>`;
  const nameRow = `<div class="acc-name"><label for="acc-name">Ім’я для суперників</label><div class="row"><input id="acc-name" maxlength="24" value="${esc(u.name || '')}" placeholder="Наприклад, Максим"><button type="button" class="btn" data-act="name-save">Зберегти</button></div></div>`;
  if (u.isGuest) {
    const sent = cloud.pendingEmail();
    return `<section class="account">
      <h3>Акаунт</h3>
      <p class="acc-lead">Ви граєте як гість. Увійдіть, щоб статистика й рейтинг зберігалися на всіх ваших пристроях і не зникли разом із даними браузера.</p>
      ${errHtml}
      <button type="button" class="btn primary wide" data-act="google">Увійти через Google</button>
      ${cloud.iosStandalone() ? '<p class="note">На iPhone у встановленому застосунку вхід через Google може не спрацювати – тоді увійдіть кодом з пошти або відкрийте гру в Safari.</p>' : ''}
      <div class="acc-mail"><input id="acc-email" type="email" inputmode="email" autocomplete="email" placeholder="або ваша пошта" value="${esc(sent || '')}"><button type="button" class="btn" data-act="email">${sent ? 'Надіслати ще раз' : 'Отримати код'}</button></div>
      <div class="acc-mail" id="acc-code-row"${sent ? '' : ' hidden'}><input id="acc-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="код з листа"><button type="button" class="btn primary" data-act="code">Увійти</button></div>
      <p class="note" id="acc-msg"${sent ? '' : ' hidden'}>${sent ? `Ми надіслали код на ${esc(sent)}. Введіть його в полі вище і натисніть «Увійти».` : ''}</p>
      <p class="note">Входячи, ви приймаєте <a href="terms.html" target="_blank" rel="noopener">умови використання</a> і <a href="privacy.html" target="_blank" rel="noopener">політику конфіденційності</a>. Рейтинг рахується лише в партіях між авторизованими гравцями.</p>
      ${nameRow}
    </section>`;
  }
  // рейтинг окремо для трофейних і для класичних шахів; підпис плитки - лише контроль часу
  const tiles = (ids) => ids.map((p) => {
    const r = myRatings[p];
    return `<div class="tile"><b>${r ? Math.round(r.rating) : cloud.START_RATING}</b><span>${cloud.POOL_NAME[p.replace('classical-', '')]}${r ? ` · ${r.games} ${plural(r.games, ['партія', 'партії', 'партій'])}` : ' · ще без партій'}</span></div>`;
  }).join('');
  return `<section class="account">
    <h3>Акаунт</h3>
    <p class="acc-lead">${esc(u.email || 'Увійшли через Google')}</p>
    ${errHtml}
    <h4 class="pool-h">Трофейні шахи</h4>
    <div class="tiles">${tiles(cloud.TROPHY_POOLS)}</div>
    <h4 class="pool-h">Класичні шахи</h4>
    <div class="tiles">${tiles(cloud.CLASSICAL_POOLS)}</div>
    <p class="note">Рейтинг рахується в онлайн-партіях з годинником між авторизованими гравцями.</p>
    ${nameRow}
    <div class="acc-actions" id="acc-actions">
      <button type="button" class="btn" data-act="export">Вивантажити мої дані</button>
      <button type="button" class="btn" data-act="signout">Вийти</button>
      <button type="button" class="btn danger-ghost" data-act="delete">Видалити акаунт</button>
    </div>
  </section>`;
}

function renderStats() {
  const box = $('stats-body');
  const g = statsGames;
  if (!g.length) {
    box.innerHTML = `${accountHtml()}<p class="note">Тут з’являться ваші партії: результат, рівень машини, заряди і перегляд партії хід за ходом. Зіграйте першу партію до кінця, і вона потрапить сюди.</p>
      <div class="foot"><button type="button" class="btn primary" data-act="close">Зрозуміло</button></div>`;
    return;
  }
  const s = archive.summarize(g);
  const r = s.rated;
  const levels = Object.keys(s.byLevel).map(Number).sort((a, b) => a - b);
  const clLevels = Object.keys(s.classical.byLevel).map(Number).sort((a, b) => a - b);
  const localAll = s.local + s.classical.local;
  const fav = s.charges.byKind.reduce((best, n, k) => (n > (s.charges.byKind[best] || 0) ? k : best), 0);
  const avg = (n) => (s.charges.games ? (n / s.charges.games).toFixed(1).replace('.', ',') : '0');
  const row = (name, t) => `<tr><td>${name}</td><td class="num">${t.games}</td><td class="num">${t.win}</td><td class="num">${t.draw}</td><td class="num">${t.loss}</td></tr>`;
  let html = accountHtml() + `<div class="tiles">
      <div class="tile"><b>${s.total}</b><span>${plural(s.total, ['партія', 'партії', 'партій'])}</span></div>
      <div class="tile"><b>${pct(r.win, r.games)}</b><span>перемог${r.games ? ` (${r.win} з ${r.games})` : ''}</span></div>
      <div class="tile"><b>${s.bestBeaten ? s.bestBeaten : '0'}</b><span>${s.bestBeaten ? 'найсильніший обіграний рівень: ' + LEVELS[s.bestBeaten].name : 'рівень машини ще не обіграно'}</span></div>
    </div>`;
  if (levels.length || s.online.games || clLevels.length || s.classical.online.games) {
    // класичні шахи - окремими рядками: сила в них і в трофейних різна
    html += `<div><h3>Результати</h3><div class="tablewrap"><table class="stats"><thead><tr><th>Суперник</th><th class="num">Партій</th><th class="num">В</th><th class="num">Н</th><th class="num">П</th></tr></thead><tbody>
      ${levels.map((l) => row(`${l} · ${LEVELS[l]?.name ?? ''}`, s.byLevel[l])).join('')}
      ${s.online.games ? row('Друг онлайн', s.online) : ''}
      ${clLevels.map((l) => row(`${l} · ${LEVELS[l]?.name ?? ''} · класичні`, s.classical.byLevel[l])).join('')}
      ${s.classical.online.games ? row('Друг онлайн · класичні', s.classical.online) : ''}
      </tbody></table></div>${localAll ? `<p class="note">Ще ${localAll} ${plural(localAll, ['партія', 'партії', 'партій'])} удвох на пристрої – у перемоги й поразки вони не входять.</p>` : ''}</div>`;
  }
  if (s.charges.games) {
    html += `<div><h3>Заряди</h3><ul class="facts">
      <li><span>Отримано за партію, у середньому</span><b>${avg(s.charges.granted)}</b></li>
      <li><span>Витрачено за партію, у середньому</span><b>${avg(s.charges.spent)}</b></li>
      ${fav ? `<li><span>Найчастіший заряд</span><b class="fav">${badgeHtml(fav, 'chg')} ${TRO_NOM[fav]}</b></li>` : ''}
      <li><span>Перемог матом ходом зарядом</span><b>${s.charges.chargeMates}</b></li>
      <li><span>Найдовша серія перемог</span><b>${s.bestStreak}</b></li>
    </ul></div>`;
  }
  html += `<div><h3>Історія</h3><ul class="history">${g.slice(0, 100).map((x, i) => {
    const o = x.outcome ? OUT[x.outcome] : null;
    const res = o ? `<span class="res ${x.outcome}" title="${o[1]}">${o[0]}</span>` : `<span class="res local">${x.result === 'draw' ? '½' : x.result === 'white' ? '1–0' : '0–1'}</span>`;
    return `<li><button type="button" class="hrow" data-game="${i}">${res}<span class="hmain"><span class="hop">${esc(opponentText(x))}</span><span class="hsub">${esc(x.reason)} · ${Math.ceil(x.moves.length / 2)} ${plural(Math.ceil(x.moves.length / 2), ['хід', 'ходи', 'ходів'])} · ${tcText(x.control)}</span></span><span class="hdate">${dateText(x.endedAt)}</span></button></li>`;
  }).join('')}</ul></div>
    <p class="note">${cloud.me() && !cloud.me().isGuest ? 'Статистика синхронізується з вашим акаунтом.' : cloud.enabled ? 'Поки ви гість, статистика прив’язана до цього пристрою.' : 'Статистика зберігається лише на цьому пристрої.'}</p>
    <div class="foot" id="stats-foot"><button type="button" class="btn danger-ghost" data-act="clear">Очистити історію</button><button type="button" class="btn primary" data-act="close">Закрити</button></div>`;
  box.innerHTML = html;
}

// перегляд партії з архіву хід за ходом - на окремій дошці у вікні, поточну партію не чіпає
const VIEW = { rec: null, ply: 0, frames: [] };
function openReplay(rec) {
  const p = Position.start(rulesOf(rec.rules));
  const frames = [{ pos: p.clone(), last: null, san: '' }];
  for (const x of rec.moves) {
    const legal = p.generate();
    const m = legal.find((y) => sameMove(y, unpack(x)));
    if (!m) break;
    const san = sanOf(m, legal, p);
    p.make(m);
    frames.push({ pos: p.clone(), last: { from: m.from, to: m.to }, san: san + (p.inCheck() ? (p.generate().length ? '+' : '#') : ''), tk: !!m.tk });
  }
  VIEW.rec = rec; VIEW.frames = frames; VIEW.ply = frames.length - 1;
  renderReplay();
}
function renderReplay() {
  const { rec, frames, ply } = VIEW;
  const f = frames[ply];
  const flip = rec.myColor === BLACK;
  let board = '';
  for (let i = 0; i < 64; i++) {
    const row = i >> 3, col = i & 7;
    const sq = flip ? row * 8 + (7 - col) : (7 - row) * 8 + col;
    const dark = ((sq >> 3) + (sq & 7)) % 2 === 0;
    const last = f.last && (f.last.from === sq ? ' last from' : f.last.to === sq ? ' last to' : '');
    const pc = f.pos.board[sq];
    board += `<div class="sq${dark ? ' dark' : ''}${last || ''}">${pc ? pieceHtml(typeOf(pc), colorOf(pc), f.pos.t1[sq] ? ' charged' : '') + (f.pos.t1[sq] ? badgeHtml(f.pos.t1[sq]) : '') : ''}</div>`;
  }
  const o = rec.outcome ? OUT[rec.outcome][1] : (rec.result === 'draw' ? 'нічия' : rec.result === 'white' ? 'перемога білих' : 'перемога чорних');
  let moves = '';
  for (let i = 1; i < frames.length; i += 2) {
    const a = frames[i], b = frames[i + 1];
    const cell = (k, fr) => `<span class="${fr.tk ? 't' : ''}${k === ply ? ' cur' : ''}" data-ply="${k}">${fr.san}</span>`;
    moves += `<li><span class="n">${(i + 1) / 2}.</span>${cell(i, a)}${b ? cell(i + 1, b) : ''}</li>`;
  }
  $('stats-body').innerHTML = `
    <div class="rhead"><b>${esc(opponentText(rec))}</b><span>${esc(o)} · ${esc(rec.reason)} · ${dateText(rec.endedAt)}</span></div>
    <div class="mini" style="--sq:calc(min(100%, 460px) / 8)">${board}</div>
    <div class="rnav">
      <button type="button" class="btn" data-nav="first" aria-label="На початок">⏮︎</button>
      <button type="button" class="btn" data-nav="prev" aria-label="Попередній хід">◀︎</button>
      <span class="rply">${ply ? `хід ${Math.ceil(ply / 2)}${ply % 2 ? '' : ' (чорні)'}` : 'початок'} з ${Math.ceil((frames.length - 1) / 2)}</span>
      <button type="button" class="btn" data-nav="next" aria-label="Наступний хід">▶︎</button>
      <button type="button" class="btn" data-nav="last" aria-label="В кінець">⏭︎</button>
    </div>
    <ol class="moves">${moves}</ol>
    <div class="foot"><button type="button" class="btn" data-act="back">До статистики</button><button type="button" class="btn primary" data-act="close">Закрити</button></div>`;
  $('stats-body').querySelector('.moves .cur')?.scrollIntoView({ block: 'nearest' });
}
$('stats-body').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-game],[data-nav],[data-ply]');
  if (!t) return;
  if (t.dataset.game) { openReplay(statsGames[Number(t.dataset.game)]); return; }
  if (t.dataset.ply) { VIEW.ply = Number(t.dataset.ply); renderReplay(); return; }
  if (t.dataset.nav) {
    const n = VIEW.frames.length - 1;
    VIEW.ply = { first: 0, prev: Math.max(0, VIEW.ply - 1), next: Math.min(n, VIEW.ply + 1), last: n }[t.dataset.nav];
    renderReplay(); return;
  }
  const act = t.dataset.act;
  const msg = (text) => { const m = $('acc-msg'); if (m) { m.textContent = text; m.hidden = false; } };
  if (act === 'google' || act === 'google-existing') {
    t.disabled = true;
    msg('Відкриваємо сторінку Google…');
    const r = await cloud.googleUrl({ existing: act === 'google-existing' });
    t.disabled = false;
    if (r.error) { msg(r.error); return; }
    location.assign(r.url);
    // якщо браузер не перейшов (буває на iPhone) - звичайне посилання, яке гравець натискає сам
    setTimeout(() => {
      const m = $('acc-msg');
      if (!m) return;
      m.innerHTML = `Якщо сторінка Google не відкрилася, <a href="${esc(r.url)}">натисніть тут, щоб відкрити її</a>.${cloud.iosStandalone() ? ' На iPhone вхід через Google найнадійніше працює в Safari: відкрийте гру в Safari або увійдіть кодом з пошти.' : ''}`;
      m.hidden = false;
    }, 2500);
    return;
  }
  if (act === 'email') {
    t.disabled = true; msg('Надсилаємо…');
    const r = await cloud.signInEmail($('acc-email').value);
    // вікно могло вже перемалюватися (тоді поле для коду в ньому вже є) - беремо елементи заново
    msg(r.text);
    const b = document.querySelector('[data-act="email"]'); if (b) b.disabled = false;
    if (r.askCode && $('acc-code-row')) { $('acc-code-row').hidden = false; if (b) b.textContent = 'Надіслати ще раз'; $('acc-code').focus(); }
    return;
  }
  if (act === 'code') { t.disabled = true; msg('Перевіряємо код…'); const e2 = await cloud.verifyEmailCode($('acc-code').value); if (e2) { const b = document.querySelector('[data-act="code"]'); if (b) b.disabled = false; msg(e2); } return; }
  if (act === 'name-save') { const okName = await cloud.setName($('acc-name').value); t.textContent = okName ? 'Збережено' : 'Не вдалося'; return; }
  if (act === 'signout') { await cloud.signOut(); statsGames = []; renderStats(); return; }
  if (act === 'export') {
    const data = await cloud.exportData();
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'trofeini-shahy-dani.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  if (act === 'delete') {
    $('acc-actions').innerHTML = `<span class="confirm">Видалити акаунт разом з усією історією, рейтингом і профілем? Повернути їх не вийде.</span><button type="button" class="btn" data-act="keep">Ні</button><button type="button" class="btn danger" data-act="delete-yes">Видалити</button>`;
    return;
  }
  if (act === 'delete-yes') { const e2 = await cloud.deleteAccount(); statsGames = []; renderStats(); if (e2) msg(e2); return; }
  if (act === 'close') closeDialog('dlg-stats');
  else if (act === 'back') renderStats();
  else if (act === 'clear') {
    $('stats-foot').innerHTML = `<span class="confirm">Видалити всі ${statsGames.length} партій з цього пристрою? Повернути їх не вийде.</span><button type="button" class="btn" data-act="keep">Ні</button><button type="button" class="btn danger" data-act="wipe">Видалити</button>`;
  } else if (act === 'keep') renderStats();
  else if (act === 'wipe') { await archive.clearGames(); statsGames = []; renderStats(); }
});
// у перегляді - стрілки клавіатури
$('dlg-stats').addEventListener('keydown', (e) => {
  if (!VIEW.rec || !$('stats-body').querySelector('.mini')) return;
  const n = VIEW.frames.length - 1;
  if (e.key === 'ArrowLeft') { VIEW.ply = Math.max(0, VIEW.ply - 1); renderReplay(); e.preventDefault(); }
  if (e.key === 'ArrowRight') { VIEW.ply = Math.min(n, VIEW.ply + 1); renderReplay(); e.preventDefault(); }
});
$('btn-stats').onclick = openStats;
$('end-stats').onclick = () => { closeDialog('dlg-end'); openStats(); };
$('end-save-btn').onclick = () => { closeDialog('dlg-end'); openStats(); };

// Хто з фігур узяв найбільше - без впливу на правила, лише для фінального екрана
function bestPiece() {
  const p = Position.start(S.pos.rules);
  const id = new Int16Array(64).fill(-1);
  for (let sq = 0; sq < 64; sq++) if (p.board[sq]) id[sq] = sq;
  const caps = {}, kind = {};
  for (const x of S.moves) {
    const m = p.generate().find((y) => sameMove(y, unpack(x)));
    if (!m) break;
    const pid = id[m.from];
    const isCap = !!p.board[m.to] || m.flag === 2;
    if (isCap) { caps[pid] = (caps[pid] || 0) + 1; kind[pid] = [typeOf(p.board[m.from]), colorOf(p.board[m.from])]; }
    if (m.flag === 2) id[p.side === WHITE ? m.to - 8 : m.to + 8] = -1;
    id[m.to] = pid; id[m.from] = -1;
    if (m.flag === 3 || m.flag === 4) {
      const rf = m.flag === 3 ? (p.side === WHITE ? 7 : 63) : (p.side === WHITE ? 0 : 56);
      const rt = m.flag === 3 ? (p.side === WHITE ? 5 : 61) : (p.side === WHITE ? 3 : 59);
      id[rt] = id[rf]; id[rf] = -1;
    }
    p.make(m);
  }
  let top = null;
  for (const k of Object.keys(caps)) if (!top || caps[k] > caps[top]) top = k;
  if (!top || caps[top] < 3) return '';
  const [t, c] = kind[top];
  return `Фігура партії – ${c === WHITE ? (FEM[t] ? 'біла' : 'білий') : (FEM[t] ? 'чорна' : 'чорний')} ${NOM[t]}: ${caps[top]} взяття.`;
}

// --- дотики -----------------------------------------------------------------
let promoResolve = null;
function onSquare(sq) {
  if (VIEW_LIVE.ply != null) { reviewAt(null); return; }
  if (!myTurn()) return;
  const p = S.pos;
  const pc = p.board[sq];
  if (S.sel >= 0) {
    const cands = p.generate().filter((m) => m.from === S.sel && m.to === sq);
    if (cands.length === 1) { applyMove(cands[0]); return; }
    if (cands.length > 1) { askPromo(cands).then((m) => m && applyMove(m)); return; }
  }
  if (pc && colorOf(pc) === p.side && (S.mode === 'local' || colorOf(pc) === S.me)) {
    S.sel = S.sel === sq ? -1 : sq;
  } else S.sel = -1;
  render();
}

function askPromo(cands) {
  const box = $('promo-opts');
  box.innerHTML = '';
  const color = S.pos.side === WHITE ? 'w' : 'b';
  for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) {
    const m = cands.find((x) => x.promo === pr);
    if (!m) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = pieceHtml(pr, color === 'w' ? WHITE : BLACK);
    b.setAttribute('aria-label', NOM[pr]);
    b.onclick = () => { closeDialog('dlg-promo'); promoResolve?.(m); promoResolve = null; };
    box.appendChild(b);
  }
  openDialog('dlg-promo');
  return new Promise((res) => { promoResolve = res; });
}

// --- перетягування -------------------------------------------------------------
// Крім двох дотиків (фігура, потім поле) фігуру можна перетягнути пальцем чи мишею.
// Натискання на свою фігуру одразу її вибирає; клік, що прийде після нього, уже оброблено тут.
const DRAG = { press: null, ghost: null, size: 0, over: -1, skipSq: -1, skipUntil: 0 };
function sqAt(x, y) {
  const r = boardEl.getBoundingClientRect();
  if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return -1;
  return cellToSq(Math.floor((y - r.top) / (r.height / 8)) * 8 + Math.floor((x - r.left) / (r.width / 8)));
}
function canPick(sq) {
  const pc = S.pos.board[sq];
  return myTurn() && !!pc && colorOf(pc) === S.pos.side && (S.mode === 'local' || colorOf(pc) === S.me);
}
function dragEnd() {
  DRAG.ghost?.remove();
  DRAG.ghost = null; DRAG.press = null; DRAG.over = -1;
}
boardEl.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || !e.isPrimary || VIEW_LIVE.ply != null) return;
  const cell = e.target.closest('.sq');
  const i = cells.indexOf(cell);
  if (i < 0) return;
  const sq = cellToSq(i);
  if (!canPick(sq)) return;
  const wasSel = S.sel === sq;
  if (!wasSel) { S.sel = sq; render(); }
  DRAG.press = { sq, wasSel, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch' };
  DRAG.skipSq = sq; DRAG.skipUntil = Infinity;
});
addEventListener('pointermove', (e) => {
  const p = DRAG.press;
  if (!p || e.pointerId !== p.id) return;
  if (!DRAG.ghost) {
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
    const cell = cells[sqToCell(p.sq)];
    const r = cell.getBoundingClientRect();
    const g = document.createElement('div');
    g.className = 'sq drag-ghost';
    g.style.cssText = `width:${r.width}px;height:${r.height}px;--sq:${r.width}px`;
    g.innerHTML = [...cell.querySelectorAll(':scope > .pc, :scope > .badge')].map((x) => x.outerHTML).join('');
    document.body.appendChild(g);
    DRAG.ghost = g; DRAG.size = r.width;
  }
  // на телефоні фігура трохи вище пальця, щоб її було видно
  const lift = p.touch ? DRAG.size * 0.45 : 0;
  DRAG.ghost.style.transform = `translate(${e.clientX - DRAG.size / 2}px, ${e.clientY - DRAG.size / 2 - lift}px) scale(${p.touch ? 1.25 : 1.08})`;
  const over = sqAt(e.clientX, e.clientY - lift);
  if (over !== DRAG.over) { DRAG.over = over; render(); }
});
addEventListener('pointerup', (e) => {
  const p = DRAG.press;
  if (!p || e.pointerId !== p.id) return;
  DRAG.skipUntil = performance.now() + 450;
  if (!DRAG.ghost) {                                   // просто дотик: повторний дотик до вибраної фігури знімає вибір
    DRAG.press = null;
    if (p.wasSel) { S.sel = -1; render(); }
    return;
  }
  const to = DRAG.over;
  dragEnd();
  if (to < 0 || to === p.sq || S.sel !== p.sq || !myTurn()) { render(); return; }
  const cands = S.pos.generate().filter((m) => m.from === p.sq && m.to === to);
  if (cands.length === 1) applyMove(cands[0], { dragged: true });
  else if (cands.length > 1) { render(); askPromo(cands).then((m) => m && applyMove(m, { dragged: true })); }
  else render();                                       // сюди не можна: фігура повертається і лишається вибраною
});
addEventListener('pointercancel', (e) => {
  if (!DRAG.press || e.pointerId !== DRAG.press.id) return;
  dragEnd(); render();
});

// --- екран не гасне, поки йде партія ---------------------------------------------------
// Поки партія не скінчилася і за останні 10 хвилин хтось ходив чи торкався екрана, екран тримаємо ввімкненим
// (Screen Wake Lock). Сховали вкладку - браузер сам відпускає, повернулися - беремо знову.
// Де цього API немає або сторінці його не дозволено (старі iPhone, деякі вбудовані браузери), - запасний
// шлях, як у NoSleep.js: беззвучне відео 16×16 по колу. Його можна запустити лише з дотику.
const AWAKE_IDLE_MS = 10 * 60 * 1000;
const AWAKE_MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAXYbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAml0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHhbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABjG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUxzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAe/+EAFmdCwB7ZHsBEAAADAAQAAAMAEDxYuSABAAVoy4PEyAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAqkAAAKpAAAABhzdHRzAAAAAAAAAAEAAAAEAAAgAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAACRzdHN6AAAAAAAAAAAAAAAEAAACiQAAAAsAAAALAAAACgAAACBzdGNvAAAAAAAAAAQAAAYdAAAItgAACNEAAAjsAAACmXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAIAAAAAAAAH0AAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAB9AAAAQAAAEAAAAAAhFtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAB9AAABCgFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAAG8bWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAGAc3RibAAAAH5zdHNkAAAAAAAAAAEAAABubXA0YQAAAAAAAAABAAAAAAAAAAAAAQAQAAAAAB9AAAAAAAA2ZXNkcwAAAAADgICAJQACAASAgIAXQBUAAAAAAB9AAAABPwWAgIAFFYhW5QAGgICAAQIAAAAUYnRydAAAAAAAAB9AAAABPwAAACBzdHRzAAAAAAAAAAIAAAAQAAAEAAAAAAEAAAKAAAAAKHN0c2MAAAAAAAAAAgAAAAEAAAABAAAAAQAAAAIAAAAEAAAAAQAAAFhzdHN6AAAAAAAAAAAAAAARAAAAFQAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAkc3RjbwAAAAAAAAAFAAAGCAAACKYAAAjBAAAI3AAACPYAAAAac2dwZAEAAAByb2xsAAAAAgAAAAH//wAAABxzYmdwAAAAAHJvbGwAAAABAAAAEQAAAAEAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYwLjE2LjEwMAAAAAhmcmVlAAADBm1kYXTeAgBMYXZjNjAuMzEuMTAyAAIwQA4AAAJyBgX//27cRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJsb2NrPTE6LTM6LTMgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTIuMDA6MC43MCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTQgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTIgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjIwAIAAAAAPZYiEBfOf//8PRQABV5+AARggBwEYIAcBGCAHARggBwAAAAdBmjgL5zqAARggBwEYIAcBGCAHARggBwAAAAdBmlQC+c6gARggBwEYIAcBGCAHARggBwAAAAZBmmAVznUBGCAHARggBwEYIAcBGCAH';
const AWAKE = { last: performance.now(), lock: null, busy: false, denied: false, video: null };
const wantAwake = () => !!S.pos && !S.over && document.visibilityState === 'visible' && performance.now() - AWAKE.last < AWAKE_IDLE_MS;
async function syncAwake(gesture = false) {
  const want = wantAwake();
  if ('wakeLock' in navigator && !AWAKE.denied) {
    if (want && !AWAKE.lock && !AWAKE.busy) {
      AWAKE.busy = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        AWAKE.lock = lock;
        lock.addEventListener('release', () => { if (AWAKE.lock === lock) AWAKE.lock = null; });
      } catch (e) {
        // заборонено самій сторінці (політика вбудованої сторінки) - далі запасний шлях; інакше спробуємо згодом
        if (e?.name === 'NotAllowedError' && document.visibilityState === 'visible') AWAKE.denied = true;
      }
      AWAKE.busy = false;
      if (!wantAwake() || AWAKE.denied) syncAwake(gesture);       // поки чекали, партія скінчилася чи шлях змінився
    } else if (!want && AWAKE.lock) {
      const lock = AWAKE.lock; AWAKE.lock = null;
      lock.release().catch(() => {});
    }
    return;
  }
  if (want && gesture) {
    if (!AWAKE.video) {
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
      v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      v.src = AWAKE_MP4;
      // деякі версії Safari зупиняються на кінці, попри loop
      v.addEventListener('timeupdate', () => { if (v.currentTime > 1.5) v.currentTime = 0.1; });
      document.body.appendChild(v);
      AWAKE.video = v;
    }
    if (AWAKE.video.paused) AWAKE.video.play().catch(() => {});
  } else if (!want && AWAKE.video && !AWAKE.video.paused) AWAKE.video.pause();
}
const awakeNow = () => { AWAKE.last = performance.now(); syncAwake(true); };
for (const ev of ['pointerup', 'keydown']) addEventListener(ev, awakeNow, { passive: true });
document.addEventListener('visibilitychange', () => syncAwake());
setInterval(() => syncAwake(), 30000);                              // відпустити після 10 хвилин тиші

// --- звук і вібрація ------------------------------------------------------------
// Звуки синтезуються на льоту (Web Audio), без файлів: стук ходу, глухіший подвійний - взяття, дзвіночок - заряд.
// Браузер дає грати звук лише після дотику до сторінки, тож контекст оживає з першим дотиком.
const soundOn = () => store.get('sound', true) !== false;
let actx = null;
function audio() {
  if (!actx) {
    const C = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!C) return null;
    try { actx = new C(); } catch { return null; }
  }
  if (actx.state === 'suspended' || actx.state === 'interrupted') actx.resume().catch(() => {});
  return actx;
}
// на телефоні жестом, що дозволяє звук, браузер вважає відпускання пальця, а не дотик
for (const ev of ['pointerdown', 'pointerup', 'keydown']) addEventListener(ev, () => { if (soundOn()) audio(); }, { passive: true });
function knock(c, t, freq = 1500, gain = 0.45) {
  const n = Math.ceil(c.sampleRate * 0.05);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 4;
  const src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.1; g.gain.value = gain;
  src.connect(bp); bp.connect(g); g.connect(c.destination); src.start(t);
  const o = c.createOscillator(), og = c.createGain();           // низький «удар» дерева об дерево
  o.frequency.setValueAtTime(freq / 7, t); o.frequency.exponentialRampToValueAtTime(freq / 12, t + 0.08);
  og.gain.setValueAtTime(gain * 0.5, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(og); og.connect(c.destination); o.start(t); o.stop(t + 0.1);
}
function bell(c, t, freq, gain = 0.09, len = 0.4) {
  const o = c.createOscillator(), g = c.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + len + 0.02);
}
function sound(kind) {
  if (!soundOn()) return;
  const c = audio();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + 0.005;
  if (kind === 'move') knock(c, t);
  else if (kind === 'capture') { knock(c, t, 1100, 0.6); knock(c, t + 0.045, 850, 0.3); }
  else if (kind === 'charge') { knock(c, t, 1100, 0.55); bell(c, t + 0.06, 1318.5); bell(c, t + 0.15, 1975.5, 0.07, 0.55); }
  else if (kind === 'check') { knock(c, t); bell(c, t + 0.03, 987.8, 0.07, 0.25); }
  else if (kind === 'notify') { bell(c, t, 880); bell(c, t + 0.14, 1174.7, 0.09, 0.5); }
  else if (kind === 'end') { bell(c, t, 659.3); bell(c, t + 0.15, 784); bell(c, t + 0.3, 1046.5, 0.09, 0.7); }
}
const buzz = (pattern) => { if (soundOn()) try { navigator.vibrate?.(pattern); } catch { /* вібрації немає */ } };
const SOUND_ICON = {
  on: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  off: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
};
function renderSoundBtn() {
  const b = $('btn-sound'), on = soundOn();
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? 'Звук увімкнено' : 'Звук вимкнено');
  b.title = on ? 'Звук і вібрація: увімкнено' : 'Звук і вібрація: вимкнено';
  b.querySelector('svg').innerHTML = on ? SOUND_ICON.on : SOUND_ICON.off;
}
$('btn-sound').onclick = () => {
  store.set('sound', !soundOn());
  renderSoundBtn();
  if (soundOn()) { audio(); setTimeout(() => sound('move'), 30); }
};
renderSoundBtn();

// --- машина ---------------------------------------------------------------
let worker = null, workerBroken = false;
function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./worker.js?v=c40509266662', import.meta.url), { type: 'module' });
    worker.onerror = () => { workerBroken = true; worker = null; };
  } catch { workerBroken = true; worker = null; }
  return worker;
}
const fallbackEngine = new Engine({});
let fallbackRules = null;

function maybeAI() {
  if (S.mode !== 'ai' || S.over || S.pos.side === S.me) return;
  S.thinking = true;
  const req = ++S.aiReq;
  const started = performance.now();
  render();
  const done = (mv) => {
    if (req !== S.aiReq) return;                         // хід скасовано, поки машина думала
    const wait = Math.max(0, 350 - (performance.now() - started));
    setTimeout(() => {
      if (req !== S.aiReq) return;
      S.thinking = false;
      if (mv) applyMove(mv); else render();
    }, wait);
  };
  const w = getWorker();
  const msg = { id: req, moves: S.moves.map(unpack), level: S.level, rules: S.rules, seed: (Math.random() * 2 ** 31) | 0 };
  if (w) {
    const onMsg = (e) => {
      if (e.data.id !== req) return;
      w.removeEventListener('message', onMsg);
      if (e.data.error) { workerBroken = true; runInline(); } else done(e.data.move);
    };
    w.addEventListener('message', onMsg);
    w.postMessage(msg);
  } else runInline();
  function runInline() {
    setTimeout(() => {
      if (fallbackRules !== S.rules) { fallbackEngine.clearTT(); fallbackRules = S.rules; }   // оцінки інших правил тут хибні
      const { move } = chooseMove(fallbackEngine, S.pos.clone(), LEVELS[S.level]);
      done(move && { from: move.from, to: move.to, promo: move.promo, tk: move.tk, flag: move.flag });
    }, 30);
  }
}

// --- панель дій -------------------------------------------------------------
function renderStatus(legal) {
  const el = $('status');
  const main = el.querySelector('.main'), ev = el.querySelector('.event');
  const p = S.pos;
  let text;
  el.classList.remove('check');
  if (S.over) {
    text = S.over.result === 'draw' ? 'Нічия' : `Перемога ${S.over.result === 'white' ? 'білих' : 'чорних'}`;
    text += ' · ' + S.over.reason;
  } else if (S.mode === 'online' && S.gid && !net.opponentJoined()) {
    text = 'Чекаємо на суперника';
  } else if (S.thinking) text = 'Машина думає…';
  else {
    const side = p.side === WHITE ? 'білих' : 'чорних';
    text = S.mode === 'local' ? `Хід ${side}` : p.side === S.me ? 'Ваш хід' : `Хід суперника`;
    if (p.inCheck()) {
      el.classList.add('check');
      const ks = p.kingSquare(p.side);
      const by = p.chargeAttackers(ks, p.side ^ 8);
      const classical = p.inCheckClassical(p.side);
      text = 'Шах! ' + text;
      if (by.length && !classical) text = `Шах зарядом ${TRO_GEN[by[0].kind]} з ${sqName(by[0].sq)}! ${S.mode === 'local' ? `Хід ${side}` : p.side === S.me ? 'Ваш хід' : 'Хід суперника'}`;
    }
  }
  if (hasDrawOffer()) text += S.drawOffer === S.me ? ' · ви запропонували нічию' : ' · суперник пропонує нічию';
  const rv = $('review');
  rv.hidden = VIEW_LIVE.ply == null;
  if (!rv.hidden) {
    const k = VIEW_LIVE.ply;
    text = k ? `Перегляд: ${Math.ceil(k / 2)}. ${k % 2 ? 'білі' : 'чорні'} – ${S.sans[k - 1]}` : 'Перегляд: початкова позиція';
    rv.querySelector('.rtext').textContent = S.over ? '' : 'Партія йде далі' + (S.control ? ', годинник теж.' : '.');
    rv.querySelector('[data-rv="prev"]').disabled = k <= 0;
  }
  main.textContent = text;
  el.querySelector('.conn').hidden = !(S.mode === 'online' && S.gid && S.connLost && !S.over);
  ev.className = 'event' + (S.event?.cls ? ' ' + S.event.cls : '');
  ev.innerHTML = S.event?.text ?? (S.moves.length ? '' : classical() ? 'Торкніться фігури, щоб побачити її ходи.' : 'Торкніться фігури, щоб побачити її ходи. Ромбики – ходи зарядом.');
  $('rules-tag').hidden = !classical();
}

function renderMoves() {
  const ol = $('moves');
  let html = '';
  const cell = (k) => `<span class="${S.tks[k] ? 't' : ''}" data-ply="${k + 1}" role="button" tabindex="-1">${S.sans[k]}</span>`;
  for (let i = 0; i < S.sans.length; i += 2) {
    html += `<li><span class="n">${i / 2 + 1}.</span>${cell(i)}${S.sans[i + 1] ? ' ' + cell(i + 1) : ''}</li>`;
  }
  if (ol.dataset.html !== html) { ol.innerHTML = html; ol.dataset.html = html; }
  const cur = VIEW_LIVE.ply ?? S.sans.length;
  let curEl = null;
  ol.querySelectorAll('li span:not(.n)').forEach((el) => { const on = Number(el.dataset.ply) === cur; el.classList.toggle('cur', on); if (on) curEl = el; });
  if (VIEW_LIVE.ply == null) ol.scrollTop = ol.scrollHeight;
  else curEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// --- перегляд ходів партії, що йде ----------------------------------------------
// Дотик до ходу в записі або стрілки ← → показують позицію після цього ходу; партія тим часом іде далі.
const VIEW_LIVE = { ply: null, pos: null, last: null };
function reviewAt(k) {
  if (k == null || k >= S.moves.length || !S.moves.length) { VIEW_LIVE.ply = null; VIEW_LIVE.pos = null; render(); return; }
  k = Math.max(0, k);
  const p = Position.start(S.pos.rules);
  let last = null;
  for (let i = 0; i < k; i++) {
    const m = p.generate().find((y) => sameMove(y, unpack(S.moves[i])));
    if (!m) break;
    p.make(m); last = { from: m.from, to: m.to };
  }
  VIEW_LIVE.ply = k; VIEW_LIVE.pos = p; VIEW_LIVE.last = last;
  S.sel = -1;
  render();
}
$('moves').addEventListener('click', (e) => {
  const t = e.target.closest('[data-ply]');
  if (t) reviewAt(Number(t.dataset.ply));
});
$('review').addEventListener('click', (e) => {
  const t = e.target.closest('[data-rv]');
  if (!t) return;
  const cur = VIEW_LIVE.ply ?? S.moves.length;
  reviewAt({ prev: cur - 1, next: cur + 1, live: null }[t.dataset.rv]);
});
document.addEventListener('keydown', (e) => {
  if (!S.pos || document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
  const cur = VIEW_LIVE.ply ?? S.moves.length;
  const go = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: null }[e.key];
  if (go === undefined && !(e.key === 'Escape' && VIEW_LIVE.ply != null)) return;
  e.preventDefault();
  if (document.activeElement?.closest?.('#board')) document.activeElement.blur();   // інакше на клітинці лишається рамка фокуса
  reviewAt(go === undefined ? null : go);
});

// панель: проти машини і вдвох - «Скасувати», онлайн - «Нічия» на тому самому місці
function renderButtons() {
  const undo = $('btn-undo');
  undo.hidden = S.mode === 'online';
  if (S.mode === 'local') {                           // удвох на одному пристрої скасовувати можна без обмежень
    undo.disabled = !!S.over || !S.moves.length;
    undo.querySelector('.lbl').textContent = 'Скасувати';
  } else {
    undo.disabled = !!S.over || S.undos <= 0 || S.moves.length < (S.me === WHITE ? 1 : 2);
    undo.querySelector('.lbl').textContent = S.undos > 0 ? 'Скасувати' : 'Використано';
  }
  undo.title = S.mode === 'ai' ? 'Скасувати свій останній хід (раз за партію)' : 'Скасувати останній хід';
  $('btn-resign').disabled = !!S.over || (S.mode === 'online' && !net.opponentJoined());
  $('btn-threats').hidden = classical();             // загрози зарядів у класичних шахах не буває
  $('btn-threats').setAttribute('aria-pressed', String(S.showThreats));
  const draw = $('btn-draw');
  draw.hidden = S.mode !== 'online';
  const theirs = theirDrawOffer();
  draw.disabled = !!S.over || !net.opponentJoined() || (hasDrawOffer() && !theirs);
  draw.classList.toggle('offer', theirs);
  draw.querySelector('.lbl').textContent = theirs ? 'Прийняти' : 'Нічия';
  draw.title = theirs ? 'Суперник пропонує нічию – прийняти' : hasDrawOffer() ? 'Ви вже запропонували нічию' : 'Запропонувати нічию';
}

$('btn-undo').onclick = () => {
  if (S.over || !S.moves.length) return;
  if (S.mode === 'ai' && S.undos <= 0) return;
  if (S.mode !== 'ai' && S.mode !== 'local') return;
  S.aiReq++;                                          // відкинути відповідь машини, якщо вона ще думає
  S.thinking = false;
  VIEW_LIVE.ply = null; VIEW_LIVE.pos = null;
  const back = S.mode === 'local' ? 1 : S.pos.side === S.me ? 2 : 1;
  for (let i = 0; i < back && S.moves.length; i++) {
    S.pos.unmake(); S.moves.pop(); S.sans.pop(); S.tks.pop(); S.durations.pop();
  }
  if (S.mode === 'ai') S.undos--;
  S.sel = -1;
  S.event = { text: S.mode === 'ai' ? 'Хід скасовано. У цій партії скасувань більше немає.' : 'Хід скасовано.', cls: '' };
  S.lastMove = S.moves.length ? lastMoveOf(S.moves[S.moves.length - 1]) : null;
  S.turnStart = performance.now();
  save(); render();
  maybeAI();
};
const lastMoveOf = (x) => { const m = unpack(x); return { from: m.from, to: m.to }; };
$('btn-threats').onclick = () => { S.showThreats = !S.showThreats; render(); };
$('btn-flip').onclick = () => { S.orient ^= 8; render(); };
// підтвердження дії - власне вікно (системне confirm() у вбудованих браузерах і артефакті не працює)
let confirmResolve = null;
function confirmAction({ title, text, yes, danger = false }) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  const y = $('confirm-yes');
  y.textContent = yes;
  y.className = 'btn ' + (danger ? 'danger' : 'primary');
  openDialog('dlg-confirm');
  return new Promise((res) => { confirmResolve = res; });
}
const answerConfirm = (v) => { closeDialog('dlg-confirm'); confirmResolve?.(v); confirmResolve = null; };
$('confirm-yes').onclick = () => answerConfirm(true);
$('confirm-no').onclick = () => answerConfirm(false);
$('dlg-confirm').addEventListener('cancel', () => { confirmResolve?.(false); confirmResolve = null; });

$('btn-resign').onclick = async () => {
  if (S.over) return;
  const loser = S.mode === 'local' ? S.pos.side : S.me;
  const who = loser === WHITE ? 'білі' : 'чорні';
  const okResign = await confirmAction(S.mode === 'local'
    ? { title: `Здаються ${who}?`, text: `Партію буде завершено перемогою ${loser === WHITE ? 'чорних' : 'білих'}.`, yes: 'Здатися', danger: true }
    : { title: 'Здатися?', text: 'Партію буде зараховано як вашу поразку.', yes: 'Здатися', danger: true });
  if (!okResign || S.over) return;
  finish({ result: loser === WHITE ? 'black' : 'white', reason: 'здача' });
  if (S.mode === 'online') net.writeResult(S.over);
};
$('btn-draw').onclick = async () => {
  if (S.mode !== 'online' || S.over) return;
  const accept = theirDrawOffer();
  const okDraw = await confirmAction(accept
    ? { title: 'Прийняти нічию?', text: 'Партія завершиться внічию.', yes: 'Прийняти нічию' }
    : { title: 'Запропонувати нічию?', text: 'Суперник побачить пропозицію і зможе її прийняти. Пропозиція зникне, щойно хтось зробить хід.', yes: 'Запропонувати' });
  if (!okDraw || S.over) return;
  if (theirDrawOffer()) { finish({ result: 'draw', reason: 'нічия за згодою' }); net.writeResult(S.over); }
  else { S.drawOffer = S.me; net.offerDraw(S.me); render(); }
};

// --- діалоги ------------------------------------------------------------------
function openDialog(id) { const d = $(id); if (!d.open) d.showModal(); }
function closeDialog(id) { const d = $(id); if (d.open) d.close(); }
$('btn-rules').onclick = () => { $('rules-classical').hidden = !classical(); openDialog('dlg-rules'); };
$('rules-close').onclick = () => closeDialog('dlg-rules');
$('end-close').onclick = () => closeDialog('dlg-end');
$('end-again').onclick = () => { closeDialog('dlg-end'); openNewDialog(); };
$('dlg-promo').addEventListener('cancel', () => { promoResolve?.(null); promoResolve = null; });
$('hint-close').onclick = () => { $('hint').hidden = true; store.set('hint', 1); };
$('btn-new').onclick = () => openNewDialog();

// останній вибір у діалозі пам’ятаємо між запусками
// колір в онлайн-партії щоразу «Випадково»: його не запам’ятовуємо, а ручний вибір іде в текст запрошення
const NEW = { rules: DEFAULT_RULES_ID, mode: 'ai', level: 3, color: 'w', tc: '10|2', ...store.get('new', {}), onlineColor: 'r' };
if (!RULESETS[NEW.rules]) NEW.rules = DEFAULT_RULES_ID;
if (NEW.min) $('tc-min').value = NEW.min;
if (NEW.inc != null) $('tc-inc').value = NEW.inc;
// поки хмара підключається, онлайн-партія ще недоступна - це не «немає зв’язку»
let cloudSettled = !cloud.enabled;
cloud.ready.then(() => { cloudSettled = true; if ($('dlg-new').open) syncNewDialog(); });
cloud.onChange(() => { if ($('dlg-new').open) syncNewDialog(); });
function chipGroup(id, key, onPick) {
  const box = $(id);
  box.querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => {
      if (c.disabled) return;
      box.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      NEW[typeof key === 'function' ? key() : key] = c.dataset.v;
      onPick?.();
    };
  });
}
function syncNewDialog() {
  const set = (id, v) => $(id).querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === String(v))));
  set('opt-rules', NEW.rules); set('opt-mode', NEW.mode); set('opt-level', NEW.level); set('opt-color', NEW.mode === 'online' ? NEW.onlineColor : NEW.color); set('opt-tc', NEW.tc);
  $('grp-level').hidden = NEW.mode !== 'ai';
  $('grp-color').hidden = NEW.mode === 'local';
  $('tc-custom').hidden = NEW.tc !== 'custom';
  const note = $('online-note');
  note.hidden = NEW.mode !== 'online';
  if (NEW.mode === 'online') {
    note.textContent = net.kind === 'cloud'
      ? (net.available()
        ? 'Після старту ви отримаєте посилання – надішліть його другу в будь-який месенджер. Він відкриє його на телефоні, і партія почнеться. Партія не загубиться, навіть якщо закрити застосунок.'
        : cloudSettled ? 'Немає зв’язку з сервером гри. Перевірте інтернет і перезапустіть гру.' : 'Підключаємося до сервера гри…')
      : net.kind === 'relay'
      ? 'Після старту ви отримаєте посилання – надішліть його другу в будь-який месенджер. Він відкриє його на телефоні, і партія почнеться. Ходи пересилає безкоштовний сервіс ntfy.sh.'
      : net.available()
      ? 'Після старту ви отримаєте посилання для суперника. Йому потрібен доступ до цієї сторінки з правом вносити зміни – його дає власник через меню «Поділитися».'
      : 'Онлайн-партія недоступна в цьому перегляді: потрібен вхід у claude.ai і доступ до спільних даних сторінки.';
  }
  $('new-start').disabled = NEW.mode === 'online' && !net.available();
}
(function buildLevels() {
  const box = $('opt-level');
  for (let i = 1; i < LEVELS.length; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.v = String(i);
    b.innerHTML = `${i}<small>${LEVELS[i].name}</small>`;
    box.appendChild(b);
  }
})();
chipGroup('opt-rules', 'rules', syncNewDialog);
chipGroup('opt-mode', 'mode', syncNewDialog);
chipGroup('opt-level', 'level', syncNewDialog);
chipGroup('opt-color', () => (NEW.mode === 'online' ? 'onlineColor' : 'color'), syncNewDialog);
chipGroup('opt-tc', 'tc', syncNewDialog);
$('new-cancel').onclick = () => closeDialog('dlg-new');
function openNewDialog() {
  NEW.rules = S.rules; NEW.mode = S.mode; NEW.level = String(S.level); NEW.onlineColor = 'r';
  syncNewDialog();
  openDialog('dlg-new');
}
function parseTC() {
  if (NEW.tc === 'none') return null;
  if (NEW.tc === 'custom') {
    const mn = Math.min(180, Math.max(1, Number($('tc-min').value) || 5));
    const inc = Math.min(60, Math.max(0, Number($('tc-inc').value) || 0));
    return { base: mn * 60, inc };
  }
  const [mn, inc] = NEW.tc.split('|').map(Number);
  return { base: mn * 60, inc };
}
$('new-start').onclick = async () => {
  const control = parseTC();
  const pick = NEW.mode === 'online' ? NEW.onlineColor : NEW.color;
  const color = pick === 'r' ? (Math.random() < 0.5 ? WHITE : BLACK) : pick === 'b' ? BLACK : WHITE;
  store.set('new', { rules: NEW.rules, mode: NEW.mode, level: NEW.level, color: NEW.color, tc: NEW.tc, min: $('tc-min').value, inc: $('tc-inc').value });
  closeDialog('dlg-new');
  // партія ще йде: перепитати; онлайн-суперник не має лишитися з партією, яку ніхто не доведе до кінця
  const live = !S.over && (S.mode === 'online' ? !!S.gid && net.opponentJoined() : S.moves.length >= 2);
  if (live) {
    const okNew = await confirmAction(S.mode === 'online'
      ? { title: 'Залишити онлайн-партію?', text: 'У поточній партії вам буде зараховано поразку, як за здачу. Суперник отримає перемогу.', yes: 'Здатися і почати', danger: true }
      : { title: 'Почати нову партію?', text: 'Поточну партію буде перервано, у статистику вона не потрапить.', yes: 'Почати нову' });
    if (!okNew) return;
    if (S.mode === 'online' && !S.over) {
      finish({ result: S.me === WHITE ? 'black' : 'white', reason: 'здача' }, { quiet: true });
      net.writeResult(S.over);
    }
  }
  if (S.mode === 'online') { if (!net.opponentJoined()) net.cancelWaiting(); net.leave(); }
  if (NEW.mode === 'online') {
    const gid = await net.createGame({ control, color, rules: NEW.rules });
    if (!gid) {
      S.event = { text: isClassical(NEW.rules) && net.kind === 'cloud'
        ? 'Не вдалося створити онлайн-партію в класичні шахи: немає зв’язку або сервер гри ще не оновлено для класичних шахів. Спробуйте ще раз згодом.'
        : 'Не вдалося створити онлайн-партію. Спробуйте ще раз.', cls: '' };
      render(); return;
    }
    startGame({ mode: 'online', control, me: color, gid, pick, rules: NEW.rules });
    showShare();
    return;
  }
  startGame({ mode: NEW.mode, level: Number(NEW.level), control, me: color, rules: NEW.rules });
};

// запрошення: Telegram, Viber і WhatsApp - посиланнями на їхнє «поділитися», плюс копіювання і системне меню телефона
// колір згадуємо, лише якщо господар обрав його сам (за «Випадково» другу досить знати, що партія чекає)
function inviteText() {
  const mine = S.pick === 'w' ? 'білими' : S.pick === 'b' ? 'чорними' : '';
  return (classical() ? 'Зіграймо в шахи за класичними правилами!' : 'Зіграймо в трофейні шахи!') + (mine ? ` Я граю ${mine}, ти – ${S.pick === 'w' ? 'чорними' : 'білими'}.` : '') + ' Відкрий посилання на телефоні:';
}
function shareBar() {
  const url = net.inviteUrl(S.gid);
  const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(inviteText())}`;
  const vb = `viber://forward?text=${encodeURIComponent(inviteText() + ' ' + url)}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(inviteText() + ' ' + url)}`;
  return `<span class="sharebar">
    <a class="btn tg" data-share="tg" href="${tg}" target="_blank" rel="noopener">Telegram</a>
    <a class="btn vb" data-share="viber" href="${vb}">Viber</a>
    <a class="btn wa" data-share="wa" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>
    <button type="button" class="btn" data-share="copy">Скопіювати</button>
    ${navigator.share ? '<button type="button" class="btn" data-share="more">Інше…</button>' : ''}
  </span><span class="share-msg" id="share-msg">Обраний месенджер відкриється, якщо він встановлений на цьому пристрої.</span>`;
}
function showShare() {
  if (net.kind !== 'artifact') {
    S.event = { text: 'Партію створено. Надішліть другу посилання – щойно він його відкриє, партія почнеться.' + shareBar(), cls: '' };
  } else {
    S.event = { text: 'Партію створено. Суперник побачить її у списку «Відкриті партії», щойно відкриє цю сторінку.', cls: '' };
  }
  render();
}
async function shareInvite(how) {
  const url = net.inviteUrl(S.gid);
  const msg = (t) => { const m = $('share-msg'); if (m) m.textContent = t; };
  if (how === 'more') {
    try { await navigator.share({ title: 'Трофейні шахи', text: inviteText(), url }); } catch { /* гравець закрив меню */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(inviteText() + ' ' + url);
    msg('Запрошення скопійовано – вставте його в будь-який месенджер.');
  } catch {
    msg('Скопіюйте посилання вручну: ' + url);
  }
}
$('status').addEventListener('click', (e) => {
  const t = e.target.closest('[data-share]');
  if (!t) return;
  if (t.dataset.share === 'copy' || t.dataset.share === 'more') shareInvite(t.dataset.share);
  // Telegram, Viber і WhatsApp - звичайні посилання, їх відкриває браузер або сам застосунок
});

// --- старт, збереження ------------------------------------------------------
function startGame({ mode, level = S.level, control, me = WHITE, gid = null, pick = null, rules = DEFAULT_RULES_ID, moves = [], durations = [], undos = 1, id = null, startedAt = null }) {
  S.aiReq++;
  VIEW_LIVE.ply = null; VIEW_LIVE.pos = null;
  S.mode = mode; S.level = Math.min(Math.max(level | 0, 1), LEVELS.length - 1); S.control = control; S.me = me;
  S.orient = mode === 'local' ? WHITE : me;
  S.rules = RULESETS[rules] ? rules : DEFAULT_RULES_ID;
  S.pos = Position.start(rulesOf(S.rules));
  if (classical()) S.showThreats = false;
  // підказка про заряд - лише в трофейних шахах і доки гравець її не сховав
  $('hint').hidden = classical() || !!store.get('hint');
  S.moves = []; S.sans = []; S.tks = []; S.durations = [];
  S.over = null; S.sel = -1; S.thinking = false; S.undos = undos; S.event = null; S.lastMove = null;
  S.gid = gid; S.pick = pick; S.drawOffer = null; S.players = null; S.playersFor = null; S.joinedSeen = false; S.connLost = false;
  $('end-rating').hidden = true;
  // онлайн-партія має той самий запис на обох пристроях і після перезапусків
  S.gameId = id ?? (mode === 'online' && gid ? 'on-' + gid : archive.newId());
  S.startedAt = startedAt ?? new Date().toISOString();
  for (let i = 0; i < moves.length; i++) replayOne(moves[i], durations[i] ?? 0);
  S.turnStart = performance.now();
  if (S.moves.length) checkOutcome();
  save();
  render();
  maybeAI();
}

function replayOne(x, dur) {
  const p = S.pos;
  const legal = p.generate();
  const m = legal.find((y) => sameMove(y, unpack(x)));
  if (!m) return false;
  const san = sanOf(m, legal);
  p.make(m);
  S.moves.push(x); S.sans.push(san + (p.inCheck() ? (p.generate().length ? '+' : '#') : ''));
  S.tks.push(!!m.tk); S.durations.push(dur);
  S.lastMove = { from: m.from, to: m.to };
  return true;
}

function save() {
  if (S.mode === 'online') {                          // онлайн-партія живе в посередника; пам’ятаємо лише, яка
    store.set('online', S.over ? null : { gid: S.gid, pick: S.pick });
    return;
  }
  store.set('game', {
    mode: S.mode, level: S.level, control: S.control, me: S.me, moves: S.moves, durations: S.durations,
    undos: S.undos, over: S.over, id: S.gameId, startedAt: S.startedAt, rules: S.rules,
  });
}

// --- онлайн: вхідні події -----------------------------------------------------
net.onUpdate((doc) => {
  if (S.mode !== 'online' || doc.id !== S.gid) return;
  if (doc.white && doc.black && doc.white !== net.myId() && doc.black !== net.myId()) {
    S.event = { text: 'У цій партії вже двоє гравців.', cls: '' }; render(); return;
  }
  // нові ходи суперника
  const incoming = doc.moves || [];
  if (incoming.length < S.moves.length) return;       // наш хід ще не дійшов - чекаємо
  if (!S.joinedSeen && doc.white && doc.black) {
    S.joinedSeen = true;
    if (!incoming.length && !doc.over) {
      S.event = { text: 'Суперник приєднався – партія почалася. ' + (S.me === WHITE ? 'Ваш хід.' : 'Перший хід за білими.'), cls: '' };
      sound('notify'); buzz([40, 60, 40]);
    }
  }
  for (let i = S.moves.length; i < incoming.length && !S.over; i++) {
    const ok = applyMove(unpack(incoming[i]), { duration: (doc.durations || [])[i] ?? 0, remote: true });
    if (!ok) { S.event = { text: 'Отримано неможливий хід – партію зупинено.', cls: '' }; render(); return; }
  }
  S.drawOffer = doc.drawOffer ?? null;
  if (doc.over && !S.over) finish(doc.over);
  // імена й рейтинг гравців - коли за столом обоє
  const seats = (doc.white || '') + (doc.black || '');
  if (net.players && doc.white && doc.black && S.playersFor !== seats) {
    S.playersFor = seats;
    net.players(doc).then((pl) => { if (S.gid === doc.id) { S.players = pl; render(); } }).catch(() => {});
  }
  if (doc.ratingChange) showRatingChange(doc);
  render();
});
function showRatingChange(doc) {
  const mine = doc.ratingChange?.[S.me === WHITE ? 'white' : 'black'];
  if (!mine) return;
  const d = mine.after - mine.before;
  const el = $('end-rating');
  el.textContent = `Рейтинг (${cloud.POOL_NAME[doc.pool] ?? ''}): ${mine.before} → ${mine.after} (${d >= 0 ? '+' : '−'}${Math.abs(d)}).`;
  el.hidden = false;
}

// --- лобі онлайн-партій ------------------------------------------------------
const lobbyEl = $('lobby');
let lobbyGames = [];
const tcLabel = (c) => (c ? `${c.base / 60}|${c.inc}` : 'без годинника');
const gameLabel = (g) => tcLabel(g.control) + (isClassical(g.rules) ? ' · класичні' : '');
async function renderLobby() {
  const me = net.myId();
  if (!me) { lobbyEl.hidden = true; return; }
  const mine = lobbyGames.filter((g) => g.status === 'playing' && (g.white === me || g.black === me) && g.id !== S.gid);
  const open = lobbyGames.filter((g) => g.status === 'waiting' && g.host !== me);
  const myWaiting = lobbyGames.filter((g) => g.status === 'waiting' && g.host === me && g.id !== S.gid);
  if (!mine.length && !open.length && !myWaiting.length) { lobbyEl.hidden = true; return; }
  const nm = await net.names([...new Set(open.map((g) => g.host))]);
  const rows = [];
  for (const g of mine) rows.push(`<li><span>Ваша незавершена онлайн-партія · ${gameLabel(g)}</span><button class="btn" data-join="${g.id}" type="button">Продовжити</button></li>`);
  for (const g of open) {
    const youColor = g.white ? 'чорними' : 'білими';
    const who = nm[g.host] || 'Суперник';
    rows.push(`<li><span><b class="who"></b> чекає на суперника · ${gameLabel(g)} · ви граєте ${youColor}</span><button class="btn primary" data-join="${g.id}" data-who="${encodeURIComponent(who)}" type="button">Приєднатися</button></li>`);
  }
  for (const g of myWaiting) rows.push(`<li><span>Ваша партія чекає на суперника · ${gameLabel(g)}</span><button class="btn" data-join="${g.id}" type="button">Відкрити</button></li>`);
  lobbyEl.innerHTML = `<h3>Відкриті партії</h3><ul>${rows.join('')}</ul>`;
  lobbyEl.querySelectorAll('[data-who]').forEach((b) => {
    b.closest('li').querySelector('.who').textContent = decodeURIComponent(b.dataset.who);
  });
  lobbyEl.querySelectorAll('[data-join]').forEach((b) => { b.onclick = () => joinOnline(b.dataset.join); });
  lobbyEl.hidden = false;
}
async function joinOnline(gid, pick = null) {
  if (S.mode === 'online') net.leave();
  const res = await net.joinGame(gid);
  if (!res) {
    S.event = { text: net.kind !== 'artifact'
      ? 'Не вдалося приєднатися: партію вже зайняли, вона завершилася або старша за 12 годин, або немає зв’язку.'
      : 'Не вдалося приєднатися. Можливо, партію вже зайняли, або у вас немає права вносити зміни на цій сторінці.', cls: '' };
    if (net.kind !== 'artifact') store.set('online', null);
    render(); return;
  }
  startGame({ mode: 'online', control: res.control, me: res.color, gid, pick, rules: res.rules, moves: res.moves, durations: res.durations });
  if (res.over) finish(res.over);
  else if (S.over) net.writeResult(S.over);          // партія скінчилася на дошці, а на сервер результат не дійшов
  S.joinedSeen = net.opponentJoined();
  if (!S.over && !net.opponentJoined()) showShare();  // своя партія ще чекає на суперника - посилання знову під рукою
  else if (!S.over && !res.moves.length) {
    S.event = { text: (res.color === WHITE ? 'Ви в партії й граєте білими. Ваш хід.' : 'Ви в партії й граєте чорними. Перший хід за білими.')
      + (classical() ? ' Правила – класичні шахи, без зарядів.' : ''), cls: '' };
    render();
  }
  renderLobby();
}

// онлайн: зв’язок зник - кажемо про це, але не одразу (коротке перепідключення - не обрив)
let connTimer = null;
net.onConn?.((ok) => {
  clearTimeout(connTimer);
  if (ok) { if (S.connLost) { S.connLost = false; render(); } return; }
  connTimer = setTimeout(() => { S.connLost = true; render(); }, 1500);
});
net.onLobby((games) => { lobbyGames = games; renderLobby(); });

// помилку входу (вона приходить після повернення зі сторінки Google чи листа) показуємо на головному екрані
cloud.ready.then(() => { const e = cloud.error(); if (e && !S.event) { S.event = { text: esc(e.text), cls: '' }; render(); } });

(async function boot() {
  const saved = store.get('game');
  if (saved && !saved.over && saved.mode !== 'online') {
    startGame({ ...saved });
  } else {
    startGame({ mode: 'ai', level: 3, control: { base: 600, inc: 2 }, me: WHITE });
  }
  if (net.kind === 'artifact') return;
  // посилання-запрошення ?g=... або незавершена онлайн-партія після перезапуску
  const url = new URL(location.href);
  const invited = url.searchParams.get('g');
  if (invited) {
    url.searchParams.delete('g');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  const gid = invited || store.get('online')?.gid;
  const pick = invited ? null : store.get('online')?.pick ?? null;   // чи господар сам обирав колір - для тексту запрошення
  if (!gid) return;
  S.event = { text: 'Під’єднуємося до онлайн-партії…', cls: '' }; render();
  await joinOnline(gid, pick);
})();
