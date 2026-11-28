// Підказка «встановити на телефон». На Android гра є в Google Play - туди й ведемо (там застосунок
// з усім рідним: «Назад», ярлики, вібрація). Комп’ютер (Chrome, Edge) дає власне вікно встановлення сайту;
// iPhone - ні, тому там показуємо, де в Safari ця кнопка.
import { tr, en } from './i18n.js?v=ba671da91a1f';

const KEY = 'tsh:install-hidden';
const PLAY_KEY = 'tsh:play-hidden';
// сторінка в Google Play - мовою сайту (hl): без нього Play показує мову акаунта Google чи браузера
const PLAY = 'https://play.google.com/store/apps/details?id=ua.vn.trofeini&hl=' + (en ? 'en' : 'uk');
const android = /android/i.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const hidden = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// Підказка прикріплена до низу екрана поверх сторінки: поки вона показана, сторінка має знизу запас на її висоту
// (--install-h), щоб запис ходів і кнопки під нею можна було прокрутити над нею
const room = () => {
  const el = document.getElementById('install');
  document.documentElement.style.setProperty('--install-h', el ? el.offsetHeight + 'px' : '0px');
};
function dropBanner() { document.getElementById('install')?.remove(); room(); }
addEventListener('resize', room);

function banner(html, onAction, key = KEY) {
  const off = () => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
  if ((standalone && key === KEY) || off() || document.getElementById('install')) return;
  const el = document.createElement('div');
  el.className = 'hint'; el.id = 'install';
  el.innerHTML = `<p>${html}</p><button type="button" aria-label="${tr('Сховати')}">×</button>`;
  el.querySelector('button[aria-label]').onclick = () => { dropBanner(); try { localStorage.setItem(key, '1'); } catch { /* немає сховища */ } };
  if (onAction) el.querySelector('[data-install]').onclick = onAction;
  const anchor = document.getElementById('hint');
  anchor.parentNode.insertBefore(el, anchor);
  room();
  el.querySelector('img')?.addEventListener('load', room);
}

// --- мова: підказка перейти на іншу мовну версію (перехід за мовою браузера - у <head> української сторінки) ---
// На українській сторінці - «Switch to English?», якщо серед мов браузера немає української (сюди потрапляє той,
// хто сам обрав українську); на англійській - «Перейти на українську?», якщо українська в браузері є (наприклад,
// відкрили англійське запрошення від друга). Хрестик ховає підказку на цьому пристрої. Ручний вибір мови
// (підказкою чи перемикачем унизу) запам’ятовуємо: він важливіший за мову браузера.
const LANG_KEY = 'tsh:lang';
const saveLang = (l) => { try { localStorage.setItem(LANG_KEY, l); } catch { /* немає сховища */ } };
const savedLang = (() => { try { return localStorage.getItem(LANG_KEY); } catch { return null; } })();
const browserUk = (navigator.languages?.length ? navigator.languages : [navigator.language || '']).some((l) => /^uk\b/i.test(l));
document.querySelector('.credit .lang')?.addEventListener('click', () => saveLang(en ? 'uk' : 'en'));
if (en ? browserUk || savedLang === 'uk' : !browserUk) {
  // запрошення (?g=) чи партія (?r=) відкриваються й іншою мовою. Гра прибирає їх з адреси одразу після старту,
  // тож беремо первинну адресу сторінки; службових параметрів (вхід через Google тощо) не переносимо
  const first = new URL(performance.getEntriesByType?.('navigation')?.[0]?.name || location.href);
  const kept = new URLSearchParams([...first.searchParams].filter(([k]) => k === 'g' || k === 'r'));
  const keep = kept.toString() ? '?' + kept : '';
  banner(en
    ? `<span lang="uk">Перейти на українську? <a class="lang-go" href="./${keep}" hreflang="uk">Українська версія</a></span>`
    : `<span lang="en">Switch to English? <a class="lang-go" href="en/${keep}" hreflang="en">English version</a></span>`, null, 'tsh:lang-hint-' + (en ? 'en' : 'uk'));
  document.querySelector('#install .lang-go')?.addEventListener('click', () => saveLang(en ? 'uk' : 'en'));
}

// Android: замість встановлення сайту - застосунок з Google Play (і для тих, хто вже встановив сайт)
if (android) {
  banner(`${tr('Гра є в Google Play – встановіть застосунок для Android.')}<a class="play-badge" href="${PLAY}" target="_blank" rel="noopener"><img src="${en ? 'google-play-badge-en.png' : 'google-play-badge.png'}" alt="${tr('Завантажити з Google Play')}" width="155" height="60"></a>`, null, PLAY_KEY);
}
// посилання на Google Play внизу сторінки - на будь-якому пристрої; у другому рядку (з фігурами), бо перший
// (документи) на телефоні вже заповнений, а зайвий рядок змусив би гортати сторінку
const credit = document.querySelector('.credit');
if (credit) {
  const a = Object.assign(document.createElement('a'), { href: PLAY, target: '_blank', rel: 'noopener', textContent: 'Google Play' });
  const lang = credit.querySelector('.lang');
  if (lang) credit.insertBefore(a, lang).after(' · '); else credit.append(' · ', a);
}

let deferred = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (android) return;              // на Android пропонуємо Google Play, а не встановлення сайту
  deferred = e;
  banner(`${tr('Встановіть гру на цей пристрій – вона з’явиться серед ваших застосунків і відкриватиметься без браузера.')} <button type="button" class="btn primary" data-install style="margin-top:8px">${tr('Встановити')}</button>`, async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    dropBanner();
  });
});
addEventListener('appinstalled', dropBanner);

const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (ios && !standalone) {
  banner(tr('Щоб встановити гру на iPhone: у Safari натисніть кнопку «Поділитися» (квадрат зі стрілкою вгору), далі «На початковий екран».'));
}
