// Підказка «встановити на телефон». Android (Chrome) дає власне вікно встановлення,
// iPhone - ні, тому там показуємо, де в Safari ця кнопка.
const KEY = 'tsh:install-hidden';
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const hidden = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

function banner(html, onAction) {
  if (standalone || hidden() || document.getElementById('install')) return;
  const el = document.createElement('div');
  el.className = 'hint'; el.id = 'install';
  el.innerHTML = `<p>${html}</p><button type="button" aria-label="Сховати">×</button>`;
  el.querySelector('button[aria-label]').onclick = () => { el.remove(); try { localStorage.setItem(KEY, '1'); } catch { /* немає сховища */ } };
  if (onAction) el.querySelector('[data-install]').onclick = onAction;
  const anchor = document.getElementById('hint');
  anchor.parentNode.insertBefore(el, anchor);
}

let deferred = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  banner('Встановіть гру на телефон – вона з’явиться серед застосунків і працюватиме без браузера. <button type="button" class="btn primary" data-install style="margin-top:8px">Встановити</button>', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    document.getElementById('install')?.remove();
  });
});
addEventListener('appinstalled', () => document.getElementById('install')?.remove());

const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (ios && !standalone) {
  banner('Щоб встановити гру на iPhone: у Safari натисніть кнопку «Поділитися» (квадрат зі стрілкою вгору), далі «На початковий екран».');
}
