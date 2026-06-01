import { useState, useEffect, useMemo } from 'react';
import { CarLauncher, type NativeApp } from './nativePlugin';
import { ALL_APPS, type AppItem, type AppCategory } from '../data/apps';
import { isNative } from './bridge';

/** requestIdleCallback yoksa (Safari <16) setTimeout(0) ile fallback */
const _rIdle: (fn: () => void) => void =
  typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn, { timeout: 1000 })
    : (fn) => setTimeout(fn, 0);

export interface AppDiscoveryResult {
  apps: AppItem[];
  appMap: Record<string, AppItem>;
  loading: boolean;
}

/**
 * System app package variants that are covered by curated entries using universal
 * actions/categories. Prevents duplicate tiles when the OEM ships a different
 * package name for phone / contacts / messages / camera / clock / calculator.
 */
const SYSTEM_APP_BLOCKLIST = new Set([
  // Phone / dialer
  'com.android.dialer', 'com.samsung.android.dialer', 'com.miui.dialer',
  'com.oneplus.dialer', 'com.lge.dialer', 'com.motorola.dialer',
  // Contacts
  'com.android.contacts', 'com.samsung.android.contacts', 'com.miui.contacts',
  // Messages / SMS
  'com.android.mms', 'com.samsung.android.messaging', 'com.android.messaging',
  'com.google.android.apps.messaging', 'com.miui.sms',
  // Camera
  'com.android.camera', 'com.android.camera2', 'com.samsung.android.camera',
  'com.miui.camera', 'com.oneplus.camera', 'com.huawei.camera',
  // Clock / alarm
  'com.android.deskclock', 'com.google.android.deskclock', 'com.samsung.android.clock',
  'com.miui.clock',
  // Calculator
  'com.android.calculator2', 'com.google.android.calculator', 'com.samsung.android.calculator',
  'com.miui.calculator',
]);

/* ── Native Icon Cache ───────────────────────────────────────────────────────
 *
 * Base64 PNG data URI'leri (~4–8 KB/uygulama) React state'te tutulmaz.
 * Nedeni: setState her render'da nesne karşılaştırması (Object.is) yapar;
 * 50 uygulama × 8 KB string karşılaştırması = gereksiz CPU yükü.
 *
 * Çözüm: Module-level Map — React tree dışında, GC edilmez, yeniden parse edilmez.
 * Curated ALL_APPS ikonları da buraya eklenir (filtrelenmiş olsalar bile).
 *
 * CLAUDE.md §3 Performans: Map<string,string> ≈ 50 × 8 KB = 400 KB sabit heap,
 * render döngüsüne dahil değil.
 */
const _iconCache = new Map<string, string>();

/**
 * Paket adına göre native Base64 PNG ikonunu döndürür.
 * AppItem.icon'u bypass eder — her zaman native ikonu tercih eder.
 *
 * @param packageName Android paket adı (örn: 'com.spotify.music')
 * @returns data:image/png;base64,… URI veya undefined (native ikon yoksa)
 */
export function getNativeIcon(packageName: string): string | undefined {
  return packageName ? _iconCache.get(packageName) : undefined;
}

/**
 * Uygulama için en iyi ikonu döndürür:
 *   1. _iconCache'den native Base64 PNG  ← tercih
 *   2. app.icon (emoji fallback)         ← yedek
 *
 * Bileşenler app.icon yerine bunu çağırmalı.
 */
export function resolveAppIcon(app: AppItem): string {
  const pkg = app.androidPackage ?? '';
  return (pkg && _iconCache.get(pkg)) ?? app.icon;
}

/**
 * Hook to discover installed apps on the device and merge them with our curated list.
 */
export function useApps(): AppDiscoveryResult {
  const [discoveredApps, setDiscoveredApps] = useState<AppItem[]>([]);
  const [installedPackages, setInstalledPackages] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(isNative);

  useEffect(() => {
    if (!isNative) {
      setLoading(false);
      return;
    }

    async function scan() {
      try {
        const { apps } = await CarLauncher.getApps();

        // Curated package names for easy lookup
        const curatedPackages = new Set(
          ALL_APPS.map(a => a.androidPackage).filter((p): p is string => Boolean(p))
        );

        // ── İkon önbelleğini doldur ────────────────────────────────────────
        // İlk 20 ikon ana thread'de hemen yüklenir (görünür alanı hızlı doldur).
        // Kalanlar requestIdleCallback ile toplu yüklenir — UI frame'ini bloklamaz.
        // Curated uygulamaların (Spotify, Maps vb.) ikonları da böylece
        // app.icon emoji'sini override edecek şekilde cache'e girer.
        const SYNC_COUNT = 20;
        apps.slice(0, SYNC_COUNT).forEach(na => {
          if (na.icon) _iconCache.set(na.packageName, na.icon);
        });
        if (apps.length > SYNC_COUNT) {
          const deferred = apps.slice(SYNC_COUNT);
          let _offset    = 0;
          const _fillBatch = () => {
            const end = Math.min(_offset + 8, deferred.length);
            for (let i = _offset; i < end; i++) {
              const na = deferred[i];
              if (na.icon) _iconCache.set(na.packageName, na.icon);
            }
            _offset = end;
            if (_offset < deferred.length) _rIdle(_fillBatch);
          };
          _rIdle(_fillBatch);
        }

        // ── Yüklü paket kümesi — ALL_APPS filtresi için (render'a karışmaz)
        setInstalledPackages(new Set<string>(apps.map(na => na.packageName)));

        // ── Keşfedilen (non-curated) uygulamalar ──────────────────────────
        // AppItem.icon: SADECE emoji fallback — Base64 React state'e GİRMEZ.
        // resolveAppIcon() veya getNativeIcon() ile gerçek ikon alınır.
        const newApps: AppItem[] = apps
          .filter(na =>
            !curatedPackages.has(na.packageName) &&
            !SYSTEM_APP_BLOCKLIST.has(na.packageName)
          )
          .map(na => ({
            id:               `native-${na.packageName}`,
            name:             na.name,
            icon:             guessIcon(na),   // emoji — küçük string, render-safe
            category:         (na.isSystemApp ? 'system' : 'utility') as AppCategory,
            url:              '',
            androidPackage:   na.packageName,
            supportsFavorite: true,
            supportsRecent:   true,
          }));

        setDiscoveredApps(newApps);
      } catch (err) {
        console.error('[AppDiscovery] Scan failed:', err);
      } finally {
        setLoading(false);
      }
    }

    scan();
  }, []);

  const mergedApps = useMemo(() => {
    if (isNative) {
      // Native modda yalnızca cihazda yüklü curated uygulamaları göster.
      // ŞART A: internalPage tanımlı (örn: Settings) → her zaman tut.
      // ŞART B: androidPackage cihazda yüklü → tut.
      // ŞART C: androidPackage yok (intent/category tabanlı: Telefon, Mesaj…) → tut.
      const filtered = ALL_APPS.filter(app => {
        if (app.internalPage !== undefined) return true;       // A
        if (!app.androidPackage) return true;                  // C
        return installedPackages.has(app.androidPackage);      // B
      });
      return [...filtered, ...discoveredApps];
    }
    // Web/Demo: küratörlü listenin tamamını göster
    return [...ALL_APPS, ...discoveredApps];
  }, [discoveredApps, installedPackages]);

  const mergedMap = useMemo(() => {
    return Object.fromEntries(mergedApps.map(a => [a.id, a]));
  }, [mergedApps]);

  return { apps: mergedApps, appMap: mergedMap, loading };
}

/**
 * Paket adına göre public/icons.svg sembol ID'sini döner.
 * Emoji kullanımı tamamen kaldırıldı — tüm ikonlar SVG sembol referansıdır.
 *
 * Öncelik sırası (appDiscovery genelinde):
 *   1. _iconCache → native Android Base64 PNG (en yüksek öncelik)
 *   2. guessIcon  → /icons.svg#<id> sembol referansı
 *   3. /icons.svg#icon-app → Generic App sembolü (hiçbir eşleşme yoksa)
 */
function guessIcon(app: NativeApp): string {
  const pkg  = app.packageName.toLowerCase();
  const name = app.name.toLowerCase();

  if (pkg.includes('clock') || pkg.includes('alarm'))                          return '/icons.svg#icon-clock';
  if (pkg.includes('calculator'))                                               return '/icons.svg#icon-calculator';
  if (pkg.includes('camera'))                                                   return '/icons.svg#icon-camera';
  if (pkg.includes('gallery') || pkg.includes('photos'))                       return '/icons.svg#icon-gallery';
  if (pkg.includes('music') || pkg.includes('player') || pkg.includes('audio')) return '/icons.svg#icon-music';
  if (pkg.includes('video') || pkg.includes('movie'))                          return '/icons.svg#icon-video';
  if (pkg.includes('file') || pkg.includes('manager') || pkg.includes('explorer')) return '/icons.svg#icon-files';
  if (pkg.includes('mail'))                                                     return '/icons.svg#icon-mail';
  if (pkg.includes('calendar'))                                                 return '/icons.svg#icon-calendar';
  if (pkg.includes('contact'))                                                  return '/icons.svg#icon-contact';
  if (pkg.includes('phone') || pkg.includes('dialer'))                         return '/icons.svg#icon-phone';
  if (pkg.includes('sms') || pkg.includes('mms') || pkg.includes('message'))   return '/icons.svg#icon-message';
  if (pkg.includes('map') || pkg.includes('nav'))                              return '/icons.svg#icon-map';
  if (pkg.includes('weather'))                                                  return '/icons.svg#icon-weather';
  if (pkg.includes('browser') || pkg.includes('chrome') || pkg.includes('firefox')) return '/icons.svg#icon-browser';
  if (pkg.includes('setting'))                                                  return '/icons.svg#icon-settings';
  if (pkg.includes('tool') || pkg.includes('fix'))                             return '/icons.svg#icon-tools';
  if (pkg.includes('radio'))                                                    return '/icons.svg#icon-radio';
  if (pkg.includes('market') || pkg.includes('store') || pkg.includes('vending')) return '/icons.svg#icon-store';

  // İsim bazlı eşleşmeler
  if (name.includes('müzik') || name.includes('music'))  return '/icons.svg#icon-music';
  if (name.includes('harita') || name.includes('map'))   return '/icons.svg#icon-map';

  // Sistem uygulaması → CPU ikonu; diğerleri → Generic App
  if (app.isSystemApp) return '/icons.svg#icon-system';
  return '/icons.svg#icon-app';
}
