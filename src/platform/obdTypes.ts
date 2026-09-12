/* ── OBD Types & Initial State ───────────────────────────── */

export type OBDConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'initializing'   // connectOBD resolve → ECU handshake ısınma penceresi
  | 'connected'
  | 'reconnecting'   // exponential-backoff retry in progress
  | 'error';

export type VehicleType = 'ice' | 'diesel' | 'ev' | 'hybrid' | 'phev';

export interface OBDData {
  connectionState: OBDConnectionState;
  source: 'real' | 'mock' | 'none';
  deviceName: string;
  vehicleType: VehicleType;  // aktif araç tipi
  /** Unix ms — son GEÇERLİ ECU frame'i (ATRV HARİÇ). 0 = hiç alınmadı. */
  lastSeenMs: number;

  /* ── Ayrık bağlantı durumları ────────────────────────────────────────────────
   * `connectionState` DÖRT ayrı gerçeği tek alana sıkıştırıyordu; bir PID timeout'u
   * global "kopuk" gibi görünüyordu. Bu üç alan onları AYIRIR (connectionState
   * geriye dönük uyum için AYNEN korunur). */

  /**
   * Transport (RFCOMM/GATT/TCP) linki DOĞRULANMIŞ biçimde canlı mı — native'den paket
   * geliyor mu (ATRV dahil). UI "OBD bağlı değil" mesajını YALNIZ bu false iken gösterir.
   * ECU'nun susması bunu false YAPMAZ.
   */
  transportConnected: boolean;
  /**
   * ECU verisi TAZE mi. false → son değerler KORUNUR ama "stale" gösterilir; bağlantı
   * DÜŞMEZ, reconnect BAŞLAMAZ. Kısa veri boşluklarının UI'da kopma gibi görünmemesi
   * için `transportConnected`'ten ayrıdır.
   */
  dataFresh: boolean;
  /** Unix ms — son HERHANGİ bir native paket (ATRV dahil) = link heartbeat. 0 = hiç. */
  lastRxAt: number;

  // ── Universal ─────────────────────────────────
  speed: number;        // km/h
  headlights: boolean;  // far açık/kapalı

  // ── ICE / Diesel / Hybrid ─────────────────────
  rpm: number;          // motor RPM  (-1 = EV'de yok)
  engineTemp: number;   // °C         (-1 = EV'de yok)
  fuelLevel: number;    // 0–100%     (-1 = tam EV'de yok)
  throttle: number;     // 0–100%     (-1 = desteklenmiyor)
  intakeTemp: number;   // °C         (-1 = desteklenmiyor)
  boostPressure: number; // kPa turbo (-1 = yok)
  egt: number;          // °C egzoz   (-1 = yok)

  // ── EV / Hybrid ───────────────────────────────
  batteryLevel: number;   // % SoC   (-1 = ICE'de yok)
  batteryTemp: number;    // °C      (-1 = ICE'de yok)
  range: number;          // km      (-1 = ICE'de yok)
  chargingState: 'not_charging' | 'charging' | 'fast_charging' | 'unknown';
  chargingPower: number;  // kW      (-1 = şarj değil)
  motorPower: number;     // kW çıkış / regen (-1 = desteklenmiyor)

  // ── Computed fuel metrics ─────────────────────
  /** Kalan yakıt (litre) — fuelTankL config ile hesaplanır; -1 = config eksik / EV */
  fuelRemainingL: number;
  /** Tahmini menzil (km) — ortalama tüketim + kalan yakıt; -1 = hesaplanamadı */
  estimatedRangeKm: number;

  // ── 12V Akü (tüm araç tipleri) ───────────────
  /** 12V kurşun-asit akü voltajı (V) — PID 0x42 System Voltage / CAN bus.
   *  -1 = desteklenmiyor; undefined = henüz okunmadı. */
  batteryVoltage?: number;

  // ── Body status (CAN bus / extended OBD) ──────
  /** Kapı açıklık durumu — CAN bus kaynaklı; undefined = desteklenmiyor */
  doors?: {
    fl:    boolean;  // ön-sol (sürücü)
    fr:    boolean;  // ön-sağ (yolcu)
    rl:    boolean;  // arka-sol
    rr:    boolean;  // arka-sağ
    trunk: boolean;  // bagaj
  };
  /** TPMS lastik basınçları (kPa) — undefined = sensör yok */
  tpms?: {
    fl: number;  // ön-sol
    fr: number;  // ön-sağ
    rl: number;  // arka-sol
    rr: number;  // arka-sağ
  };
}

export const INITIAL: OBDData = {
  connectionState: 'idle',
  source: 'none',
  deviceName: '',
  vehicleType: 'ice',
  lastSeenMs: 0,
  // Fail-closed: kanıt gelene kadar link "bağlı değil", veri "taze değil".
  transportConnected: false,
  dataFresh: false,
  lastRxAt: 0,
  // Universal
  speed: 0,
  headlights: false,
  // ICE / Diesel — tüm değerler -1: ELM327 bağlanana kadar sensör verisi yok
  rpm: -1,
  engineTemp: -1,
  fuelLevel: -1,
  throttle: -1,
  intakeTemp: -1,
  boostPressure: -1,
  egt: -1,
  // EV / Hybrid
  batteryLevel: -1,
  batteryTemp: -1,
  range: -1,
  chargingState: 'unknown',
  chargingPower: -1,
  motorPower: -1,
  // Computed
  fuelRemainingL: -1,
  estimatedRangeKm: -1,
  // Body status — undefined until CAN bus data arrives
  doors: undefined,
  tpms:  undefined,
};
