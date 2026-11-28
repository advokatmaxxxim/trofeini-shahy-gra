// «Поділитися в соцмережах»: під кожну мережу - свій матеріал з тієї самої партії.
//   відео 9:16 (TikTok, Reels, Shorts) - найефектніший момент партії: гачок угорі, швидкий повтор,
//     уповільнення на ключовому ході з ромбиками ходів зарядом, «Мат!», заклик trofeini.vn.ua; без музики -
//     популярний звук гравець додає в самій мережі (так більше охоплення і жодних питань авторського права);
//   сторіс 9:16 (Instagram, Facebook), допис 4:5 (Instagram, Facebook, LinkedIn, Threads), допис 16:9 (X);
//   текст допису під мережу: хештеги, посилання на партію хід за ходом (?r=...) там, де воно клікабельне.
// Відео кодується на самому пристрої: WebCodecs (H.264) + mp4-muxer у MP4; де WebCodecs немає - MediaRecorder
// (MP4 або WebM) у реальному часі; де немає й того - лише картинки. Модуль вантажиться, лише коли потрібен.
import { tr, en, cap } from './i18n.js?v=ba671da91a1f';
import * as native from './native.js?v=ba671da91a1f';
import { CARD_NAME, saveImage, loadImage, pieceSrc, badgeSrc, wrapText } from './share.js?v=ba671da91a1f';

const BASE = CARD_NAME.replace(/\.png$/, '');
const VAL = [0, 1, 3, 3, 5, 9, 0];
const FPS = 30;
const SITE_NAME = 'trofeini.vn.ua';

// --- мережі ------------------------------------------------------------------------------
// formats: video (9:16, рух), story (9:16), feed (4:5), wide (16:9) - у порядку охоплення: перший формат
// рекомендований (Reels і Shorts мережа показує й тим, хто не підписаний; сторіс - лише підписникам 24 години,
// зате з наліпкою-посиланням; допис лишається в профілі). upload - куди на ПК завантажити файл;
// intent - сторінка нового допису з уже вписаним текстом (там, де мережа таке дає); pkg і app - застосунок мережі
// на Android і адреса, яку він відкриває (браузер на Android відкриває його посиланням intent://).
const NETS = [
  { id: 'tiktok', name: 'TikTok', formats: ['video'], upload: 'https://www.tiktok.com/upload', pkg: 'com.zhiliaoapp.musically', app: 'https://www.tiktok.com/' },
  { id: 'instagram', name: 'Instagram', formats: ['video', 'story', 'feed'], upload: 'https://www.instagram.com/', pkg: 'com.instagram.android', app: 'https://www.instagram.com/' },
  { id: 'facebook', name: 'Facebook', formats: ['video', 'feed', 'story'], upload: 'https://www.facebook.com/', pkg: 'com.facebook.katana', app: 'https://www.facebook.com/' },
  { id: 'youtube', name: 'YouTube', formats: ['video'], upload: 'https://www.youtube.com/upload', pkg: 'com.google.android.youtube', app: 'https://www.youtube.com/' },
  { id: 'x', name: 'X', formats: ['wide', 'video'], intent: (text, url) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` },
  { id: 'linkedin', name: 'LinkedIn', formats: ['feed', 'video'], intent: (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}` },
  { id: 'threads', name: 'Threads', formats: ['feed', 'video'], intent: (text) => `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}` },
];
const NET = Object.fromEntries(NETS.map((n) => [n.id, n]));
// Браузер на Android: файл конкретному застосунку передати не можна (це вміє лише системне меню), тому файл
// зберігається, а застосунок мережі відкривається - лишається натиснути «+» і вибрати збережене. Без запасної
// адреси: немає застосунку - Android відкриє його сторінку в Google Play, а гра лишається відкритою.
const isAndroid = () => /Android/i.test(navigator.userAgent);
function appLink(net, text, url) {
  if (net.intent) return net.intent(intentText(net.id, text, url), url);      // новий допис з текстом (X, LinkedIn, Threads)
  const u = new URL(net.app);
  return `intent://${u.host}${u.pathname}#Intent;scheme=https;package=${net.pkg};end`;
}
const fmtLabel = (net, f) => (f === 'video' ? ({ instagram: 'Reels', facebook: 'Reels', youtube: 'Shorts' }[net] ?? tr('Відео')) : f === 'story' ? tr('Сторіс') : tr('Допис'));
const FILE = { video: '', story: '-story', feed: '-post', wide: '-x' };

// --- найефектніший момент партії -----------------------------------------------------------
// Бали ходу: мат (ще більше - мат зарядом), шах зарядом, взяття (дорожча фігура - більше; зарядом - ще більше;
// менша фігура бере більшу - окремий бонус), отриманий заряд. Гачок - речення про найкращий хід.
export function analyse(g) {
  const { frames, typeOf, colorOf } = g;
  const N = frames.length - 1;
  const ev = [null];
  for (let i = 1; i <= N; i++) {
    const b = frames[i - 1].pos, a = frames[i].pos, { from, to } = frames[i].last;
    const mp = b.board[from], mover = typeOf(mp), tk = frames[i].tk || 0, san = frames[i].san;
    let victim = b.board[to] ? typeOf(b.board[to]) : 0;
    if (!victim && mover === 1 && !tk && (from & 7) !== (to & 7)) victim = 1;     // взяття на проході
    const mate = san.endsWith('#'), check = mate || san.endsWith('+');
    const granted = !!victim && !!a.t1[to] && (!!tk || !b.t1[from]);
    let s = 0;
    if (mate) s += 100 + (tk ? 40 : 0);
    else if (check && tk) s += 22;
    if (victim) {
      s += VAL[victim] * 3;
      if (tk) s += 14 + VAL[victim] * 3;
      if (mover !== 6 && VAL[victim] > VAL[mover] + 1) s += 10 + (VAL[victim] - VAL[mover]) * 2;
    }
    if (granted) s += 3;
    ev.push({ i, from, to, mover, color: colorOf(mp), victim, tk, mate, check, granted, kind: granted ? a.t1[to] : 0, s });
  }
  // ключові ходи (1-2): мат зарядом - головний; звичайний мат - головний, якщо раніше не було чогось яскравого
  // (тоді яскравий хід - гачок, а мат - другий уповільнений момент)
  let best = 0;
  for (let i = 1; i <= N; i++) if (ev[i].s > 0 && ev[i].s >= (ev[best]?.s ?? 0)) best = i;
  const last = ev[N];
  let hl = [];
  if (last?.mate) {
    let alt = 0;
    for (let i = 1; i < N; i++) if (ev[i].s >= 45 && ev[i].s >= (ev[alt]?.s ?? 0)) alt = i;
    hl = !last.tk && alt ? [alt, N] : [N];
  } else if (best && ev[best].s >= 12) hl = [best];          // «кінь узяв пішака» - не привід для гачка
  const hook = hl.length ? hookOf(ev[hl[0]], g) : g.title;
  return { N, ev, hl, hook };
}

function hookOf(e, g) {
  const fem = !!g.FEM[e.mover];
  const mover = en ? g.NOM[e.mover] : cap(g.NOM[e.mover]);
  const v = { mover, victim: g.ACC[e.victim], tk: g.TRO_GEN[e.tk], n: Math.ceil(e.i / 2) };
  if (e.mate && e.tk) return (fem ? tr('{mover} дала мат ходом {tk}!', v) : tr('{mover} дав мат ходом {tk}!', v));
  if (e.mate) return tr('Мат на {n}-му ході!', v);
  if (e.victim && e.tk) return (fem ? tr('{mover} узяла {victim} ходом {tk}!', v) : tr('{mover} узяв {victim} ходом {tk}!', v));
  if (e.check && e.tk) return (fem ? tr('{mover} дала шах ходом {tk}!', v) : tr('{mover} дав шах ходом {tk}!', v));
  if (e.victim) return (fem ? tr('{mover} узяла {victim}!', v) : tr('{mover} узяв {victim}!', v));
  return g.title;
}

// --- тексти дописів ------------------------------------------------------------------------
const TAGS = () => (en ? '#chess #chesstok #chessvariant #trophychess' : '#шахи #chess #трофейнішахи #chesstok');
export function captionFor(netId, g, hook) {
  const url = g.url;
  switch (netId) {
    case 'tiktok':
    case 'instagram':
      return tr('{hook} Трофейні шахи: фігура, що бере, отримує хід узятої. Грай безкоштовно – trofeini.vn.ua', { hook }) + ' ' + TAGS();
    case 'facebook':
      return tr('{hook} Подивіться партію хід за ходом: {url} Трофейні шахи – фігура, що бере, отримує хід узятої.', { hook, url });
    case 'youtube':
      return tr('{hook} Трофейні шахи #Shorts', { hook }) + ' ' + TAGS() + '\n' + tr('Партія хід за ходом: {url}', { url });
    case 'linkedin':
      return [hook, tr('Трофейні шахи – варіант шахів, де фігура, що бере, отримує один хід узятої фігури. Безкоштовна гра в браузері та в Google Play, без реклами.'),
        tr('Партія хід за ходом: {url}', { url }), en ? '#chess #gamedev #indiegame' : '#шахи #chess #gamedev'].join('\n\n');
    default:                                      // x, threads: коротко
      return tr('{hook} Подивіться партію хід за ходом:', { hook }) + ' ' + url + ' ' + (en ? '#chess' : '#шахи #chess');
  }
}
// X сам додає посилання з параметра url - у тексті його не дублюємо
const intentText = (netId, text, url) => (netId === 'x' ? text.replace(' ' + url, '') : text);

// --- графіка -------------------------------------------------------------------------------
const ARTS = new Map();
async function prepare(g, sq) {
  const key = Math.round(sq * 100);
  if (ARTS.has(key)) return ARTS.get(key);
  const job = (async () => {
    const css = getComputedStyle(document.documentElement);
    const v = (name, d) => css.getPropertyValue(name).trim() || d;
    const font = v('--f-brand', 'sans-serif');
    try { await Promise.race([document.fonts.load(`800 60px ${font}`), new Promise((r) => setTimeout(r, 1500))]); } catch { /* системний шрифт */ }
    const raster = async (src, size) => {
      const im = await loadImage(src);
      const c = document.createElement('canvas');
      c.width = c.height = Math.max(1, Math.round(size));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return c;
    };
    const A = {
      v, font, sq,
      light: v('--sq-light', '#eeeed2'), dark: v('--sq-dark', '#769656'), hl: v('--last-to', 'rgba(255,255,51,.5)'),
      gold: v('--gold', '#e6b43c'), goldInk: v('--gold-ink', '#f0c860'), bg: v('--bg', '#302e2b'), soft: v('--ink-soft', '#bab9b8'), accent: v('--accent', '#81b64c'),
      full: {}, small: {}, badge: {}, logo: await raster(pieceSrc(`pc w ${g.letters[2]}`), 64),
    };
    for (const col of ['w', 'b']) {
      for (let t = 1; t <= 6; t++) {
        const src = pieceSrc(`pc ${col} ${g.letters[t]}`);
        A.full[col + t] = await raster(src, sq * 0.9);
        A.small[col + t] = await raster(src, sq * 0.67);
      }
    }
    for (let t = 1; t <= 5; t++) A.badge[t] = await raster(badgeSrc(`pc b ${g.letters[t]}`), sq * 0.39 * 0.78);
    return A;
  })();
  ARTS.set(key, job);
  job.catch(() => ARTS.delete(key));
  return job;
}

function drawPiece(c, A, g, pc, charge, x, y, sq, alpha = 1) {
  const col = g.colorOf(pc) === g.white ? 'w' : 'b', t = g.typeOf(pc);
  if (alpha < 1) { c.save(); c.globalAlpha = Math.max(0, alpha); }
  if (!charge) c.drawImage(A.full[col + t], x + sq * 0.05, y + sq * 0.05, sq * 0.9, sq * 0.9);
  else {
    // фігура із зарядом - як на дошці: менша, в лівому нижньому куті, із золотим сяйвом, і значок угорі праворуч
    c.save(); c.shadowColor = 'rgba(230,180,60,.95)'; c.shadowBlur = sq * 0.09;
    c.drawImage(A.small[col + t], x + sq * 0.04, y + sq * (1 - 0.04 - 0.67), sq * 0.67, sq * 0.67);
    c.restore();
    const d = sq * 0.39, cx = x + sq - sq * 0.02 - d / 2, cy = y + sq * 0.02 + d / 2;
    c.beginPath(); c.arc(cx, cy, d / 2 + sq * 0.025, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
    c.beginPath(); c.arc(cx, cy, d / 2, 0, Math.PI * 2); c.fillStyle = A.gold; c.fill();
    c.drawImage(A.badge[charge], cx - d * 0.39, cy - d * 0.39, d * 0.78, d * 0.78);
  }
  if (alpha < 1) c.restore();
}

const kingSq = (g, pos) => {
  if (!pos.inCheck()) return -1;
  for (let s = 0; s < 64; s++) { const pc = pos.board[s]; if (pc && g.typeOf(pc) === 6 && g.colorOf(pc) === pos.side) return s; }
  return -1;
};

// st: {x, y, size, flip, pos, last, check (поле короля під шахом), hide (поле, з якого фігура зараз їде),
//      fade: {sq, alpha}, move: {pc, charge, from, to, u}, marks: [{sq, cap}], ring: {sq, u}, arrow: {from, to}}
function drawBoard(c, A, g, st) {
  const { x, y, size, flip, pos } = st, sq = size / 8;
  const at = (s) => { const f = s & 7, r = s >> 3; return flip ? [x + (7 - f) * sq, y + r * sq] : [x + f * sq, y + (7 - r) * sq]; };
  for (let s = 0; s < 64; s++) {
    const [px, py] = at(s);
    c.fillStyle = ((s >> 3) + (s & 7)) % 2 === 0 ? A.dark : A.light;
    c.fillRect(px, py, sq, sq);
    if (st.last && (st.last.from === s || st.last.to === s)) { c.fillStyle = A.hl; c.fillRect(px, py, sq, sq); }
    if (st.check === s) { c.fillStyle = 'rgba(220,50,40,.6)'; c.fillRect(px, py, sq, sq); }
  }
  if (st.arrow) {
    // стрілка під фігурами - значок заряду лишається видно
    const [ax, ay] = at(st.arrow.from), [bx, by] = at(st.arrow.to);
    const x1 = ax + sq / 2, y1 = ay + sq / 2, x2 = bx + sq / 2, y2 = by + sq / 2, len = Math.hypot(x2 - x1, y2 - y1);
    if (len > 1) {
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len, ex = x2 - ux * sq * 0.2, ey = y2 - uy * sq * 0.2, hw = sq * 0.22, hb = sq * 0.38;
      c.save(); c.fillStyle = 'rgba(255,170,0,.78)'; c.strokeStyle = 'rgba(255,170,0,.78)'; c.lineWidth = sq * 0.16; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(ex - ux * hb * 0.8, ey - uy * hb * 0.8); c.stroke();
      c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - ux * hb - uy * hw, ey - uy * hb + ux * hw); c.lineTo(ex - ux * hb + uy * hw, ey - uy * hb - ux * hw); c.closePath(); c.fill();
      c.restore();
    }
  }
  for (let s = 0; s < 64; s++) {
    const pc = pos.board[s];
    if (!pc || s === st.hide) continue;
    const [px, py] = at(s);
    drawPiece(c, A, g, pc, pos.t1[s], px, py, sq, st.fade?.sq === s ? st.fade.alpha : 1);
  }
  for (const m of st.marks || []) {
    const [px, py] = at(m.sq), cx = px + sq / 2, cy = py + sq / 2;
    c.save();
    if (m.dot) { c.fillStyle = 'rgba(255,255,255,.55)'; c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = sq * 0.03; c.beginPath(); c.arc(cx, cy, sq * 0.17, 0, Math.PI * 2); c.fill(); c.stroke(); }
    else if (m.cap) { c.strokeStyle = A.gold; c.lineWidth = sq * 0.08; c.beginPath(); c.arc(cx, cy, sq * 0.4, 0, Math.PI * 2); c.stroke(); }
    else {
      // ромбик ходу зарядом, як на дошці гри
      const r = sq * 0.21;
      c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy); c.closePath();
      c.lineWidth = sq * 0.05; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke(); c.fillStyle = A.gold; c.fill();
    }
    c.restore();
  }
  if (st.move) {
    const m = st.move, [fx, fy] = at(m.from), [tx, ty] = at(m.to), u = m.u;
    drawPiece(c, A, g, m.pc, m.charge, fx + (tx - fx) * u, fy + (ty - fy) * u, sq);
  }
  if (st.ring) {
    const [px, py] = at(st.ring.sq), u = st.ring.u, grow = st.ring.grow ?? 1.3;
    c.save(); c.globalAlpha = Math.max(0, 1 - u); c.strokeStyle = A.gold; c.lineWidth = sq * 0.12 * (1 - u * 0.6);
    c.beginPath(); c.arc(px + sq / 2, py + sq / 2, sq * (0.45 + u * grow), 0, Math.PI * 2); c.stroke(); c.restore();
  }
}

// текст у кілька рядків: найбільший кегль, з яким текст влазить у maxLines рядків і висоту maxH
function fit(c, A, text, maxW, maxLines, sizes, maxH, weight = 800) {
  for (const size of sizes) {
    c.font = `${weight} ${size}px ${A.font}`;
    const lines = wrapText(c, text, maxW);
    if (lines.length <= maxLines && lines.length * size * 1.12 <= maxH) return { lines, size, weight };
  }
  const size = sizes[sizes.length - 1];
  c.font = `${weight} ${size}px ${A.font}`;
  const lines = wrapText(c, text, maxW).slice(0, maxLines);
  return { lines, size, weight };
}
function drawFit(c, A, f, x, yTop, align = 'center', color = '#fff') {
  c.font = `${f.weight} ${f.size}px ${A.font}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'top';
  f.lines.forEach((line, i) => c.fillText(line, x, yTop + i * f.size * 1.12));
  return yTop + f.lines.length * f.size * 1.12;
}
function drawLogo(c, A, x, y, s) {
  c.fillStyle = A.accent;
  c.beginPath(); c.roundRect ? c.roundRect(x, y, s, s, s * 0.18) : c.rect(x, y, s, s); c.fill();
  c.drawImage(A.logo, x + s * 0.08, y + s * 0.1, s * 0.84, s * 0.84);
  c.beginPath(); c.arc(x + s - s * 0.13, y + s * 0.13, s * 0.145, 0, Math.PI * 2); c.fillStyle = A.gold; c.fill();
}
function pill(c, A, text, cx, cy, size, bg, ink) {
  c.font = `800 ${size}px ${A.font}`;
  const w = c.measureText(text).width + size * 1.4, h = size * 1.7;
  c.fillStyle = bg; c.beginPath(); c.roundRect ? c.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2) : c.rect(cx - w / 2, cy - h / 2, w, h); c.fill();
  c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, cx, cy + size * 0.04);
}
const toBlob = (cv) => new Promise((res) => cv.toBlob(res, 'image/png'));
const canvas = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };

// стан дошки для картинок: позиція після ключового ходу зі стрілкою (без ключового ходу - фінальна позиція)
function posterState(g, an) {
  const i = an.hl[0] ?? an.N, f = g.frames[i];
  return { pos: f.pos, last: f.last, check: kingSq(g, f.pos), arrow: f.last, flip: g.flip };
}

// --- картинки ------------------------------------------------------------------------------
const VW = 1080, VH = 1920, VB = { x: 60, y: 500, size: 960 };   // компонування 9:16 (відео і сторіс)
async function renderStory(g, an) {
  const A = await prepare(g, VB.size / 8), cv = canvas(VW, VH), c = cv.getContext('2d');
  c.fillStyle = A.bg; c.fillRect(0, 0, VW, VH);
  topBlock(c, A, an.hook, g.tagline, 200);
  drawBoard(c, A, g, { ...VB, ...posterState(g, an) });
  c.font = `500 34px ${A.font}`; c.fillStyle = A.soft; c.textAlign = 'center'; c.textBaseline = 'top';
  c.fillText(fitOne(c, g.sub, VW - 120), VW / 2, VB.y + VB.size + 36);
  pill(c, A, tr('Грати: {site}', { site: SITE_NAME }), VW / 2, VB.y + VB.size + 170, 50, A.gold, '#1f1d1b');
  return toBlob(cv);
}
// гачок і пояснення правила вгорі кадру 9:16; повертає низ блоку
function topBlock(c, A, hook, tagline, yTop = 130, alpha = 1, scale = 1) {
  c.save(); c.globalAlpha = alpha;
  const f = fit(c, A, hook, VW - 120, 3, [84, 76, 68, 60, 54], 230);
  if (scale !== 1) { c.translate(VW / 2, yTop + 100); c.scale(scale, scale); c.translate(-VW / 2, -(yTop + 100)); }
  const yb = drawFit(c, A, f, VW / 2, yTop + (230 - f.lines.length * f.size * 1.12) / 2);
  c.restore();
  c.save(); c.globalAlpha = alpha;
  c.font = `600 34px ${A.font}`; c.fillStyle = A.goldInk; c.textAlign = 'center'; c.textBaseline = 'top';
  c.fillText(fitOne(c, tagline, VW - 120), VW / 2, yTop + 244);
  c.restore();
  return yb;
}
function fitOne(c, text, maxW) {
  let t = text;
  while (c.measureText(t).width > maxW && t.length > 10) t = t.slice(0, -2).trimEnd() + '…';
  return t;
}
async function renderFeed(g, an) {
  const W = 1080, H = 1350, B = { x: 90, y: 280, size: 900 };
  const A = await prepare(g, B.size / 8), cv = canvas(W, H), c = cv.getContext('2d');
  c.fillStyle = A.bg; c.fillRect(0, 0, W, H);
  const f = fit(c, A, an.hook, W - 120, 3, [68, 60, 54, 48], 200);
  drawFit(c, A, f, W / 2, 50 + (200 - f.lines.length * f.size * 1.12) / 2);
  drawBoard(c, A, g, { ...B, ...posterState(g, an) });
  footer(c, A, g, 60, H - 116, W - 60);
  return toBlob(cv);
}
// підпис унизу: значок гри, назва, правило, адреса
function footer(c, A, g, x, y, right, s = 76) {
  drawLogo(c, A, x, y, s);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillStyle = '#ffffff'; c.font = `800 ${Math.round(s * 0.52)}px ${A.font}`; c.fillText(tr('Трофейні шахи'), x + s + 20, y + s * 0.46);
  c.fillStyle = A.soft; c.font = `500 ${Math.round(s * 0.34)}px ${A.font}`; c.fillText(fitOne(c, g.tagline, right - x - s - 20 - (right > 1200 ? 0 : 300)), x + s + 20, y + s * 0.9);
  if (right <= 1200) { c.fillStyle = A.goldInk; c.font = `800 ${Math.round(s * 0.44)}px ${A.font}`; c.textAlign = 'right'; c.fillText(SITE_NAME, right, y + s * 0.46); }
}
async function renderWide(g, an) {
  const W = 1600, H = 900, B = { x: 50, y: 50, size: 800 };
  const A = await prepare(g, B.size / 8), cv = canvas(W, H), c = cv.getContext('2d');
  c.fillStyle = A.bg; c.fillRect(0, 0, W, H);
  drawBoard(c, A, g, { ...B, ...posterState(g, an) });
  const X = 910, RW = W - X - 50;
  drawLogo(c, A, X, 60, 64);
  c.fillStyle = '#fff'; c.font = `800 36px ${A.font}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(tr('Трофейні шахи'), X + 84, 92);
  const f = fit(c, A, an.hook, RW, 4, [64, 58, 52, 46], 320);
  const yb = drawFit(c, A, f, X, 190, 'left');
  const s2 = fit(c, A, g.sub, RW, 2, [32, 28], 80, 500);
  drawFit(c, A, s2, X, yb + 24, 'left', A.soft);
  const t2 = fit(c, A, g.tagline, RW, 2, [32, 28], 80, 600);
  drawFit(c, A, t2, X, 690, 'left', A.goldInk);
  c.fillStyle = A.goldInk; c.font = `800 46px ${A.font}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(SITE_NAME, X, 840);
  return toBlob(cv);
}

// --- відео ---------------------------------------------------------------------------------
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const clamp01 = (u) => Math.max(0, Math.min(1, u));
function timeline(an) {
  const segs = [];
  const add = (d, kind, o = {}) => segs.push({ d, kind, ...o });
  const fast = (a, b, budget) => {
    const cnt = b - a + 1;
    if (cnt <= 0) return;
    const dt = Math.min(0.5, Math.max(0.12, budget / cnt));
    for (let k = a; k <= b; k++) add(dt, 'move', { ply: k });
  };
  add(1.6, 'intro');
  let cur = 1;
  an.hl.forEach((h, j) => {
    fast(cur, h - 1, j === 0 ? 7 : 4);
    const e = an.ev[h], second = j > 0;
    add(second ? 0.8 : 1.3, 'setup', { ply: h });
    add(0.9, 'slow', { ply: h });
    add(e.mate ? 2.1 : 1.9, 'hit', { ply: h });
    cur = h + 1;
  });
  if (cur <= an.N) { fast(cur, an.N, an.hl.length ? 4 : 9); add(1.5, 'end'); }
  add(3.2, 'outro');
  let t = 0;
  for (const s of segs) { s.t0 = t; t += s.d; }
  return { segs, total: t };
}
const plyLabel = (g, k) => `${Math.ceil(k / 2)}${k % 2 ? '.' : '…'} ${g.frames[k].san}`;

function videoPainter(g, an, A) {
  const tl = timeline(an);
  // ходи зарядом фігури, що зараз зробить ключовий хід (ромбики й кільця, як на дошці)
  const marksOf = (k) => {
    const b = g.frames[k - 1].pos, e = an.ev[k];
    if (!e.tk) return [{ sq: e.to, dot: true }];          // звичайний хід - лише поле, куди піде фігура
    return b.generate().filter((m) => m.from === e.from && m.tk).map((m) => ({ sq: m.to, cap: !!b.board[m.to] }));
  };
  const marks = new Map(an.hl.map((h) => [h, marksOf(h)]));
  const checks = g.frames.map(() => -2);
  const chk = (k) => (checks[k] === -2 ? (checks[k] = kingSq(g, g.frames[k].pos)) : checks[k]);
  let si = 0;
  return {
    total: tl.total,
    paint(c, t) {
      while (si < tl.segs.length - 1 && t >= tl.segs[si].t0 + tl.segs[si].d) si++;
      while (si > 0 && t < tl.segs[si].t0) si--;
      const s = tl.segs[si], u = clamp01((t - s.t0) / s.d);
      c.fillStyle = A.bg; c.fillRect(0, 0, VW, VH);
      let st, label = '', caption = '', big = null;
      const frameSt = (k) => ({ pos: g.frames[k].pos, last: g.frames[k].last, check: chk(k) });
      const moveSt = (k, mu) => {
        const b = g.frames[k - 1].pos, { from, to } = g.frames[k].last;
        if (mu >= 1) return frameSt(k);
        return { pos: b, last: g.frames[k - 1].last, check: -1, hide: from, fade: { sq: to, alpha: mu < 0.7 ? 1 : 1 - (mu - 0.7) / 0.3 }, move: { pc: b.board[from], charge: b.t1[from], from, to, u: mu } };
      };
      if (s.kind === 'intro') st = frameSt(0);
      else if (s.kind === 'move') { st = moveSt(s.ply, ease(clamp01(u / 0.7))); label = plyLabel(g, s.ply); }
      else if (s.kind === 'setup') {
        const e = an.ev[s.ply];
        st = { ...frameSt(s.ply - 1), marks: marks.get(s.ply), ring: { sq: e.from, u: (u * 2) % 1, grow: 0.35 } };
        caption = e.tk ? tr('Хід зарядом {piece}', { piece: g.TRO_GEN[e.tk] }) : tr('Вирішальний хід…');
      } else if (s.kind === 'slow') {
        const e = an.ev[s.ply];
        st = moveSt(s.ply, ease(u));
        caption = e.tk ? tr('Хід зарядом {piece}', { piece: g.TRO_GEN[e.tk] }) : tr('Вирішальний хід…');
      } else if (s.kind === 'hit') {
        const e = an.ev[s.ply];
        st = { ...frameSt(s.ply), ring: u < 0.45 ? { sq: e.to, u: u / 0.45 } : null };
        label = plyLabel(g, s.ply);
        if (e.mate) big = tr('Мат!');
        else caption = e.granted ? tr('+ заряд {piece}', { piece: g.TRO_GEN[e.kind] }) : e.check ? tr('Шах!') : '';
        if (!caption && !big) { caption = plyLabel(g, s.ply); label = ''; }
      } else if (s.kind === 'end') { st = frameSt(an.N); caption = g.title; }
      else st = frameSt(an.N);
      // гачок угорі - весь час (у вступі з’являється)
      const ha = s.kind === 'intro' ? clamp01(u * 3) : 1, hs = s.kind === 'intro' ? 0.85 + 0.15 * ease(clamp01(u * 3)) : 1;
      topBlock(c, A, an.hook, g.tagline, 90, ha, hs);
      drawBoard(c, A, g, { ...VB, flip: g.flip, ...st });
      // рядок над дошкою: хід або підпис ключового моменту
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (caption) { c.font = `800 46px ${A.font}`; pill(c, A, fitOne(c, caption, VW - 200), VW / 2, 446, 46, A.gold, '#1f1d1b'); }
      else if (label) { c.font = `700 46px ${A.font}`; c.fillStyle = A.soft; c.fillText(label, VW / 2, 446); }
      if (big) {
        const k = ease(clamp01(u * 2.5)), sc = 0.6 + 0.4 * k;
        c.save(); c.translate(VW / 2, VB.y + VB.size / 2); c.scale(sc, sc); c.globalAlpha = k;
        c.font = `800 210px ${A.font}`; c.lineJoin = 'round'; c.lineWidth = 26; c.strokeStyle = 'rgba(160,20,20,.92)'; c.strokeText(big, 0, 0);
        c.fillStyle = '#fff'; c.fillText(big, 0, 0); c.restore();
      }
      c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.font = `700 36px ${A.font}`; c.fillStyle = A.soft;
      c.fillText(SITE_NAME, VW / 2, VB.y + VB.size + 62);
      if (s.kind === 'outro') outro(c, A, g, clamp01(u / 0.18));
    },
  };
}
function outro(c, A, g, a) {
  c.save();
  c.globalAlpha = a * 0.86; c.fillStyle = '#16140f'; c.fillRect(0, 0, VW, VH);
  c.globalAlpha = a;
  drawLogo(c, A, VW / 2 - 90, 560, 180);
  c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#fff'; c.font = `800 96px ${A.font}`;
  c.fillText(tr('Трофейні шахи'), VW / 2, 880);
  const f = fit(c, A, g.tagline, VW - 160, 2, [46, 40], 120, 600);
  drawFit(c, A, f, VW / 2, 920, 'center', A.goldInk);
  c.fillStyle = '#fff'; c.font = `700 50px ${A.font}`; c.textBaseline = 'alphabetic';
  c.fillText(tr('Грайте безкоштовно'), VW / 2, 1130);
  pill(c, A, SITE_NAME, VW / 2, 1235, 64, A.gold, '#1f1d1b');
  c.fillStyle = A.soft; c.font = `600 40px ${A.font}`; c.textBaseline = 'alphabetic';
  c.fillText(tr('у браузері та в Google Play'), VW / 2, 1370);
  c.restore();
}

// що вміє цей браузер: 'webcodecs' | 'recorder' | null
export function videoSupport() {
  if (typeof VideoEncoder === 'function' && typeof VideoFrame === 'function') return 'webcodecs';
  if (typeof MediaRecorder === 'function' && HTMLCanvasElement.prototype.captureStream && recorderType()) return 'recorder';
  return null;
}
function recorderType() {
  for (const t of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* немає */ }
  }
  return null;
}
const ENC = [['avc1.640028', 1080, 1920, 2_500_000], ['avc1.4d0028', 1080, 1920, 2_500_000], ['avc1.42e028', 1080, 1920, 2_500_000], ['avc1.42e01f', 720, 1280, 1_600_000]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function encodeWebCodecs(painter, onProgress) {
  const { Muxer, ArrayBufferTarget } = await import('./mp4-muxer.js');
  let lastErr = null;
  for (const [codec, w, h, bitrate] of ENC) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: FPS, avc: { format: 'avc' } };
    try { if (!(await VideoEncoder.isConfigSupported(cfg)).supported) continue; } catch { continue; }
    try {
      const cv = canvas(w, h), c = cv.getContext('2d');
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({ target, video: { codec: 'avc', width: w, height: h, frameRate: FPS }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
      let err = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { err = e; } }, error: (e) => { err = e; } });
      enc.configure(cfg);
      const n = Math.ceil(painter.total * FPS);
      for (let i = 0; i < n; i++) {
        if (err) throw err;
        c.setTransform(w / VW, 0, 0, h / VH, 0, 0);
        painter.paint(c, i / FPS);
        const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
        vf.close();
        while (enc.encodeQueueSize > 4) { await sleep(4); if (err) throw err; }
        if (i % 8 === 0) { onProgress(i / n); await sleep(0); }
      }
      await enc.flush();
      if (err) throw err;
      enc.close();
      muxer.finalize();
      return new Blob([target.buffer], { type: 'video/mp4' });
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('no encoder');
}
async function encodeRecorder(painter, onProgress) {
  const type = recorderType();
  const cv = canvas(720, 1280), c = cv.getContext('2d');
  c.setTransform(720 / VW, 0, 0, 1280 / VH, 0, 0);
  painter.paint(c, 0);
  const stream = cv.captureStream(FPS);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });
  rec.start(1000);
  const t0 = performance.now();
  for (;;) {
    const t = (performance.now() - t0) / 1000;
    if (t >= painter.total) break;
    painter.paint(c, t);
    onProgress(t / painter.total);
    await sleep(1000 / FPS);
  }
  painter.paint(c, painter.total);
  await sleep(150);
  rec.stop();
  stream.getTracks().forEach((tr0) => tr0.stop());
  await done;
  return new Blob(chunks, { type: type.split(';')[0] });
}
async function renderVideo(g, an, onProgress) {
  const A = await prepare(g, VB.size / 8);
  const how = videoSupport();
  if (!how) throw new Error('video unsupported');
  if (how === 'webcodecs') {
    try { return await encodeWebCodecs(videoPainter(g, an, A), onProgress); } catch (e) { if (!recorderType()) throw e; }
  }
  return encodeRecorder(videoPainter(g, an, A), onProgress);
}

// --- панель ---------------------------------------------------------------------------------
const pc = () => !native.inApp && !matchMedia('(pointer: coarse)').matches;
export function panelHtml() {
  const rows = NETS.map((n) => `<div class="soc-row"><b>${n.name}</b><span>${n.formats.map((f, i) => `<button type="button" class="btn${i ? '' : ' rec'}" data-soc="${n.id}:${f}">${fmtLabel(n.id, f)}</button>`).join('')}</span></div>`).join('');
  return `<div class="soc">${rows}</div><p class="note soc-legend">${tr('Зелена кнопка – формат із найбільшим охопленням. Reels і Shorts мережа показує й тим, хто на вас не підписаний; сторіс бачать лише підписники 24 години, зате в неї можна додати наліпку-посилання; допис лишається в профілі, а у Facebook, X, LinkedIn і Threads посилання в ньому клікабельне.')}</p><div class="soc-out" hidden></div>`;
}

let CTX = null;              // {g, an, assets: Map(format → {blob, url})}
let busy = false;
// g - партія й усе, що потрібно для малювання (збирає app.js); panel - елемент панелі; say - рядок повідомлення
export function open(panel, g, say) {
  if (CTX?.panel !== panel || CTX?.g.url !== g.url) {
    for (const a of CTX?.assets?.values() ?? []) if (a.href) URL.revokeObjectURL(a.href);
    CTX = { panel, g, an: analyse(g), assets: new Map(), say };
  }
  CTX.say = say;
  panel.innerHTML = panelHtml();
  panel.hidden = false;
  if (!panel.dataset.socBound) {
    panel.dataset.socBound = '1';
    panel.addEventListener('click', onClick);
  }
  say('');
}

async function asset(fmt, onProgress) {
  if (CTX.assets.has(fmt)) return CTX.assets.get(fmt);
  const { g, an } = CTX;
  const blob = fmt === 'video' ? await renderVideo(g, an, onProgress) : fmt === 'story' ? await renderStory(g, an) : fmt === 'feed' ? await renderFeed(g, an) : await renderWide(g, an);
  const ext = blob.type === 'video/mp4' ? '.mp4' : blob.type === 'video/webm' ? '.webm' : '.png';
  const a = { blob, name: BASE + FILE[fmt] + ext, href: URL.createObjectURL(blob) };
  CTX.assets.set(fmt, a);
  return a;
}

async function onClick(e) {
  const b = e.target.closest('[data-soc],[data-so]');
  if (!b || !CTX) return;
  const say = CTX.say;
  if (b.dataset.soc) {
    if (busy) return;
    const [netId, fmt] = b.dataset.soc.split(':');
    if (fmt === 'video' && !videoSupport()) { say(tr('Цей браузер не вміє створювати відео. Оновіть його або виберіть сторіс чи допис.')); return; }
    busy = true;
    CTX.panel.querySelectorAll('[data-soc]').forEach((x) => x.classList.toggle('on', x === b));
    say(fmt === 'video' ? tr('Готуємо відео… {p} %', { p: 0 }) : tr('Готуємо картинку…'));
    try {
      const a = await asset(fmt, (p) => say(tr('Готуємо відео… {p} %', { p: Math.round(p * 100) })));
      const text = captionFor(netId, CTX.g, CTX.an.hook);
      CTX.cur = { netId, fmt, a, text };
      showResult();
      if (native.inApp) await sendNative();
      else if (pc()) { saveImage(a.blob, a.name); }
    } catch {
      say(fmt === 'video' ? tr('Не вдалося створити відео на цьому пристрої. Спробуйте сторіс чи допис.') : tr('Не вдалося підготувати картинку.'));
    } finally { busy = false; }
    return;
  }
  const cur = CTX.cur;
  if (!cur) return;
  const act = b.dataset.so;
  try {
    if (act === 'copy') { await copyText(cur.text); say(tr('Текст допису скопійовано.')); }
    if (act === 'save') { saveImage(cur.a.blob, cur.a.name); say(fileSaved(cur.fmt)); }
    if (act === 'copy-img') { await navigator.clipboard.write([new ClipboardItem({ 'image/png': cur.a.blob })]); say(tr('Картинку скопійовано – вставте її в допис (Ctrl+V).')); }
    if (act === 'open') { copyText(cur.text).catch(() => {}); }          // посилання відкриється само (target=_blank)
    if (act === 'send') await sendNative(true);
    if (act === 'any') await sendNative(true, true);
    if (act === 'go') {                 // браузер на Android: зберегти файл і відкрити застосунок мережі (посилання - саме)
      copyText(cur.text).catch(() => {});
      saveImage(cur.a.blob, cur.a.name);
      say(tr('{file} збережено в «Завантаження». У {net} натисніть «+» і виберіть його; текст допису скопійовано – вставте в підпис. Якщо {net} не відкрився – «Меню «Поділитися»».', { file: cur.fmt === 'video' ? tr('Відео') : tr('Картинку'), net: NET[cur.netId].name }));
    }
    if (act === 'share') {
      copyText(cur.text).catch(() => {});
      const file = new File([cur.a.blob], cur.a.name, { type: cur.a.blob.type });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: cur.text });
      else { saveImage(cur.a.blob, cur.a.name); say(fileSaved(cur.fmt)); }
    }
  } catch (err) {
    if (err?.name !== 'AbortError') say(tr('Не вдалося. Збережіть файл і додайте його в мережу вручну.'));
  }
}
const fileSaved = (fmt) => (fmt === 'video' ? tr('Відео збережено.') : tr('Картинку збережено.'));
async function copyText(text) {
  if (native.inApp && native.send({ t: 'copy', text })) return;
  await navigator.clipboard.writeText(text);
}
// застосунок: одразу в застосунок мережі (якщо його немає - системне меню)
async function sendNative(again = false, any = false) {
  const cur = CTX.cur;
  native.send({ t: 'copy', text: cur.text });
  const ok = await native.share({ text: cur.text, blob: cur.a.blob, name: cur.a.name, to: any ? '' : cur.netId });
  if (!ok) CTX.say(tr('Не вдалося відкрити меню «Поділитися».'));
  else if (!again) CTX.say(hintOf(cur, true));
}
function hintOf(cur, copied) {
  const parts = [];
  if (cur.fmt === 'video') parts.push(tr('Відео без музики: додайте популярний звук у самій мережі перед публікацією – так його побачить більше людей.'));
  if (cur.fmt === 'story') parts.push(tr('У сторіс додайте наліпку «Посилання» з адресою {site}.', { site: SITE_NAME }));
  parts.push(copied ? tr('Текст допису скопійовано – вставте його в підпис.') : tr('Текст допису – нижче.'));
  return parts.join(' ');
}
function showResult() {
  const { a, netId, fmt, text } = CTX.cur, net = NET[netId];
  const out = CTX.panel.querySelector('.soc-out');
  if (!out) return;                       // панель закрили, поки готувався файл
  const isVideo = fmt === 'video';
  const prev = isVideo ? `<video src="${a.href}" muted loop autoplay playsinline></video>` : `<img src="${a.href}" alt="">`;
  const btns = [];
  if (native.inApp) {
    btns.push(`<button type="button" class="btn primary" data-so="send">${tr('Відкрити {net}', { net: net.name })}</button>`);
    btns.push(`<button type="button" class="btn" data-so="any">${tr('Інший застосунок…')}</button>`);
  } else if (pc()) {
    const href = net.intent ? net.intent(intentText(netId, text, CTX.g.url), CTX.g.url) : net.upload;
    btns.push(`<a class="btn primary" data-so="open" href="${href}" target="_blank" rel="noopener">${tr('Відкрити {net}', { net: net.name })}</a>`);
    btns.push(`<button type="button" class="btn" data-so="save">${isVideo ? tr('Зберегти відео') : tr('Зберегти картинку')}</button>`);
    if (!isVideo && navigator.clipboard?.write && window.ClipboardItem) btns.push(`<button type="button" class="btn" data-so="copy-img">${tr('Скопіювати картинку')}</button>`);
  } else if (isAndroid()) {
    const href = appLink(net, text, CTX.g.url);
    btns.push(`<a class="btn primary" data-so="go" href="${href}"${net.intent ? ' target="_blank" rel="noopener"' : ''}>${tr('Зберегти й відкрити {net}', { net: net.name })}</a>`);
    btns.push(`<button type="button" class="btn" data-so="share">${tr('Меню «Поділитися»')}</button>`);
  } else {
    btns.push(`<button type="button" class="btn primary" data-so="share">${tr('Поділитися в {net}', { net: net.name })}</button>`);
    btns.push(`<button type="button" class="btn" data-so="save">${isVideo ? tr('Зберегти відео') : tr('Зберегти картинку')}</button>`);
  }
  btns.push(`<button type="button" class="btn" data-so="copy">${tr('Скопіювати текст')}</button>`);
  out.innerHTML = `<div class="soc-prev ${fmt}">${prev}</div><div class="soc-acts">${btns.join('')}</div><textarea class="soc-text" readonly rows="4" aria-label="${tr('Текст допису')}"></textarea>`;
  out.querySelector('.soc-text').value = text;
  out.hidden = false;
  try { out.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* старий браузер */ }
  const hint = pc()
    ? (isVideo ? tr('Відео збережено.') : tr('Картинку збережено.')) + ' ' + (net.intent ? tr('Відкрийте {net}: текст допису вже вписано, додайте збережений файл.', { net: net.name }) : tr('Відкрийте {net} і завантажте збережений файл; текст допису скопіюйте кнопкою нижче.', { net: net.name }))
      + (isVideo ? ' ' + tr('Відео без музики: додайте популярний звук у самій мережі перед публікацією – так його побачить більше людей.') : '')
    : isAndroid() && !native.inApp ? hintOf(CTX.cur, false) + ' ' + tr('Відразу в застосунок мережі файл передає застосунок «Трофейні шахи» з Google Play; браузер цього не вміє.')
      : hintOf(CTX.cur, false);
  CTX.say(hint);
}

// для тестів: зібрати матеріал без панелі
export async function render(g, fmt, onProgress = () => {}) {
  const an = analyse(g);
  const blob = fmt === 'video' ? await renderVideo(g, an, onProgress) : fmt === 'story' ? await renderStory(g, an) : fmt === 'feed' ? await renderFeed(g, an) : await renderWide(g, an);
  return { blob, an, total: timeline(an).total };
}
