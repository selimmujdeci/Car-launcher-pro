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
          .filter(na => !curatedPackages.has(na.packageName))
          .map(na => ({
            id: `native-${na.packageName}`,
            name: na.name,
            icon: guessIcon(na),
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
  
  // Generic icons
  if (app.isSystemApp) return '⚙️';
  return '📱';
}
