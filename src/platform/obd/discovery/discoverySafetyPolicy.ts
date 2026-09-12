/**
 * discoverySafetyPolicy — P0 Deep PID/DID Explorer Faz-1 · GÜVENLİK POLİTİKASI (SAF).
 *
 * DEĞİŞMEZ KURALLAR (CLAUDE.md görev tanımı — kod+testle kilitlenir):
 *  1. Tarama kesinlikle READ-ONLY — yalnız izin verilen servisler kuyruğa girer.
 *  2. Yasak servisler (yazma/aktüatör/güvenlik/kodlama) hiçbir koşulda ALLOWLIST'e giremez.
 *  3. Araç HAREKET ediyorsa (hız>0 / bilinmiyor) derin DID taraması BAŞLAMAZ (fail-closed:
 *     hız bilinmiyorsa "duruyor" VARSAYILMAZ — park KANITI istenir).
 *  4. ECU/oturum sağlıksızsa (bağlı değil / gerçek kaynak değil / veri bayat) tarama BAŞLAMAZ.
 *  5. KWP (yavaş seri) protokolde komut bütçesi sıkı sınırlanır (bounded token-bucket).
 *
 * SAF: I/O yok, native/React importu yok — tam test edilebilir.
 */

/**
 * READ-ONLY izin verilen servisler — Mode 01 (current data / desteklenen-PID bitmap) ve
 * UDS ReadDataByIdentifier (22) / KWP ReadDataByLocalIdentifier (21). Bu turda Mode 09
 * (vehicle info) AKTİF olarak sorgulanmıyor (mevcut boru hattı ayrı yoldan okuyor) — yalnız
 * kullanılan servisler allowlist'te; başka hiçbir servis (yazma dahil) ASLA eklenmez.
 */
export const READ_ONLY_ALLOWED_SERVICES: ReadonlySet<string> = Object.freeze(new Set(['01', '22', '21']));

/**
 * Savunma derinliği — bilinçli KARA LİSTE (allowlist zaten fail-closed'dır, bu ek bir kilit):
 * 04 (DTC silme) · 2E (WriteDataByIdentifier) · 31 (RoutineControl) · 27 (SecurityAccess) ·
 * 11 (ECUReset) · 14 (ClearDiagnosticInformation) · 85 (ControlDTCSetting) · 2F (IOControl).
 */
export const HARD_FORBIDDEN_SERVICES: ReadonlySet<string> = Object.freeze(
  new Set(['04', '2E', '31', '27', '11', '14', '85', '2F']),
);

/**
 * Bir servis kodu keşif kuyruğuna girebilir mi. Fail-closed: allowlist DIŞINDAKİ HER ŞEY
 * (bilinmeyen dahil) reddedilir; kara liste ayrıca allowlist'e sızmışsa (programlama hatası)
 * yine de reddeder — savunma derinliği.
 */
export function isReadOnlyServiceAllowed(service: string | null | undefined): boolean {
  if (typeof service !== 'string' || service.length === 0) return false;
  const s = service.trim().toUpperCase();
  if (HARD_FORBIDDEN_SERVICES.has(s)) return false;
  return READ_ONLY_ALLOWED_SERVICES.has(s);
}

/** Derin tarama için gereken sağlık/hareket anlık görüntüsü (obdService.getOBDDataSnapshot türevi). */
export interface DiscoveryHealthSnapshot {
  connectionState: string;
  source: string;
  dataFresh: boolean;
  /** null = hız BİLİNMİYOR (fail-closed: "duruyor" varsayılmaz). */
  speedKmh: number | null;
}

export type DiscoveryGateReason =
  | 'ok'
  | 'unhealthy_session'
  | 'vehicle_moving'
  | 'speed_unknown';

export interface DiscoveryGateDecision {
  readonly allowed: boolean;
  readonly reason: DiscoveryGateReason;
}

/**
 * Derin DID taraması başlayabilir mi / devam edebilir mi. Her adımdan ÖNCE tekrar
 * çağrılmalıdır (mid-scan güvenlik yeniden-kontrolü — tarama sırasında araç hareket
 * edebilir/ECU susabilir).
 */
export function canStartDeepScan(snap: DiscoveryHealthSnapshot): DiscoveryGateDecision {
  if (snap.connectionState !== 'connected' || snap.source !== 'real' || snap.dataFresh !== true) {
    return { allowed: false, reason: 'unhealthy_session' };
  }
  if (snap.speedKmh === null) {
    return { allowed: false, reason: 'speed_unknown' };
  }
  if (snap.speedKmh > 0) {
    return { allowed: false, reason: 'vehicle_moving' };
  }
  return { allowed: true, reason: 'ok' };
}

/**
 * KWP (yavaş seri) komut bütçesi — bounded token-bucket. Pencere dolunca sayaç sıfırlanır;
 * bütçe biterse `tryConsume()` false döner (çağıran taramayı bu turda durdurur).
 */
export class KwpCommandBudget {
  private _count = 0;
  private _windowStart: number;
  private readonly maxCommands: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(maxCommands: number, windowMs: number, now: () => number = Date.now) {
    if (maxCommands < 1) throw new Error('KwpCommandBudget: maxCommands ≥ 1 olmalı');
    if (windowMs < 1) throw new Error('KwpCommandBudget: windowMs ≥ 1 olmalı');
    this.maxCommands = maxCommands;
    this.windowMs = windowMs;
    this.now = now;
    this._windowStart = this.now();
  }

  /** Bir komut hakkı ister. Bütçe doluysa false (çağıran göndermemeli). */
  tryConsume(): boolean {
    const t = this.now();
    if (t - this._windowStart >= this.windowMs) {
      this._windowStart = t;
      this._count = 0;
    }
    if (this._count >= this.maxCommands) return false;
    this._count++;
    return true;
  }

  get remaining(): number {
    return Math.max(0, this.maxCommands - this._count);
  }
}

/** Faz-1 varsayılan KWP keşif bütçesi — sıkı (KWP/K-line yavaş seri hat, saha dersi). */
export const DEFAULT_KWP_DISCOVERY_BUDGET = Object.freeze({ maxCommands: 12, windowMs: 60_000 });
/** CAN'de daha geniş bütçe (hızlı hat) — yine de bounded (DoS gibi davranmasın). */
export const DEFAULT_CAN_DISCOVERY_BUDGET = Object.freeze({ maxCommands: 40, windowMs: 60_000 });
