// Поділитися партією: картинка з фінальною позицією і посилання, за яким друг побачить усю партію
// хід за ходом (?r=...). Партія вміщується в саме посилання - сервер для цього не потрібен.
//
// Формат r: версія + правила (t - трофейні, c - класичні) + результат (w/b/d) + причина (одна літера)
// + хто знизу на дошці (w/b) + ходи.
//   версія 2: хід - 2 знаки base64url (поле звідки і куди); якщо з тих самих полів можливі кілька ходів
//             (хід зарядом чи звичайний, перетворення пішака), після них «~» і знак з номером варіанта
//             серед таких ходів у порядку, в якому їх видає ядро правил;
//   версія 1: хід - 4 знаки (повний упакований хід, як в архіві) - такі посилання теж відкриваються.
import { Position, rulesOf } from './core.js?v=a58ed1eed0b8';
import * as native from './native.js?v=a58ed1eed0b8';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const REASONS = {
  m: 'мат', p: 'пат', t: 'час вийшов', s: 'здача', a: 'нічия за згодою', f: 'правило 50 ходів',
  r: 'трикратне повторення позиції', k: 'час вийшов, але в суперника лишився сам король',
};
const REASON_CODE = Object.fromEntries(Object.entries(REASONS).map(([k, v]) => [v, k]));
const MAX_PLIES = 600;
const pack = (m) => m.from | (m.to << 6) | (m.promo << 12) | (m.tk << 15) | (m.flag << 18);
const unpackMove = (x) => ({ from: x & 63, to: (x >> 6) & 63, promo: (x >> 12) & 7, tk: (x >> 15) & 7 });
const RULES = (r) => (r === 'classical' ? 'classical' : 'trofei-simple-r10');

export function encodeGame({ rules, result, reason, moves, bottom }) {
  let s = '2' + (rules === 'classical' ? 'c' : 't') + ({ white: 'w', black: 'b', draw: 'd' }[result] ?? 'd')
    + (REASON_CODE[reason] ?? 'x') + (bottom === 'b' ? 'b' : 'w');
  const p = Position.start(rulesOf(RULES(rules)));
  for (const x of moves.slice(0, MAX_PLIES)) {
    const u = unpackMove(x);
    const same = p.generate().filter((m) => m.from === u.from && m.to === u.to);
    const i = same.findIndex((m) => m.promo === u.promo && m.tk === u.tk);
    if (i < 0) break;                                   // нелегальний хід - далі не кодуємо
    s += B64[u.from] + B64[u.to] + (same.length > 1 ? '~' + B64[i] : '');
    p.make(same[i]);
  }
  return s;
}

// повертає запис партії (ходи - упаковані числа, як в архіві) або null
export function decodeGame(s) {
  if (typeof s !== 'string' || s.length > 5 + MAX_PLIES * 4) return null;
  let moves = [];
  if (/^1[tc][wbd][a-z][wb]([A-Za-z0-9_-]{4})*$/.test(s)) {
    for (let i = 5; i < s.length; i += 4) {
      let x = 0;
      for (let j = 0; j < 4; j++) x = (x << 6) | B64.indexOf(s[i + j]);
      moves.push(x);
    }
  } else if (/^2[tc][wbd][a-z][wb]([A-Za-z0-9_-]{2}(~[A-Za-z0-9_-])?)*$/.test(s)) {
    const p = Position.start(rulesOf(RULES(s[1] === 'c' ? 'classical' : '')));
    for (let i = 5; i < s.length;) {
      const from = B64.indexOf(s[i]), to = B64.indexOf(s[i + 1]);
      let k = 0;
      i += 2;
      if (s[i] === '~') { k = B64.indexOf(s[i + 1]); i += 2; }
      const m = p.generate().filter((x) => x.from === from && x.to === to)[k];
      if (!m) break;
      moves.push(pack(m)); p.make(m);
    }
  } else return null;
  if (moves.length < 1) return null;
  return {
    rules: s[1] === 'c' ? 'classical' : 'trofei-simple-r10',
    result: { w: 'white', b: 'black', d: 'draw' }[s[2]],
    reason: REASONS[s[3]] ?? 'партію завершено',
    bottom: s[4],
    moves,
  };
}

// --- картинка --------------------------------------------------------------------------
// Фігури беремо з тих самих CSS-класів, що й на дошці (SVG, вбудовані в index.html), тож картинка
// виглядає точно як гра. Розмір 1080×1320 - добре виглядає в Telegram, Viber і WhatsApp.
const W = 1080, PAD = 60, BOARD = W - PAD * 2, TOP = 210, H = TOP + BOARD + 150;

function cssUrl(html) {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:40px;height:40px';
  host.innerHTML = html;
  document.body.appendChild(host);
  const el = host.querySelector('.pc');
  const bg = getComputedStyle(el).backgroundImage;
  host.remove();
  const m = bg.match(/^url\("?(.*?)"?\)$/);
  return m ? m[1] : null;
}
const imgCache = new Map();
function loadImage(src) {
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }));
  }
  return imgCache.get(src);
}
const pieceSrc = (cls) => cssUrl(`<span class="${cls}"></span>`);
const badgeSrc = (cls) => cssUrl(`<span class="badge"><span class="${cls}"></span></span>`);

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// frame: {pos, last} - фінальна позиція; letters: класи фігур за типом (як PIECE_LETTER у app.js)
export async function renderCard({ frame, flip, title, subtitle, tagline, letters, colorOf, typeOf, white }) {
  const css = getComputedStyle(document.documentElement);
  const v = (name, d) => css.getPropertyValue(name).trim() || d;
  const font = v('--f-brand', 'sans-serif');
  try { await Promise.race([document.fonts.load(`800 60px ${font}`), new Promise((r) => setTimeout(r, 1500))]); } catch { /* без шрифту - системний */ }

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = v('--bg', '#302e2b'); g.fillRect(0, 0, W, H);

  // заголовок
  g.fillStyle = '#ffffff'; g.textBaseline = 'alphabetic';
  g.font = `800 64px ${font}`;
  const tl = wrapText(g, title, W - PAD * 2).slice(0, 2);
  const tSize = tl.length > 1 ? 52 : 64;
  g.font = `800 ${tSize}px ${font}`;
  tl.forEach((line, i) => g.fillText(line, PAD, 92 + i * (tSize + 6) - (tl.length > 1 ? 22 : 0)));
  g.fillStyle = v('--ink-soft', '#bab9b8'); g.font = `500 34px ${font}`;
  // підзаголовок - в один рядок: якщо задовгий, зменшуємо шрифт, а в крайньому разі обрізаємо з «…»
  let sub = subtitle, size = 34;
  const fit = () => { g.font = `500 ${size}px ${font}`; return g.measureText(sub).width <= W - PAD * 2; };
  while (!fit() && size > 26) size -= 2;
  while (!fit() && sub.length > 10) sub = sub.slice(0, -2).trimEnd() + '…';
  g.fillText(sub, PAD, 172);

  // дошка
  const sq = BOARD / 8, light = v('--sq-light', '#eeeed2'), dark = v('--sq-dark', '#769656'), hl = v('--last-to', 'rgba(255,255,51,.5)');
  const pos = frame.pos;
  const at = (s) => { const f = s & 7, r = s >> 3; return flip ? [PAD + (7 - f) * sq, TOP + r * sq] : [PAD + f * sq, TOP + (7 - r) * sq]; };
  const jobs = [];
  for (let s = 0; s < 64; s++) {
    const [x, y] = at(s);
    g.fillStyle = ((s >> 3) + (s & 7)) % 2 === 0 ? dark : light;
    g.fillRect(x, y, sq, sq);
    if (frame.last && (frame.last.from === s || frame.last.to === s)) { g.fillStyle = hl; g.fillRect(x, y, sq, sq); }
    const pc = pos.board[s];
    // король під шахом (і матом) - червона підсвітка, як на дошці
    if (pc && typeOf(pc) === 6 && colorOf(pc) === pos.side && pos.inCheck()) { g.fillStyle = 'rgba(220,50,40,.6)'; g.fillRect(x, y, sq, sq); }
    if (pc) jobs.push({ s, x, y, pc, charge: pos.t1[s] });
  }
  for (const j of jobs) {
    const cls = `pc ${colorOf(j.pc) === white ? 'w' : 'b'} ${letters[typeOf(j.pc)]}`;
    const im = await loadImage(pieceSrc(cls));
    if (!j.charge) { g.drawImage(im, j.x + sq * 0.05, j.y + sq * 0.05, sq * 0.9, sq * 0.9); continue; }
    // фігура із зарядом - як на дошці: менша, в лівому нижньому куті, із золотим сяйвом, і значок угорі праворуч
    g.save(); g.shadowColor = 'rgba(230,180,60,.95)'; g.shadowBlur = sq * 0.09;
    g.drawImage(im, j.x + sq * 0.04, j.y + sq * (1 - 0.04 - 0.67), sq * 0.67, sq * 0.67);
    g.restore();
    const d = sq * 0.39, cx = j.x + sq - sq * 0.02 - d / 2, cy = j.y + sq * 0.02 + d / 2;
    g.beginPath(); g.arc(cx, cy, d / 2 + sq * 0.025, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
    g.beginPath(); g.arc(cx, cy, d / 2, 0, Math.PI * 2); g.fillStyle = v('--gold', '#e6b43c'); g.fill();
    const bi = await loadImage(badgeSrc(`pc b ${letters[j.charge]}`));
    g.drawImage(bi, cx - d * 0.39, cy - d * 0.39, d * 0.78, d * 0.78);
  }

  // підпис унизу: значок гри, назва, адреса
  const fy = TOP + BOARD + 92;
  // значок гри малюємо сам - той самий, що в шапці: білий кінь на зеленому з золотим значком
  const lx = PAD, ly = fy - 58, ls = 76;
  g.fillStyle = v('--accent', '#81b64c');
  g.beginPath(); g.roundRect ? g.roundRect(lx, ly, ls, ls, 14) : g.rect(lx, ly, ls, ls); g.fill();
  g.drawImage(await loadImage(pieceSrc(`pc w ${letters[2]}`)), lx + 6, ly + 8, ls - 12, ls - 12);
  g.beginPath(); g.arc(lx + ls - 10, ly + 10, 11, 0, Math.PI * 2); g.fillStyle = v('--gold', '#e6b43c'); g.fill();
  g.fillStyle = '#ffffff'; g.font = `800 40px ${font}`;
  g.fillText('Трофейні шахи', PAD + 96, fy - 14);
  g.fillStyle = v('--ink-soft', '#bab9b8'); g.font = `500 26px ${font}`;
  g.fillText(tagline, PAD + 96, fy + 20);
  g.fillStyle = v('--gold-ink', '#f0c860'); g.font = `800 34px ${font}`; g.textAlign = 'right';
  g.fillText('trofeini.vn.ua', W - PAD, fy - 14);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// Поділитися: на телефоні - системне меню з картинкою (Telegram, Viber, WhatsApp...); де файли не
// підтримуються - лише текст із посиланням; інакше картинка завантажується, а текст копіюється.
// Повертає текст для гравця або null, якщо меню відкрилося.
export async function shareCard({ blob, text, url }) {
  const file = blob ? new File([blob], 'trofeini-shahy.png', { type: 'image/png' }) : null;
  const full = `${text} ${url}`;
  // Android-застосунок: системне меню «Поділитися» з картинкою (у WebView меню браузера немає)
  if (native.inApp && await native.share({ text: full, blob })) return null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: full }); return null; }
    if (navigator.share) { await navigator.share({ text, url }); return null; }
  } catch (e) {
    if (e?.name === 'AbortError') return null;      // гравець закрив меню
  }
  if (blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'trofeini-shahy.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  try { await navigator.clipboard.writeText(full); return 'Картинку збережено, а текст із посиланням скопійовано – вставте його в месенджер.'; } catch { return 'Картинку збережено. Посилання на партію: ' + url; }
}
