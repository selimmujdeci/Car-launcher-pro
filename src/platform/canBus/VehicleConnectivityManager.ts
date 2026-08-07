/**
 * VehicleConnectivityManager — Patch 5
 *
 * Her araç sinyal kaynağının bağlantı sağlığını izler.
 * Yeni adapter veya thread oluşturmaz — mevcut servislerden okur.
 *
 * Kaynaklar ve öncelik:
 *   MCU/CANBOX  (0.92) — Hiworld canbox native CAN
 *   OBD         (0.85) — Bluetooth ELM327
 *   RAW_CAN     (0.80) — ELM327 ATMA modu
 *   GPS         (0.70) — GNSS fallback
 *
 * Bağlantı noktaları:
 *   ← useHALStatusStore : CAN phase (MCU sağlığı)
 *   ← onOBDData         : OBD veri akışı
 *   ← onGPSLocation     : GPS konum akışı
 *   ← ProfileSignalGate : Safe Mode durumu
 */

import { useHALStatusStore }       from '../vehicleDataLayer/halStatusStore';
import { onOBDData }               from '../obdService';
import { onGPSLocation }           from '../gpsService';
import { isGateSafeMode, getSafeModeReason } from './ProfileSignalGate';

// ── Tipler ───────────────────────────────────────────────────────────────────

export type ConnectivitySource = 'MCU' | 'OBD' | 'RAW_CAN' | 'GPS';

/**
 * T5 — ARAÇ KİMLİĞİ (VIN) DURUMU: bağlantı ekseninden AYRI bir güven eksenidir.
 *
 * VIN okunamaması bir TAŞIMA hatası değildir; birçok araç 0902'yi hiç desteklemez.
 * Bu yüzden kendi enum'u vardır ve `SourceHealth.errorReason`a ASLA sızmaz.
 */
export type VehicleIdentityStatus =
  | 'unknown'        // henüz ölçülmedi
  | 'not_requested'  // handshake VIN sormadı
  | 'unsupported'    // araç 0902'yi desteklemiyor (arıza DEĞİL)
  | 'read_failed'    // istendi, yanıt alınamadı/bozuk
  | 'absent'         // yanıt geldi, VIN yok
  | 'present'        // VIN okundu (doğrulanmadı)
  | 'verified'       // VIN okundu ve bilinen profille eşleşti
  | 'mismatch';      // VIN okundu ama beklenenle ÇELİŞİYOR (gerçek kimlik arızası)

export interface SourceHealth {
  source:       ConnectivitySource;
  available:    boolean;       // kaynak cihazda mevcut mu
  connected:    boolean;       // aktif veri akışı var mı
  confidence:   number;        // 0.0–1.0 — temel güven
  lastSignalAt: number;        // epoch ms, 0 = hiç gelmedi
  safeMode:     boolean;       // gate bu kaynak için safe mod'da mı
  /**
   * KAYNAĞA ÖZGÜ taşıma/oturum hatası.
   *
   * ESKİ KUSUR (saha snapshot 2026-08-01): burada GLOBAL safe-mode gerekçesi
   * (`getSafeModeReason()`, örn. 'NO_VIN_MATCH') HER kaynağa kopyalanıyordu.
   * Sonuç: sapasağlam bağlı OBD (`connected:true, confidence:0.85`) ve GPS
   * (`connected:true, confidence:0.7`) "NO_VIN_MATCH" hatası taşıyor görünüyordu —
   * GPS için VIN eşleşmesi kavramı ANLAMSIZ olduğu hâlde. LAB'da yanlış teşhis üretiyordu.
   *
   * Artık burada YALNIZ o kaynağın kendi hatası durur. Gate/VIN durumu
   * `safeMode` + `getVehicleIdentity()` eksenlerinden okunur.
   */
  errorReason:  string | null;
  /**
   * Geriye dönük uyumluluk: eski tüketiciler global safe-mode gerekçesini
   * `errorReason` üzerinden okuyordu. Kırmamak için gerekçe KAYBOLMAZ, yalnız
   * DOĞRU alana taşınır — kaynak hatası değil, gate durumu olduğu açıkça görünür.
   */
  safeModeReason: string | null;
}

// ── Sabitler ─────────────────────────────────────────────────────────────────

const BASE_CONFIDENCE: Record<ConnectivitySource, number> = {
  MCU:     0.92,
  OBD:     0.85,
  RAW_CAN: 0.80,
  GPS:     0.70,
};

/** Bu kadar ms veri gelmezse kaynak stale sayılır */
const STALE_THRESHOLD: Record<ConnectivitySource, number> = {
  MCU:     5_000,
  OBD:     4_000,
  RAW_CAN: 4_000,
  GPS:     10_000,
};

// ── Dahili state ──────────────────────────────────────────────────────────────

const _state: Record<ConnectivitySource, SourceHealth> = {
  MCU:     _makeHealth('MCU'),
  OBD:     _makeHealth('OBD'),
  RAW_CAN: _makeHealth('RAW_CAN'),
  GPS:     _makeHealth('GPS'),
};

function _makeHealth(source: ConnectivitySource): SourceHealth {
  return { source, available: false, connected: false,
           confidence: 0, lastSignalAt: 0, safeMode: true,
           errorReason: null, safeModeReason: null };
}

/* ── T9: CAN iletişim semantiği — tek "canAlive" bayrağı YETMEZ ───────────────
 *
 * SAHA KUSURU (snapshot 2026-08-01): OBD protokolü `7` (ISO 15765-4 CAN 11bit/500k)
 * aktif, ECU verisi akıyor (410C/410D yanıtları) — AMA aynı snapshot
 * `canAlive:false`, `RAW_CAN available:false`, `canPhase:"WAIT_FIRST_FRAME"`
 * gösteriyordu. Bu "araçta CAN iletişimi yok" diye okunuyor ve yanlış teşhise
 * götürüyordu. Gerçek: araçla CAN ÜZERİNDEN konuşuluyor (OBD-over-CAN), ama
 * HAM CAN frame yakalama (raw sniffing) bu donanımda mevcut değil. Bunlar
 * FARKLI YETENEKLERDİR ve ayrı raporlanmalıdır.
 *
 * `canPhase:"WAIT_FIRST_FRAME"` de yanıltıcıydı: raw CAN hiç MEVCUT DEĞİLKEN
 * "ilk frame bekleniyor" demek, başlamamış bir işi bekliyormuş gibi gösterir.
 */
export interface CanCapabilityView {
  /** OBD oturumu CAN tabanlı bir protokol üzerinden mi yürüyor (ISO 15765-4). */
  obdOverCanActive: boolean;
  /** Aktif OBD protokol numarası (ELM ATDPN) — bilinmiyorsa null. */
  obdProtocol: string | null;
  /** ELM/OBD oturumu canlı mı (protokolden bağımsız). */
  obdSessionActive: boolean;
  /** HAM CAN frame yakalama bu kurulumda MEVCUT mu. */
  rawCanAvailable: boolean;
  /** Ham CAN frame'i gerçekten akıyor mu. */
  rawCanAlive: boolean;
  /** MCU/CANBOX köprüsü bağlı mı — raw CAN'den AYRI eksen. */
  mcuConnected: boolean;
  /**
   * Ham CAN hattının dürüst durumu. Raw CAN mevcut değilse 'UNAVAILABLE'dır;
   * "frame bekleniyor" DEĞİL (beklenen bir frame yoktur).
   */
  rawCanPhase: 'UNAVAILABLE' | 'NOT_STARTED' | 'WAITING_FIRST_FRAME' | 'ALIVE' | 'TIMEOUT';
}

/** ELM protokol numaraları CAN tabanlı olanlar (ISO 15765-4 aileleri: 6–9, A–C). */
const CAN_BASED_ELM_PROTOCOLS = new Set(['6', '7', '8', '9', 'A', 'B', 'C']);

/**
 * T9: saf türetim — mevcut alanları BOZMAZ, üstüne açık bir yetenek görünümü kurar.
 * Hiçbir yeni ölçüm yapmaz; yalnız var olan kanıtı doğru kavramlara ayırır.
 */
export function deriveCanCapability(input: {
  obdConnected: boolean;
  obdProtocolActive: string | null;
  rawCanAvailable: boolean;
  rawCanConnected: boolean;
  mcuConnected: boolean;
  canPhase: string | null;
}): CanCapabilityView {
  const proto = typeof input.obdProtocolActive === 'string' && input.obdProtocolActive !== ''
    ? input.obdProtocolActive.trim().toUpperCase()
    : null;
  const obdOverCanActive = input.obdConnected && proto !== null && CAN_BASED_ELM_PROTOCOLS.has(proto);

  let rawCanPhase: CanCapabilityView['rawCanPhase'];
  if (!input.rawCanAvailable)      rawCanPhase = 'UNAVAILABLE';
  else if (input.rawCanConnected)  rawCanPhase = 'ALIVE';
  else if (input.canPhase === 'NO_FRAME_TIMEOUT') rawCanPhase = 'TIMEOUT';
  else if (input.canPhase === 'IDLE' || input.canPhase === null) rawCanPhase = 'NOT_STARTED';
  else rawCanPhase = 'WAITING_FIRST_FRAME';

  return {
    obdOverCanActive,
    obdProtocol: proto,
    obdSessionActive: input.obdConnected,
    rawCanAvailable: input.rawCanAvailable,
    rawCanAlive: input.rawCanConnected,
    mcuConnected: input.mcuConnected,
    rawCanPhase,
  };
}

/* ── T5: araç kimliği (VIN) — bağımsız eksen ─────────────────────────────────── */

let _identity: VehicleIdentityStatus = 'unknown';

/**
 * VIN/kimlik durumunu ayarlar. Bağlantı sağlığını ETKİLEMEZ — VIN yokluğu
 * bir taşıma arızası değildir ve hiçbir kaynağı "başarısız" göstermez.
 */
export function setVehicleIdentityStatus(status: VehicleIdentityStatus): void {
  _identity = status;
}

/** Araç kimliği durumu — LAB/tanı bunu bağlantı hatasından AYRI okur. */
export function getVehicleIdentityStatus(): VehicleIdentityStatus {
  return _identity;
}

/**
 * Handshake kanıtından kimlik durumu türetir (saf — test edilebilir).
 *
 * ESKİ KUSUR: snapshot'ta `vinPresent:false` iken `vinClass:"ok"` görünüyordu —
 * "VIN yok" ile "VIN yanıtı sağlıklı" aynı anda iddia ediliyordu. `vinClass`
 * yanıtın BİÇİM sınıfıdır, varlık kanıtı DEĞİLDİR; tek otorite `vinPresent`tir.
 */
export function deriveIdentityStatus(
  hs: { outcome?: string | null; vinPresent?: boolean; vinClass?: string | null } | null,
): VehicleIdentityStatus {
  if (!hs) return 'unknown';
  if (hs.outcome === 'not_run')       return 'not_requested';
  if (hs.outcome === 'not_supported') return 'unsupported';
  if (hs.vinPresent === true)         return 'present';
  // vinPresent false → 'ok' sınıfı VIN'i var yapmaz. Sınıf yoksa hiç istenmemiştir.
  if (hs.vinClass == null)            return 'not_requested';
  if (hs.vinClass === 'unsupported')  return 'unsupported';
  if (hs.vinClass === 'ok')           return 'absent';   // yanıt geldi, VIN taşımıyor
  return 'read_failed';
}

// Listener'lar
const _listeners = new Set<(snapshot: Readonly<typeof _state>) => void>();

// Staleness check interval
let _staleCheckTimer: ReturnType<typeof setInterval> | null = null;
let _halUnsub:   (() => void) | null = null;
let _obdUnsub:   (() => void) | null = null;
let _gpsUnsub:   (() => void) | null = null;
let _started = false;

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * Connectivity Manager'ı başlat.
 * SystemBoot Wave 2'de, VehicleDataLayer'dan sonra çağrılmalı.
 * @returns cleanup fonksiyonu
 */
export function startConnectivityManager(): () => void {
  if (_started) return () => {};
  _started = true;

  // MCU/CANBOX — HAL status store üzerinden
  _halUnsub = useHALStatusStore.subscribe((s) => {
    const phase = s.canPhase;
    const connected = phase === 'CONNECTED';
    const available = phase !== 'IDLE';
    _update('MCU', {
      available,
      connected,
      confidence: connected ? BASE_CONFIDENCE.MCU : 0,
      errorReason: phase === 'FALLBACK_ACTIVE' ? 'CAN frame alınamadı' :
                   phase === 'NO_FRAME_TIMEOUT' ? 'Timeout' : null,
    });
  });

  // OBD — veri akışı varsa connected
  _obdUnsub = onOBDData((_d) => {
    _update('OBD', {
      available:  true,
      connected:  true,
      confidence: BASE_CONFIDENCE.OBD,
      errorReason: null,
    });
  });

  // GPS
  _gpsUnsub = onGPSLocation((loc) => {
    if (!loc) return;
    _update('GPS', {
      available:  true,
      connected:  true,
      confidence: BASE_CONFIDENCE.GPS,
      errorReason: null,
    });
  });

  // Staleness checker — 3s'de bir çalış
  _staleCheckTimer = setInterval(_checkStaleness, 3_000);

  return _stop;
}

/** Anlık snapshot — tüm kaynakların sağlık durumu */
export function getConnectivitySnapshot(): Readonly<typeof _state> {
  return _state;
}

/** Bir kaynağın sağlık durumu */
export function getSourceHealth(source: ConnectivitySource): SourceHealth {
  return _state[source];
}

/** Aktif (connected + confidence > 0) kaynakları döner */
export function getActiveSources(): SourceHealth[] {
  return (Object.values(_state) as SourceHealth[]).filter(s => s.connected);
}

/** Değişiklik listener'ı ekle */
export function onConnectivityChange(fn: (s: Readonly<typeof _state>) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Raw CAN kaynağını manuel güncelle (ElmRawCanMonitor'dan) */
export function markRawCanSignal(): void {
  _update('RAW_CAN', {
    available: true, connected: true,
    confidence: BASE_CONFIDENCE.RAW_CAN, errorReason: null,
  });
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _update(source: ConnectivitySource, patch: Partial<SourceHealth>): void {
  const prev = _state[source];
  const now  = Date.now();
  const safeMode = source === 'MCU' ? false : isGateSafeMode();
  _state[source] = {
    ...prev,
    ...patch,
    lastSignalAt: patch.connected ? now : prev.lastSignalAt,
    safeMode,
    // T5: kaynak hatası YALNIZ o kaynağın kendi hatasıdır. Global safe-mode
    // gerekçesi buraya KOPYALANMAZ (bkz. SourceHealth.errorReason yorumu) —
    // kendi alanına yazılır, böylece hiçbir kanıt kaybolmaz ama karışmaz da.
    errorReason:    patch.errorReason ?? null,
    safeModeReason: safeMode ? getSafeModeReason() : null,
  };
  _notify();
}

function _checkStaleness(): void {
  const now = Date.now();
  let changed = false;
  for (const source of Object.keys(_state) as ConnectivitySource[]) {
    const h = _state[source];
    if (!h.connected) continue;
    const threshold = STALE_THRESHOLD[source];
    if (h.lastSignalAt > 0 && now - h.lastSignalAt > threshold) {
      _state[source] = { ...h, connected: false, confidence: 0, errorReason: 'Sinyal kesildi' };
      changed = true;
    }
  }
  if (changed) _notify();
}

function _notify(): void {
  _listeners.forEach(fn => {
    try { fn(_state); } catch { /* listener hataları sızdırmaz */ }
  });
}

function _stop(): void {
  _started = false;
  _halUnsub?.(); _halUnsub = null;
  _obdUnsub?.(); _obdUnsub = null;
  _gpsUnsub?.(); _gpsUnsub = null;
  if (_staleCheckTimer) { clearInterval(_staleCheckTimer); _staleCheckTimer = null; }
  _listeners.clear();
}
