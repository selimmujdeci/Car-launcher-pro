/**
 * uiActivityRecorder.ts — UI yüzey (modal/overlay/drawer/alert) aktivite kaydedici.
 *
 * "ZAMANSIZ AÇILAN MODAL AVCISI" (kullanıcı isteği): modallar/overlay'ler bu
 * uygulamada merkezi bir store'dan DEĞİL, her biri kendi React bileşeninden
 * açılıyor. Her birine dokunmak yerine — hepsi DOM'a yüksek-z-index `fixed`
 * eleman olarak bindiği için — TEK bir MutationObserver ile merkezi izliyoruz
 * (gelecekteki modaller dahil, hiçbir bileşene dokunmadan).
 *
 * Her açılışın BAĞLAMINI kaydeder (hız / geri vites / son kullanıcı dokunuşundan
 * bu yana geçen süre) ve "ZAMANSIZ" olanları işaretler:
 *   - sürüşte açıldı (speed > 5)          → modal sürüş sırasında çıkmamalı
 *   - geri viteste açıldı                  → kamera/güvenlik anı kirlenir
 *   - kullanıcı dokunmadan açıldı (>1.5sn) → sistem-kaynaklı beklenmedik açılış
 *   - kısa sürede tekrar tekrar açıldı     → flapping (kararsız modal)
 *
 * PERFORMANS: observer callback'i, pahalı getComputedStyle'ı YALNIZ ucuz ön-filtre
 * (role/aria/class/inline-z) geçen eklenen düğümlere uygular → React re-render
 * gürültüsünde neredeyse bedava. Zaman ölçümleri monotonik (performance.now).
 */

import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';

/* ── Tipler ──────────────────────────────────────────────────── */

export interface UiSurfaceEvent {
  ts:          number;   // Date.now (panelde okunur görüntü)
  sinceBootMs: number;   // monotonik
  action:      'open' | 'close';
  desc:        string;   // "div#foo.modal z9990 42%"
  zIndex:      number;
  areaPct:     number;
  speed:       number | null;
  reverse:     boolean;
  sinceUserMs: number;   // son kullanıcı dokunuşundan bu yana
  untimely:    boolean;
  reasons:     string[]; // ['sürüşte','geri-viteste','kullanıcı-dokunmadan','tekrar-tekrar']
}

export interface UiActivitySnapshot {
  installed:     boolean;
  openNow:       string[];        // şu an açık yüzeylerin desc'leri
  recent:        UiSurfaceEvent[]; // son N olay
  untimelyCount: number;          // zamansız açılış sayısı (bu oturum)
  lastUserMsAgo: number;          // son kullanıcı etkileşiminden bu yana
}

/* ── Modül durumu ───────────────────────────────────────────── */

const MAX_LOG      = 40;
const FLAP_WINDOW  = 10_000;
const NO_USER_MS   = 1_500;
const DRIVING_KMH  = 5;

let _installed   = false;
let _bootMono    = 0;
let _lastUserMono = 0;
const _log:        UiSurfaceEvent[] = [];
const _open:       Map<Element, string> = new Map();     // el → desc
const _flap:       Map<string, number[]> = new Map();    // desc → mono zamanları
let _observer:     MutationObserver | null = null;
const _userEvents = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

function mono(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}

/* ── Yüzey tespiti ──────────────────────────────────────────── */

/** Ucuz ön-filtre: getComputedStyle'dan ÖNCE eler (React churn'ünde bedava). */
function cheapCandidate(el: HTMLElement): boolean {
  const role = el.getAttribute('role');
  if (role === 'dialog' || role === 'alertdialog' || role === 'alert') return true;
  if (el.getAttribute('aria-modal') === 'true') return true;
  const cls = typeof el.className === 'string' ? el.className : '';
  const idc = cls + ' ' + (el.id || '');
  if (/modal|overlay|drawer|dialog|banner|disclaimer|popup|sheet/i.test(idc)) return true;
  const st = el.getAttribute('style') || '';
  if (/position:\s*fixed/i.test(st)) return true;
  if (/\bfixed\b/.test(cls) && /\bz-\[/.test(cls)) return true;
  return false;
}

interface SurfaceInfo { desc: string; zIndex: number; areaPct: number }

/** Kesin tespit (pahalı — yalnız aday düğümlere). null = yüzey değil. */
function classifySurface(el: HTMLElement): SurfaceInfo | null {
  if (el.dataset.selftestIgnore === '1') return null;       // kendi tanı butonumuz vb.
  if (typeof getComputedStyle !== 'function') return null;
  const cs = getComputedStyle(el);
  const fixed = cs.position === 'fixed';
  const z     = parseInt(cs.zIndex, 10) || 0;
  const role  = el.getAttribute('role') || '';
  const isDialog = role === 'dialog' || role === 'alertdialog' || role === 'alert' ||
    el.getAttribute('aria-modal') === 'true';
  const cls   = typeof el.className === 'string' ? el.className : '';
  const nameHit = /modal|overlay|drawer|dialog|banner|disclaimer|popup|sheet/i.test(cls + ' ' + (el.id || ''));

  // 🔴 GÖRÜNÜRLÜK KAPISI (SAHA 2026-07-06): DrawerShell gibi yüzeyler KAPALIYKEN
  // DOM'da kalır (`transform: translateY(100%)` → ekran-dışı) ama getBoundingClientRect
  // öteleme'yi saymaz → ham alan hâlâ ~%100. Bu, 14 KAPALI drawer'ı "açık modal"
  // sayıp avcıyı "kurt geldi"ye çeviriyordu. Çözüm: ham alan DEĞİL, viewport ile
  // GERÇEK GÖRÜNÜR KESİŞİM alanını kullan + gizli (visibility/display/opacity) ele.
  if (cs.visibility === 'hidden' || cs.display === 'none') return null;
  // opacity:0 KAPALI drawer'ları eler. DİKKAT: `parseFloat(op) || 1` YAZMA —
  // op=0 falsy olduğu için `0 || 1` = 1 olur ve opacity:0 SIZAR (SAHA 2026-07-06
  // ilk fix bu tuzağa düştü: DrawerShell dış div kapalıyken opacity:0 ama inset:0
  // tam-ekran → görünür-alan %100, yalnız opacity ayırıyor). NaN'ı (parse edilemez)
  // 0'dan AYIR: yalnız gerçek düşük opacity ele.
  const op = parseFloat(cs.opacity);
  if (Number.isFinite(op) && op < 0.05) return null;

  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || 1, vh = window.innerHeight || 1;
  // Görünür kesişim (ekran-dışı öteleme burada elenir).
  const visW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
  const visH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
  const areaPct = Math.round((visW * visH) / (vw * vh) * 100);

  // Yüzey mi? (a) fixed + yüksek-z + kayda değer GÖRÜNÜR alan, (b) dialog/alert
  // rolü (açık modal işareti — alanı baypas eder; gizliyse yukarıda zaten elendi),
  // (c) fixed + isim eşleşmesi + orta-z. Ekran-dışı ötelenmiş anonim yüzeyler (kapalı
  // drawer) görünür-alan ~0 olduğu için (a)/(c) branch'lerinde elenir.
  const surface =
    (fixed && z >= 900 && areaPct >= 12) ||
    isDialog ||
    (fixed && nameHit && z >= 500 && areaPct >= 6);
  if (!surface) return null;
  if (areaPct < 3 && !isDialog) return null;

  const firstCls = cls ? '.' + cls.split(/\s+/).filter(Boolean)[0] : '';
  const desc = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${firstCls} z${z} ${areaPct}%`;
  return { desc, zIndex: z, areaPct };
}

/* ── Kayıt ──────────────────────────────────────────────────── */

function pushEvent(e: UiSurfaceEvent): void {
  _log.push(e);
  if (_log.length > MAX_LOG) _log.shift();
}

function recordOpen(el: HTMLElement): void {
  if (_open.has(el)) return;
  const info = classifySurface(el);
  if (!info) return;

  const m   = mono();
  const vs  = useUnifiedVehicleStore.getState();
  const speed = vs.speed;
  const reverse = vs.reverse;
  const sinceUserMs = Math.round(m - _lastUserMono);

  // Flapping: aynı yüzey son 10sn'de kaç kez açıldı
  const arr = (_flap.get(info.desc) ?? []).filter((t) => m - t < FLAP_WINDOW);
  arr.push(m);
  _flap.set(info.desc, arr);

  const reasons: string[] = [];
  if ((speed ?? 0) > DRIVING_KMH)    reasons.push('sürüşte');
  if (reverse)                       reasons.push('geri-viteste');
  if (sinceUserMs > NO_USER_MS)      reasons.push('kullanıcı-dokunmadan');
  if (arr.length >= 3)               reasons.push('tekrar-tekrar');

  _open.set(el, info.desc);
  pushEvent({
    ts: Date.now(), sinceBootMs: Math.round(m - _bootMono), action: 'open',
    desc: info.desc, zIndex: info.zIndex, areaPct: info.areaPct,
    speed, reverse, sinceUserMs, untimely: reasons.length > 0, reasons,
  });
}

function recordClose(el: Element): void {
  const desc = _open.get(el);
  if (!desc) return;
  _open.delete(el);
  const m = mono();
  pushEvent({
    ts: Date.now(), sinceBootMs: Math.round(m - _bootMono), action: 'close',
    desc, zIndex: 0, areaPct: 0, speed: null, reverse: false,
    sinceUserMs: 0, untimely: false, reasons: [],
  });
}

/* ── Kurulum / yaşam döngüsü ─────────────────────────────────── */

function onUserInteract(): void { _lastUserMono = mono(); }

/**
 * Kaydediciyi kurar. SystemBoot Wave 1'de (erken — disclaimer boot'ta açılır)
 * çağrılır. İdempotent; dönen cleanup observer + listener'ları söker (zero-leak).
 */
export function startUiActivityRecorder(): () => void {
  if (_installed) return () => { /* zaten kurulu */ };
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => { /* DOM yok (test/SSR) */ };
  }
  _installed    = true;
  _bootMono     = mono();
  _lastUserMono = mono();

  for (const ev of _userEvents) {
    document.addEventListener(ev, onUserInteract, { capture: true, passive: true });
  }

  // Kurulum anında zaten açık yüzeyleri yakala (boot-time modaller: disclaimer).
  try {
    const seeds = document.querySelectorAll(
      '[role=dialog],[role=alertdialog],[role=alert],[aria-modal="true"],' +
      '[class*=modal],[class*=overlay],[class*=drawer],[class*=disclaimer]',
    );
    seeds.forEach((el) => { if (el instanceof HTMLElement) recordOpen(el); });
  } catch { /* fail-soft */ }

  _observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      mut.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement && cheapCandidate(n)) recordOpen(n);
      });
    }
    // Kapanış: artık DOM'da olmayan izlenen yüzeyleri temizle (ata düğüm silinmiş olabilir).
    if (_open.size > 0) {
      for (const el of Array.from(_open.keys())) {
        if (!document.contains(el)) recordClose(el);
      }
    }
  });
  _observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    if (_observer) { _observer.disconnect(); _observer = null; }
    for (const ev of _userEvents) {
      document.removeEventListener(ev, onUserInteract, { capture: true } as EventListenerOptions);
    }
    _open.clear();
    _flap.clear();
    _installed = false;
  };
}

/* ── Okuma (tanı payload'ı + self-test probu) ────────────────── */

export function getUiActivitySnapshot(): UiActivitySnapshot {
  const m = mono();
  return {
    installed:     _installed,
    openNow:       Array.from(_open.values()),
    recent:        _log.slice(-20),
    untimelyCount: _log.filter((e) => e.action === 'open' && e.untimely).length,
    lastUserMsAgo: _installed ? Math.round(m - _lastUserMono) : -1,
  };
}

/** @internal testler için — kaydı sıfırla. */
export function _resetUiActivityForTest(): void {
  _log.length = 0;
  _open.clear();
  _flap.clear();
}
