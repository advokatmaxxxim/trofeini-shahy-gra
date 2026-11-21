// Режим Android-застосунку (тека android/): гра відкрита у вбудованому WebView із файлів, що лежать
// у самому застосунку, а не на сайті. Рідна частина дописує до User-Agent позначку TrofeiniApp/<версія>
// і дає місток TrofeiniAndroid.postMessage (лише сторінкам самої гри). Тут - усе, що гра робить
// у застосунку інакше, ніж у браузері; у браузері й артефакті claude.ai цей модуль нічого не змінює.
export const inApp = /\bTrofeiniApp\//.test(navigator.userAgent);
// версія застосунку з User-Agent: «1.0.0 (3)» - назва і код версії
export const appVersion = (navigator.userAgent.match(/\bTrofeiniApp\/(\S+) \((\d+)\)/) ?? []).slice(1).join(' (') + (inApp ? ')' : '');
// посилання, якими діляться з застосунку, ведуть на сайт: у кого застосунку немає, відкриє гру в браузері
export const SITE_URL = 'https://trofeini.vn.ua/';
// куди Supabase повертає після входу через Google: Android відкриє цю адресу в застосунку
export const AUTH_REDIRECT = 'ua.vn.trofeini://auth';

const bridge = () => (inApp ? globalThis.TrofeiniAndroid : null);
export const available = () => typeof bridge()?.postMessage === 'function';

// повідомлення рідній частині: {t: 'ready' | 'awake' | 'vibrate' | 'share' | 'copy' | 'open', ...}
export function send(msg) {
  if (!available()) return false;
  try { bridge().postMessage(JSON.stringify(msg)); return true; } catch { return false; }
}

// обробники, які викликає рідна частина: back() - кнопка «Назад» (true - гра закрила своє вікно),
// run(дія) - ярлик значка, коли гра вже відкрита
export function handle(handlers) {
  globalThis.__trofeini = { ...(globalThis.__trofeini || {}), ...handlers };
}

// --- перевірка віку Google Play (Play Age Signals) ----------------------------------------------
// Рідна частина питає Google Play лише там, де закон вимагає від магазину передавати вік (окремі штати США,
// з 2027 - Бразилія). Відповідь: {mode: 'full'} - усе як завжди; {mode: 'local', reason} - вхід в акаунт
// і онлайн вимкнені, гра з машиною й удвох працює (reason: 'child' - до 13 років, 'verify' - вік не
// підтверджено в Google Play, 'parent' - чекає дозволу батьків, 'retry' - не вдалося перевірити).
// Поза застосунком перевірки немає. Сам вік гра не зберігає і нікуди не передає.
let ageNow = available() ? null : { mode: 'full' };
const ageWaiters = [], ageListeners = [];
function setAge(d) {
  const next = d?.mode === 'local' ? { mode: 'local', reason: String(d.reason || 'verify') } : { mode: 'full' };
  ageNow = next;
  ageWaiters.splice(0).forEach((f) => f(next));
  ageListeners.forEach((f) => { try { f(next); } catch { /* слухач зламався */ } });
}
// рішення до старту сервера гри; якщо рідна частина мовчить (не має статися) - не блокуємо гру назавжди
export function ageDecision({ timeout = 15000 } = {}) {
  if (ageNow) return Promise.resolve(ageNow);
  return new Promise((resolve) => {
    ageWaiters.push(resolve);
    setTimeout(() => resolve(ageNow ?? { mode: 'full', late: true }), timeout);
  });
}
// пізня відповідь (після тайм-ауту) теж має подіяти
export function onAge(fn) { ageListeners.push(fn); }
if (!ageNow) {
  globalThis.__trofeini = { ...(globalThis.__trofeini || {}), age: setAge };
  send({ t: 'age' });
}

// файл (картинка партії, вивантажені дані) → data: URL для передачі в рідне меню «Поділитися»
export function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// системне меню «Поділитися» Android: текст і, за бажання, файл
export async function share({ text, blob = null, name = 'trofeini-shahy.png' }) {
  let file = '';
  if (blob) { try { file = await toDataUrl(blob); } catch { file = ''; } }
  return send({ t: 'share', text, file, name });
}
