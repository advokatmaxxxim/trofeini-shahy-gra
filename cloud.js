// Хмара (Supabase): вхід, профіль, синхронізація архіву, рейтинг, вивантаження і видалення даних.
//
// Вхід: кожен, хто відкрив гру, одразу стає гостем (анонімний акаунт Supabase) - грати можна без жодних
// дій. Вхід через Google або кодом з пошти не створює новий акаунт, а «прив’язується» до гостьового:
// ідентифікатор лишається тим самим, тож уся історія зберігається. Якщо цей Google чи ця пошта вже мають
// акаунт, гравець просто входить у нього; партії з пристрою синхронізуються туди ж.
//
// Без налаштувань (web/cloud-config.js порожній) або без бібліотеки (артефакт claude.ai) модуль вимкнений:
// enabled = false, а гра працює як раніше.
import { SUPABASE_URL, SUPABASE_KEY } from './cloud-config.js?v=c40509266662';
import * as archive from './history.js?v=c40509266662';

export const enabled = !!(SUPABASE_URL && SUPABASE_KEY && globalThis.supabase?.createClient);
export const sb = enabled
  ? globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  })
  : null;

const here = () => location.origin + location.pathname;
const listeners = [];
let user = null;              // {id, isGuest, email, name}
let lastError = null;         // повідомлення для гравця після невдалого входу
export function onChange(fn) { listeners.push(fn); }
const changed = () => listeners.forEach((f) => { try { f(); } catch { /* слухач зламався */ } });
export const me = () => user;
export const error = () => lastError;

function toUser(u) {
  if (!u) return null;
  return { id: u.id, isGuest: !!u.is_anonymous, email: u.email || null, name: user?.id === u.id ? user.name : null };
}

// помилка, з якою Supabase повертає гравця після входу (вона приходить в адресі)
function readUrlError() {
  const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const code = q.get('error_code') || h.get('error_code');
  const desc = q.get('error_description') || h.get('error_description');
  if (!code && !desc) return null;
  ['error', 'error_code', 'error_description'].forEach((k) => q.delete(k));
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  return { code, desc };
}

export const ready = (async () => {
  if (!enabled) return;
  const urlErr = readUrlError();
  if (urlErr && /already|exists/i.test(urlErr.code + ' ' + urlErr.desc)) {
    // цей Google уже має акаунт (наприклад, створений на іншому пристрої): одразу входимо в нього;
    // партії гостя з цього пристрою потім синхронізуються туди. Позначка - щоб не зациклитися.
    let tried = false;
    try { tried = sessionStorage.getItem('tsh:google-retry') === '1'; sessionStorage.setItem('tsh:google-retry', '1'); } catch { /* немає сховища */ }
    if (!tried) {
      const r = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here() } });
      if (!r.error) return;            // браузер іде на сторінку Google
    }
    lastError = { text: 'Цей акаунт Google уже використовується. Увійдіть у нього – партії з цього пристрою перенесуться туди.', retryGoogle: true };
  } else if (urlErr) {
    lastError = { text: 'Не вдалося увійти: ' + (urlErr.desc || urlErr.code) + '. Спробуйте ще раз або увійдіть кодом з пошти.' };
  } else {
    try { sessionStorage.removeItem('tsh:google-retry'); } catch { /* немає сховища */ }
  }
  try {
    let { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const r = await sb.auth.signInAnonymously();
      session = r.data?.session ?? null;
      if (r.error) lastError = { text: 'Не вдалося підключитися до сервера гри. Статистика поки зберігається лише на пристрої.' };
    }
    user = toUser(session?.user);
    if (user) await loadProfile();
  } catch { lastError = { text: 'Немає зв’язку з сервером гри. Статистика поки зберігається лише на пристрої.' }; }
  sb.auth.onAuthStateChange((_ev, session) => {
    const prev = user?.id;
    user = toUser(session?.user);
    if (user && user.id !== prev) loadProfile().then(changed);
    if (user) sync().catch(() => {});
    changed();
  });
  changed();
  if (user) sync().catch(() => {});
})();

// --- профіль ------------------------------------------------------------------
async function loadProfile() {
  const { data } = await sb.from('profiles').select('name').eq('id', user.id).maybeSingle();
  user.name = data?.name ?? null;
}
export async function setName(name) {
  name = String(name || '').trim().slice(0, 24);
  if (!user || !name) return false;
  const { error: e } = await sb.from('profiles').upsert({ id: user.id, name, updated_at: new Date().toISOString() });
  if (e) return false;
  user.name = name;   // без changed(): вікно статистики не перемальовується, напис «Збережено» лишається
  return true;
}

// --- вхід ------------------------------------------------------------------------
// Повертає {url} сторінки входу Google або {error}. Переходить туди сама гра (app.js), а якщо браузер
// перехід не виконав (так буває на iPhone), гравець бачить звичайне посилання на ту саму сторінку.
export async function googleUrl({ existing = false } = {}) {
  lastError = null;
  const opts = { provider: 'google', options: { redirectTo: here(), skipBrowserRedirect: true } };
  let r;
  try {
    r = user?.isGuest && !existing ? await sb.auth.linkIdentity(opts) : await sb.auth.signInWithOAuth(opts);
    // прив’язка до гостя не вдалася ще до переходу - тоді звичайний вхід
    if (r.error && user?.isGuest && !existing) r = await sb.auth.signInWithOAuth(opts);
  } catch (e) { r = { error: e }; }
  if (r.error || !r.data?.url) return { error: 'Не вдалося почати вхід через Google: ' + (r.error?.message || 'немає адреси сторінки входу') + '.' };
  return { url: r.data.url };
}
// iPhone чи iPad, гра відкрита як встановлений застосунок (а не в Safari)
export const iosStandalone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches);

// Вхід поштою - шестизначним кодом з листа (у листі є й посилання). Код вводиться в тій самій грі, тож
// працює і там, де посилання відкрилося б не в грі, а в браузері (встановлена гра на iPhone).
// Повертає {text, askCode}: що сказати гравцеві і чи показати поле для коду.
let pending = null;            // {email, type} - на яку пошту і яким способом надіслано код
// куди надіслано код: вікно акаунта перемальовується (Supabase повідомляє про зміну акаунта одразу після
// запиту коду), і поле для коду має лишитися на місці
export const pendingEmail = () => pending?.email ?? null;
export async function signInEmail(email) {
  lastError = null;
  email = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { text: 'Перевірте адресу пошти.' };
  if (user?.isGuest) {
    // прив’язати пошту до гостьового акаунта: прийде лист із кодом підтвердження
    const r = await sb.auth.updateUser({ email }, { emailRedirectTo: here() });
    if (!r.error) { pending = { email, type: 'email_change' }; return { text: `Ми надіслали код на ${email}. Введіть його нижче – і ви ввійдете, зі збереженою історією.`, askCode: true }; }
    if (!/already|exists|registered/i.test(r.error.message)) return { text: 'Не вдалося надіслати лист: ' + r.error.message };
  }
  // пошта вже має акаунт - вхід у нього кодом
  const r = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: here(), shouldCreateUser: true } });
  if (r.error) return { text: 'Не вдалося надіслати лист: ' + r.error.message };
  pending = { email, type: 'email' };
  return { text: `Ми надіслали код на ${email}. Введіть його нижче, щоб увійти. Партії з цього пристрою перенесуться в акаунт.`, askCode: true };
}
// код з листа; повертає текст помилки або null, якщо вхід вдався (тоді гра оновиться сама)
export async function verifyEmailCode(code) {
  code = String(code || '').replace(/\s+/g, '');
  if (!pending) return 'Спершу введіть пошту і отримайте код.';
  if (!/^\d{6,10}$/.test(code)) return 'Код – це цифри з листа.';
  let r;
  try { r = await sb.auth.verifyOtp({ email: pending.email, token: code, type: pending.type }); } catch (e) { r = { error: e }; }
  if (r.error) return /expired|invalid/i.test(r.error.message || '') ? 'Код неправильний або застарів. Перевірте його або надішліть новий.' : 'Не вдалося увійти: ' + (r.error.message || r.error) + '.';
  pending = null;
  return null;
}

// вийти: архів цього пристрою спершу синхронізується, потім очищається (щоб на спільному пристрої
// наступний гравець не бачив чужої історії); далі - новий гість
export async function signOut() {
  await sync().catch(() => {});
  await sb.auth.signOut().catch(() => {});
  await archive.clearGames().catch(() => {});
  try { localStorage.removeItem('tsh:pull:' + (user?.id ?? '')); } catch { /* немає сховища */ }
  user = null; changed();
  const r = await sb.auth.signInAnonymously();
  user = toUser(r.data?.session?.user); changed();
}

export async function deleteAccount() {
  const { error: e } = await sb.rpc('delete_my_account');
  if (e) return 'Не вдалося видалити акаунт: ' + e.message;
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  await archive.clearGames().catch(() => {});
  user = null; changed();
  const r = await sb.auth.signInAnonymously();
  user = toUser(r.data?.session?.user); changed();
  return null;
}

// усе, що сервер знає про гравця, одним файлом
export async function exportData() {
  if (!user) return null;
  const [profile, records, ratings, games] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    sb.from('game_records').select('*').eq('user_id', user.id),
    sb.from('ratings').select('*').eq('user_id', user.id),
    sb.from('games').select('*').or(`white.eq.${user.id},black.eq.${user.id}`),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email, guest: user.isGuest },
    profile: profile.data, ratings: ratings.data, onlineGames: games.data, archive: records.data,
  };
}

// --- рейтинг --------------------------------------------------------------------
export const POOL_NAME = {
  bullet: 'Куля', blitz: 'Бліц', rapid: 'Рапід',
  // класичні шахи мають окремий рейтинг (supabase/migrations/0002_classical.sql)
  'classical-bullet': 'Класика · куля', 'classical-blitz': 'Класика · бліц', 'classical-rapid': 'Класика · рапід',
};
export const TROPHY_POOLS = ['bullet', 'blitz', 'rapid'];
export const START_RATING = 500;        // так само, як типове значення в базі (0003_rating_start.sql)
export const CLASSICAL_POOLS = ['classical-bullet', 'classical-blitz', 'classical-rapid'];
export async function ratingsOf(ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!enabled || !ids.length) return {};
  const [{ data: rs }, { data: ps }] = await Promise.all([
    sb.from('ratings').select('user_id,pool,rating,rd,games').in('user_id', ids),
    sb.from('profiles').select('id,name').in('id', ids),
  ]);
  const out = Object.fromEntries(ids.map((id) => [id, { name: '', ratings: {} }]));
  for (const p of ps || []) out[p.id].name = p.name;
  for (const r of rs || []) out[r.user_id].ratings[r.pool] = r;
  return out;
}

// --- синхронізація архіву -----------------------------------------------------
// Нові записи пристрою (ще не надіслані цьому акаунту) - на сервер; записи акаунта, яких немає на пристрої, - сюди.
let syncing = null;
export function sync() {
  if (!enabled || !user) return Promise.resolve();
  if (!syncing) syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}
async function doSync() {
  const uid = user.id;
  const local = await archive.listGames();
  const toPush = local.filter((r) => r.syncedUser !== uid);
  for (let i = 0; i < toPush.length; i += 50) {
    const chunk = toPush.slice(i, i + 50);
    const rows = chunk.map((r) => ({ user_id: uid, id: r.id, ended_at: r.endedAt, updated_at: new Date().toISOString(), record: { ...r, syncedAt: null, syncedUser: null } }));
    const { error: e } = await sb.from('game_records').upsert(rows);
    if (e) throw e;
    const now = new Date().toISOString();
    for (const r of chunk) await archive.putGame({ ...r, syncedAt: now, syncedUser: uid }, { quiet: true });
  }
  const key = 'tsh:pull:' + uid;
  let since = null;
  try { since = localStorage.getItem(key); } catch { /* немає сховища */ }
  let q = sb.from('game_records').select('id,record,updated_at').eq('user_id', uid).order('updated_at', { ascending: true }).limit(1000);
  if (since) q = q.gt('updated_at', since);
  const { data, error: e } = await q;
  if (e) throw e;
  const have = new Set(local.map((r) => r.id));
  const now = new Date().toISOString();
  let added = 0;
  for (const row of data || []) {
    if (!have.has(row.id)) { await archive.putGame({ ...row.record, syncedAt: now, syncedUser: uid }, { quiet: true }); added++; }
    since = row.updated_at;
  }
  if (since) try { localStorage.setItem(key, since); } catch { /* немає сховища */ }
  if (added || toPush.length) archive.notify();
}

// новий запис в архіві - невдовзі на сервер
let syncTimer = null;
archive.onChange(() => {
  if (!enabled || !user) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync().catch(() => {}), 1500);
});
