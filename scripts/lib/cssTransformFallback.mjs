/**
 * cssTransformFallback — bağımsız transform özelliklerine (`translate:` /
 * `scale:` / `rotate:`) Chrome 104 öncesi için `transform` yedeği.
 *
 * NEDEN (ölçüldü, 2026-09-30): Tailwind v4 `-translate-x-1/2`, `scale-95`,
 * `rotate-90` gibi sınıfları YALNIZ bu yeni özelliklerle yazar. K24'ün
 * WebView'i Chrome 101.0.4951.61 (kütük) — gerçek Chromium 101'de
 * `CSS.supports('translate','10px') === false`; bildirimler atılıyor.
 * Aynı build'in CSS'iyle Chromium 101'de: `left-1/2 -translate-x-1/2`
 * uyarı bandı 200 px sağa kayık, `top-1/2 -translate-y-1/2` sütun 50 px
 * aşağıda, `active:scale-*` basma geri bildirimi yok.
 *
 * YÖNTEM: her eşleşen kural için AYNI seçici + AYNI @media/@supports zinciri
 * ile `@supports not (translate:0)` içine yedek kural eklenir. Bir öğede
 * birden çok sınıf (ör. ortalama + basma) bileşebilsin diye her özellik kendi
 * kayıtlı değişkenine yazılır ve `transform` üçünü birlikte kurar:
 *   transform: translate(var(--tw-fb-t)) rotate(var(--tw-fb-r)) scale(var(--tw-fb-s))
 * Sıra CSS Transforms 2 ile aynıdır (translate → rotate → scale). Değişkenler
 * `@property … inherits:false` ile kaydedilir → çocuğa SIZMAZ (Chrome 85+).
 * Yeni tarayıcılar `@supports not` bloğunu hiç uygulamaz → davranış değişmez.
 */

const PROPS = ['translate', 'scale', 'rotate'];

export const FALLBACK_PRELUDE =
  '@property --tw-fb-t{syntax:"*";inherits:false;initial-value:0px,0px}' +
  '@property --tw-fb-r{syntax:"*";inherits:false;initial-value:0deg}' +
  '@property --tw-fb-s{syntax:"*";inherits:false;initial-value:1,1}';

const TRANSFORM = 'transform:translate(var(--tw-fb-t)) rotate(var(--tw-fb-r)) scale(var(--tw-fb-s))';

/** Üst düzey (parantez dışı) boşluklara göre böl. */
function splitTopLevel(v) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of v.trim()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Tek özellik değerini yedek değişken değerine çevir; çevrilemezse null. */
export function toFallbackValue(prop, raw) {
  const v = raw.trim();
  if (v === 'none') return prop === 'translate' ? '0px,0px' : prop === 'scale' ? '1,1' : '0deg';
  const t = splitTopLevel(v);
  if (prop === 'translate') {
    if (t.length === 1) return `${t[0]},0px`;
    if (t.length === 2 || t.length === 3) return `${t[0]},${t[1]}`; // z ekseni 2B yedekte yok sayılır
    return null;
  }
  if (prop === 'scale') {
    if (t.length === 1) return `${t[0]},${t[0]}`;
    if (t.length === 2 || t.length === 3) return `${t[0]},${t[1]}`;
    return null;
  }
  // rotate: yalnız tek açı (eksenli döndürme yedeklenmez)
  return t.length === 1 ? t[0] : null;
}

/** Bildirim bloğundan yedek bildirimleri üret; eşleşme yoksa null. */
function fallbackDecls(block) {
  const parts = [];
  let important = false;
  for (const decl of block.split(';')) {
    const m = /^\s*(translate|scale|rotate)\s*:(.*)$/s.exec(decl);
    if (!m) continue;
    let value = m[2];
    const imp = /!important\s*$/.test(value);
    if (imp) { important = true; value = value.replace(/!important\s*$/, ''); }
    const fb = toFallbackValue(m[1], value);
    if (fb === null) continue;
    parts.push(`--tw-fb-${m[1][0]}:${fb}`);
  }
  if (!parts.length) return null;
  const imp = important ? '!important' : '';
  return [...parts.map((p) => p + imp), TRANSFORM + imp].join(';');
}

/**
 * Küçültülmüş/küçültülmemiş CSS'i gezer; eşleşen her kural için yedek üretir.
 * @keyframes içi atlanır (animasyon kareleri ayrı mekanizmadır).
 */
export function addTransformFallback(css) {
  if (!PROPS.some((p) => css.includes(`${p}:`))) return css;
  const extra = [];
  const stack = []; // açık blok başlıkları
  let i = 0;
  let headStart = 0;
  let inStr = null;
  while (i < css.length) {
    const ch = css[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; i++; continue; }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (ch === '{') {
      const head = css.slice(headStart, i).trim();
      if (!head.startsWith('@')) {
        // bildirim bloğu: kapanışı bul (bildirim bloklarında iç içe { yok)
        const close = css.indexOf('}', i + 1);
        const block = css.slice(i + 1, close < 0 ? css.length : close);
        const inKeyframes = stack.some((h) => /^@(-webkit-)?keyframes/.test(h));
        const fb = inKeyframes ? null : fallbackDecls(block);
        if (fb) {
          const open = stack.map((h) => `${h}{`).join('');
          const shut = '}'.repeat(stack.length);
          extra.push(`${open}@supports not (translate:0){${head}{${fb}}}${shut}`);
        }
        i = close < 0 ? css.length : close + 1;
        headStart = i;
        continue;
      }
      stack.push(head);
      i++;
      headStart = i;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      i++;
      headStart = i;
      continue;
    }
    if (ch === ';' && css.slice(headStart, i).trim().startsWith('@')) {
      // @import / @charset gibi bloksuz at-kural
      i++;
      headStart = i;
      continue;
    }
    i++;
  }
  if (!extra.length) return css;
  return `${css}\n${FALLBACK_PRELUDE}${extra.join('')}`;
}
