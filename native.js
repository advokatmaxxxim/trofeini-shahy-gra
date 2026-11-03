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
