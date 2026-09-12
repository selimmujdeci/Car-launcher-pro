/**
 * Protokol-Sınıfı Timeout Profili (OBD-OS-F0-4).
 *
 * NEDEN: bugüne kadar TEK timeout seti (CAN'e göre ayarlanmış) tüm protokollere
 * uygulanıyordu. CAN 500 kbit/s'te bir PID yanıtı ~50 ms gelir; KWP2000 (ISO 14230)
 * ve ISO 9141-2 ise 10.4 kbit/s SERİ hattır — 5-baud init tek başına 2–3 sn sürer,
 * ECU yanıtı 100 ms'yi rahat aşar. CAN'e göre biçilmiş 15 sn connect / 10 sn data-gate
 * penceresi bu araçlarda YETMİYOR → bağlantı "kuruldu ama veri yok" sanılıp koparılıyor
 * (Trafic/KWP sahası). Yavaş protokol ARIZA DEĞİLDİR; ona göre beklemek gerekir.
 *
 * KAPSAM KORUMASI: CAN ve BİLİNMEYEN protokol değerleri, mevcut `obdRetryPolicy`
 * sabitleriyle BİREBİR aynıdır — çalışan CAN davranışı bu PR'da değişmez. Yalnız
 * yavaş seri protokoller (KWP/ISO9141/J1850) daha geniş pencere alır.
 */
import { CONNECT_TIMEOUT_MS, DATA_GATE_TIMEOUT_MS, STALE_THRESHOLD_MS } from '../obdRetryPolicy';

/** ELM327 ATSP numarasının protokol sınıfı. */
export type ProtocolClass = 'can' | 'kwp' | 'iso9141' | 'j1850' | 'unknown';

export interface ProtocolTimeoutProfile {
  /** connectOBD (ELM init + warm-up) için üst sınır. */
  connectTimeoutMs: number;
  /** Bağlantı sonrası ilk gerçek PID verisi için bekleme (data-gate). */
  dataGateTimeoutMs: number;
  /** Bu süre boyunca frame gelmezse bağlantı düşmüş sayılır (stale watchdog). */
  staleThresholdMs: number;
}

/**
 * ELM327 ATSP numarası → protokol sınıfı.
 * 1=J1850 PWM · 2=J1850 VPW · 3=ISO 9141-2 · 4=KWP 5-baud init · 5=KWP fast init ·
 * 6..9=CAN (11/29 bit, 250/500 kbit) · A..C=CAN (SAE J1939 / kullanıcı) · 0/null=otomatik.
 */
export function classifyProtocol(protocol: string | null | undefined): ProtocolClass {
  if (!protocol) return 'unknown';
  switch (protocol.trim().toUpperCase()) {
    case '1': case '2': return 'j1850';
    case '3':           return 'iso9141';
    case '4': case '5': return 'kwp';
    case '6': case '7': case '8': case '9':
    case 'A': case 'B': case 'C': return 'can';
    default: return 'unknown';   // '0' (ATSP0 otomatik) dahil → henüz bilinmiyor
  }
}

/**
 * CAN + BİLİNMEYEN: mevcut sabitler AYNEN (regresyon yok — bilinmeyen protokolde
 * pencereyi uzatmak, yanlış transport'ta BLE↔classic fallback'ini geciktirirdi).
 */
const CAN_PROFILE: ProtocolTimeoutProfile = {
  connectTimeoutMs:  CONNECT_TIMEOUT_MS,    // 15 s
  dataGateTimeoutMs: DATA_GATE_TIMEOUT_MS,  // 10 s
  staleThresholdMs:  STALE_THRESHOLD_MS,    // 12 s
};

const PROFILES: Record<ProtocolClass, ProtocolTimeoutProfile> = {
  can:     CAN_PROFILE,
  unknown: CAN_PROFILE,
  // KWP2000 (ISO 14230-4): 10.4 kbit/s seri. Fast init ~300 ms, 5-baud init 2–3 sn;
  // ECU yanıt gecikmesi (P2max) 50 ms'den 1 sn'ye kadar çıkabilir.
  kwp: {
    connectTimeoutMs:  25_000,
    dataGateTimeoutMs: 18_000,
    staleThresholdMs:  18_000,
  },
  // ISO 9141-2: aynı seri hat, ama yalnız 5-baud init → en yavaş el sıkışması.
  iso9141: {
    connectTimeoutMs:  28_000,
    dataGateTimeoutMs: 20_000,
    staleThresholdMs:  20_000,
  },
  // SAE J1850 (VPW 10.4 / PWM 41.6 kbit): CAN'den yavaş, seri protokollerden hızlı.
  j1850: {
    connectTimeoutMs:  20_000,
    dataGateTimeoutMs: 14_000,
    staleThresholdMs:  14_000,
  },
};

/** Verilen ATSP protokolü için timeout profili. null/bilinmiyor → CAN (mevcut) değerleri. */
export function getProtocolProfile(protocol: string | null | undefined): ProtocolTimeoutProfile {
  return PROFILES[classifyProtocol(protocol)];
}

/** Yavaş seri protokol mü (KWP/ISO9141)? Native ELM327 ayarları (ATST/ATSW) bunlara uygulanır. */
export function isSlowSerialProtocol(protocol: string | null | undefined): boolean {
  const c = classifyProtocol(protocol);
  return c === 'kwp' || c === 'iso9141';
}
