// Онлайн-партія з другом через Supabase (етап А). Той самий інтерфейс, що в online.js і online-relay.js.
// Партія - рядок таблиці games; змінюють його лише функції бази (create_game, join_game, push_move,
// offer_draw, finish_game), які перевіряють чергу ходу і узгодженість результату.
// Нові ходи приходять миттєво через Supabase Realtime; після обриву чи повернення в застосунок
// стан дочитується з бази, тож партія не губиться.
import * as cloud from './cloud.js?v=c40509266662';

export const kind = 'cloud';
const sb = cloud.sb;
const listeners = [];
let current = null, channel = null, attached = null;
let wantOver = null;          // результат, який ми записали, але база ще могла не отримати

export const ready$ = cloud.ready;
export function available() { return cloud.enabled && !!cloud.me(); }
export function myId() { return cloud.me()?.id ?? null; }
export function onUpdate(fn) { listeners.push(fn); }
export function onLobby() { /* лобі немає: суперник приходить за посиланням */ }
export function opponentJoined() { return !!(current && current.white && current.black); }
export async function names(ids) {
  const info = await cloud.ratingsOf(ids).catch(() => ({}));
  return Object.fromEntries(ids.map((id) => [id, info[id]?.name || '']));
}
export async function players(doc) {
  const info = await cloud.ratingsOf([doc.white, doc.black]).catch(() => ({}));
  const one = (id) => id && info[id] ? { name: info[id].name, rating: info[id].ratings[doc.pool] ?? null } : null;
  return { white: one(doc.white), black: one(doc.black), pool: doc.pool };
}
export function inviteUrl(gid) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('g', gid);
  return u.toString();
}
const notify = () => { const d = current; if (d) listeners.forEach((f) => f(d)); };

// --- стан зв’язку: канал миттєвих оновлень і запити до бази -------------------
// Поки зв’язку немає, раз на кілька секунд пробуємо дочитати партію; щойно вийде - дошлемо, що не дійшло.
const conn = { ch: true, req: true };
const connListeners = [];
let lastConn = true, retryTimer = null;
export function onConn(fn) { connListeners.push(fn); }
export function connected() { return navigator.onLine !== false && conn.ch && conn.req; }
function connChanged() {
  const c = connected();
  if (c === lastConn) return;
  lastConn = c;
  clearInterval(retryTimer); retryTimer = null;
  if (!c) retryTimer = setInterval(() => { if (attached) refetch().catch(() => {}); }, 4000);
  connListeners.forEach((f) => { try { f(c); } catch { /* слухач зламався */ } });
}
const netError = (e) => !e.code || e.code === 'PGRST000' || /fetch|network|load failed/i.test(e.message || '');
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

function toDoc(row) {
  return {
    id: row.id, status: row.status, host: row.host, white: row.white, black: row.black,
    control: row.control, rules: row.rules ?? 'trofei-simple-r10', moves: (row.moves || []).map(Number), durations: (row.durations || []).map(Number),
    over: row.over, drawOffer: row.draw_offer ?? null, rated: row.rated, pool: row.pool, ratingChange: row.rating_change,
  };
}
let lastSeen = 0;            // коли востаннє отримали стан партії
function apply(row) {
  if (!row || row.id !== attached) return;
  lastSeen = Date.now();
  const d = toDoc(row);
  // знімок із бази не відкочує ходи, які ми вже зробили, але ще не підтверджено
  if (current && current.id === d.id && current.moves.length > d.moves.length && !d.over) {
    d.moves = current.moves; d.durations = current.durations;
  }
  current = d;
  notify();
}
async function refetch() {
  if (!attached) return;
  const { data, error } = await sb.from('games').select('*').eq('id', attached).maybeSingle();
  if (error) { if (netError(error)) { conn.req = false; connChanged(); } return; }
  conn.req = true; broken = false; connChanged();
  if (data) { apply(data); resend(data); }
}
// Хід чи результат, що не дійшли до бази за три спроби (телефон був без мережі), - дошлемо зараз.
// Повтор безпечний: база ігнорує вже записаний хід і вже записаний результат.
function resend(row) {
  if (!current || inflight || row.id !== current.id || row.status !== 'playing') return;
  const mine = current.white === myId() ? 0 : 1;
  const have = (row.moves || []).length;
  for (let i = have; i < current.moves.length; i++) {
    if (i % 2 === mine) call('push_move', { p_id: current.id, p_ply: i, p_move: current.moves[i], p_duration: Math.round(current.durations[i] || 0) });
  }
  // результат - лише якщо після нього нових ходів не було (інакше він уже не відповідає дошці)
  if (wantOver && wantOver.id === current.id && wantOver.ply === current.moves.length) {
    call('finish_game', { p_id: current.id, p_result: wantOver.result, p_reason: wantOver.reason });
  }
}
function subscribe(gid) {
  if (channel) sb.removeChannel(channel);
  attached = gid;
  const ch = sb.channel('game:' + gid);
  channel = ch;
  ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gid}` }, (p) => apply(p.new))
    .subscribe((status) => {
      if (channel !== ch) return;
      if (status === 'SUBSCRIBED') { conn.ch = true; refetch().catch(() => {}); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') conn.ch = false;
      connChanged();
    });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refetch().catch(() => {}); });
// страховка: миттєве сповіщення може загубитися чи запізнитися - якщо 10 секунд не було жодного оновлення,
// дочитуємо партію з бази самі (лише поки партія йде і застосунок на екрані). Поки господар чекає на суперника,
// поріг - 3 секунди: друг уже відкрив посилання, і чекати на нього довше, ніж треба, найприкріше.
setInterval(() => {
  if (!attached || !current || current.over || document.visibilityState !== 'visible') return;
  if (Date.now() - lastSeen > (current.status === 'waiting' ? 3000 : 10000)) refetch().catch(() => {});
}, 1500);
addEventListener('online', () => { connChanged(); refetch().catch(() => {}); });
addEventListener('offline', connChanged);

// виклики по одному, щоб ходи йшли в базу по черзі; мережеві збої - до трьох спроб
// Якщо запит не пройшов і за три спроби, наступні в черзі вже не шлемо (результат не має випередити хід):
// щойно партію знову вдасться дочитати, resend() дошле все потрібне по порядку.
let chain = Promise.resolve(), inflight = 0, broken = false;
function call(fn, args) {
  inflight++;
  chain = chain.then(async () => {
    if (broken) return null;
    for (let t = 0; t < 3; t++) {
      // sb.rpc() повертає не Promise, а об’єкт лише з then (без catch), тож збій ловимо через try
      let r;
      try { r = await sb.rpc(fn, args); } catch (e) { r = { error: e }; }
      const { data, error } = r ?? {};
      if (!error) { conn.req = true; connChanged(); if (data) apply(data); return data; }
      if (!netError(error)) { refetch().catch(() => {}); return null; }
      await new Promise((res) => setTimeout(res, 700 * (t + 1)));
    }
    broken = true; conn.req = false; connChanged();
    return null;
  })
    // будь-яка несподівана помилка не має зупинити чергу: наступні ходи все одно підуть
    .catch(() => null)
    .finally(() => { inflight--; });
  return chain;
}

export async function createGame({ control, color, rules = 'trofei-simple-r10' }) {
  await cloud.ready;
  if (!available()) return null;
  const gid = newId();
  attached = gid;
  // правила передаємо, лише якщо вони не типові: так трофейна партія створюється і на базі без міграції 0002
  const args = { p_id: gid, p_color: color, p_control: control ?? null };
  if (rules !== 'trofei-simple-r10') args.p_rules = rules;
  const { data, error } = await sb.rpc('create_game', args);
  if (error || !data) { attached = null; return null; }
  current = toDoc(data);
  subscribe(gid);
  return gid;
}

export async function joinGame(gid) {
  await cloud.ready;
  if (!available() || !/^[a-z0-9]{16}$/.test(gid)) return null;
  attached = gid;
  const { data, error } = await sb.rpc('join_game', { p_id: gid });
  if (error || !data) { attached = null; return null; }
  current = toDoc(data);
  subscribe(gid);
  const me = myId();
  const color = current.white === me ? 0 : 8;
  return { control: current.control, color, moves: current.moves, durations: current.durations, over: current.over, rules: current.rules };
}

export function sendMove(moves, durations) {
  if (!current) return;
  const i = moves.length - 1;
  current = { ...current, moves, durations, drawOffer: null };
  call('push_move', { p_id: current.id, p_ply: i, p_move: moves[i], p_duration: Math.round(durations[i] || 0) });
}
export function writeResult(over) {
  if (!current || !over) return;
  wantOver = { id: current.id, ply: current.moves.length, ...over };
  call('finish_game', { p_id: current.id, p_result: over.result, p_reason: over.reason });
}
export function offerDraw() {
  if (!current) return;
  call('offer_draw', { p_id: current.id });
}
export function cancelWaiting() {
  if (!current || current.status !== 'waiting') return;
  call('finish_game', { p_id: current.id, p_result: 'draw', p_reason: 'партію скасовано' });
}
export function leave() {
  const ch = channel;
  channel = null; attached = null; current = null; wantOver = null; broken = false;
  if (ch) sb.removeChannel(ch);
  conn.ch = true; conn.req = true; connChanged();
}
