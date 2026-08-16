/**
 * themeRuntimeSources — Tema Çalışma Zamanı gözlem katmanı (TEK okuma noktası).
 *
 * SALT-OKUNUR: tema UYGULAMAZ, manifest GÖNDERMEZ/SİLMEZ, önizleme köprüsünü
 * TETİKLEMEZ, ağa ÇIKMAZ. Yalnız mevcut senkron getter'lar + DOM varlık sayımı.
 *
 * GİZLİLİK: kullanıcının seçtiği renk değerleri kişisel veri değildir ama gereksizdir —
 * ekrana ham renk/manifest İÇERİĞİ taşınmaz; yalnız SAYI, DURUM ve ZAMAN gösterilir.
 *
 * Her getter kendi try/catch'i içindedir: tek bir kaynak patlarsa ekran kalanı gösterir.
 */

import { getThemeRuntimeSnapshot, type ThemeRuntimeSnapshot } from '../theme/themeRuntime';
import { THEME_COMPONENTS, THEME_SURFACES } from '../theme/themeComponentRegistry';
import { getPreviewBridgeStats } from '../themePreviewBridge';
import { useLayoutStore } from '../../store/useLayoutStore';

export interface ThemeRuntimeRawSnapshot {
  /** Okuma anı (Unix ms) — yaş hesapları için. */
  readonly readAt: number;
  readonly runtime: ThemeRuntimeSnapshot | null;
  /** Kayıt defterindeki toplam düzenlenebilir bileşen sayısı. */
  readonly registryComponentCount: number;
  readonly registrySurfaceCount: number;
  /** DOM'da ŞU AN gerçekten bulunan `data-editable` düğüm sayısı. */
  readonly domEditableCount: number | null;
  /** DOM'da bulunan ve kayıt defterinde de olan bileşen sayısı. */
  readonly domRegisteredCount: number | null;
  /** DOM'da bulunan `data-theme-surface` yüzey sayısı. */
  readonly domSurfaceCount: number | null;
  /** Manifest CSS etiketi DOM'da var mı. */
  readonly styleTagPresent: boolean | null;
  /** Manifest CSS etiketindeki karakter sayısı (içerik DEĞİL). */
  readonly styleTagBytes: number | null;
  /** Önizleme köprüsü kuruldu mu. */
  readonly bridgeInstalled: boolean;
  /** Bu çalışma iframe içinde mi (Stüdyo önizlemesi) — gerçek araçta false. */
  readonly bridgeInIframe: boolean;
  /** Stüdyo overlay'i için kaç kez geometri ölçümü yollandı. */
  readonly probeCount: number;
  /** Son ölçümde ekranda bulunan düzenlenebilir bileşen sayısı (hiç ölçüm yoksa null). */
  readonly lastProbeFound: number | null;
  /** Yerleşim niyeti tema-başına saklanan tema sayısı (kalıntı teşhisi). */
  readonly layoutThemeCount: number | null;
}

const EMPTY: ThemeRuntimeRawSnapshot = {
  readAt: 0,
  runtime: null,
  registryComponentCount: 0,
  registrySurfaceCount: 0,
  domEditableCount: null,
  domRegisteredCount: null,
  domSurfaceCount: null,
  styleTagPresent: null,
  styleTagBytes: null,
  bridgeInstalled: false,
  bridgeInIframe: false,
  probeCount: 0,
  lastProbeFound: null,
  layoutThemeCount: null,
};

function safeNow(): number {
  try { return Date.now(); } catch { return 0; }
}

function readRuntime(): ThemeRuntimeSnapshot | null {
  try { return getThemeRuntimeSnapshot(); } catch { return null; }
}

function readDom(): {
  editable: number | null;
  registered: number | null;
  surfaces: number | null;
  tagPresent: boolean | null;
  tagBytes: number | null;
} {
  try {
    if (typeof document === 'undefined') {
      return { editable: null, registered: null, surfaces: null, tagPresent: null, tagBytes: null };
    }
    const nodes = document.querySelectorAll('[data-editable]');
    let registered = 0;
    for (const c of THEME_COMPONENTS) {
      if (document.querySelector(`[data-editable="${c.id}"]`)) registered++;
    }
    const tag = document.getElementById('caros-theme-manifest-css');
    return {
      editable: nodes.length,
      registered,
      surfaces: document.querySelectorAll('[data-theme-surface]').length,
      tagPresent: tag !== null,
      tagBytes: tag ? (tag.textContent ?? '').length : null,
    };
  } catch {
    return { editable: null, registered: null, surfaces: null, tagPresent: null, tagBytes: null };
  }
}

function readLayoutThemeCount(): number | null {
  try {
    // SALT OKUMA — hiçbir niyet yazılmaz/sıfırlanmaz.
    const byTheme = useLayoutStore.getState().byTheme;
    return byTheme && typeof byTheme === 'object' ? Object.keys(byTheme).length : null;
  } catch {
    return null;
  }
}

/** Tek senkron okuma — ekran açılışında ve elle YENİLE'de çağrılır. */
export function readThemeRuntimeSnapshot(): ThemeRuntimeRawSnapshot {
  try {
    const dom = readDom();
    const bridge = (() => {
      try { return getPreviewBridgeStats(); } catch { return null; }
    })();
    return {
      readAt: safeNow(),
      runtime: readRuntime(),
      registryComponentCount: THEME_COMPONENTS.length,
      registrySurfaceCount: THEME_SURFACES.length,
      domEditableCount: dom.editable,
      domRegisteredCount: dom.registered,
      domSurfaceCount: dom.surfaces,
      styleTagPresent: dom.tagPresent,
      styleTagBytes: dom.tagBytes,
      bridgeInstalled: bridge?.installed ?? false,
      bridgeInIframe: bridge?.inIframe ?? false,
      probeCount: bridge?.probeCount ?? 0,
      lastProbeFound: bridge?.lastProbeFound ?? null,
      layoutThemeCount: readLayoutThemeCount(),
    };
  } catch {
    return { ...EMPTY, readAt: safeNow() };
  }
}
