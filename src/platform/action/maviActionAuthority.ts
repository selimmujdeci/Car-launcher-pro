/**
 * maviActionAuthority — ARAÇ ETKİLİ eylemlerin TEK kapısı: defter + güvenlik + onay.
 * (MAVI-M4-ACTION-AUTHORITY)
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 kanıtladı: canlı Mavi eylemleri İKİ ayrı yürütücüden geçiyordu
 * (`intentEngine.routeIntent` ve `commandExecutor.dispatchIntent`) ve hiçbiri
 * `AiSafetyGate`i görmüyordu. Telefon araması onaysız başlıyordu; DTC silme
 * `confirmed:true` SABİT geçiyordu; donanım portları kapısız çağrılıyordu.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 * Araç etkili HER intent burada TANIMLIDIR ve her biri için şunlar zorunludur:
 *   actionId · risk · onay gereksinimi · gerekli capability (port) ·
 *   güvenlik kapsamı (AiSafetyGate) · hareket politikası · sonuç sözleşmesi.
 * Defterde OLMAYAN bir intent araç etkili SAYILMAZ → yürütücüye ulaşamaz
 * (guard testi yeni araç etkili intentin defter dışı eklenmesini yasaklar).
 *
 * ── KAPI SIRASI (hepsi port/native/OBD çağrısından ÖNCE) ────────────────────
 *   1. Hareket politikası  → M2 `motionState` (unknown ≠ parked)
 *   2. AiSafetyGate        → `evaluateActionIdSafety` (kapsam kararı)
 *   3. Açık kullanıcı onayı→ gerekiyorsa `needs_confirmation`
 *   4. Capability (port)   → yoksa dürüst `unsupported`
 * Sonuç DAİMA M3 `IntentExecutionResult`tir; bu katman ASLA konuşmaz, UI açmaz,
 * store yazmaz — yalnız KARAR üretir.
 *
 * ── maviCore İLE İLİŞKİ ─────────────────────────────────────────────────────
 * `maviCore` SHADOW/FROZEN kalır (M1 karar matrisi). Buradan yalnız onun SAF
 * kütüphanesi kullanılır (`createActionRegistry` · `evaluateActionIdSafety`);
 * shadow orchestrator/bridge/takeover HİÇ dokunulmaz — import yan etkisizdir.
 */

import { createActionRegistry, type ActionRiskLevel } from '../maviCore/actionRegistry';
import { evaluateActionIdSafety } from '../maviCore/actionSafety';
import { createAiSafetyGate, type AiCapabilityScope } from '../aiCore/safetyGate';
import { intentResult, type IntentExecutionResult } from '../intentExecutionResult';
// MAVI-M4-LAB-2: zincirin TEK bounded aşama halkası (yeni depo DEĞİL — bkz. modül notu).
import {
  recordMaviActionStage, getMaviActionTrace, _resetMaviActionTraceForTest,
} from './maviActionTrace';
import type { IntentType } from '../intentEngine';
import type { VehicleContext } from '../aiVoiceService';

/* ══════════════════════════════════════════════════════════════════════════
 * Defter (registry) — araç etkili eylemlerin TEK tanım yeri
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bu hızın ÜSTÜ tartışmasız "hareket" sayılır. OBD hızı tamsayı km/h yayınlar;
 * 3 km/h el freni çekili araçtaki sensör gürültüsüne pay bırakır ama yürüme
 * hızını geçmez (`obd/writeGate` eşiğiyle aynı ailedendir).
 */
export const MOTION_STOPPED_MAX_KMH = 3;

/** Hareket politikası — M2 `motionState` sözleşmesine dayanır. */
export type MotionPolicy =
  /** Hareket durumu ne olursa olsun yürüyebilir. */
  | 'any'
  /** YALNIZ DOĞRULANMIŞ `stopped`. `moving` VE `unknown` reddedilir (fail-closed). */
  | 'requires_stopped';

/**
 * Araç etkili bir eylemin ihtiyaç duyduğu YÜRÜTÜCÜ PORTU (capability) adı.
 * `CommandContext` üzerindeki alan adıyla BİREBİR aynıdır — kapı bu adla
 * `typeof ports[cap] === 'function'` kontrolü yapar, yürütücü de aynı adla çağırır.
 */
export type VehicleActionCapability =
  | 'hwLockDoors' | 'hwUnlockDoors'
  | 'hwHonkHorn'  | 'hwFlashLights'
  | 'hwAlarmOn'   | 'hwAlarmOff'
  | 'hwRearCamera' | 'hwLightsOff' | 'hwScreenOff';

export interface VehicleActionDef {
  /** Defter kimliği — `evaluateActionIdSafety` bu id ile sorar. */
  readonly actionId: string;
  readonly risk: ActionRiskLevel;
  /** Açık kullanıcı onayı ZORUNLU mu (telefon araması, DTC silme…). */
  readonly requiresConfirmation: boolean;
  /**
   * Yürütücünün ihtiyaç duyduğu `CommandContext` portu. `null` → port gerekmez
   * (yürütücü doğrudan servisi çağırır, ör. `dtcService`).
   *
   * `hwRearCamera` · `hwLightsOff` · `hwScreenOff` BİLİNÇLİ olarak hiçbir yerde
   * SAĞLANMAZ: bu üç eylemin native karşılığı YOKTUR. Deftere kayıtlı olmaları
   * onları "var" yapmaz — kapı port bulamayınca DÜRÜST `unsupported` döner
   * ("yapıldı" DENMEZ). Native port geldiği gün yalnız çağıran taraf bağlanır.
   */
  readonly capability: VehicleActionCapability | null;
  /** AiSafetyGate kapsamı. Tanımsız → araç ECU'suna dokunmaz (UI/telefon/nav). */
  readonly vehicleScope?: AiCapabilityScope;
  readonly motionPolicy: MotionPolicy;
  /** İnsan-okur başlık (log/tanı — kullanıcıya GÖSTERİLMEZ). */
  readonly title: string;
  /**
   * Politikanın KAYNAĞI — yorum değil, METADATA.
   * `p0_provisional` = P0 güvenlik turunda seçilmiş **geçici güvenli baseline**;
   * saha doğrulaması tamamlanınca (kütük) yeniden değerlendirilir.
   * `validated` = ölçülmüş/doğrulanmış kalıcı politika.
   */
  readonly policySource: 'p0_provisional' | 'validated';
  /**
   * `motionPolicy` seçiminin gerekçe KODU (metadata). `motionPolicy:'any'`
   * bilinçli bırakıldıysa burada NEDEN'i taşınır — böylece "unutulmuş 'any'" ile
   * "bilerek 'any'" ayırt edilebilir.
   */
  readonly motionRationale:
    | 'unlock_requires_stopped'      // hareket hâlinde kapı açmak TEHLİKELİ
    | 'legitimate_while_moving'      // sürüşte meşru kullanımı var (korna/far/kilit)
    | 'field_validation_pending';    // daraltma adayı — saha kanıtı bekliyor
}

/**
 * ARAÇ ETKİLİ EYLEM DEFTERİ. Buraya girmeyen intent araç etkili değildir.
 *
 * ── P0 GEÇİCİ GÜVENLİ BASELINE (2026-07-28) ─────────────────────────────────
 * Önceki politika altı donanım eylemini de **onaysız** çalıştırıyordu; gerekçe
 * "hareket kanıtı yeterli" idi. Denetim bunun iki ayakta da zayıf olduğunu
 * ölçtü: (a) hareket kapısı `motionState` yokken FAIL-OPEN'dı (aşağıya bkz.),
 * (b) tek bir yanlış tanınan sözcük onaysız korna/kilit üretebiliyordu.
 * Bu yüzden altı donanım eylemi de **açık onay** ister. Karar `policySource:
 * 'p0_provisional'` ile İŞARETLİDİR — saha doğrulamasından sonra gevşetilmesi
 * ayrıca değerlendirilecektir (metadata, yorum değil).
 */
export const VEHICLE_ACTIONS: Readonly<Partial<Record<IntentType, VehicleActionDef>>> = Object.freeze({
  HARDWARE_LOCK: {
    actionId: 'vehicle.doors.lock', risk: 'medium', requiresConfirmation: true,
    capability: 'hwLockDoors', motionPolicy: 'any', title: 'Kapıları kilitle',
    policySource: 'p0_provisional', motionRationale: 'legitimate_while_moving',
  },
  HARDWARE_UNLOCK: {
    actionId: 'vehicle.doors.unlock', risk: 'high', requiresConfirmation: true,
    capability: 'hwUnlockDoors', motionPolicy: 'requires_stopped', title: 'Kapıları aç',
    policySource: 'p0_provisional', motionRationale: 'unlock_requires_stopped',
  },
  HARDWARE_HORN: {
    actionId: 'vehicle.horn.sound', risk: 'medium', requiresConfirmation: true,
    capability: 'hwHonkHorn', motionPolicy: 'any', title: 'Korna',
    policySource: 'p0_provisional', motionRationale: 'legitimate_while_moving',
  },
  HARDWARE_FLASH: {
    actionId: 'vehicle.lights.flash', risk: 'low', requiresConfirmation: true,
    capability: 'hwFlashLights', motionPolicy: 'any', title: 'Far sinyali',
    policySource: 'p0_provisional', motionRationale: 'legitimate_while_moving',
  },
  HARDWARE_ALARM_ON: {
    actionId: 'vehicle.alarm.on', risk: 'medium', requiresConfirmation: true,
    capability: 'hwAlarmOn', motionPolicy: 'any', title: 'Alarmı aç',
    /* Daraltma adayı: hareket hâlinde alarm kurmanın meşru kullanımı ÖLÇÜLMEDİ.
       Onay kapısı bugün riski taşıyor; saha kanıtı gelince 'requires_stopped'
       değerlendirilecek. */
    policySource: 'p0_provisional', motionRationale: 'field_validation_pending',
  },
  HARDWARE_ALARM_OFF: {
    actionId: 'vehicle.alarm.off', risk: 'medium', requiresConfirmation: true,
    capability: 'hwAlarmOff', motionPolicy: 'any', title: 'Alarmı kapat',
    policySource: 'p0_provisional', motionRationale: 'field_validation_pending',
  },
  /* Native karşılığı OLMAYAN üçlü — port ASLA sağlanmaz → daima `unsupported`.
   * Defterde bulunmaları "sessiz no-op" yerine DÜRÜST cevap üretmek içindir. */
  HARDWARE_REAR_CAMERA: {
    actionId: 'vehicle.camera.rear', risk: 'low', requiresConfirmation: false,
    capability: 'hwRearCamera', motionPolicy: 'any', title: 'Arka kamera',
    /* Port ASLA sağlanmaz → daima `unsupported`; onay sormanın anlamı yok. */
    policySource: 'validated', motionRationale: 'legitimate_while_moving',
  },
  HARDWARE_LIGHTS_OFF: {
    actionId: 'vehicle.lights.off', risk: 'medium', requiresConfirmation: false,
    capability: 'hwLightsOff', motionPolicy: 'any', title: 'Işıkları kapat',
    policySource: 'validated', motionRationale: 'legitimate_while_moving',
  },
  HARDWARE_SCREEN_OFF: {
    actionId: 'vehicle.screen.off', risk: 'low', requiresConfirmation: false,
    capability: 'hwScreenOff', motionPolicy: 'any', title: 'Ekranı kapat',
    policySource: 'validated', motionRationale: 'legitimate_while_moving',
  },
  /* ECU YAZMA sınıfı — açık onay + WriteGate (fiziksel önkoşullar) ZORUNLU. */
  CLEAR_DTC_CODES: {
    actionId: 'vehicle.dtc.clear', risk: 'high', requiresConfirmation: true,
    capability: null, vehicleScope: 'clear_dtc', motionPolicy: 'any',
    title: 'Arıza kayıtlarını sil',
    /* Hareket kapısı WriteGate'tedir (hız + telemetri tazeliği) — çift kapı. */
    policySource: 'validated', motionRationale: 'field_validation_pending',
  },
  /* SALT-OKUMA araç eylemleri. */
  CHECK_VEHICLE_HEALTH: {
    actionId: 'vehicle.health.read', risk: 'low', requiresConfirmation: false,
    capability: null, vehicleScope: 'read', motionPolicy: 'any', title: 'Araç sağlığı oku',
    policySource: 'validated', motionRationale: 'legitimate_while_moving',
  },
  QUERY_SENSOR: {
    actionId: 'vehicle.sensor.read', risk: 'low', requiresConfirmation: false,
    capability: null, vehicleScope: 'read', motionPolicy: 'any', title: 'Sensör oku',
    policySource: 'validated', motionRationale: 'legitimate_while_moving',
  },
  /* Araç dışı, geri alınamaz dış etki — ama ONAY İSTENMEZ.
   *
   * ── NEDEN KALDIRILDI (saha 2026-07-31) ────────────────────────────────
   * "Annemi ara" komutunun KENDİSİ zaten açık ve tek anlamlı bir talimattır;
   * üstüne "onaylıyor musun?" sormak kullanıcıyı ikinci kez aynı şeyi
   * söylemeye zorluyordu. Onay kapısı, kullanıcının AÇIKÇA istemediği bir
   * eylemi modelin ÇIKARIM YOLUYLA başlatmasına karşı tasarlanmıştı; burada
   * öyle bir çıkarım yok — kişi adı kullanıcının ağzından çıkıyor.
   *
   * Koruma KALDIRILMADI, DOĞRU YERE taşındı: kişi/numara çözülemezse arama
   * BAŞLAMAZ (`contact_not_found`) ve `bridge.callNumber` yalnız gerçek bir
   * numarayla çağrılır. `risk:'high'` bilinçli olarak KORUNDU — eylem
   * defterinde ve telemetride yüksek riskli görünmeye devam eder. */
  OPEN_PHONE: {
    actionId: 'phone.call.start', risk: 'high', requiresConfirmation: false,
    capability: null, motionPolicy: 'any', title: 'Telefon araması başlat',
    policySource: 'validated', motionRationale: 'legitimate_while_moving',
  },
});

/** Bu intent araç etkili mi (deftere kayıtlı mı)? */
export function isVehicleEffectiveIntent(type: IntentType): boolean {
  return Object.prototype.hasOwnProperty.call(VEHICLE_ACTIONS, type);
}

export function getVehicleActionDef(type: IntentType): VehicleActionDef | undefined {
  return VEHICLE_ACTIONS[type];
}

/* ── AiSafetyGate + MaviActionRegistry örnekleri (modül-içi, tekil) ───────── */

/**
 * Bu otoritenin kapsam izni: `read` (telemetri) + `clear_dtc` (KULLANICI onaylı,
 * WriteGate'li DTC silme). `ecu_write` · `coding` · `adaptation` · `actuator`
 * ANAYASAL olarak yasaktır ve bu yapılandırmayla dahi AÇILAMAZ (savunma derinliği).
 * AI AJANLARININ kendi kapısı ayrıdır ve salt-okunur kalır (aiCore varsayılanı).
 */
const _gate = createAiSafetyGate({ allowedScopes: ['read', 'clear_dtc'] });

const _registry = createActionRegistry();
for (const def of Object.values(VEHICLE_ACTIONS)) {
  _registry.register({
    id: def.actionId,
    title: def.title,
    risk: def.risk,
    reversible: false,
    // Yürütme zaman aşımı gerçek yürütücünün (bridge L2 ACK / WriteGate / OBD)
    // kendi bütçesindedir; defter yalnız KARAR verir. Bu alan sözleşme gereği
    // doldurulur ve bu otoritede yürütme zamanlayıcısı OLARAK KULLANILMAZ.
    timeoutMs: 12_000,
    resultContract: 'ack',
    ...(def.vehicleScope ? { vehicleScope: def.vehicleScope } : {}),
    validate: () => ({ ok: true, errors: [], value: {} }),
  });
}

/** @internal — tanı/guard testleri. */
export function getActionAuthorityRegistryIds(): readonly string[] {
  return _registry.ids();
}

/* ══════════════════════════════════════════════════════════════════════════
 * MAVI-M4-LAB · BOUNDED GÖZLEM (salt-okunur — karar ÜRETMEZ)
 * ════════════════════════════════════════════════════════════════════════
 * "Gözlemlenemeyen özellik tamamlanmış değildir" (CLAUDE.md). Kapı kararları
 * burada bounded bir halkaya ve saturating sayaçlara yazılır.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────
 *  · Kayıt KARARI ETKİLEMEZ: `_record` sonucu değiştirmez, throw etmez
 *    (fail-soft) ve kapı akışına hiçbir dal eklemez.
 *  · **PII TAŞIMAZ:** yalnız `IntentType` (enum), `actionId` (sabit kimlik),
 *    `status`/`reason` (makine-okur kodlar) ve zaman damgası. Ham kullanıcı
 *    komutu · kişi adı · telefon numarası · sağlayıcı cevabı · konum · VIN
 *    bu halkaya YAPISAL OLARAK giremez (tipte böyle bir alan YOK).
 *  · Halka SABİT boyutludur (dairesel tampon) ve sayaçlar DOYAR — uzun
 *    oturumda bellek büyümez (log seli/taşma yok).
 *  · Yeni global store KURULMAZ; bu modülün kendi modül-içi durumudur. */

/** Halka kapasitesi — Mali-400 render bütçesi + sabit bellek. */
export const MAX_ACTION_DECISIONS = 40;
/** Sayaç tavanı (doyan) — taşma yok. */
const MAX_ACTION_COUNTER = 1_000_000;

/** Tek kapı kararının PII'siz kaydı. */
export interface ActionDecisionRecord {
  readonly intent: IntentType;
  readonly actionId: string;
  /** `allowed` = kapı geçildi (yürütücü çağrılabilir); diğerleri M3 statüsüdür. */
  readonly status: 'allowed' | IntentExecutionResult['status'];
  readonly reason: string;
  readonly atMs: number;
}

export interface ActionAuthorityCounters {
  readonly evaluated: number;
  readonly allowed: number;
  readonly denied: number;
  readonly confirmationRequired: number;
  readonly unsupported: number;
  readonly failed: number;
}

/* MAVI-M4-LAB-2: kapı kararları ARTIK AYRI bir halkada tutulmaz — zincirin
 * diğer aşamalarıyla (M3 sonucu · M6 konuşma) AYNI bounded halkaya yazılır
 * (`action/maviActionTrace`). Böylece tek komutun hikâyesi tek yerde birleşir
 * ve ikinci bir olay deposu doğmaz. Aşağıdaki sayaçlar M4-LAB ekranının
 * sözleşmesidir ve DEĞİŞMEDEN korunur. */
let _cEvaluated = 0, _cAllowed = 0, _cDenied = 0;
let _cConfirmation = 0, _cUnsupported = 0, _cFailed = 0;

function _sat(v: number): number {
  return v >= MAX_ACTION_COUNTER ? MAX_ACTION_COUNTER : v + 1;
}

/** Kapı kararını ORTAK halkaya yazar. ASLA throw etmez, kararı DEĞİŞTİRMEZ. */
function _record(intent: IntentType, actionId: string, status: ActionDecisionRecord['status'], reason: string): void {
  try {
    recordMaviActionStage({ stage: 'gate', intent, actionId, status, reason });
    _cEvaluated = _sat(_cEvaluated);
    if (status === 'allowed')                 _cAllowed = _sat(_cAllowed);
    else if (status === 'denied')             _cDenied = _sat(_cDenied);
    else if (status === 'needs_confirmation') _cConfirmation = _sat(_cConfirmation);
    else if (status === 'unsupported')        _cUnsupported = _sat(_cUnsupported);
    else if (status === 'failed')             _cFailed = _sat(_cFailed);
  } catch { /* gözlem ASLA kararı bozmaz */ }
}

/**
 * CAROS LAB gözlem yüzeyi — SALT OKUNUR, bounded, PII YOK.
 * Kararlar **EN YENİDEN ESKİYE** sıralı döner (repo LAB deseni).
 *
 * Ortak halkadan YALNIZ `gate` aşamaları süzülür → M4-LAB ekranının sözleşmesi
 * (yalnız kapı kararları) birebir korunur.
 */
export function getActionAuthorityDiagnostics(): {
  readonly counters: ActionAuthorityCounters;
  readonly decisions: readonly ActionDecisionRecord[];
  readonly capacity: number;
  readonly countersSaturated: boolean;
} {
  const out: ActionDecisionRecord[] = [];
  try {
    for (const rec of getMaviActionTrace()) {
      if (rec.stage !== 'gate') continue;
      if (out.length >= MAX_ACTION_DECISIONS) break;
      out.push(Object.freeze({
        intent:   (rec.intent ?? '') as IntentType,
        actionId: rec.actionId ?? '',
        status:   rec.status as ActionDecisionRecord['status'],
        reason:   rec.reason,
        atMs:     rec.atMs,
      }));
    }
  } catch { /* fail-soft: sayaçlar yine döner */ }

  return Object.freeze({
    counters: Object.freeze({
      evaluated: _cEvaluated, denied: _cDenied, allowed: _cAllowed,
      confirmationRequired: _cConfirmation, unsupported: _cUnsupported, failed: _cFailed,
    }),
    decisions: Object.freeze(out),
    capacity: MAX_ACTION_DECISIONS,
    countersSaturated: _cEvaluated >= MAX_ACTION_COUNTER,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetActionAuthorityDiagnosticsForTest(): void {
  _resetMaviActionTraceForTest();
  _cEvaluated = 0; _cAllowed = 0; _cDenied = 0;
  _cConfirmation = 0; _cUnsupported = 0; _cFailed = 0;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kapı değerlendirmesi
 * ════════════════════════════════════════════════════════════════════════ */

export interface ActionGateInput {
  readonly intent: IntentType;
  readonly vehicleCtx: VehicleContext;
  /** Yürütücünün elindeki portlar — capability kontrolü için. */
  readonly ports: Readonly<Partial<Record<VehicleActionCapability, unknown>>>;
  /** Kullanıcı bu eylemi AÇIKÇA onayladı mı (bekleyen onay çözümünden gelir). */
  readonly confirmed?: boolean;
  /**
   * Onay gereksinimini bu çağrı için geçersiz kılar (ör. `OPEN_PHONE` kişi adı
   * olmadan yalnız telefon UYGULAMASINI açar → arama başlatmaz → onay gerekmez).
   */
  readonly confirmationExempt?: boolean;
}

/** Kapı sonucu: `allow` ise yürütücü çağrılabilir; aksi halde M3 sonucu döner. */
export type ActionGateOutcome =
  | { readonly allow: true; readonly def: VehicleActionDef }
  | { readonly allow: false; readonly result: IntentExecutionResult };

/**
 * ARAÇ ETKİLİ eylem kapısı. **Port/native/OBD çağrısından ÖNCE** çalışır ve
 * ASLA yan etki üretmez. Defterde olmayan intent için `allow:false` +
 * `not_handled` döner (bu katmanın işi değil → çağıran normal akışına devam eder).
 */
export function evaluateVehicleAction(input: ActionGateInput): ActionGateOutcome {
  const def = VEHICLE_ACTIONS[input.intent];
  if (!def) {
    /* Defter dışı intent araç etkili DEĞİLDİR → bu otoritenin işi değil.
     * Sayaçları kirletmemek için KAYDEDİLMEZ (aksi halde her müzik/tema
     * komutu "evaluated" sayılır ve gözlem yanıltıcı olurdu). */
    return { allow: false, result: intentResult(input.intent, 'not_handled', 'not_vehicle_effective') };
  }

  /** Kararı halkaya yazıp AYNEN geri verir (akışa dal eklemez). */
  const deny = (result: IntentExecutionResult): ActionGateOutcome => {
    _record(input.intent, def.actionId, result.status, result.reason ?? '');
    return { allow: false, result };
  };

  /* 1 — HAREKET POLİTİKASI · FAIL-CLOSED.
   *
   * ⚠️ ESKİ DAVRANIŞ FAIL-OPEN'DI: `motionState` TAŞIMAYAN çağıranlar için kural
   * `isDriving === true` idi; yani telemetri hiç yokken (`motionState`
   * undefined + `isDriving` undefined/false) araç "duruyor" SAYILIYOR ve
   * hareket hâlinde kapı açma kapısı sessizce AÇILIYORDU. Artık YALNIZ AÇIKÇA
   * doğrulanmış `stopped` geçer: `unknown` · `undefined` · çelişkili telemetri
   * hepsi REDDEDİLİR ("bilinmiyorsa duruyor varsayma"). */
  if (def.motionPolicy === 'requires_stopped') {
    const vctx  = input.vehicleCtx;
    const motion = vctx?.motionState;
    const speed  = typeof vctx?.speedKmh === 'number' && Number.isFinite(vctx.speedKmh)
      ? vctx.speedKmh : null;
    /* Hareket KANITI: üç bağımsız kaynaktan biri bile hareket diyorsa hareket sayılır. */
    const movingProof = motion === 'moving'
      || vctx?.isDriving === true
      || (speed !== null && speed > MOTION_STOPPED_MAX_KMH);
    /* Çelişki de kanıttır: "stopped" denip hız yüksekse telemetriye GÜVENİLMEZ. */
    const verifiedStopped = motion === 'stopped' && !movingProof;
    if (!verifiedStopped) {
      return deny(intentResult(
        input.intent, 'denied',
        movingProof ? 'vehicle_moving' : 'motion_unverified',
      ));
    }
  }

  // 2 — AiSafetyGate (kapsam kararı). `confirmed:true` geçilir çünkü ONAY kararı
  //     bu katmanın KENDİ politikasıdır (3. adım); gate yalnız KAPSAMA bakmalıdır.
  const safety = evaluateActionIdSafety(_registry, _gate, def.actionId, { confirmed: true, agentId: 'mavi.command' });
  if (safety.outcome === 'deny') {
    return deny(intentResult(input.intent, 'denied', safety.gateReason ?? safety.reason));
  }

  // 3 — AÇIK KULLANICI ONAYI (port/native çağrısından ÖNCE).
  if (def.requiresConfirmation && input.confirmationExempt !== true && input.confirmed !== true) {
    return deny(intentResult(input.intent, 'needs_confirmation', 'explicit_consent_required'));
  }

  // 4 — CAPABILITY (port) — yoksa DÜRÜST `unsupported` ("yapıldı" DENMEZ).
  if (def.capability && typeof input.ports[def.capability] !== 'function') {
    return deny(intentResult(input.intent, 'unsupported', 'no_port'));
  }

  _record(input.intent, def.actionId, 'allowed', 'gate_passed');
  return { allow: true, def };
}
