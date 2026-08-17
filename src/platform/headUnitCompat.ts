/**
 * Head Unit Compatibility Layer
 *
 * Eski Android / eski WebView / düşük donanımlı cihazları otomatik tespit eder.
 * Tespit edilirse:
 *  - data-compat-mode="true" → <html> etiketine eklenir (CSS override tetikler)
 *  - performanceMode 'lite' olarak zorlanır
 *  - dvh height sorunu düzeltilir
 *  - İzin diyaloğu sonrası siyah ekran için agresif repaint uygulanır
 *
 * applyCompatMode() → main.tsx'te React render öncesi çağrılmalı
 */

import { setPerformanceMode, getPerformanceMode } from './performanceMode';
import { getCapabilities, getDeviceTier } from './deviceCapabilities';

// Listener'ların tek seferlik kaydedilmesini sağlar — HMR / re-entry'ye karşı guard
let _compatListenersAttached = false;

export interface CompatProfile {
  /** Düşük performans sınıfı — efekt/bütçe kararları için. */
  isLowTier: boolean;
  /**
   * @deprecated Kütük #411 — bu alan CİHAZ TÜRÜ değil PERFORMANS SINIFI taşır.
   * Yerleşim kararlarında kullanmayın; `isLowTier` ile aynı değeri döndürür.
   */
  isHeadUnit: boolean;
  supportsBackdropFilter: boolean;
  supportsDvh: boolean;
  cpuCores: number;
  memoryGb: number;
  androidVersion: number;
  webViewVersion: number;
  weakGpu: boolean;
}

/* ── Profile builder — TEK otoriteden (deviceCapabilities) türetilir ─────────
 * Eskiden burada ayrı UA/CSS/ekran/GPU probe helper'ları vardı; hepsi
 * deviceCapabilities'e taşındı. isHeadUnit artık kanonik `DeviceTier === 'low'`:
 * performanceMode + runtime ile AYNI tespit kaynağından beslenir → tutarlı. */

/**
 * ⚠️ KAVRAM AYRIMI (saha 2026-08-05 · kütük #411).
 *
 * ÖLÇÜLDÜ: cihaz bir TELEFONDU (Redmi 23090RA98I) ama `cl_isHeadUnit = "1"`
 * yazılmıştı; head unit için tasarlanmış px/metre yerleşimi telefonda
 * uygulanınca #412'deki üst üste binen/kırpılan ekranlar çıktı.
 *
 * KÖK: `isHeadUnit` aslında "düşük performans sınıfı"nın takma adıydı
 * (`DeviceTier === 'low'`). Düşük RAM'li bir telefon otomatik olarak
 * "head unit" sayılıyordu. Performans sınıfı ile CİHAZ TÜRÜ farklı sorulardır:
 *   • sınıf  → hangi efektleri kapatayım? (blur, animasyon, worker)
 *   • tür    → hangi YERLEŞİMİ kullanayım? (HU px ölçüleri vs telefon)
 * Alan adı `isLowTier` olarak netleştirildi; `isHeadUnit` geriye dönük uyum
 * için KORUNDU ama artık tek başına yerleşim kararı vermek için kullanılmaz.
 */
function buildProfile(): CompatProfile {
  const c = getCapabilities();
  const lowTier = getDeviceTier() === 'low';
  return {
    isLowTier:              lowTier,
    isHeadUnit:             lowTier,
    supportsBackdropFilter: c.supportsBackdropFilter,
    supportsDvh:            c.supportsDvh,
    cpuCores:               c.cores,
    memoryGb:               c.memoryMb > 0 ? c.memoryMb / 1024 : 0,
    androidVersion:         c.androidVersion,
    webViewVersion:         c.webViewVersion,
    weakGpu:                c.weakGpu,
  };
}

/* ── Runtime state ─────────────────────────────────────────── */

let _profile: CompatProfile | null = null;

export function getCompatProfile(): CompatProfile {
  if (!_profile) _profile = buildProfile();
  return _profile;
}

export function isLowEndDevice(): boolean {
  return getCompatProfile().isLowTier;
}

export function supportsBackdropFilter(): boolean {
  return getCompatProfile().supportsBackdropFilter;
}

/* ── Dynamic Scaling Engine ─────────────────────────────────── */
// Cihaz ekran genişliğine göre piecewise-linear --scale-factor hesaplar:
//   ≤ 800 px → 0.8  |  1280 px → 1.0  |  ≥ 1920 px → 1.5
// html font-size bu değerle ayarlanır; rem/em tabanlı tüm ölçüler otomatik uyar.

function _computeScaleFactor(width: number): number {
  if (width <= 800)  return 0.8;
  if (width <= 1280) return 0.8 + ((width - 800)  / 480) * 0.2;
  if (width <= 1920) return 1.0 + ((width - 1280) / 640) * 0.5;
  return 1.5;
}

function _applyScaleFactor(): void {
  const width = window.innerWidth || document.documentElement.clientWidth;
  const scale = _computeScaleFactor(width);
  document.documentElement.style.setProperty('--scale-factor', scale.toFixed(3));
  // rem tabanlı ölçekleme: 1rem = 16px × scale-factor
  document.documentElement.style.fontSize = (16 * scale).toFixed(2) + 'px';
}

let _scaleListenerAttached = false;

function _startDynamicScaling(): void {
  _applyScaleFactor();
  if (!_scaleListenerAttached) {
    _scaleListenerAttached = true;
    window.addEventListener('resize', _applyScaleFactor, { passive: true });
  }
}

/* ── Repaint helper — izin diyaloğu sonrası siyah ekran fix ── */

function forceRepaint(): void {
  try {
    requestAnimationFrame(() => {
      // GPU layer yeniden oluştur
      document.documentElement.style.transform = 'translateZ(0)';
      requestAnimationFrame(() => {
        document.documentElement.style.transform = '';
        // Layout recalc tetikle
        void document.documentElement.offsetHeight;
        // Takılı theme crossfade overlay'i temizle
        const overlay = document.getElementById('theme-crossfade-overlay');
        if (overlay) {
          overlay.style.transition = 'none';
          overlay.style.opacity = '0';
          overlay.style.pointerEvents = 'none';
        }
        // Takılı brightness filter'ı temizle
        const filterVal = document.documentElement.style.filter;
        if (filterVal && filterVal !== 'none') {
          document.documentElement.style.filter = '';
        }
        // Root'un height'ı 0 kalmışsa düzelt
        const root = document.getElementById('root');
        if (root && root.offsetHeight < 10) {
          root.style.height = '100vh';
          requestAnimationFrame(() => { root.style.height = ''; });
        }
      });
    });
  } catch {
    // requestAnimationFrame yoksa veya hata olursa sessizce devam et
  }
}

/* ── applyCompatMode — main.tsx'ten React render öncesi çağır ── */

function applyCompatThemeDefaults(): void {
  // Eski cihazlarda glass/neon tema → minimal/flat zorla (blur yok, performanslı)
  // Kullanıcı daha önce kendi tercihi varsa dokunma
  if (localStorage.getItem('cl_themeStyle_userSet') === '1') return;
  try {
    const key = 'car-launcher-storage';
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw) as { state?: { settings?: { themeStyle?: string; widgetStyle?: string } } };
    if (!data?.state?.settings) return;
    const s = data.state.settings;
    if (s.themeStyle === 'glass' || s.themeStyle === 'neon') {
      s.themeStyle = 'minimal';
      s.widgetStyle = 'flat';
      localStorage.setItem(key, JSON.stringify(data));
    }
  } catch { /* quota veya parse hatası — devam et */ }
}

/** Önceki başlatmada DÜŞÜK SINIF tespit edildiyse hemen compat-mode aç (FOUC önler) */
function applyCachedHeadUnitFlag(): boolean {
  try {
    // Kütük #411: yeni anahtar `cl_compatLowTier`. Eski `cl_isHeadUnit` yalnız
    // GERİYE DÖNÜK okunur (kurulu cihazlarda FOUC geri gelmesin) — YAZILMAZ.
    const lowTier = localStorage.getItem('cl_compatLowTier') === '1'
                 || localStorage.getItem('cl_isHeadUnit') === '1';
    if (lowTier) {
      document.documentElement.setAttribute('data-compat-mode', 'true');
      document.documentElement.classList.add('perf-low');
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export function applyCompatMode(): void {
  // Cache'den anında uygula — React render öncesi blur/animation kapanır
  applyCachedHeadUnitFlag();

  // Dinamik ölçekleme — compat/normal tüm cihazlarda çalışır
  _startDynamicScaling();

  const profile = getCompatProfile();

  // Cache: sonraki açılış için PERFORMANS SINIFI sonucunu sakla (#411).
  // Bu bir cihaz TÜRÜ damgası değildir — telefonu head unit yapmaz.
  try {
    localStorage.setItem('cl_compatLowTier', profile.isLowTier ? '1' : '0');
    // Eski anahtarı temizle: yanlış semantiğiyle kalıcı hasar veriyordu.
    if (localStorage.getItem('cl_isHeadUnit') !== null) localStorage.removeItem('cl_isHeadUnit');
  } catch { /* quota */ }

  if (profile.isLowTier) {
    // CSS override için data attribute + perf-low class
    document.documentElement.setAttribute('data-compat-mode', 'true');
    document.documentElement.classList.add('perf-low');

    // Kullanıcı manuel olarak perf mode ayarlamamışsa 'lite' zorla
    const hasUserPref = (() => {
      try { return localStorage.getItem('cl_performanceMode_userSet') === '1'; } catch { return false; }
    })();
    if (!hasUserPref && getPerformanceMode() !== 'lite') {
      setPerformanceMode('lite');
    }

    // Eski cihazda glass/neon temayı minimal'a zorla — blur rendera zarar verir
    applyCompatThemeDefaults();

    // dvh desteği yoksa height'ı düzelt
    if (!profile.supportsDvh) {
      document.documentElement.style.height = '100%';
      document.body.style.height = '100%';
      const root = document.getElementById('root');
      if (root) root.style.height = '100%';
    }
  } else {
    /* ── ÖNBELLEK GERİ ALMA (kütük #601) ───────────────────────────────────
     * `applyCachedHeadUnitFlag()` yukarıda ÖNBELLEĞE bakıp `perf-low`u zaten
     * eklemiş olabilir (FOUC önleme). Canlı profil "düşük değil" diyorsa o
     * sınıf GERİ ALINMALIDIR — yoksa bir kez '1' yazılmış cihaz, sınıflandırma
     * düzelse bile o oturum boyunca düşük-uç kalırdı.
     *
     * ÖLÇÜLEN BEDEL (2026-08-16, Xiaomi 23090RA98I): `perf-low` aktifken
     * `MapInteractionManager._smoothPan` false olur ve kamera `easeTo` yerine
     * `jumpTo` kullanır → harita ~6,7 fps'te "takıla takıla" akar (#570'in
     * ta kendisi). Önbellek yazılıp bir daha SİLİNMEDİĞİ için, #599'un tier
     * düzeltmesi tek başına yetmezdi: ilk açılış yine takılırdı.
     *
     * Yalnız bu iki işaret geri alınır. `cl_performanceMode` DEĞİŞTİRİLMEZ —
     * onu kullanıcı da ayarlamış olabilir; sessizce ezmek kullanıcı ayarını
     * çalmak olur. Önbellek anahtarı zaten yukarıda '0' olarak yazıldı. */
    document.documentElement.removeAttribute('data-compat-mode');
    document.documentElement.classList.remove('perf-low');
  }

  // Tüm cihazlarda: izin diyaloğu / focus dönüşü için agresif repaint
  // Guard: main.tsx HMR ya da çift çağrı durumunda listener kümülenmesini engelle
  if (!_compatListenersAttached) {
    _compatListenersAttached = true;
    const onVisible = () => { if (!document.hidden) forceRepaint(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', forceRepaint);
    // Capacitor resume eventi
    document.addEventListener('resume', forceRepaint);
  }

  // Force Resize: bazı head unit'ler ilk açılışta WebView boyutunu yanlış hesaplar.
  // 500ms sonra resize zorla → layout yeniden hesaplanır, siyah ekran düzelir.
  setTimeout(function() {
    try { window.dispatchEvent(new Event('resize')); } catch { /* ignore */ }
  }, 500);
}

/**
 * Kullanıcı settings'ten performance mode seçtiğinde bunu işaretle,
 * böylece auto-detect bu tercihi ezmez.
 */
export function markUserSetPerformanceMode(): void {
  try { localStorage.setItem('cl_performanceMode_userSet', '1'); } catch { /* quota */ }
}
