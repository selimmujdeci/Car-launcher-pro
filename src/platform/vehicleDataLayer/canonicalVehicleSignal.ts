/**
 * canonicalVehicleSignal — AYNI FİZİKSEL VERİNİN TEK OTORİTESİ (P0-OBD-01).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Beş fiziksel büyüklük İKİ ayrı yoldan gelebilir: araç CAN veriyolu ve OBD
 * adaptörü. Köprü OBD tarafını mağazaya taşıyınca, kim kazanır sorusunun
 * cevabı HER TÜKETİCİDE AYRI AYRI yazılırsa ikinci otorite doğar — bu, kütükte
 * defalarca kaydedilmiş bir hata desenidir (`useBatteryVoltage` docstring'i
 * tam olarak bu kopukluğu anlatır: karar yolu OBD'yi okuyup akü uyarısı
 * üretirken, gösterim yolu yalnız CAN'a bakıp kalıcı "—" gösteriyordu).
 *
 * Bu modül o kararın TEK yeridir.
 *
 * ── ÖNCELİK (değişmez) ────────────────────────────────────────────────────
 *   CAN → OBD → yok
 * CAN doğrudan araç şebekesidir (`valTypes` temel güveni 0.92); OBD adaptörü
 * ~300 ms gecikmeli serial hattır (0.85). İkisi de yoksa `null` döner ve
 * kaynak `NONE` olur — sahte 0 / sahte "sağlıklı" ÜRETİLMEZ.
 *
 * ── SAF ───────────────────────────────────────────────────────────────────
 * I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 * Tüm girdi çağırandan gelir; aynı girdi her zaman aynı çıktıyı verir.
 */

import type { CanonicalObdKey } from '../obd/canonicalObdSignals';
import { classifyFreshness, type ObdFreshnessState } from '../obd/obdFreshnessPolicy';
import type { UnifiedVehicleState } from './UnifiedVehicleStore';

/** Değerin GERÇEK üreticisi — kanıtsız "OBD" ya da "CAN" yazılmaz. */
export type CanonicalSignalSource = 'CAN' | 'OBD' | 'NONE';

export interface CanonicalSignalReading {
  /**
   * Fiziksel değer.
   *
   * `null` = ölçülemiyor (arayüz `—`, kural PASİF).
   * `state === 'STALE'` iken değer DOLUDUR ama **karara girmemelidir** — bayat
   * bir ölçüm göstermek dürüsttür, onunla karar vermek değildir.
   */
  readonly value:  number | null;
  /** Değerin nereden geldiği. `NONE` iken `value` her zaman `null`dır. */
  readonly source: CanonicalSignalSource;
  /**
   * P0-OBD-02 — ölçümün karar durumu.
   *   `LIVE`        → güvenilir, karara girebilir.
   *   `STALE`       → gerçek bir ölçümdü, artık güvenilmez. GÖSTER, KARAR VERME.
   *   `UNAVAILABLE` → değer yok ya da o kadar eski ki aracın durumunu anlatmıyor.
   * CAN kaynağı her zaman `LIVE`dır: mağazada CAN alanlarının ZAMAN DAMGASI YOKTUR
   * ve uydurmak provenance yalanı olurdu. CAN kopunca `resetCanData()` alanları
   * zaten `null`a çeker (reset-safe tasarım — bkz. `safetyStateMapper` başlığı).
   */
  readonly state:  ObdFreshnessState;
}

/** Kanıt yok — tek paylaşılan dondurulmuş nesne (tahsis yok). */
const NO_READING: CanonicalSignalReading =
  Object.freeze({ value: null, source: 'NONE' as const, state: 'UNAVAILABLE' as const });

/**
 * Fiziksel makullük bandı. Bant DIŞI değer ÖLÇÜM SAYILMAZ (adaptör glitch'i) —
 * `obdSanitizer` ve `useBatteryVoltage` ile AYNI sözleşme, tek yerde.
 */
interface SignalRange { readonly min: number; readonly max: number }

/**
 * Kanonik büyüklük → (CAN alanı · OBD anahtarı · geçerli bant).
 *
 * Bu tablo `canonicalObdSignals` katalogundaki `canField` eşlemesinin
 * TÜKETİM tarafıdır; kilit testi ikisinin ayrışmadığını doğrular.
 */
const AUTHORITY = {
  coolantTemp: {
    can: 'canCoolantTemp', obd: 'coolantTemp' as CanonicalObdKey,
    range: { min: -40, max: 200 },
  },
  oilTemp: {
    can: 'canOilTemp', obd: 'oilTemp' as CanonicalObdKey,
    range: { min: -40, max: 215 },
  },
  throttle: {
    can: 'canThrottle', obd: 'throttle' as CanonicalObdKey,
    range: { min: 0, max: 100 },
  },
  batteryVolt: {
    can: 'canBatteryVolt', obd: 'moduleVoltage' as CanonicalObdKey,
    range: { min: 8, max: 16 },
  },
  ambientTemp: {
    can: 'canAmbientTemp', obd: 'ambientTemp' as CanonicalObdKey,
    range: { min: -40, max: 80 },
  },
} as const satisfies Record<string, {
  can: keyof UnifiedVehicleState; obd: CanonicalObdKey; range: SignalRange;
}>;

/** CAN ↔ OBD arasında paylaşılan fiziksel büyüklükler. */
export type CanonicalSharedSignal = keyof typeof AUTHORITY;

/** Tüm paylaşılan büyüklükler (LAB/testler bu listeyi gezer). */
export const CANONICAL_SHARED_SIGNALS: readonly CanonicalSharedSignal[] =
  Object.keys(AUTHORITY) as CanonicalSharedSignal[];

function _inRange(v: unknown, r: SignalRange): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;
}

/**
 * Bir paylaşılan sinyalin TEK otoriter okuması: CAN → OBD → yok.
 *
 * Bant dışı bir CAN değeri OBD'yi ENGELLEMEZ: bozuk CAN okuması yüzünden
 * geçerli OBD ölçümünü çöpe atmak, "veri var ama gösterilmiyor" kusurunu
 * yeniden üretirdi.
 *
 * ── P0-OBD-02 · TAZELİK OKUMA ANINDA ──────────────────────────────────────
 * OBD tarafı yaşa göre `LIVE · STALE · UNAVAILABLE` olarak sınıflanır. Bu
 * hesabın OKUMA anında yapılması bilinçlidir: hiçbir timer değerleri
 * "bayatlatmak" için çalışmaz, dolayısıyla uygulama arka plandayken de
 * (WebView timer kısıtlaması altında) sonuç DOĞRUDUR.
 *
 * `nowMs` ZORUNLUDUR — bu modül `Date.now()` çağırmaz (saflık). Fail-closed:
 * çağıran geçersiz bir damga verirse OBD tarafı `UNAVAILABLE` sayılır.
 *
 * @param nowMs Çağıranın Unix ms damgası (`obdSignalsAt` ile AYNI saat).
 */
export function resolveCanonicalSignal(
  s: Pick<UnifiedVehicleState, 'obdSignals'> & Partial<UnifiedVehicleState>,
  signal: CanonicalSharedSignal,
  nowMs: number,
): CanonicalSignalReading {
  const def = AUTHORITY[signal];

  const canVal = s[def.can as keyof UnifiedVehicleState] as unknown;
  if (_inRange(canVal, def.range)) return { value: canVal, source: 'CAN', state: 'LIVE' };

  const entry = s.obdSignals?.[def.obd];
  if (entry === undefined || !_inRange(entry.value, def.range)) return NO_READING;

  // Fail-closed: geçersiz damga → yaş hesaplanamaz → ölçüm kullanılamaz.
  if (!Number.isFinite(nowMs)) return NO_READING;

  const verdict = classifyFreshness({
    hasValue:     true,
    measuredAtMs: entry.atMs,
    nowMs,
    window:       { staleMs: entry.staleMs, unavailableMs: entry.unavailableMs },
    valueEpoch:   entry.epoch,
    currentEpoch: s.obdSessionEpoch ?? entry.epoch,
  });

  if (verdict.state === 'UNAVAILABLE') return NO_READING;
  // STALE'de değer KORUNUR (gösterilebilsin) ama durum açıkça bildirilir.
  return { value: entry.value, source: 'OBD', state: verdict.state };
}

/**
 * Yalnız KARARA GİREBİLİR okuma — `STALE` de `null` sayılır (fail-closed).
 *
 * Guardian, tahmin motoru ve akü koruması bunu kullanır: bayat bir motor ısısıyla
 * aşırı ısınma alarmı üretmek, sahte veriyle karar vermenin ta kendisidir.
 */
export function resolveLiveCanonicalSignal(
  s: Pick<UnifiedVehicleState, 'obdSignals'> & Partial<UnifiedVehicleState>,
  signal: CanonicalSharedSignal,
  nowMs: number,
): CanonicalSignalReading {
  const r = resolveCanonicalSignal(s, signal, nowMs);
  return r.state === 'LIVE' ? r : NO_READING;
}

/** Kısayol: yalnız değeri isteyen çağıranlar için (kaynak gerekmiyorsa). */
export function canonicalSignalValue(
  s: Pick<UnifiedVehicleState, 'obdSignals'> & Partial<UnifiedVehicleState>,
  signal: CanonicalSharedSignal,
  nowMs: number,
): number | null {
  return resolveLiveCanonicalSignal(s, signal, nowMs).value;
}

/**
 * HERHANGİ bir kanonik OBD sinyalinin TAZE değeri — CAN karşılığı OLMAYANLAR dahil.
 *
 * `resolveCanonicalSignal` yalnız CAN ile PAYLAŞILAN beş büyüklüğü çözer. Yakıt
 * trimi · EGR hatası · katalizör sıcaklığı gibi OBD'ye ÖZGÜ sinyallerin CAN
 * karşılığı yoktur ama aynı tazelik ve oturum disiplinine tabidir. Bu fonksiyon
 * o disiplini AYNI politikayla (ikinci kopya değil) uygular.
 *
 * @returns yalnız `LIVE` ölçüm; `STALE`/`UNAVAILABLE`/eksik → `null`.
 */
export function readLiveObdSignal(
  s: Pick<UnifiedVehicleState, 'obdSignals'> & Partial<UnifiedVehicleState>,
  key: CanonicalObdKey,
  nowMs: number,
): number | null {
  const e = s.obdSignals?.[key];
  if (e === undefined || !Number.isFinite(e.value) || !Number.isFinite(nowMs)) return null;
  const v = classifyFreshness({
    hasValue:     true,
    measuredAtMs: e.atMs,
    nowMs,
    window:       { staleMs: e.staleMs, unavailableMs: e.unavailableMs },
    valueEpoch:   e.epoch,
    currentEpoch: s.obdSessionEpoch ?? e.epoch,
  });
  return v.state === 'LIVE' ? e.value : null;
}

/**
 * 12 V AKÜ VOLTAJININ TEK ZİNCİRİ: CAN → OBD PID 0x42 → adaptör ATRV → yok.
 *
 * ── NEDEN AYRI FONKSİYON (P0-OBD-03) ──────────────────────────────────────
 * Bu zincir ÜÇ ayrı yerde ayrı ayrı yazılmıştı: `useBatteryVoltage` (CAN →
 * ATRV), `diagnosticSections.buildPowerSnapshot` (CAN → ATRV, farklı bant
 * kuralıyla) ve `canonicalVehicleSignal` (CAN → PID 0x42). Üçü ayrışabilirdi:
 * gösterge "12,1 V" derken tanı raporu "kaynak yok" yazabiliyordu.
 *
 * ATRV neden kanonik haritada DEĞİL: o, ADAPTÖRÜN kendi hat ölçümüdür, ECU'nun
 * bildirdiği değer değildir (PID 0x42 = kontrol ünitesi voltajı). İkisini aynı
 * anahtara koymak provenance'ı bulanıklaştırırdı; bu yüzden ATRV burada AÇIKÇA
 * SON YEDEK olarak, çağıranın verdiği parametreyle zincire eklenir.
 *
 * SAF: `Date.now()` çağırmaz, obdService'i import etmez (çağıran ATRV'yi verir).
 *
 * @param atrvVolt Adaptörün ATRV okuması (`OBDData.batteryVoltage`); yoksa null.
 */
export function resolveBatteryVoltage(
  s: Pick<UnifiedVehicleState, 'obdSignals'> & Partial<UnifiedVehicleState>,
  atrvVolt: number | null | undefined,
  nowMs: number,
): CanonicalSignalReading {
  // 1-2. CAN → OBD PID 0x42 (yalnız TAZE ölçüm; bayat voltajla akü kararı verilmez).
  const canonical = resolveLiveCanonicalSignal(s, 'batteryVolt', nowMs);
  if (canonical.value !== null) return canonical;

  // 3. Adaptör ATRV — köprü öncesi TEK OBD kaynağıydı, KORUNDU.
  const range = AUTHORITY.batteryVolt.range;
  if (_inRange(atrvVolt, range)) return { value: atrvVolt, source: 'OBD', state: 'LIVE' };

  return NO_READING;
}

/**
 * İki anlık görüntü arasında bu sinyalin OTORİTER SONUCU değişti mi?
 *
 * Ham alanları tek tek kıyaslamak YANILTICIDIR: CAN varken OBD'nin değişmesi
 * sonucu DEĞİŞTİRMEZ, ama naif kıyas "değişti" der ve gereksiz hesap tetikler
 * (K24 bütçesi). Bu fonksiyon KARARI kıyaslar.
 */
export function canonicalSignalChanged(
  next: Pick<UnifiedVehicleState, 'obdSignals'> & Partial<UnifiedVehicleState>,
  prev: Pick<UnifiedVehicleState, 'obdSignals'> & Partial<UnifiedVehicleState>,
  signal: CanonicalSharedSignal,
  nowMs: number,
): boolean {
  const a = resolveCanonicalSignal(next, signal, nowMs);
  const b = resolveCanonicalSignal(prev, signal, nowMs);
  return a.value !== b.value || a.source !== b.source || a.state !== b.state;
}
