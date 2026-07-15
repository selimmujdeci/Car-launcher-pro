/**
 * rootCauseKb.ts — Diagnostics V2 · PR-3: KÖK-NEDEN BİLGİ TABANI.
 *
 * AMAÇ: Tanı raporundaki her bulgu `code`'unu GELİŞTİRİCİ-HEDEFLİ işaretçiye
 * bağlar — "adaptörü kontrol et" değil, "CarLauncherPlugin.performHandshake()
 * Mode09 cevabını doğrula". Kullanıcı "TANI GÖNDER" dediğinde Claude log/adb/kod
 * aramadan doğrudan dosya+fonksiyona gidebilsin (vizyonun nihai hedefi).
 *
 * TASARIM:
 *  - STATİK + küratörlü + bundle'da (ağ yok, PII yok, permissive).
 *  - `suspectFiles` GERÇEK, var-olan dosya yolları (CI guard: dosya mevcut mu →
 *    rootCauseKb.test.ts). `suspectSymbols` küratörlü İPUCU (fonksiyon/sınıf adı) —
 *    kod taşınınca güncellenmeli; test dosya-varlığını kilitler, sembol drift'i
 *    ileride sembol-var-mı guard'ıyla sıkılaştırılabilir.
 *  - `requiredEvidence`: bu kök-nedeni KESİNLEŞTİRMEK için gereken ham kanıt
 *    anahtarları. PR-4 (INCONCLUSIVE motoru) bunları "eksik kanıt" beyanında,
 *    PR-5/6 (OBD kanıt zinciri) doldurmada kullanır.
 *
 * KURAL: KB'de OLMAYAN kod → codePointer boş kalır (uydurma YASAK). Motor sessizce
 * eski davranışa düşer (fail-soft).
 */

export interface RootCauseKbEntry {
  /** diagnosticTriage kural kodu (dedup anahtarı ile 1:1). */
  code: string;
  /** Root cause'un muhtemel bulunduğu GERÇEK dosya(lar) — CI guard'lı. */
  suspectFiles: string[];
  /** Küratörlü fonksiyon/sınıf ipucu (drift'e açık — güncel tutulmalı). */
  suspectSymbols: string[];
  /** Geliştirici-hedefli tek satır düzeltme ipucu. */
  fixHint: string;
  /** Bu kök-nedeni kesinleştirmek için gereken ham kanıt anahtarları (PR-4/5). */
  requiredEvidence: string[];
}

/* ── KB — mevcut diagnosticTriage kod kümesiyle 1:1 ──────────────── */

const ENTRIES: readonly RootCauseKbEntry[] = [
  {
    code: 'TRANSPORT_RECONNECT',
    suspectFiles: ['src/platform/obd/ObdHealthMonitor.ts', 'src/platform/obdService.ts',
      'android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java'],
    suspectSymbols: ['ObdHealthMonitor.getObdHealth', 'reconnect', 'performHandshake'],
    fixHint: 'Reconnect basıncı + düşük kaliteyi birlikte incele; native handshake/transport kararlılığını doğrula (BLE menzil/güç mü, yoksa handshake mı düşüyor).',
    requiredEvidence: ['handshakeStage', 'connectionQuality', 'reconnectPressure', 'lastDisconnectReason'],
  },
  {
    code: 'OBD_DTC_PRESENT',
    suspectFiles: ['src/platform/obdService.ts',
      'android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java'],
    suspectSymbols: ['readAllStoredDtc', 'readFreezeFrame', 'Mode03'],
    fixHint: 'DTC listesini + freeze frame\'i doğrula; count>0 ama codes boşsa Mode03 parse/derinlik (MAX_DEPTH) sorununu kontrol et.',
    requiredEvidence: ['dtcCodes', 'freezeFrameRaw', 'mode03Response'],
  },
  {
    code: 'FUSION_LOW_CONFIDENCE',
    // ANA YOL: aktif kaynak seçimi VehicleCompute worker'da (_resolveSpeedSource) yapılır ve
    // VehicleSignalResolver → halStatusStore.activeSource'a yansır — tanı raporundaki
    // `fusion.activeSource` BURADAN gelir. `speedFusion.ts` İKİNCİL yoldur (yalnız
    // MiniMapWidget + telemetryService); plausibility'si vardır ama ana göstergeyi beslemez.
    // Bu yüzden çelişki önce worker'da aranır (bkz. `_isSpeedRejected` RPM çapraz kontrolü).
    suspectFiles: [
      'src/platform/vehicleDataLayer/VehicleCompute.worker.ts',
      'src/platform/speedFusion.ts',
      'src/platform/gpsService.ts',
    ],
    suspectSymbols: ['_resolveSpeedSource', '_isSpeedRejected', 'speedFusion', 'fuseSpeed'],
    fixHint: 'Önce worker: OBD hızı ile RPM/GPS çelişiyor mu (ör. hız 0 iken RPM>rölanti ve GPS hareket görüyor → OBD hız PID güvenilmez; KWP araçlarda hız ABS ECU\'sundadır, motor ECU\'su 0 döner). Sonra GPS ucu: doğruluk/izin. Hangi kaynağın saptığını kanıtla — "donanım kesin" varsayma.',
    requiredEvidence: ['gpsAccuracyM', 'gpsPermission', 'hwSpeedSource', 'fusionDiffKmh'],
  },
  {
    code: 'GPS_PERMISSION_DENIED',
    suspectFiles: ['src/platform/gpsService.ts'],
    suspectSymbols: ['requestPermission', 'ensureLocationPermission'],
    fixHint: 'Konum izni akışını kontrol et; kullanıcı reddettiyse Ayarlar yönlendirmesi, kalıcı red ise fail-soft GPS-siz mod.',
    requiredEvidence: ['permissionState'],
  },
  {
    code: 'GPS_NO_FIX',
    suspectFiles: ['src/platform/gpsService.ts'],
    suspectSymbols: ['watchPosition', 'onLocation'],
    fixHint: 'İzleme aktif ama fix yok → anten/görüş açısı veya native konum sağlayıcı; dead-reckoning fallback durumunu doğrula.',
    requiredEvidence: ['fixAgeMs', 'accuracyM', 'nativeProvider'],
  },
  {
    code: 'NETAI_CIRCUIT_OPEN',
    suspectFiles: ['src/platform/aiHealth.ts'],
    suspectSymbols: ['aiHealth', 'circuitBreaker', 'recordFailure'],
    fixHint: 'Ardışık hata sonrası devre kesici açık; sağlayıcı anahtarı/ağ/fallback zincirini (Gemini→Groq→Haiku) doğrula.',
    requiredEvidence: ['consecFails', 'blockedForMs', 'provider'],
  },
  {
    code: 'NETAI_QUOTA_COOLDOWN',
    suspectFiles: ['src/platform/aiHealth.ts'],
    suspectSymbols: ['quota', 'cooldown'],
    fixHint: 'Sağlayıcı kota penceresinde; fallback sağlayıcıya geçiş ve cooldown süresini doğrula.',
    requiredEvidence: ['geminiCooldownMs', 'groqCooldownMs', 'haikuCooldownMs'],
  },
  {
    code: 'SELFTEST_FAIL',
    suspectFiles: ['src/platform/selfTestEngine.ts'],
    suspectSymbols: ['runSelfTest', 'runProbe'],
    fixHint: 'Başarısız probun DETAIL\'ine bak; backend abort ise ağ/Supabase erişimi (probeBackend 3.5s timeout), zamansız-modal ise uiActivityRecorder eşiği.',
    requiredEvidence: ['probeResults'],
  },
  {
    code: 'SELFTEST_WARN',
    suspectFiles: ['src/platform/selfTestEngine.ts'],
    suspectSymbols: ['runSelfTest', 'runProbe'],
    fixHint: 'Uyarılı probu incele (izin prompt / yavaş backend); güvenlik-kritik değilse bilgi amaçlı.',
    requiredEvidence: ['probeResults'],
  },
  {
    code: 'UI_UNTIMELY_SURFACE',
    suspectFiles: ['src/platform/uiActivityRecorder.ts'],
    suspectSymbols: ['classifySurface', 'recordOpen', 'getUiActivitySnapshot'],
    fixHint: 'Yakalanan yüzeyin z-index\'ini bulup KAYNAK bileşeni tespit et; oto-açılan meşru banner (TripSummaryBanner/tanı modalı) ise NO_USER_MS eşiğini/muafiyeti gözden geçir.',
    requiredEvidence: ['untimelySurfaceDesc', 'sinceUserMs', 'speed', 'reverse'],
  },
  {
    code: 'MEM_LEAK_SUSPECT',
    suspectFiles: ['src/platform/diagnosticSections.ts'],
    suspectSymbols: ['buildPerfSeriesSection', 'memMb'],
    fixHint: 'Uzun oturumda heap trendini profille; useEffect/interval/listener cleanup eksiği veya MapLibre/WebGL context leak kontrol et.',
    requiredEvidence: ['perfSeriesSamples'],
  },
  {
    code: 'BOOT_SLOW_THERMAL',
    suspectFiles: ['src/platform/bootTimingRecorder.ts', 'src/platform/diagnosticSections.ts'],
    suspectSymbols: ['bootTimingRecorder', 'markWave'],
    fixHint: 'En yavaş wave + termal seviyeyi birlikte incele; ısınma boot\'u yavaşlatıyorsa AdaptiveRuntimeManager tier düşürme eşiği.',
    requiredEvidence: ['bootWaveTimings', 'thermalLevel'],
  },
  {
    code: 'POWER_CRITICAL',
    suspectFiles: ['src/platform/diagnosticSections.ts', 'src/platform/nativePlugin.ts'],
    suspectSymbols: ['buildPowerSection', 'batteryVoltage'],
    fixHint: '12V voltaj kritik → akü/alternatör donanımı; yazılım tarafında yalnız okuma doğruluğu (kaynak OBD mi native mi) teyit edilir.',
    requiredEvidence: ['voltageV', 'voltageSource'],
  },
  {
    code: 'POWER_LOW',
    suspectFiles: ['src/platform/diagnosticSections.ts', 'src/platform/nativePlugin.ts'],
    suspectSymbols: ['buildPowerSection', 'batteryVoltage'],
    fixHint: 'Düşük voltaj eğilimi → marş/restart riski; okuma kaynağı ve son 10sn eğilimini doğrula.',
    requiredEvidence: ['voltageV', 'voltageTrend'],
  },
  {
    code: 'HEALTH_CRITICAL',
    suspectFiles: ['src/platform/diagnosticSections.ts', 'src/platform/native/NativeGuardBridge.ts'],
    suspectSymbols: ['buildHealthSection', 'HealthMonitor'],
    fixHint: 'Sağlıksız servis(ler)in restartCount/heartbeat kaybını bul; VehicleDataLayer heartbeat kesilmesi mi, native köprü mü.',
    requiredEvidence: ['serviceHealth', 'heartbeatAgeMs'],
  },
  {
    code: 'HEALTH_DEGRADED',
    suspectFiles: ['src/platform/diagnosticSections.ts', 'src/platform/native/NativeGuardBridge.ts'],
    suspectSymbols: ['buildHealthSection', 'HealthMonitor'],
    fixHint: 'restartCount yüksek servisi incele; tekrarlayan restart kök nedenini (kaynak kaybı/exception) bul.',
    requiredEvidence: ['serviceHealth', 'restartCount'],
  },
  {
    code: 'STORAGE_DISK_WARN',
    suspectFiles: ['src/platform/obdStorage.ts', 'src/platform/diagnosticSections.ts'],
    suspectSymbols: ['safeStorage', 'buildStorageQueueSection'],
    fixHint: 'Disk kullanımı kritik; eski trip/telemetri budaması + safeStorage kota hata yolunu doğrula.',
    requiredEvidence: ['storagePct'],
  },
  {
    code: 'STORAGE_QUEUE_OFFLINE',
    suspectFiles: ['src/platform/diagnosticSections.ts'],
    suspectSymbols: ['buildStorageQueueSection', 'queuePending'],
    fixHint: 'Çevrimdışı kuyruk birikiyor; bağlantı gelince drenaj mantığını ve retry politikasını doğrula.',
    requiredEvidence: ['queuePending', 'online'],
  },
  {
    code: 'STORAGE_QUEUE_BACKLOG',
    suspectFiles: ['src/platform/diagnosticSections.ts'],
    suspectSymbols: ['buildStorageQueueSection', 'queuePending'],
    fixHint: 'Kuyruk birikti (online); sunucu rate-limit / RPC hata yolunu ve retry backoff\'u doğrula.',
    requiredEvidence: ['queuePending', 'rateLimitState'],
  },
  {
    code: 'GEOFENCE_READ_ERROR',
    suspectFiles: ['src/platform/diagnosticSections.ts'],
    suspectSymbols: ['buildGeofenceSection', 'readState'],
    fixHint: 'Bulut geofence okuma hatası; şema/izin (RLS/grant) ve tablo varlığını doğrula.',
    requiredEvidence: ['readState'],
  },
];

const BY_CODE: ReadonlyMap<string, RootCauseKbEntry> = new Map(ENTRIES.map((e) => [e.code, e]));

/** KB'de bu kod için kayıt varsa döner; yoksa null (uydurma YASAK → codePointer boş). */
export function lookupRootCause(code: string): RootCauseKbEntry | null {
  return BY_CODE.get(code) ?? null;
}

/** Tüm KB kayıtları (CI guard / test için). */
export function allRootCauseKbEntries(): readonly RootCauseKbEntry[] {
  return ENTRIES;
}
