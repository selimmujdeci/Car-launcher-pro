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

import { registerCommandHandler, subscribeVoiceState, cancelAssistantDuck } from '../voiceService';
import { ttsCancel } from '../ttsService';
import { getFlag } from '../remoteConfigService';
import { useCarTheme, toDay, toNight } from '../../store/useCarTheme';
import { useStore } from '../../store/useStore';
import { resolveScreen } from '../screenRegistry';
import { play, getMediaState } from '../mediaService';
import { next as mediaNext, togglePlayPause, hasQueue } from '../media/carosMediaLayer';
import { setVolume } from '../systemSettingsService';
import { stopNavigation } from '../navigationService';
import { resolveAndNavigate } from '../addressNavigationEngine';
import { getGPSState } from '../gpsService';
import { readCurrentLocation } from '../location/currentLocationService';
import { readDTCCodes, onDTCState, type DTCState } from '../dtcService';
import { createMaviWiring, type MaviWiringHandle } from '../maviCore/wiring/maviWiring';
// PR-DIAG-3: tanı raporunun segment kaynağı — MEVCUT voiceState.recent()'e REFERANS göstericisi
// (yeni buffer/telemetri DEĞİL). start/dispose ile set/temizlenir.
import { setMaviVoiceTimingsSource } from '../maviCore/wiring/maviEvidenceSection';
// MAVI-M2: Mavi'nin komut başına araç bağlamı — canlı okuma adaptörü YALNIZ burada
// (composition root) import edilir; saf resolver `voiceService` tarafında kullanılır.
import { setMaviVehicleSnapshotSource } from '../assistant/maviVehicleContext';
import { captureMaviVehicleSnapshot } from '../assistant/maviVehicleSnapshotSource';
import { createMediaNextPort } from '../maviCore/wiring/maviMediaPort';
// MÜZİK HUB PAKET A: Mavi'nin medya komutları tek kapıdan (MediaCommandGateway)
// geçer ve DÜRÜST sonuç döner. Otoritenin sahiplenmediği kaynaklarda (Spotify
// Connect / YouTube / harici oturum) eski hat AYNEN korunur.
import {
  createMediaAuthorityPort, createRoutedMediaPort, NO_UNCERTAINTY,
} from '../maviCore/wiring/maviMediaAuthorityPort';
import { honestClaim } from '../media/authority/playbackTruth';
import { isUncertainOutcome } from '../media/authority/queueRecovery';

/**
 * PAKET B · Kurtarma durumunun SENKRON okuyucusu. Modül dinamik yüklenir
 * (ana pakete girmesin); yüklenene kadar `null` kalır ve belirsizlik YOK
 * sayılır — bu güvenli yöndür: iddia yükseltilmez, yalnız düşürülebilir.
 */
let _recoveryProbe: typeof import('../media/authority/queueRecoveryRuntime') | null = null;

function loadRecoveryProbe(): void {
  void import('../media/authority/queueRecoveryRuntime')
    .then((m) => { _recoveryProbe = m; })
    .catch(() => { /* fail-soft: belirsizlik okunamaz, iddia yükseltilmez */ });
}
import { createTakeoverPolicy } from '../maviCore/wiring/takeoverPolicy';
import type { PilotHandlerDeps, PilotThemeMode } from '../maviCore/wiring/maviPilotHandlers';

/* ── TAKEOVER feature flag ─────────────────────────────────────
 * VARSAYILAN KAPALI. Kaynak sırası:
 *   1. remoteConfigService.getFlag — projenin mevcut config mekanizması; BİLİNMEYEN anahtar için
 *      `false` döner (fail-safe: yanlışlıkla production'da açılamaz).
 *   2. localStorage — YALNIZ geliştirme/saha-testi için manuel kaldıraç.
 * Değer bir kez, wiring başlarken okunur (polling/abonelik YOK). Geçersiz/eksik değer → SHADOW.
 * Bu bayrak YALNIZ `media.next` allowlist'ini açar; 9 pilot eylemi global TAKEOVER'a ALMAZ ve
 * araç/ECU eylemlerine hiçbir koşulda dokunamaz (takeoverPolicy eligible kümesi bunu garanti eder). */
export const MAVI_TAKEOVER_FLAG = 'mavi.mediaNextTakeover.enabled';

function readTakeoverFlag(): boolean {
  try {
    if (getFlag(MAVI_TAKEOVER_FLAG) === true) return true;
  } catch { /* fail-safe → kapalı */ }
  try {
    // Yalnız açık 'true' string'i açar; başka HER değer (null/'1'/'yes'/bozuk) → KAPALI.
    if (typeof localStorage !== 'undefined' && localStorage.getItem(MAVI_TAKEOVER_FLAG) === 'true') return true;
  } catch { /* fail-safe → kapalı */ }
  return false;
}

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

/**
 * MÜZİK HUB PAKET A · Mavi medya portu.
 *
 * Otorite yalnız KENDİ sahiplendiği kaynaklarda (yerel müzik · internet akışı ·
 * radyo) devreye girer ve `CommandTruth` üretir; başarısızlıkta port THROW eder
 * → handler `ok:false` verir, Mavi "yaptım" DEMEZ. Otorite yoksa veya aktif
 * kaynak harici ise (Spotify Connect / YouTube / başka uygulama) eski hat
 * DEĞİŞMEDEN kullanılır — geriye uyumluluk pazarlıksız.
 */
function buildRoutedMediaPort(): ReturnType<typeof createRoutedMediaPort> {
  loadRecoveryProbe();
  /* DİNAMİK YÜKLEME (düşük-uç bütçesi): otorite modülleri ana pakete GİRMEZ;
     ilk medya komutunda yüklenir. `mediaService`/`localMusicService` de aynı
     chunk'ı dinamik yükler — statik import buradan eklenirse üçünün de kod
     bölmesi ETKİSİZLEŞİR (rollup INEFFECTIVE_DYNAMIC_IMPORT uyarısı). */
  const gateway = (): Promise<typeof import('../media/authority/mediaCommandGateway')> =>
    import('../media/authority/mediaCommandGateway');
  const runtime = (): Promise<typeof import('../media/authority/mediaAuthorityRuntime')> =>
    import('../media/authority/mediaAuthorityRuntime');

  const authority = createMediaAuthorityPort({
    cancelAssistantDuck,
    play:     async () => (await gateway()).play(),
    pause:    async () => (await gateway()).pause(),
    stop:     async () => (await gateway()).stop(),
    next:     async () => (await gateway()).next(),
    previous: async () => (await gateway()).previous(),
    seek:     async (sec: number) => (await gateway()).seek(sec),
    // İddia kuralı TEK YERDE kalır: burada kopyalanırsa iki kural zamanla
    // ayrışır ve biri "çalıyor" derken diğeri demez. `playbackTruth` SAF ve
    // bağımlılıksızdır → statik import ağır zincir ÇEKMEZ.
    claimOf: honestClaim,
  });

  // PARİTE (MAVI3-4c): eski hat `cancelAssistantDuck(); next()` yapar — aynı sıra +
  // dürüstlük ön-koşulu. Kuyruk da oturum da yoksa next() ÇAĞRILMAZ.
  const legacyNext = createMediaNextPort({
    cancelAssistantDuck,
    hasQueue,
    hasSession: () => getMediaState().hasSession,
    next: mediaNext,
  });

  return createRoutedMediaPort({
    // Fail-soft: okuma/yükleme hatası → false → ESKİ hat (komut düşürülmez).
    isAuthorityRoute: async () => {
      try {
        const rt = await runtime();
        return rt.isAuthorityAvailable()
          && rt.isAuthorityOwnedPackage(getMediaState().activePackage);
      } catch { return false; }
    },
    authority,
    legacyPlay: () => play(),
    legacyPause: () => { if (getMediaState().playing) togglePlayPause(); },
    legacyNext,
    /* PAKET B: kuyruk kurtarması ERTELENDİ/REDDEDİLDİ ise UI ile native gerçek
       arasında BİLİNEN bir sapma vardır → Mavi kesin iddia kurmaz. Modül dinamik
       yüklenir; yükleme/okuma hatası "belirsizlik yok" sayılır (fail-soft) ve
       iddia YALNIZ düşürülebilir, asla yükseltilemez. */
    readRecoveryUncertainty: () => {
      const last = _recoveryProbe?.getLastRecovery() ?? null;
      if (!last) return NO_UNCERTAINTY;
      if (!isUncertainOutcome(last.outcome)) return NO_UNCERTAINTY;
      return {
        uncertain: true,
        note: last.outcome === 'deferred'
          ? 'kuyruk hizalaması bekliyor'
          : 'kuyruk hizalaması yapılamadı',
      };
    },
  });
}

function buildPilotDeps(): PilotHandlerDeps {
  const media = buildRoutedMediaPort();
  return {
    setTheme: applyTheme,
    // getThemeMode: CoreTheme→PilotThemeMode güvenli eşlenemediğinden verilmez (tema rollback yok).
    openScreen: (id: string): boolean => {
      const e = resolveScreen(id);
      if (!e) return false;
      e.open();
      return true;
    },
    // MÜZİK HUB PAKET A: üçü de TEK kapıdan geçer (bkz. buildRoutedMediaPort).
    // Dönen dürüst iddia (`PLAYING` / `REQUEST_SENT`) sesli cevaba taşınır.
    mediaPlay: () => media.play(),
    mediaPause: () => media.pause(),
    mediaNext: () => media.next(),
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
    // "Neredeyim?" — SALT-OKUMA. Mevcut GPS snapshot'ı + bounded reverse geocoding;
    // navigasyon başlatmaz, yeni GPS watch açmaz (bkz. currentLocationService).
    readCurrentLocation: () => readCurrentLocation(),
  };
}

/* ── Modül-seviye idempotent yaşam döngüsü ─────────────────────── */

let _handle: MaviWiringHandle | null = null;

/**
 * Mavi Voice wiring'i başlat (SHADOW). İkinci çağrı no-op (idempotent). Cleanup döner —
 * SystemBoot Wave 4'te `_reg`/`_regNamed` ile LIFO stack'e kaydedilir.
 */
export function startMaviVoiceWiring(): () => void {
  if (_handle) return stopMaviVoiceWiring; // idempotent → guard/listener iki kez bağlanmaz
  /* MAVI-M2: canlı araç bağlamı kaynağını kaydet. Bu kayıt TAKEOVER bayrağından
   * BAĞIMSIZDIR — SHADOW modda da (varsayılan) eski komut hattı gerçek bağlamla
   * çalışmalıdır. Kayıt yoksa `currentMaviVehicleContext()` dürüstçe `unknown`
   * döner (fail-closed); asla "park halinde" varsayılmaz. */
  try { setMaviVehicleSnapshotSource(captureMaviVehicleSnapshot); } catch { /* fail-soft */ }
  // Bayrak KAPALIYSA (varsayılan) mod SHADOW'dur → hakem pasif, eski hat hiç susturulmaz.
  const takeover = readTakeoverFlag();
  _handle = createMaviWiring({
    pilotDeps: buildPilotDeps(),
    registerCommandHandler,
    subscribeVoiceState,
    ttsCancel,
    mode: takeover ? 'takeover' : 'shadow',
    // Allowlist AÇIKÇA verilir: bayrak yalnız media.next'i açabilir — 9 pilot eylemi global
    // TAKEOVER'a alamaz; araç/ECU eylemleri takeoverPolicy tarafından zaten eligible değildir.
    policy: createTakeoverPolicy({
      mode: takeover ? 'takeover' : 'shadow',
      allowlist: ['media.next'],
    }),
  });
  _handle.start();
  // Tanı raporu segment kaynağını canlı köprüye bağla (PR-DIAG-3). Kopya tutulmaz — rapor anında
  // `recent()` okunur; köprü yoksa boş dizi (segmentler dürüstçe NOT_TESTED kalır).
  try {
    setMaviVoiceTimingsSource(() => _handle?.voiceState?.recent() ?? []);
  } catch { /* fail-soft: kanıt kaynağı bağlanamazsa üretim akışı ETKİLENMEZ */ }
  return stopMaviVoiceWiring;
}

/** Mavi Voice wiring'i durdur (idempotent). */
export function stopMaviVoiceWiring(): void {
  if (!_handle) return;
  // MAVI-M2: bağlam kaynağını sök → sonraki komutlar `unknown` (fail-closed) alır.
  try { setMaviVehicleSnapshotSource(null); } catch { /* fail-soft */ }
  try { setMaviVoiceTimingsSource(null); } catch { /* fail-soft */ }
  try { _handle.dispose(); } catch { /* fail-soft */ }
  _handle = null;
}

/** @internal — testler arası izolasyon. */
export function _resetMaviVoiceWiringForTest(): void {
  stopMaviVoiceWiring();
}
