// Архів партій і статистика гравця.
//
// Етап 1 - усе на пристрої: записи лежать в IndexedDB браузера (запасний варіант - localStorage).
// Запис уже має форму, яку пізніше можна без перетворень відправити на сервер:
//   - id: незмінний ідентифікатор партії (для онлайн-партії - похідний від id партії, тож обидва
//     пристрої і всі перезапуски дають той самий запис, а не дублікати);
//   - device: хто записав; syncedAt / syncedUser: коли і в який акаунт запис потрапив на сервер (web/cloud.js);
//   - rules і schema: версія правил і формату - партію можна відтворити й після змін у правилах;
//   - moves: повний список ходів, з якого перераховується вся статистика.
// Статистика ніде не зберігається окремо, а щоразу рахується з ходів (analyze/summarize), тож
// новий показник одразу з’являється і для старих партій, а сервер зможе рахувати те саме тим самим кодом.
// analyze і summarize не залежать від браузера.
import { Position, SIMPLE_RULES, WHITE, BLACK, typeOf, colorOf, TROPHY_OF_VICTIM, rulesOf, isClassical } from './core.js?v=c40509266662';

export const RULES_ID = 'trofei-simple-r10';      // типові правила запису; класичні шахи - 'classical'
export const SCHEMA = 1;

const unpack = (x) => ({ from: x & 63, to: (x >> 6) & 63, promo: (x >> 12) & 7, tk: (x >> 15) & 7, flag: (x >> 18) & 7 });
const sameMove = (a, b) => a.from === b.from && a.to === b.to && a.promo === b.promo && a.tk === b.tk;

// --- розбір однієї партії ----------------------------------------------------------
// Перегравує ходи ядром правил і рахує заряди окремо для білих і чорних.
// granted/spent - масиви за типом заряду: [_, пішак, кінь, слон, тура, ферзь].
export function analyze(moves, rules = SIMPLE_RULES) {
  const p = Position.start(rules);
  const side = () => (p.side === WHITE ? 'w' : 'b');
  const a = {
    plies: 0, valid: true, lastTk: 0,
    captures: { w: 0, b: 0 },
    granted: { w: [0, 0, 0, 0, 0, 0], b: [0, 0, 0, 0, 0, 0] },
    spent: { w: [0, 0, 0, 0, 0, 0], b: [0, 0, 0, 0, 0, 0] },
  };
  for (const x of moves) {
    const m = p.generate().find((y) => sameMove(y, unpack(x)));
    if (!m) { a.valid = false; break; }
    const s = side();
    const vsq = m.flag === 2 ? (p.side === WHITE ? m.to - 8 : m.to + 8) : m.to;
    const victim = p.board[vsq];
    const before = p.trophyCount(m.from) - (m.tk ? 1 : 0);
    if (m.tk) a.spent[s][m.tk]++;
    p.make(m);
    if (victim) {
      a.captures[s]++;
      if (p.trophyCount(m.to) > before) a.granted[s][TROPHY_OF_VICTIM[typeOf(victim)]]++;
    }
    a.lastTk = m.tk;
    a.plies++;
  }
  return a;
}

// --- запис ------------------------------------------------------------------------------
export function newId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* немає */ }
  return 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
export function deviceId() {
  try {
    let d = localStorage.getItem('tsh:device');
    if (!d) { d = newId().replace(/-/g, '').slice(0, 12); localStorage.setItem('tsh:device', d); }
    return d;
  } catch { return 'unknown'; }
}

// mode: 'ai' | 'local' | 'online'; myColor: 0 / 8, для партії удвох - null
export function buildRecord({ id, mode, level, control, myColor, over, moves, durations, gid, startedAt, rules = RULES_ID }) {
  const won = over.result === 'draw' ? 'draw' : over.result;            // 'white' | 'black' | 'draw'
  let outcome = null;
  if (myColor === WHITE || myColor === BLACK) {
    outcome = won === 'draw' ? 'draw' : (won === 'white') === (myColor === WHITE) ? 'win' : 'loss';
  }
  return {
    schema: SCHEMA, rules, id, device: deviceId(), syncedAt: null,
    startedAt: startedAt ?? null, endedAt: new Date().toISOString(),
    mode, level: mode === 'ai' ? level : null, control: control ?? null, gid: gid ?? null,
    myColor: myColor ?? null, result: won, reason: over.reason, outcome,
    moves: moves.slice(), durations: (durations || []).map((d) => Math.round(d || 0)),
  };
}

// --- зведена статистика ---------------------------------------------------------------
const wdl = () => ({ games: 0, win: 0, draw: 0, loss: 0 });
const add = (t, outcome) => { t.games++; if (outcome) t[outcome]++; };

export function summarize(records) {
  // класичні партії - окремо: свої рядки за рівнями й онлайн; заряди рахуються лише в трофейних
  const s = {
    total: records.length, rated: wdl(), local: 0, online: wdl(), byLevel: {},
    classical: { games: 0, local: 0, online: wdl(), byLevel: {} },
    bestBeaten: 0, streak: 0, bestStreak: 0,
    charges: { games: 0, granted: 0, spent: 0, byKind: [0, 0, 0, 0, 0, 0], chargeMates: 0 },
  };
  // від старих до нових - для серій перемог
  const sorted = records.slice().sort((x, y) => (x.endedAt < y.endedAt ? -1 : 1));
  let run = 0;
  for (const r of sorted) {
    const cl = isClassical(r.rules);
    const bucket = cl ? s.classical : s;
    if (cl) s.classical.games++;
    if (r.mode === 'local') { bucket.local++; continue; }
    add(s.rated, r.outcome);
    if (r.mode === 'online') add(bucket.online, r.outcome);
    if (r.mode === 'ai') {
      if (!bucket.byLevel[r.level]) bucket.byLevel[r.level] = wdl();
      add(bucket.byLevel[r.level], r.outcome);
      if (r.outcome === 'win' && r.level > s.bestBeaten) s.bestBeaten = r.level;
    }
    run = r.outcome === 'win' ? run + 1 : 0;
    s.bestStreak = Math.max(s.bestStreak, run);
    if (cl) continue;
    const a = analyze(r.moves, rulesOf(r.rules));
    const me = r.myColor === WHITE ? 'w' : 'b';
    s.charges.games++;
    s.charges.granted += a.granted[me].reduce((x, y) => x + y, 0);
    s.charges.spent += a.spent[me].reduce((x, y) => x + y, 0);
    a.granted[me].forEach((n, k) => { s.charges.byKind[k] += n; });
    if (r.outcome === 'win' && r.reason === 'мат' && a.lastTk) s.charges.chargeMates++;
  }
  s.streak = run;
  return s;
}

// --- сховище ----------------------------------------------------------------------------
// Один інтерфейс для гри: putGame, listGames, clearGames, onChange. Пізніше тут же з’явиться синхронізація.
const DB = 'trofei-shahy', STORE = 'games', LS_KEY = 'tsh:games';
const listeners = [];
const changed = () => listeners.forEach((f) => { try { f(); } catch { /* слухач зламався - не наша справа */ } });
export function onChange(fn) { listeners.push(fn); }
export function notify() { changed(); }

let dbp = null;
function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const os = req.result.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('endedAt', 'endedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } };
const lsWrite = (arr) => { try { localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(-500))); } catch { /* немає місця */ } };
const tx = (db, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode);
  const out = fn(t.objectStore(STORE));
  t.oncomplete = () => resolve(out?.result);
  t.onerror = () => reject(t.error);
});

// quiet - без сповіщення слухачів (для синхронізації, яка сповіщає один раз наприкінці)
export async function putGame(rec, { quiet = false } = {}) {
  const db = await openDb();
  if (db) { try { await tx(db, 'readwrite', (os) => os.put(rec)); if (!quiet) changed(); return; } catch { /* нижче - запасний шлях */ } }
  const arr = lsRead().filter((r) => r.id !== rec.id);
  arr.push(rec); lsWrite(arr); if (!quiet) changed();
}

export async function listGames() {
  const db = await openDb();
  let arr = null;
  if (db) { try { arr = await tx(db, 'readonly', (os) => os.getAll()); } catch { arr = null; } }
  if (!arr) arr = lsRead();
  return arr.sort((x, y) => (x.endedAt < y.endedAt ? 1 : -1));
}

export async function clearGames() {
  const db = await openDb();
  if (db) { try { await tx(db, 'readwrite', (os) => os.clear()); } catch { /* нижче */ } }
  try { localStorage.removeItem(LS_KEY); } catch { /* немає сховища */ }
  changed();
}
