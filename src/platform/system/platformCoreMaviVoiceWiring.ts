/**
 * system/platformCoreMaviVoiceWiring.ts — MAVİ ÇEKİRDEĞİ Faz-2 · GERÇEK SERVİS wiring'i.
 *
 * AMAÇ: Mavi Çekirdeği'ni gerçek platform servislerine bağlayan COMPOSITION ROOT (SystemBoot
 * komşusu; startPlatformCoreXxxWiring deseniyle bire-bir). maviCore'un yan-etkisiz kalması için
 * gerçek servisler YALNIZ burada import edilir; saf composition maviCore/wiring/maviWiring'te.
 *
 * COEXISTENCE (Model A — SHADOW): mode='shadow' → pilot handler'lar no-op (gerçek servis çağrılmaz)
 * → mevcut komut akışı (useVoiceCommandHandler) davranışı DEĞİŞMEZ, çifte yürütme yok. Gerçek pilot
 * servis portları yine de kurulur (takeover'a hazır + import path'leri derleme-zamanı doğrulanır).
 *
 * İDEMPOTENT: startMaviVoiceWiring() ikinci çağrıda no-op (modül-seviye guard); stop temiz söker.
 * Yalnız resmi servis/API çağrılır; vehicle.health.read SALT-OKUMA (readDTCCodes + snapshot).
 */

import { registerCommandHandler } from '../voiceService';
import { ttsCancel } from '../ttsService';
import { useCarTheme, toDay, toNight } from '../../store/useCarTheme';
import { useStore } from '../../store/useStore';
import { resolveScreen } from '../screenRegistry';
import { play, getMediaState } from '../mediaService';
import { next as mediaNext, togglePlayPause } from '../media/carosMediaLayer';
import { setVolume } from '../systemSettingsService';
import { stopNavigation } from '../navigationService';
import { resolveAndNavigate } from '../addressNavigationEngine';
import { getGPSState } from '../gpsService';
import { readDTCCodes, onDTCState, type DTCState } from '../dtcService';
import { createMaviWiring, type MaviWiringHandle } from '../maviCore/wiring/maviWiring';
import type { PilotHandlerDeps, PilotThemeMode } from '../maviCore/wiring/maviPilotHandlers';

/* ── Gerçek pilot servis portları ─────────────────────────────── */

/** applyVoiceTheme mantığı (useVoiceCommandHandler ile hizalı) — görsel tema motoru. */
function applyTheme(mode: PilotThemeMode): void {
  const { theme, setTheme } = useCarTheme.getState();
  if (mode === 'oled')     setTheme('oled');
  else if (mode === 'day') setTheme(toDay(theme));
  else                     setTheme(toNight(theme)); // 'night' | 'dark'
}

/** SALT-OKUMA araç sağlığı: DTC oku + anlık snapshot → sürücü-dostu özet. */
async function readVehicleHealth(): Promise<{ dtcCount: number; criticalCount: number; summary: string }> {
  await readDTCCodes();
  let snap: DTCState | null = null;
  const unsub = onDTCState((s) => { snap = s; });
  unsub();
  // `snap` geri-çağrı içinde atanır; TS akış analizi bunu göremediği için tipi `null`a daraltıp
  // `?.` sonrası `never` üretiyordu (TS2339/TS7006). Cast YALNIZ daralmayı geri alır — çalışma
  // zamanı davranışı birebir aynıdır (aynı okuma, aynı `?? []` fallback).
  const codes = (snap as DTCState | null)?.codes ?? [];
  const criticalCount = codes.filter((c) => c.severity === 'critical').length;
  const summary = codes.length === 0
    ? 'Araç sistemleri temiz, sorun yok'
    : criticalCount > 0
      ? `${codes.length} arıza kodu var, biri kritik`
      : `${codes.length} arıza kodu var`;
  return { dtcCount: codes.length, criticalCount, summary };
}

function buildPilotDeps(): PilotHandlerDeps {
  return {
    setTheme: applyTheme,
    // getThemeMode: CoreTheme→PilotThemeMode güvenli eşlenemediğinden verilmez (tema rollback yok).
    openScreen: (id: string): boolean => {
      const e = resolveScreen(id);
      if (!e) return false;
      e.open();
      return true;
    },
    mediaPlay: () => play(),
    mediaPause: () => { if (getMediaState().playing) togglePlayPause(); },
    mediaNext: () => mediaNext(),
    setVolume: (percent: number) => setVolume(percent),
    getVolume: () => {
      try { return useStore.getState().settings.volume; } catch { return undefined; }
    },
    navigateTo: (destination: string) => {
      const gps = getGPSState().location;
      resolveAndNavigate(destination, gps ? { lat: gps.latitude, lng: gps.longitude } : undefined);
    },
    openNavScreen: (): boolean => {
      const e = resolveScreen('navigasyon');
      if (!e) return false;
      e.open();
      return true;
    },
    cancelNavigation: () => stopNavigation(),
    readHealth: readVehicleHealth,
  };
}

/* ── Modül-seviye idempotent yaşam döngüsü ─────────────────────── */

let _handle: MaviWiringHandle | null = null;

/**
 * Mavi Voice wiring'i başlat (SHADOW). İkinci çağrı no-op (idempotent). Cleanup döner —
 * SystemBoot Wave 4'te `_reg`/`_regNamed` ile LIFO stack'e kaydedilir.
 */
export function startMaviVoiceWiring(): () => void {
  if (_handle) return stopMaviVoiceWiring;
  _handle = createMaviWiring({
    pilotDeps: buildPilotDeps(),
    registerCommandHandler,
    ttsCancel,
    mode: 'shadow', // Model A: gölge — mevcut davranış değişmez, çifte yürütme yok.
  });
  _handle.start();
  return stopMaviVoiceWiring;
}

/** Mavi Voice wiring'i durdur (idempotent). */
export function stopMaviVoiceWiring(): void {
  if (!_handle) return;
  try { _handle.dispose(); } catch { /* fail-soft */ }
  _handle = null;
}

/** @internal — testler arası izolasyon. */
export function _resetMaviVoiceWiringForTest(): void {
  stopMaviVoiceWiring();
}
