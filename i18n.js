// Мова гри. Сторінка одна на мову: index.html - українська (основна), en/index.html - англійська
// (її будує web/build-site.mjs з того самого index.html за словником web/lang-en.js). Тож мову визначає
// <html lang>, а не браузер: перемикач мови - це перехід на іншу сторінку.
//
// Тексти в коді пишуться українською і проходять через tr(): в англійській версії їх замінює словник.
// Параметри - у фігурних дужках: tr('Хід {n} з {total}', {n, total}). Чого в словнику немає, лишається
// українським (тест test/i18n.mjs перевіряє, що в словнику є кожен текст із коду).
import EN from './lang-en.js?v=ba671da91a1f';

export const lang = globalThis.document?.documentElement?.lang === 'en' ? 'en' : 'uk';
export const en = lang === 'en';
// для дат і чисел
export const LOCALE = en ? 'en-GB' : 'uk-UA';

export function tr(s, params) {
  let t = en ? (EN[s] ?? s) : s;
  if (params) t = t.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return t;
}

// множина: українська - три форми (1 хід, 2 ходи, 5 ходів), англійська - дві (1 move, 2 moves)
export function plural(n, [one, few, many], [enOne, enMany] = []) {
  if (en) return n === 1 ? enOne : enMany;
  const t = n % 10, h = n % 100;
  return t === 1 && h !== 11 ? one : t >= 2 && t <= 4 && (h < 12 || h > 14) ? few : many;
}

// перша літера велика (причини завершення партії зберігаються з малої)
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// адреса сторінки іншою мовою; англійська сторінка має <base href="../">, тож відносні адреси на обох -
// від кореня: './' - українська, 'en/' - англійська
export const otherLangHref = () => (en ? './' : 'en/');
