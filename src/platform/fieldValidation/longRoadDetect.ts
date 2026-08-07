/**
 * longRoadDetect.ts — OTOMATİK SENARYO ALGILAMA (görev §2) · SAF.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React yok.
 * Girdi: iki ardışık ÖRNEK. Çıktı: algılanan senaryolar + tetiklenecek snapshot.
 *
 * ── PAZARLIKSIZ ────────────────────────────────────────────────────────────
 *  · Algılama YALNIZ GEÇİŞ (kenar) üzerinden yapılır — sürekli durumdan senaryo
 *    ÜRETİLMEZ (aksi hâlde tek olay yüzlerce kez sayılırdı).
 *  · Kaynak alan `null` ise senaryo ÜRETİLMEZ. "okunamadı" ≠ "olmadı":
 *    okunamayan alandan asla "GPS kayboldu" gibi bir hüküm çıkarılmaz.
 *  · Süre eşikleri MONOTON saatle ölçülür (CLAUDE.md §Clock Jump Protection).
 *  · Bu dosya hiçbir şeyi TETİKLEMEZ; yalnız "şu an snapshot alınabilir" DER.
 */

import {
  LR_BREAK_STOP_MS, LR_GPS_LOSS_SNAPSHOT_MS, LR_LONG_IDLE_MS,
  LR_STEADY_CRUISE_MS, LR_STOP_GO_WINDOW_MS,
  type ScenarioId, type Severity, type SnapshotTrigger,
} from './longRoadModel';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Örnek sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tek gözlem örneği. HER ALAN NULLABLE'dır — okunamayan alan `null` gelir,
 * `0` veya `false` UYDURULMAZ (CLAUDE.md §Gözlemlenebilirlik kural 5).
 *
 * Bu tip `longRoadSources.readLongRoadSample()` tarafından doldurulur; burada
 * yalnız SÖZLEŞME tanımlıdır (saflığı korumak için servis importu YOK).
 */
export interface LongRoadSample {
  /** Duvar saati damgası (görüntüleme/kayıt). */
  readonly wallMs: number;
  /** Monoton saat (süre hesapları) — `performance.now()`. */
  readonly monoMs: number;

  /* ── OBD / taşıma ────────────────────────────────────────────────────── */
  readonly obdTransportConnected: boolean | null;
  readonly obdDataFresh: boolean | null;
  readonly obdConnectionState: string | null;
  readonly obdSource: string | null;
  readonly obdLastPacketAgeMs: number | null;
  readonly handshakeOutcome: string | null;
  readonly protocolActive: string | null;
  readonly protocolTried: string | null;
  readonly vinPresent: boolean | null;
  readonly supportedPidCount: number | null;
  readonly reconnectRequested: number | null;
  readonly resetRequested: number | null;
  readonly disconnectCalled: number | null;
  readonly transportReconnectAttempts: number | null;
  readonly kwpStatus: string | null;
  readonly kwpRecoveryCount: number | null;
  readonly kwpSuppressedCount: number | null;
  readonly kwpAtpcFailures: number | null;
  readonly canRetryCount: number | null;
  readonly halActiveSource: string | null;

  /* ── Sinyaller ───────────────────────────────────────────────────────── */
  readonly speed: number | null;
  readonly rpm: number | null;
  readonly engineTemp: number | null;
  readonly throttle: number | null;
  readonly intakeTemp: number | null;
  readonly fuelLevel: number | null;
  readonly batteryVoltage: number | null;

  /* ── Konum ───────────────────────────────────────────────────────────── */
  readonly locationState: string | null;
  readonly locationProvider: string | null;
  readonly locationAccuracyM: number | null;
  readonly locationFixAgeMs: number | null;
  readonly gpsSwitchCount: number | null;
  readonly gpsFallbackCount: number | null;

  /* ── Trip ────────────────────────────────────────────────────────────── */
  readonly tripActive: boolean | null;
  readonly tripTotalDistanceKm: number | null;
  readonly tripTotalCount: number | null;

  /* ── Bağlantı / bulut ────────────────────────────────────────────────── */
  readonly online: boolean | null;
  readonly telemetryReportPresent: boolean | null;
  /** YALNIZ snapshot anında doldurulur (async okuma) — tick'te `null`. */
  readonly offlineQueueSize: number | null;

  /* ── Çalışma zamanı / cihaz ──────────────────────────────────────────── */
  readonly runtimeMode: string | null;
  /** Ürünün kendi termal defterinden (`thermalJournal`) 0–3. */
  readonly thermalLevel: number | null;
  /** JS heap kullanım oranı 0–1 (`performance.memory` yoksa ürün 0 yazar). */
  readonly ramPressureRatio: number | null;
  readonly uiFreezeCount: number | null;
  readonly workerRestartTotal: number | null;
  readonly memoryPressure: string | null;
  readonly appVisible: boolean | null;
  readonly batteryPercent: number | null;
  readonly charging: boolean | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Algılayıcı durumu (türetilmiş — kalıcı DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

export interface DetectState {
  readonly prev: LongRoadSample | null;
  readonly obdGapStartMono: number | null;
  readonly gpsLossStartMono: number | null;
  readonly internetLossStartMono: number | null;
  readonly stoppedSinceMono: number | null;
  readonly idleSinceMono: number | null;
  readonly steadySinceMono: number | null;
  readonly highLoadSinceMono: number | null;
  readonly stopGoWindowStartMono: number | null;
  readonly stopGoTransitions: number;
  readonly firstLinkSeen: boolean;
  readonly firstHandshakeSeen: boolean;
  readonly longIdleReported: boolean;
  readonly breakReported: boolean;
  readonly steadyReported: boolean;
  readonly stopGoReported: boolean;
  readonly highLoadReported: boolean;
}

export function emptyDetectState(): DetectState {
  /* Template object literal — tüm anahtarlar sabit sırada (V8 hidden-class). */
  return {
    prev: null,
    obdGapStartMono: null,
    gpsLossStartMono: null,
    internetLossStartMono: null,
    stoppedSinceMono: null,
    idleSinceMono: null,
    steadySinceMono: null,
    highLoadSinceMono: null,
    stopGoWindowStartMono: null,
    stopGoTransitions: 0,
    firstLinkSeen: false,
    firstHandshakeSeen: false,
    longIdleReported: false,
    breakReported: false,
    steadyReported: false,
    stopGoReported: false,
    highLoadReported: false,
  };
}

/**
 * Restore sonrası algılayıcıyı TOHUMLAR (D1 · SAF).
 *
 * ── NEDEN ──────────────────────────────────────────────────────────────────
 * `DetectState` process ömürlüdür; restore'da sıfırdan kurulur. Ama
 * `FIRST_VEHICLE_LINK` / `FIRST_HANDSHAKE_OK` adı üstünde **bir kez** olan
 * senaryolardır: sıfırlanmış durumla ilk taze örnekte yeniden üretilirler ve
 * "İLK bağlantı" oturum boyunca 2, 3, 4 kez sayılır (bağımsız denetim §5/7 —
 * 1→2 ölçüldü). Tohumlama bunu keser.
 *
 * Kaynak olarak SENARYO defteri kullanılır: senaryo kayıtları olay defterinin
 * aksine bütçe budamasında SİLİNMEZ, dolayısıyla budanmış oturumda bile "bu
 * daha önce oldu mu" sorusu güvenle cevaplanır.
 */
export function seedDetectState(
  state: DetectState,
  seen: { readonly firstLinkSeen: boolean; readonly firstHandshakeSeen: boolean },
): DetectState {
  return {
    ...state,
    firstLinkSeen: state.firstLinkSeen || seen.firstLinkSeen === true,
    firstHandshakeSeen: state.firstHandshakeSeen || seen.firstHandshakeSeen === true,
  };
}

export interface DetectHit {
  readonly scenario: ScenarioId;
  readonly severity: Severity;
  readonly detail: string;
  /** Bu senaryo bir snapshot talep ediyor mu (politika ayrıca karar verir). */
  readonly snapshotTrigger: SnapshotTrigger | null;
}

export interface DetectResult {
  readonly state: DetectState;
  readonly hits: readonly DetectHit[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Eşikler — KAYNAKLI (görev §15: keyfî eşik YASAK)
 * ════════════════════════════════════════════════════════════════════════ */

/** Duruş kabulü: trip motorunun kendi eşiğiyle AYNI mantık (hız > 0 → hareket). */
const STOPPED_SPEED_KMH = 0;
/** Rölanti: araç durmuş ama motor dönüyor. */
const IDLE_MIN_RPM = 300;
/** Sabit hız: otoyol bandı + dar sapma. */
const STEADY_MIN_KMH = 70;
const STEADY_BAND_KMH = 12;
/** Hızlanma/yavaşlama: 1 sn'lik pencerede belirgin değişim. */
const ACCEL_KMH_PER_S = 6;
/** Uzun rampa/yük: yüksek gaz + düşük hız artışı süregelen yük göstergesi. */
const HIGH_LOAD_THROTTLE = 60;
const HIGH_LOAD_MIN_MS = 60_000;
/** Dur-kalk: pencere içinde en az bu kadar duruş→kalkış geçişi. */
const STOP_GO_MIN_TRANSITIONS = 6;
/** Tünel şüphesi: GPS kaybı sırasında araç HAREKET etmeye devam ediyorsa. */
const TUNNEL_MIN_SPEED_KMH = 20;
/** Termal seviyeler ÜRÜNÜN kendi ölçeğidir (`thermalJournal`: 0 normal → 3 kritik). */
const THERMAL_WARN_LEVEL = 2;
const THERMAL_CRIT_LEVEL = 3;

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Algılama
 * ════════════════════════════════════════════════════════════════════════ */

function _rose(prev: number | null | undefined, cur: number | null | undefined): boolean {
  return typeof prev === 'number' && typeof cur === 'number' && cur > prev;
}

/**
 * İki örnek arasındaki GEÇİŞLERİ senaryolara çevirir.
 *
 * `prev === null` (ilk örnek) → yalnız durum başlangıçları kurulur, senaryo
 * ÜRETİLMEZ. Bu bilinçlidir: ilk örnekte "kayboldu/geldi" hükmü verilemez.
 */
export function detect(state: DetectState, s: LongRoadSample): DetectResult {
  const hits: DetectHit[] = [];
  const prev = state.prev;
  let st: DetectState = { ...state, prev: s };

  const push = (
    scenario: ScenarioId, severity: Severity, detail: string,
    snapshotTrigger: SnapshotTrigger | null = null,
  ): void => { hits.push({ scenario, severity, detail, snapshotTrigger }); };

  /* ── OBD bağlantısı / handshake ─────────────────────────────────────── */

  if (!st.firstLinkSeen && s.obdTransportConnected === true) {
    st = { ...st, firstLinkSeen: true };
    push('FIRST_VEHICLE_LINK', 'INFO', `Taşıma bağlandı (kaynak=${s.obdSource ?? '—'})`);
  }
  if (!st.firstHandshakeSeen && s.handshakeOutcome === 'ok') {
    st = { ...st, firstHandshakeSeen: true };
    push('FIRST_HANDSHAKE_OK', 'INFO',
      `Handshake ok (protokol=${s.protocolActive ?? '—'}, VIN=${s.vinPresent === true ? 'var' : 'yok'}, ` +
      `PID=${s.supportedPidCount ?? '—'})`, 'FIRST_HANDSHAKE');
  }

  if (prev) {
    /* Reconnect: alt katmanın kendi sayacı ARTTIĞINDA — biz "kopuk" hükmü VERMEYİZ. */
    if (_rose(prev.reconnectRequested, s.reconnectRequested)
        || _rose(prev.transportReconnectAttempts, s.transportReconnectAttempts)) {
      push('OBD_RECONNECT', 'WARN',
        `Yeniden bağlantı istendi (istek=${s.reconnectRequested ?? '—'}, ` +
        `deneme=${s.transportReconnectAttempts ?? '—'})`);
    }
    /* Protokol yeniden kurulumu: aktif protokol DEĞİŞTİ veya KWP recovery arttı. */
    if (prev.protocolActive !== null && s.protocolActive !== null
        && prev.protocolActive !== s.protocolActive) {
      push('PROTOCOL_REESTABLISH', 'WARN',
        `Aktif protokol değişti: ${prev.protocolActive} → ${s.protocolActive}`);
    }
    if (_rose(prev.kwpRecoveryCount, s.kwpRecoveryCount)) {
      push('PROTOCOL_REESTABLISH', 'WARN', `KWP recovery çalıştı (toplam=${s.kwpRecoveryCount ?? '—'})`);
    }
    /* Kaynak değişimi: HAL'in aktif kaynağı değişti (OBD ↔ CAN ↔ GPS). */
    if (prev.halActiveSource !== null && s.halActiveSource !== null
        && prev.halActiveSource !== s.halActiveSource) {
      push('SOURCE_SWITCH', 'INFO', `Aktif kaynak: ${prev.halActiveSource} → ${s.halActiveSource}`);
    }
  }

  /* ── OBD veri kaybı: TAZELİK kenarı (ürünün kendi hükmü) ────────────── */

  if (s.obdDataFresh === false && s.obdTransportConnected === true) {
    if (st.obdGapStartMono === null) {
      st = { ...st, obdGapStartMono: s.monoMs };
      push('OBD_DATA_LOST', 'CRITICAL',
        `OBD verisi bayatladı (bağlantı ayakta, son paket yaşı=${s.obdLastPacketAgeMs ?? '—'} ms)`,
        'OBD_DATA_LOSS');
    }
  } else if (s.obdDataFresh === true && st.obdGapStartMono !== null) {
    st = { ...st, obdGapStartMono: null };
  }

  /* ── Konum ───────────────────────────────────────────────────────────── */

  const gpsLive = s.locationState === 'LIVE';
  const gpsLost = s.locationState === 'OFFLINE' || s.locationState === 'LAST_KNOWN'
    || s.locationState === 'UNKNOWN';

  if (gpsLost) {
    if (st.gpsLossStartMono === null) {
      st = { ...st, gpsLossStartMono: s.monoMs };
      push('GPS_LOST', 'WARN', `Konum durumu=${s.locationState} (sağlayıcı=${s.locationProvider ?? '—'})`);
    } else {
      const lossMs = s.monoMs - st.gpsLossStartMono;
      /* Tünel şüphesi: konum yokken araç HÂLÂ hareket ediyor. */
      if (!st.breakReported && lossMs >= LR_GPS_LOSS_SNAPSHOT_MS
          && s.speed !== null && s.speed >= TUNNEL_MIN_SPEED_KMH) {
        push('TUNNEL_GNSS_LOSS', 'WARN',
          `Konum ${Math.round(lossMs / 1000)} sn yok ama hız ${Math.round(s.speed)} km/h → GNSS kesintisi`,
          'GPS_LOSS');
      }
    }
  } else if (gpsLive && st.gpsLossStartMono !== null) {
    const lossMs = s.monoMs - st.gpsLossStartMono;
    st = { ...st, gpsLossStartMono: null };
    push('GPS_RESTORED', 'INFO', `Konum geri geldi (kesinti=${Math.round(lossMs / 1000)} sn)`);
  }

  /* ── İnternet ────────────────────────────────────────────────────────── */

  if (s.online === false) {
    if (st.internetLossStartMono === null) {
      st = { ...st, internetLossStartMono: s.monoMs };
      push('INTERNET_LOST', 'WARN', 'Ağ bağlantısı yok');
    }
  } else if (s.online === true && st.internetLossStartMono !== null) {
    const lossMs = s.monoMs - st.internetLossStartMono;
    st = { ...st, internetLossStartMono: null };
    push('INTERNET_RESTORED', 'INFO',
      `Ağ geri geldi (kesinti=${Math.round(lossMs / 1000)} sn)`, 'INTERNET_RESTORED');
  }

  /* ── Kuyruk ──────────────────────────────────────────────────────────── */

  if (prev && prev.offlineQueueSize !== null && s.offlineQueueSize !== null) {
    if (s.offlineQueueSize > prev.offlineQueueSize) {
      push('OFFLINE_QUEUE_GROWTH', 'INFO', `Kuyruk büyüdü: ${prev.offlineQueueSize} → ${s.offlineQueueSize}`);
    } else if (s.offlineQueueSize < prev.offlineQueueSize) {
      push('QUEUE_REPLAY', 'INFO', `Kuyruk boşaldı: ${prev.offlineQueueSize} → ${s.offlineQueueSize}`);
    }
  }

  /* ── Trip ────────────────────────────────────────────────────────────── */

  if (prev) {
    if (prev.tripActive === false && s.tripActive === true) {
      push('TRIP_START', 'INFO', 'Yeni trip başladı');
    }
    if (prev.tripActive === true && s.tripActive === false) {
      push('TRIP_CLOSE_AFTER_STOP', 'INFO',
        `Trip kapandı (toplam trip=${s.tripTotalCount ?? '—'})`, 'TRIP_CLOSE');
    }
  }

  /* ── Uygulama görünürlüğü ────────────────────────────────────────────── */

  if (prev && prev.appVisible !== null && s.appVisible !== null && prev.appVisible !== s.appVisible) {
    if (s.appVisible) push('APP_FOREGROUND', 'INFO', 'Uygulama öne geldi');
    else push('APP_BACKGROUND', 'INFO', 'Uygulama arka plana geçti');
  }

  /* ── Termal / bellek / pil ───────────────────────────────────────────── */

  /* Termal OTORİTESİ ürünün `thermalJournal` seviyesidir (0–3); çalışma modu
     düşüşü İKİNCİL göstergedir (termal DIŞI nedenlerle de düşebilir). */
  if (prev && prev.thermalLevel !== null && s.thermalLevel !== null
      && s.thermalLevel > prev.thermalLevel && s.thermalLevel >= THERMAL_WARN_LEVEL) {
    push('THERMAL_PRESSURE', s.thermalLevel >= THERMAL_CRIT_LEVEL ? 'CRITICAL' : 'WARN',
      `Termal seviye yükseldi: ${prev.thermalLevel} → ${s.thermalLevel}`,
      s.thermalLevel >= THERMAL_CRIT_LEVEL ? 'THERMAL_CRIT' : null);
  }
  if (prev && prev.runtimeMode !== null && s.runtimeMode !== null && prev.runtimeMode !== s.runtimeMode) {
    const degraded = s.runtimeMode === 'BASIC_JS' || s.runtimeMode === 'SAFE_MODE'
      || s.runtimeMode === 'POWER_SAVE';
    if (degraded) {
      push('THERMAL_PRESSURE', 'WARN', `Çalışma modu düştü: ${prev.runtimeMode} → ${s.runtimeMode}`);
    }
  }
  if (prev && prev.memoryPressure !== s.memoryPressure && s.memoryPressure !== null) {
    const crit = s.memoryPressure === 'CRITICAL';
    push('MEMORY_PRESSURE', crit ? 'CRITICAL' : 'WARN',
      `Bellek baskısı=${s.memoryPressure}`, crit ? 'MEMORY_CRIT' : null);
  }
  if (prev) {
    if (prev.charging !== null && s.charging !== null && prev.charging !== s.charging) {
      push('BATTERY_LOW_OR_CHARGE_CHANGE', 'INFO', `Şarj durumu değişti → ${s.charging ? 'şarjda' : 'şarjda değil'}`);
    } else if (prev.batteryPercent !== null && s.batteryPercent !== null
               && prev.batteryPercent >= 20 && s.batteryPercent < 20) {
      push('BATTERY_LOW_OR_CHARGE_CHANGE', 'WARN', `Pil %${Math.round(s.batteryPercent)} altına indi`);
    }
  }

  /* ── Sürüş profili ───────────────────────────────────────────────────── */

  const speed = s.speed;
  if (speed === null) return { state: st, hits };

  const dtMs = prev ? Math.max(0, s.monoMs - prev.monoMs) : 0;
  const stopped = speed <= STOPPED_SPEED_KMH;

  /* Hızlanma / yavaşlama — 1 sn'ye normalize edilmiş değişim. */
  if (prev && prev.speed !== null && dtMs > 0) {
    const dvPerSec = ((speed - prev.speed) * 1000) / dtMs;
    if (dvPerSec >= ACCEL_KMH_PER_S) {
      push('ACCELERATION', 'INFO', `Hızlanma ${dvPerSec.toFixed(1)} km/h/sn`);
    } else if (dvPerSec <= -ACCEL_KMH_PER_S) {
      push('DECELERATION', 'INFO', `Yavaşlama ${Math.abs(dvPerSec).toFixed(1)} km/h/sn`);
    }
  }

  /* Duruş / rölanti / mola */
  if (stopped) {
    if (st.stoppedSinceMono === null) {
      st = { ...st, stoppedSinceMono: s.monoMs, longIdleReported: false, breakReported: false };
    }
    const stoppedMs = s.monoMs - (st.stoppedSinceMono ?? s.monoMs);
    const engineOn = s.rpm !== null && s.rpm >= IDLE_MIN_RPM;

    if (engineOn) {
      if (st.idleSinceMono === null) st = { ...st, idleSinceMono: s.monoMs };
      const idleMs = s.monoMs - (st.idleSinceMono ?? s.monoMs);
      if (!st.longIdleReported && idleMs >= LR_LONG_IDLE_MS) {
        st = { ...st, longIdleReported: true };
        push('LONG_IDLE', 'INFO', `Rölanti ${Math.round(idleMs / 60_000)} dk`);
      }
    } else {
      st = { ...st, idleSinceMono: null };
    }

    if (!st.breakReported && stoppedMs >= LR_BREAK_STOP_MS) {
      st = { ...st, breakReported: true };
      push('BREAK_STOP', 'INFO', `Mola: ${Math.round(stoppedMs / 60_000)} dk duruş`);
    }
  } else {
    /* Duruş → kalkış geçişi: dur-kalk penceresini besler. */
    if (st.stoppedSinceMono !== null) {
      const windowStart = st.stopGoWindowStartMono ?? s.monoMs;
      const withinWindow = s.monoMs - windowStart <= LR_STOP_GO_WINDOW_MS;
      st = withinWindow
        ? { ...st, stopGoWindowStartMono: windowStart, stopGoTransitions: st.stopGoTransitions + 1 }
        : { ...st, stopGoWindowStartMono: s.monoMs, stopGoTransitions: 1, stopGoReported: false };
    }
    st = { ...st, stoppedSinceMono: null, idleSinceMono: null };

    if (!st.stopGoReported && st.stopGoTransitions >= STOP_GO_MIN_TRANSITIONS) {
      st = { ...st, stopGoReported: true };
      push('CITY_STOP_GO', 'INFO',
        `${st.stopGoTransitions} duruş-kalkış / ${Math.round(LR_STOP_GO_WINDOW_MS / 60_000)} dk`);
    }
  }

  /* Sabit hızlı uzun yol */
  const steadyCandidate = speed >= STEADY_MIN_KMH
    && (!prev || prev.speed === null || Math.abs(speed - prev.speed) <= STEADY_BAND_KMH);
  if (steadyCandidate) {
    if (st.steadySinceMono === null) st = { ...st, steadySinceMono: s.monoMs, steadyReported: false };
    const steadyMs = s.monoMs - (st.steadySinceMono ?? s.monoMs);
    if (!st.steadyReported && steadyMs >= LR_STEADY_CRUISE_MS) {
      st = { ...st, steadyReported: true };
      push('HIGHWAY_STEADY', 'INFO',
        `${Math.round(steadyMs / 60_000)} dk sabit hız (~${Math.round(speed)} km/h)`);
    }
  } else {
    st = { ...st, steadySinceMono: null };
  }

  /* Uzun rampa / yük: yüksek gaz sürerken hız ARTMIYOR → yük altında. */
  const loaded = s.throttle !== null && s.throttle >= HIGH_LOAD_THROTTLE
    && prev !== null && prev.speed !== null && speed - prev.speed <= 1;
  if (loaded) {
    if (st.highLoadSinceMono === null) st = { ...st, highLoadSinceMono: s.monoMs, highLoadReported: false };
    const loadMs = s.monoMs - (st.highLoadSinceMono ?? s.monoMs);
    if (!st.highLoadReported && loadMs >= HIGH_LOAD_MIN_MS) {
      st = { ...st, highLoadReported: true };
      push('LONG_GRADE_LOAD', 'INFO',
        `${Math.round(loadMs / 1000)} sn yüksek gaz (%${Math.round(s.throttle ?? 0)}) · hız artmıyor`);
    }
  } else {
    st = { ...st, highLoadSinceMono: null };
  }

  return { state: st, hits };
}
