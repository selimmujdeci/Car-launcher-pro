/**
 * themePreviewBridge — Tema Stüdyo iframe köprüsü (araç tarafı).
 *
 * carospro.com'daki Tema Stüdyo bu uygulamayı bir iframe'e gömer.
 *
 *   PWA → Araç                                 Araç → PWA
 *   ──────────────────────────────             ──────────────────────────────
 *   caros-theme-manifest   (v3 manifest)       caros-preview-ready
 *   caros-theme-preview    (v1 CSS var)        caros-preview-manifest-ack
 *   caros-preview-probe    (geometri iste)     caros-preview-probe-result
 *
 * "DOKUNDUĞUM YERİ DÜZENLE" — TASARIM KARARI (önceki turdan DEĞİŞTİ):
 * Araç tarafı dokunuşu YAKALAMAZ, `preventDefault` ÇAĞIRMAZ, DOM'a vurgu
 * özniteliği/stil YAZMAZ. Yaptığı tek şey, kayıt defterindeki bileşenlerin
 * `getBoundingClientRect` ÖLÇÜMÜNÜ bildirmektir (salt-okuma). Seçim katmanını
 * Stüdyo, iframe'in ÜSTÜNE kendi overlay'ini çizerek yapar.
 *
 * NEDEN: (a) araç uygulamasının kendi davranışı hiç bozulmaz — dokunuş zaten
 * araca ULAŞMAZ, yutulması gerekmez; (b) önizleme iframe'inde kalıcı hiçbir
 * değişiklik olmaz (enjekte stil yok); (c) hover/seçili durumu Stüdyo'nun
 * kendi görsel dilinde çizilir; (d) CSS seçici hack'i yok — ölçüm kararlı
 * `componentId` (`data-editable`) üzerinden yapılır.
 *
 * GÜVENLİK
 *  - Yalnız güvenilen origin'lerden dinlenir.
 *  - v1 yolunda YALNIZ `--` ile başlayan CSS değişkenleri set edilir.
 *  - v3 yolunda manifest `parseIncomingManifest` fail-closed kapısından geçer;
 *    CSS metni HER ZAMAN themeManifest tarafından üretilir (ham metin girmez).
 *  - Ölçüm ve manifest yanıtı yalnız iframe içindeyken gönderilir.
 *  - Önizleme araca KALICI yazmaz (persist: false) — kalıcı değişim yalnız
 *    `theme_change` komutuyla olur.
 */
import { useLayoutStore } from '../store/useLayoutStore';
import { useCarTheme, type CarTheme } from '../store/useCarTheme';
import { applyIncomingThemeManifest } from './theme/themeRuntime';
import { THEME_COMPONENTS, type ThemeSurfaceId } from './theme/themeComponentRegistry';
import { openDrawer } from './drawerBus';
import { setFullMapView } from './mapViewBus';
import type { DrawerType } from '../components/layout/DockBar';

const TRUSTED = [
  /^https:\/\/carospro\.com$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

/**
 * Yüzey → çekmece eşlemesi (ÖNİZLEME GEZİNMESİ).
 *
 * ── KAPATILAN BOŞLUK ────────────────────────────────────────────────────────
 * Stüdyo'da bir ekran seçilince önizleme O EKRANA GİTMİYORDU: iframe ana
 * ekranda kalıyor, kullanıcı Ayarlar/Bildirim/İklim düzenlerken sonucu
 * GÖREMİYORDU. Yani düzenleme körlemesineydi. Bu, yeni eklenen ekranlara özgü
 * DEĞİLDİ — mevcut on çekmece ekranı da aynı durumdaydı.
 *
 * Eşleme BURADA yaşar (araç tarafı): `DrawerType` araca özgüdür ve paylaşılan
 * sözleşmeye SOKULMAZ. PWA yalnız kayıt defterindeki yüzey kimliğini yollar.
 *
 * `null` = bu yüzeyin ayrı bir çekmecesi yok (ana ekran) → tüm çekmeceler kapanır.
 * Listede olmayan yüzey → gezinme YAPILMAZ (uydurma hedef seçilmez).
 */
const SURFACE_DRAWER: Partial<Record<ThemeSurfaceId, DrawerType>> = {
  home:          'none',
  settings:      'settings',
  /* Bakım paneli Ayarlar sayfasının İÇİNDE yaşar — ayrı çekmecesi yoktur.
     Ayarları açmak, hiç gitmemekten iyidir; bölüme kaydırma AYRI iştir. */
  maintenance:   'settings',
  diagnostics:   'dtc',
  notifications: 'notifications',
  weather:       'weather',
  security:      'security',
  dashcam:       'dashcam',
  sport:         'sport',
  trip:          'triplog',
  climate:       'climate',
  phone:         'phone',
  apps:          'apps',
  media:         'music',
  /* Harita ÇEKMECE DEĞİLDİR — tam ekran görünümdür. Çekmeceler kapatılır,
     tam ekran harita ayrıca `mapViewBus` ile açılır (aşağıya bakın). */
  nav:           'none',
};

let installed = false;
/** Kaç kez ölçüm raporlandı (CAROS LAB gözlemi). */
let probeCount = 0;
let lastProbeFound = 0;

export interface PreviewProbeItem {
  id: string;
  /** iframe belge koordinatında CSS pikseli (Stüdyo yalnız ölçekler). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Aynı kimliğin kaçıncı örneği (0 tabanlı) — bkz. `MAX_BOXES_PER_ID`. */
  index: number;
}

/**
 * Bir kimlikten bildirilen en çok kutu. PWA tarafındaki `MAX_BOXES_PER_ID` ile
 * AYNI değerdir; iki uç da kendi sınırını uygular (fail-closed, tek tarafa
 * güvenilmez).
 */
const MAX_BOXES_PER_ID = 24;

function inIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent != null && window.parent !== window;
  } catch {
    return false;
  }
}

function postToParent(msg: unknown): void {
  try {
    if (inIframe()) window.parent.postMessage(msg, '*');
  } catch { /* ignore */ }
}

/**
 * Kayıt defterindeki bileşenlerin ŞU ANKİ ekrandaki ölçümü.
 * SALT-OKUMA: hiçbir öznitelik/stil yazılmaz, hiçbir olay dinlenmez.
 * Ekranda olmayan bileşen listeye GİRMEZ (uydurma kutu üretilmez).
 */
export function probeEditableGeometry(): PreviewProbeItem[] {
  const out: PreviewProbeItem[] = [];
  if (typeof document === 'undefined') return out;
  for (const c of THEME_COMPONENTS) {
    try {
      /* ── TÜM ÖRNEKLER (2026-08-18) ────────────────────────────────────────
       * Eskiden `querySelector` ile YALNIZ İLK düğüm bildiriliyordu. Bir tema
       * kuralı ekranda birden çok düğüme iner (ayar kartları, kategori menüsü,
       * dock butonları); ilk örnek dışındaki her şey Stüdyo'da DOKUNULAMAZ
       * kalıyordu. Kullanıcı bunu *"ayarlarda istediğim yeri düzenleyemiyorum"*
       * diye tarif etti. Artık her örnek kendi kutusunu alır; hepsi aynı
       * kimliğin düzenleyicisini açar. Sayı `MAX_BOXES_PER_ID` ile sınırlıdır. */
      const els = document.querySelectorAll(`[data-editable="${c.id}"]`);
      let n = 0;
      for (let i = 0; i < els.length && n < MAX_BOXES_PER_ID; i++) {
        const r = els[i].getBoundingClientRect();
        // Sıfır boyutlu / görünmez düğüm dokunulabilir değildir — raporlanmaz.
        if (!(r.width > 0) || !(r.height > 0)) continue;
        out.push({
          id: c.id,
          x: Math.round(r.left + window.scrollX),
          y: Math.round(r.top + window.scrollY),
          w: Math.round(r.width),
          h: Math.round(r.height),
          index: n,
        });
        n++;
      }
    } catch { /* tek bileşen patlarsa kalanı bildir */ }
  }
  return out;
}

function sendProbe(): void {
  if (!inIframe()) return;
  const items = probeEditableGeometry();
  probeCount++;
  lastProbeFound = items.length;
  postToParent({
    type: 'caros-preview-probe-result',
    items,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  });
}

/** CAROS LAB gözlemi — köprünün ölçüm sayaçları (içerik taşımaz). */
export function getPreviewBridgeStats(): {
  installed: boolean;
  inIframe: boolean;
  probeCount: number;
  lastProbeFound: number | null;
} {
  return {
    installed,
    inIframe: inIframe(),
    probeCount,
    lastProbeFound: probeCount === 0 ? null : lastProbeFound,
  };
}

export function initThemePreviewBridge(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('message', (e: MessageEvent) => {
    if (!TRUSTED.some((re) => re.test(e.origin))) return;
    const data = e.data as {
      type?: string;
      vars?: Record<string, unknown>;
      layout?: unknown;
      manifest?: unknown;
      /** `caros-preview-surface`: Stüdyo'da seçilen ekranın kayıt defteri kimliği. */
      surface?: unknown;
    } | null;
    if (!data || typeof data.type !== 'string') return;

    try {
      switch (data.type) {
        /* ── v3: Tema Manifesti canlı önizleme (kalıcı DEĞİL) ── */
        case 'caros-theme-manifest': {
          const r = applyIncomingThemeManifest(data.manifest, 'preview');
          // Önizlemede baz tema da değişmeli (layout bileşeni değişir). Manifest
          // reddedilirse HİÇBİR ŞEY yapılmaz (fail-closed).
          if (r.ok && r.themeId) {
            const cur = useCarTheme.getState().theme;
            const next = (cur.endsWith('-day') ? `${r.themeId}-day` : r.themeId) as CarTheme;
            if (next !== cur) useCarTheme.getState().setTheme(next);
          }
          postToParent({
            type: 'caros-preview-manifest-ack',
            ok: r.ok,
            reason: r.ok ? null : (r.reason ?? 'bilinmeyen'),
          });
          // Tema/stil değişince kutular kayar → yeni ölçümü kendiliğinden yolla.
          // İki kare beklenir: React commit + tarayıcı yerleşimi tamamlansın.
          scheduleProbe();
          break;
        }

        /* ── v1 (geri-uyum): ham CSS var torbası ── */
        case 'caros-theme-preview': {
          const root = document.documentElement;
          const vars = data.vars;
          if (vars && typeof vars === 'object') {
            const base = (vars as Record<string, unknown>).__baseTheme;
            if (typeof base === 'string') {
              try { useCarTheme.getState().setTheme(base as CarTheme); } catch { /* fail-soft */ }
            }
            for (const [k, v] of Object.entries(vars)) {
              if (k.startsWith('--')) root.style.setProperty(k, String(v));
            }
          }
          if (data.layout) {
            try { useLayoutStore.getState().applyIntent(data.layout); } catch { /* fail-soft */ }
          }
          scheduleProbe();
          break;
        }

        /* ── Stüdyo overlay'i için ölçüm ── */
        case 'caros-preview-probe':
          sendProbe();
          break;

        /* ── Önizleme gezinmesi: Stüdyo'da seçilen ekrana git ── */
        case 'caros-preview-surface': {
          const sid = data.surface;
          if (typeof sid !== 'string') break;
          const hedef = SURFACE_DRAWER[sid as ThemeSurfaceId];
          // Bilinmeyen yüzey → HİÇBİR ŞEY yapılmaz (rastgele ekran açılmaz).
          if (hedef === undefined) break;
          try { openDrawer(hedef); } catch { /* fail-soft: gezinme ölçümü bozmaz */ }
          /* Harita yüzeyi çekmece DEĞİL, tam ekran görünümdür — ayrı yol.
             Diğer yüzeylere geçilirken KAPATILIR, yoksa harita üstte kalıp
             seçilen ekranı örter ve ölçüm yanlış kutuları bildirir. */
          try { setFullMapView(sid === 'nav'); } catch { /* fail-soft */ }
          scheduleProbe();
          break;
        }

        default:
          break;
      }
    } catch { /* fail-soft */ }
  });

  // Parent'a (PWA) hazır olduğumuzu bildir → ilk manifesti yollasın.
  postToParent({ type: 'caros-preview-ready' });
  scheduleProbe();
}

/** rAF varsa iki kare sonra, yoksa kısa timeout ile ölç (test/SSR güvenli). */
function scheduleProbe(): void {
  if (!inIframe()) return;
  try {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => sendProbe()));
    } else {
      setTimeout(sendProbe, 50);
    }
  } catch {
    try { sendProbe(); } catch { /* ignore */ }
  }
}
