import { useState, useEffect, useMemo } from 'react';
import { CarLauncher, type NativeApp } from './nativePlugin';
import { ALL_APPS, type AppItem, type AppCategory } from '../data/apps';
import { isNative } from './bridge';

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

/**
 * Hook to discover installed apps on the device and merge them with our curated list.
 */
export function useApps(): AppDiscoveryResult {
  const [discoveredApps, setDiscoveredApps] = useState<AppItem[]>([]);
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
          ALL_APPS.map(a => a.androidPackage).filter(Boolean)
        );

        const newApps: AppItem[] = apps
          .filter(na => !curatedPackages.has(na.packageName) && !SYSTEM_APP_BLOCKLIST.has(na.packageName))
          .map(na => ({
            id: `native-${na.packageName}`,
            name: na.name,
            // Native Base64 ikon varsa emoji'yi bypass et
            icon: na.icon ?? guessIcon(na),
            category: (na.isSystemApp ? 'system' : 'utility') as AppCategory,
            url: '',
            androidPackage: na.packageName,
            supportsFavorite: true,
            supportsRecent: true,
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
    // Keep curated apps at the top, then add newly discovered ones
    return [...ALL_APPS, ...discoveredApps];
  }, [discoveredApps]);

  const mergedMap = useMemo(() => {
    return Object.fromEntries(mergedApps.map(a => [a.id, a]));
  }, [mergedApps]);

  return { apps: mergedApps, appMap: mergedMap, loading };
}

/**
 * Heuristics to pick a decent emoji icon for a discovered app based on its name/package.
 */
function guessIcon(app: NativeApp): string {
  const pkg = app.packageName.toLowerCase();
  const name = app.name.toLowerCase();

  if (pkg.includes('clock') || pkg.includes('alarm')) return '⏰';
  if (pkg.includes('calculator')) return '🧮';
  if (pkg.includes('camera')) return '📷';
  if (pkg.includes('gallery') || pkg.includes('photos')) return '🖼️';
  if (pkg.includes('music') || pkg.includes('player') || pkg.includes('audio')) return '🎵';
  if (pkg.includes('video') || pkg.includes('movie')) return '🎬';
  if (pkg.includes('file') || pkg.includes('manager') || pkg.includes('explorer')) return '📁';
  if (pkg.includes('mail')) return '📧';
  if (pkg.includes('calendar')) return '📅';
  if (pkg.includes('contact')) return '👤';
  if (pkg.includes('phone') || pkg.includes('dialer')) return '📞';
  if (pkg.includes('sms') || pkg.includes('mms') || pkg.includes('message')) return '💬';
  if (pkg.includes('map') || pkg.includes('nav')) return '🗺️';
  if (pkg.includes('weather')) return '⛅';
  if (pkg.includes('browser') || pkg.includes('chrome') || pkg.includes('firefox')) return '🌐';
  if (pkg.includes('setting')) return '⚙️';
  if (pkg.includes('tool') || pkg.includes('fix')) return '🔧';
  if (pkg.includes('radio')) return '📻';
  if (pkg.includes('market') || pkg.includes('store') || pkg.includes('vending')) return '🛍️';

  // Name-based fallbacks
  if (name.includes('müzik') || name.includes('music')) return '🎵';
  if (name.includes('harita') || name.includes('map')) return '🗺️';

  // Generic icons
  if (app.isSystemApp) return '⚙️';
  return '📱';
}
