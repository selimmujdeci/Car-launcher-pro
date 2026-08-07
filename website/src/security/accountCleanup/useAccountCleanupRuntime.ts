'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  getAccountCleanupRuntime,
  getAccountCleanupServerSnapshot,
  type AccountCleanupRuntime,
  type AccountCleanupRuntimeSnapshot,
} from './accountCleanupRuntime';

/**
 * ── SSR GÜVENLİĞİ (production prerender kırığının KÖKÜ) ────────────────
 *
 * ESKİ KUSUR: bu kanca `getAccountCleanupRuntime()`i **render sırasında
 * koşulsuz** çağırıyordu. O fonksiyon `typeof window === 'undefined'` iken
 * BİLİNÇLİ olarak `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY` fırlatır — sunucuda
 * çalışması YASAKTIR. Sonuç: `AccountCleanupBootGate` ile sarılı **TÜM**
 * `/dashboard/*` sayfaları prerender sırasında düşüyordu (14 sayfa).
 *
 * Tasarımın niyeti zaten SSR-safe idi: `useSyncExternalStore`a üçüncü argüman
 * olarak `getAccountCleanupServerSnapshot` VERİLMİŞTİ. Eksik olan tek şey,
 * sunucuda runtime'ı HİÇ MATERYALLEŞTİRMEMEKTİ.
 *
 * ── GÜVENLİK DAVRANIŞI GEVŞEMEDİ ───────────────────────────────────────
 *   · Sunucuda **sahte runtime KURULMAZ** — `runtime` `null` kalır.
 *   · Sunucu anlık görüntüsü `SERVER_SNAPSHOT`tır:
 *     `initialized:false · lockdownActive:true · bootStatus:'CHECKING'`
 *     → BootGate güvenli ekranı render eder; **dashboard içeriği SSR'da
 *     ASLA görünmez** (fail-closed korunur).
 *   · Tarayıcıda gerçek runtime alınır ve `initialize()` edilir; lockdown,
 *     generation ve kurtarma kapıları AYNEN çalışır.
 *   · Hata YUTULMAZ: tarayıcıda runtime hâlâ throw edebilir — mevcut
 *     davranışın birebir aynısı.
 */

/** Sunucuda abonelik YOKTUR — hiçbir dinleyici kaydedilmez. */
const _serverSubscribe = (): (() => void) => () => undefined;

export interface AccountCleanupRuntimeHandle {
  /** Sunucuda `null` — sahte runtime ÜRETİLMEZ. */
  readonly runtime: AccountCleanupRuntime | null;
  readonly snapshot: AccountCleanupRuntimeSnapshot;
  /** Tüketiciler `runtime`ı YALNIZ bu `true` iken dereference etmelidir. */
  readonly isBrowser: boolean;
}

export function useAccountCleanupRuntime(): AccountCleanupRuntimeHandle {
  const isBrowser = typeof window !== 'undefined';

  // SSR: runtime'a DOKUNULMAZ (render-time yan etki yok).
  const runtime = isBrowser ? getAccountCleanupRuntime() : null;

  const snapshot = useSyncExternalStore(
    runtime ? runtime.subscribe : _serverSubscribe,
    runtime ? runtime.getSnapshot : getAccountCleanupServerSnapshot,
    getAccountCleanupServerSnapshot,
  );

  useEffect(() => {
    // Effect YALNIZ tarayıcıda koşar; runtime burada kesinlikle vardır.
    void getAccountCleanupRuntime().initialize();
  }, []);

  return { runtime, snapshot, isBrowser };
}
