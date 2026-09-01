/**
 * safetyStateMapper — UnifiedVehicleStore → SafetyRuleEngine köprüsü (FAZ 2.5)
 *
 * İZOLE ADAPTER: Bu dosya iki taraf arasında veri dönüştürür.
 *   - Sol taraf: UnifiedVehicleStore (CAN/OBD/GPS ham verileri)
 *   - Sağ taraf: SafetyRuleEngine (normalleştirilmiş SafetyVehicleState)
 *
 * SÖZLEŞME:
 *   - createSafetyStateFromVehicleStore: SAF fonksiyon, yan etki yok, Date.now() yok.
 *   - computeSafetyOutput: React bağımsız orchestrator — test edilebilir.
 *   - SafetyRuleEngine ve SafetyAlertQueue DOKUNULMAZ.
 *   - CAN adapter, UnifiedVehicleStore DOKUNULMAZ.
 *
 * TIMESTAMP DİSİPLİNİ:
 *   _vehicleSpeedTs, performance.now() saatiyle üretilir.
 *   Engine ve hook aynı saati (performance.now()) kullanmak zorundadır.
 *   Date.now() KESİNLİKLE KULLANILMAZ — saat farkı stale kontrolünü çöktürür.
 *
 * YANLIŞ-ALARM GAITING (seatbelt / headlights):
 *   canSeatbelt ve canHeadlights store'da varsayılan false başlar.
 *   Sinyalsiz araçta false → kural "takılı değil / kapalı" sayar → YANLIŞ ALARM.
 *   Çözüm: signalsAvailable.seatbelt/headlights bayrağı dışarıdan açıkça verilmeden
 *   bu alanlar undefined geçirilir; engine undefined gördüğünde tetiklenmez.
 *
 * RESET-SAFE TASARIM:
 *   resetCanData() çağrısı sonrası CAN boolean'ları false, numerikler null.
 *   false ve null → kurallar doğal susukluğa girer (stale değil, koşulsuz pasif).
 *   Sadece speed özel: gerçek _vehicleSpeedTs'e sahip → engine speed-stale kontrolü çalışır.
 *   Diğer alanlar için per-CAN timestamp store'da yok; stale yerine reset-safe.
 */

import { evaluateSafetyRules } from './SafetyRuleEngine';
import { SafetyAlertQueue } from './SafetyAlertQueue';
import type {
  SafetyVehicleState,
  SafetyUpdatedAt,
  SafetyQueueOutput,
} from './types';
import type { UnifiedVehicleState } from '../vehicleDataLayer/UnifiedVehicleStore';
import { resolveLiveCanonicalSignal, canonicalSignalChanged } from '../vehicleDataLayer/canonicalVehicleSignal';

// ── Seçenekler arayüzü ────────────────────────────────────────────────────────

/**
 * Mapper ve orchestrator için dış bağlam seçenekleri.
 *
 * isDark: araç sinyali değil — saat + ortam ışığı hesabı dışarıdan gelir.
 * signalsAvailable: hangi CAN sinyallerinin bu araçta gerçekten var olduğu.
 *   Eksik bayrak → o sinyal undefined → ilgili kural sönük (yanlış-alarm önlemi).
 */
export interface SafetyMapOptions {
  /**
   * P0-OBD-02 — DUVAR SAATİ damgası (`Date.now()`), OBD tazelik kapısı İÇİN.
   *
   * NEDEN AYRI BİR SAAT: kural motorunun `now` parametresi `performance.now()`tir
   * (monotonik; `_vehicleSpeedTs` ile aynı eksen). OBD ölçüm damgaları ise
   * `Date.now()`tur (tüm OBD yığınının kullandığı saat). İkisini karıştırmak
   * yaşları anlamsız yapardı, bu yüzden AYRI alandır — ve mapper saflığı korunur
   * (fonksiyon kendi `Date.now()`unu ÇAĞIRMAZ).
   *
   * FAIL-CLOSED: verilmezse OBD kaynaklı sinyaller `UNAVAILABLE` sayılır (CAN
   * etkilenmez). Bayat bir ölçümle alarm üretmektense sessiz kalmak yeğdir.
   */
  wallClockMs?: number;
  /** Gece/karanlık algısı (saat + ortam ışığı füzyonu). Bilinmiyorsa undefined. */
  isDark?: boolean;
  /** Bu araçta hangi CAN sinyallerinin gerçekten mevcut olduğunu bildirir. */
  signalsAvailable?: {
    /** true ise canSeatbelt değeri geçirilir; aksi halde undefined (kural sönük). */
    seatbelt?: boolean;
    /** true ise canHeadlights değeri geçirilir; aksi halde undefined (kural sönük). */
    headlights?: boolean;
  };
}

// ── Mapper çıktı tipi ─────────────────────────────────────────────────────────

/** createSafetyStateFromVehicleStore dönüş değeri. */
export interface SafetyMappedState {
  state: SafetyVehicleState;
  updatedAt: SafetyUpdatedAt;
}

// ── Ana mapper (saf fonksiyon) ────────────────────────────────────────────────

/**
 * UnifiedVehicleState → SafetyVehicleState + SafetyUpdatedAt dönüşümü.
 *
 * MAPPING TABLOSU (birebir uygulanır):
 *
 * | SafetyVehicleState | Kaynak               | Kural                                          |
 * |--------------------|----------------------|------------------------------------------------|
 * | speed              | v.speed              | doğrudan (number|null)                         |
 * | reverse            | v.reverse            | doğrudan boolean                               |
 * | doorOpen           | v.canDoorOpen        | doğrudan boolean                               |
 * | parkingBrake       | v.canParkingBrake    | doğrudan boolean                               |
 * | coolantTemp        | CAN → OBD otoritesi  | number|null (resolveCanonicalSignal)           |
 * | fuel               | v.fuel               | number|null                                    |
 * | batteryVolt        | CAN → OBD otoritesi  | number|null (resolveCanonicalSignal)           |
 * | seatbelt           | v.canSeatbelt        | YALNIZCA signalsAvailable.seatbelt=true ise;  |
 * |                    |                      | aksi halde undefined (yanlış-alarm önlemi)     |
 * | headlightsOn       | v.canHeadlights      | YALNIZCA signalsAvailable.headlights=true ise; |
 * |                    |                      | aksi halde undefined                           |
 * | isDark             | opts.isDark          | araç sinyali değil; yoksa undefined            |
 * | hoodOpen           | (store'da YOK)       | daima undefined                                |
 * | trunkOpen          | (store'da YOK)       | daima undefined                                |
 * | oilWarning         | (store'da YOK)       | daima undefined                                |
 *
 * updatedAt.speed: YALNIZCA v.speed != null ise v._vehicleSpeedTs atanır.
 *   _vehicleSpeedTs performance.now() saatidir → hook/orchestrator now olarak
 *   da performance.now() kullanmalıdır (aynı saat).
 *   speed null ise updatedAt.speed YAZILMAZ.
 *
 * @param v    - UnifiedVehicleStore anlık snapshot'ı
 * @param opts - Dış bağlam (gece/gündüz, sinyal mevcudiyeti)
 */
export function createSafetyStateFromVehicleStore(
  v: UnifiedVehicleState,
  opts?: SafetyMapOptions,
): SafetyMappedState {
  // ── updatedAt: yalnızca speed için gerçek timestamp ───────────────────────
  // Diğer sinyaller için per-CAN timestamp store'da yok.
  // resetCanData() sonrası boolean'lar false / numerikler null → kural koşulsuz pasif.
  // Bu tasarım reset-safe'tir: stale takibi gereksiz.
  /* FAIL-CLOSED: damga yoksa OBD tarafı kullanılamaz. `NaN` bilinçlidir —
     `resolveLiveCanonicalSignal` sonlu olmayan damgada UNAVAILABLE döner, yani
     "damga unutuldu" sessizce "veri taze" anlamına GELEMEZ. */
  const _wall = typeof opts?.wallClockMs === 'number' ? opts.wallClockMs : Number.NaN;

  const updatedAt: SafetyUpdatedAt = {};
  if (v.speed != null) {
    // _vehicleSpeedTs performance.now() saatidir; orchestrator aynı saati kullanır
    updatedAt.speed = v._vehicleSpeedTs;
  }

  // ── SafetyVehicleState dönüşümü ───────────────────────────────────────────
  const state: SafetyVehicleState = {
    // Doğrudan eşlemeler
    speed:        v.speed,
    reverse:      v.reverse,
    doorOpen:     v.canDoorOpen,
    parkingBrake: v.canParkingBrake,
    /* P0-OBD-01 — TEK KANONİK OTORİTE (CAN → OBD → yok).
       ESKİDEN: bu iki alan YALNIZ `canCoolantTemp`/`canBatteryVolt`ten okunuyordu.
       CAN'ı olmayan (aftermarket ELM327'li) araçta ikisi de KALICI `null` kalıyor,
       dolayısıyla Guardian'ın aşırı ısınma ve akü kuralları HİÇ tetiklenmiyordu —
       oysa OBD PID 0x05 ve 0x42 o sırada okunuyordu (worker ENGINE_OVERHEAT olayını
       zaten OBD ısısıyla üretiyordu; Safety Brain geride kalmıştı). Otorite tek
       yerde: bkz. `canonicalVehicleSignal.ts`. */
    coolantTemp:  resolveLiveCanonicalSignal(v, 'coolantTemp', _wall).value,
    fuel:         v.fuel,
    batteryVolt:  resolveLiveCanonicalSignal(v, 'batteryVolt', _wall).value,

    // Yanlış-alarm gating: sinyal mevcudiyeti açıkça bildirilmeden undefined
    // Store default false → "kemer takılı değil / far kapalı" → kural tetiklenir → YANLIŞ ALARM
    // Bu alanlar yalnızca araçta gerçekten bu CAN sinyali geliyorsa geçirilir
    seatbelt:    opts?.signalsAvailable?.seatbelt === true
      ? v.canSeatbelt
      : undefined,
    headlightsOn: opts?.signalsAvailable?.headlights === true
      ? v.canHeadlights
      : undefined,

    // Araç sinyali değil; saat + ortam ışığı füzyonu dışarıdan gelir
    isDark: opts?.isDark,

    // Store'da YOK → daima undefined (ilgili kurallar hiçbir zaman tetiklenmez)
    hoodOpen:   undefined,
    trunkOpen:  undefined,
    oilWarning: undefined,
  };

  return { state, updatedAt };
}

// ── Store subscribe seçicisi (K24 perf düzeltmesi — FAZ 2.6b) ─────────────────

/**
 * İki ardışık UnifiedVehicleStore snapshot'ı arasında, createSafetyStateFromVehicleStore'un
 * GERÇEKTEN OKUDUĞU alanlardan (yukarıdaki MAPPING TABLOSU) herhangi biri değişti mi?
 *
 * NEDEN: useSafetyAlerts eskiden `useUnifiedVehicleStore.subscribe(() => runCompute())`
 * ile seçicisiz abone oluyordu — store'daki HER değişiklikte (örn. sadece map/tema state'i
 * güncellenince) gereksiz yere computeSafetyTick tetikleniyordu. Bu fonksiyon yalnızca
 * mapper'ın kullandığı alanları karşılaştırır; ilgisiz store değişimlerinde false döner.
 *
 * seatbelt/headlights: signalsAvailable bayrağı false ise mapper bu alanları HER ZAMAN
 * undefined'a eşler (bkz. createSafetyStateFromVehicleStore) — yani değerleri değişse
 * bile çıktıyı etkilemez, bu yüzden bayrak kapalıyken karşılaştırmaya HİÇ dahil edilmez.
 *
 * NOT: _vehicleSpeedTs kasıtlı olarak karşılaştırılmaz — zaman bazlı "stale" kontrolü
 * 500ms'lik safetyTicker tarafından periyodik yapılır (bkz. useSafetyAlerts); bu seçici
 * yalnızca ANLIK değer değişikliklerinde erken tetikleme sağlar.
 */
export function safetyRelevantFieldsChanged(
  state: UnifiedVehicleState,
  prevState: UnifiedVehicleState,
  signalsAvailable?: SafetyMapOptions['signalsAvailable'],
  wallClockMs?: number,
): boolean {
  /* Damga yoksa İKİ tarafı da aynı (fail-closed) kabul kuralıyla kıyaslarız →
     OBD kaynaklı değişim "değişmedi" görünür. Bu güvenlidir: 500 ms'lik
     safetyTicker zaten periyodik olarak yeniden hesaplar (bkz. useSafetyAlerts). */
  const _wall = typeof wallClockMs === 'number' ? wallClockMs : Number.NaN;
  if (
    state.speed           !== prevState.speed ||
    state.reverse         !== prevState.reverse ||
    state.canDoorOpen     !== prevState.canDoorOpen ||
    state.canParkingBrake !== prevState.canParkingBrake ||
    state.fuel             !== prevState.fuel ||
    /* Ham alan DEĞİL, OTORİTER SONUÇ kıyaslanır: CAN varken OBD'nin değişmesi
       mapper çıktısını DEĞİŞTİRMEZ; naif kıyas gereksiz hesap tetiklerdi (K24). */
    canonicalSignalChanged(state, prevState, 'coolantTemp', _wall) ||
    canonicalSignalChanged(state, prevState, 'batteryVolt', _wall)
  ) {
    return true;
  }
  if (signalsAvailable?.seatbelt === true && state.canSeatbelt !== prevState.canSeatbelt) {
    return true;
  }
  if (signalsAvailable?.headlights === true && state.canHeadlights !== prevState.canHeadlights) {
    return true;
  }
  return false;
}

// ── Orchestrator (React bağımsız, tam test edilebilir) ────────────────────────

/**
 * CAN/OBD/GPS verilerini alır, mapper → engine → queue zincirini çalıştırır.
 *
 * React hook veya test ortamı bu fonksiyonu çağırır.
 * Queue instance dışarıda tutulur → durum korunur (debounce/tekrar sayaçları).
 *
 * @param queue - Durum korunan SafetyAlertQueue instance'ı (dışarıdan gelir)
 * @param v     - UnifiedVehicleStore anlık snapshot'ı
 * @param now   - performance.now() — Date.now() DEĞİL (timestamp saat uyumu şart)
 * @param opts  - Gece/sinyal mevcudiyeti seçenekleri
 */
export function computeSafetyOutput(
  queue: SafetyAlertQueue,
  v: UnifiedVehicleState,
  now: number,
  opts?: SafetyMapOptions,
): SafetyQueueOutput {
  // 1. Store → SafetyVehicleState + updatedAt dönüşümü
  const { state, updatedAt } = createSafetyStateFromVehicleStore(v, opts);

  // 2. Engine: saf fonksiyon → anlık aktif alert listesi
  const activeAlerts = evaluateSafetyRules(state, now, updatedAt);

  // 3. Queue: debounce / tekrar / mute → SafetyQueueOutput
  return queue.update(activeAlerts, now);
}

// ── Output karşılaştırma (saf, yan etki yok) ─────────────────────────────────

/**
 * İki SafetyQueueOutput'un işlevsel olarak eşit olup olmadığını karşılaştırır.
 *
 * NEDEN ts KARŞILAŞTIRMAYA GİRMEZ:
 *   SafetyAlert.ts her tick'te `now` ile üretilir → aynı koşulda bile
 *   her çağrıda farklıdır. ts kıyasa girse → her tick "farklı" → re-render fırtınası.
 *   ruleId statik kimliktir (koşul var mı yok mu → ruleId değişir ya da kaybolur).
 *
 * KIYASLANAN ALANLAR:
 *   - voiceAnnouncementAlert: null-güvenli ruleId eşitliği.
 *     Queue semantiği: her tekrarlı ses arasında null'a döner; bu null→değer
 *     geçişi bilerek yakalanır (ses kanalı önemli).
 *   - primaryBannerAlert: null-güvenli ruleId eşitliği.
 *   - visibleAlerts: önce length, sonra sırayla ruleId eşitliği.
 *   - muted: eleman-eleman string dizi eşitliği (sıra dahil).
 *   - suppressed: eleman-eleman string dizi eşitliği (sıra dahil).
 *
 * @returns Tüm alanlar eşitse true, herhangi biri farklıysa false.
 */
export function safetyOutputsEqual(
  a: SafetyQueueOutput,
  b: SafetyQueueOutput,
): boolean {
  // voiceAnnouncementAlert: null-güvenli ruleId kıyası
  const aVoice = a.voiceAnnouncementAlert?.ruleId ?? null;
  const bVoice = b.voiceAnnouncementAlert?.ruleId ?? null;
  if (aVoice !== bVoice) return false;

  // primaryBannerAlert: null-güvenli ruleId kıyası
  const aBanner = a.primaryBannerAlert?.ruleId ?? null;
  const bBanner = b.primaryBannerAlert?.ruleId ?? null;
  if (aBanner !== bBanner) return false;

  // visibleAlerts: önce uzunluk, sonra sıralı ruleId karşılaştırması
  if (a.visibleAlerts.length !== b.visibleAlerts.length) return false;
  for (let i = 0; i < a.visibleAlerts.length; i++) {
    if (a.visibleAlerts[i].ruleId !== b.visibleAlerts[i].ruleId) return false;
  }

  // muted: eleman-eleman string dizi eşitliği
  if (a.muted.length !== b.muted.length) return false;
  for (let i = 0; i < a.muted.length; i++) {
    if (a.muted[i] !== b.muted[i]) return false;
  }

  // suppressed: eleman-eleman string dizi eşitliği
  if (a.suppressed.length !== b.suppressed.length) return false;
  for (let i = 0; i < a.suppressed.length; i++) {
    if (a.suppressed[i] !== b.suppressed[i]) return false;
  }

  return true;
}

// ── Tek-tick hesap (saf, test edilebilir) ─────────────────────────────────────

/** computeSafetyTick dönüş değeri. */
export interface SafetyTickResult {
  /** Queue'nun bu tick'teki çıktısı (UI'ya iletilecek). */
  output: SafetyQueueOutput;
  /**
   * Engine'in ham çıktısına göre aktif alert var mı?
   *
   * NEDEN visibleAlerts.length değil:
   *   visibleAlerts yalnızca debounce onaylanmış alertleri içerir.
   *   Debounce bekleyen bir alert henüz visible değildir ama engine onu
   *   üretmektedir → tick devam etmeli ki debounce onaylansın ve
   *   voiceAnnouncementAlert üretilebilsin. Koşul kalkınca engine 0 alert
   *   üretir → bu false döner → ticker durur (queue track'leri zaten silinmiştir
   *   → bekleyen repeat/debounce kalmaz).
   */
  hasActiveAlerts: boolean;
}

/**
 * Tek bir hesap tick'i: mapper → engine → queue zinciri + ticker kararı.
 *
 * React bağımsız; fake timers ile test edilebilir.
 *
 * @param queue - Durum korunan SafetyAlertQueue instance'ı
 * @param v     - UnifiedVehicleStore anlık snapshot'ı
 * @param now   - performance.now() — Date.now() DEĞİL
 * @param opts  - Gece/sinyal mevcudiyeti seçenekleri
 */
export function computeSafetyTick(
  queue: SafetyAlertQueue,
  v: UnifiedVehicleState,
  now: number,
  opts?: SafetyMapOptions,
): SafetyTickResult {
  // 1. Store → SafetyVehicleState + updatedAt dönüşümü
  const { state, updatedAt } = createSafetyStateFromVehicleStore(v, opts);

  // 2. Engine: saf fonksiyon → anlık aktif alert listesi (ham çıktı)
  const activeAlerts = evaluateSafetyRules(state, now, updatedAt);

  // 3. Queue: debounce / tekrar / mute → SafetyQueueOutput
  const output = queue.update(activeAlerts, now);

  // hasActiveAlerts: engine ham çıktısına bakılır (debounce bekleyenler dahil)
  return { output, hasActiveAlerts: activeAlerts.length > 0 };
}
