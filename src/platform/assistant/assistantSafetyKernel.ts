/**
 * assistantSafetyKernel — Companion Safety Kernel & Response Verifier (PR-A).
 *
 * AMAÇ: Asistanın online AI modellerinden BAĞIMSIZ, tamamen YEREL ve DETERMİNİSTİK
 * güvenlik katmanı. Kritik araç durumlarında online çağrıyı engeller (PRE-GATE) ve
 * dönen online cevabı doğrular (POST-GATE / Response Verifier). Vizyon "8 Kapı":
 * gate 1 (doğru mu → confidence yerine güvenli-varsayım), gate 3 (kullanıcı bilmeli
 * mi → yalnız doğrulanmış güvenlik şablonu), gate 8 (en doğru aksiyon → online değil
 * yerel şablon).
 *
 * TASARIM (diagnosticTriage deseni — decoupled + saf + fail-soft):
 *   • `evaluatePreGate(ctx)` / `verifyResponse(text, ctx, opts)` = SAF fonksiyonlar
 *     (enjekte edilen `SafetyContext` üstünde çalışır; canlı servis okumaz → tam
 *     test edilebilir; asla throw etmez).
 *   • `buildSafetyContext()` = canlı kaynakları OKUYAN tek adaptör (fail-soft; her
 *     kaynak ayrı try/catch → bir kaynağın hatası diğerlerini/akışı etkilemez).
 *
 * KESİN SINIRLAR (CLAUDE.md · PR-A kapsamı):
 *  - severity / driveSafe / diagnostic safety kararlarını DEĞİŞTİRMEZ — yalnız OKUR.
 *  - Online model bu kararları YÜKSELTEMEZ; kernel yalnız reddeder/kısaltır/yerel
 *    şablonla değiştirir (asla "daha az kritik" yapamaz).
 *  - Yeni sağlayıcı / router sırası / offline sohbet / Deep Scan YOK.
 *  - Serbest metin üretme motoru YOK — sabit, doğrulanmış şablon metinleri + mevcut
 *    ses klipleri (public/voice/safety-*.wav) kullanılır.
 *  - Eşikler SAFETY_ASSISTANT_STANDARD.md + SafetyRuleEngine ile HİZALI (aşağıda).
 *
 * FAIL-CLOSED tercihi (spec + risk): yanlış-pozitif (online geçici engellenir)
 * KABUL; yanlış-negatif (kritik durumda online "önemli değil" der) KABUL EDİLMEZ.
 * Bu yüzden kernel emin değilse KISITLAR; çağıran, kernel throw ederse online'ı
 * AÇMAZ (offline'a düşer).
 */

import { MODE_RANK, useCognitiveStore } from '../../store/useCognitiveStore';
import { useSystemStore } from '../../store/useSystemStore';
import { onOBDData } from '../obdService';
import { onDTCState } from '../dtcService';
import { diagnoseDtc } from '../diagnosticKnowledgeEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Güvenlik şablonları (additive · doğrulanmış · SAFETY_ASSISTANT_STANDARD hizalı)
 * ════════════════════════════════════════════════════════════════════════ */

export type SafetyTemplateId =
  | 'engine_overheat'
  | 'oil_pressure_critical'
  | 'brake_system_critical'
  | 'transmission_overheat'
  | 'charging_system_critical'
  | 'drowsiness_critical'
  | 'reverse_attention'
  | 'stop_vehicle_safely'
  | 'service_required';

export interface SafetyTemplate {
  id: SafetyTemplateId;
  /** Kısa · sürücü dostu · eylem odaklı · panik yok · belirsiz "devam edebilirsiniz" YOK. */
  text: string;
  /** Varsa mevcut doğrulanmış ses klibi (public/voice/*.wav, uzantısız). Yoksa TTS metni okur. */
  clipId?: string;
}

/**
 * Metinler SAFETY_ASSISTANT_STANDARD.md §1 ifadeleriyle hizalı (kaput/motor/akü
 * satırları). Klip adları public/voice/ envanterinden — olmayan kategori clipId'siz
 * (TTS metni okur; sahte klip referansı YOK).
 */
export const SAFETY_TEMPLATES: Readonly<Record<SafetyTemplateId, SafetyTemplate>> = {
  engine_overheat: {
    id: 'engine_overheat',
    text: 'Motor sıcaklığı yüksek. Lütfen güvenli bir yerde durup motoru dinlendir.',
    clipId: 'safety-overheat',
  },
  oil_pressure_critical: {
    id: 'oil_pressure_critical',
    text: 'Yağ basıncı düşük görünüyor. Lütfen hemen güvenli bir yerde dur, motoru zorlama.',
    clipId: 'safety-battery-oil',
  },
  brake_system_critical: {
    id: 'brake_system_critical',
    text: 'Fren sisteminde bir uyarı var. Lütfen hızını düşürüp güvenli bir yerde dur.',
  },
  transmission_overheat: {
    id: 'transmission_overheat',
    text: 'Şanzıman sıcaklığı yüksek. Lütfen durup aracı bir süre dinlendir.',
  },
  charging_system_critical: {
    id: 'charging_system_critical',
    text: 'Şarj sisteminde bir arıza göstergesi var. En kısa sürede kontrol ettirmen gerek.',
    clipId: 'safety-battery-oil',
  },
  drowsiness_critical: {
    id: 'drowsiness_critical',
    text: 'Yorgun görünüyorsun. Lütfen güvenli bir yerde durup biraz mola ver.',
  },
  reverse_attention: {
    id: 'reverse_attention',
    text: 'Geri manevradasın, sana sonra döneyim.',
  },
  stop_vehicle_safely: {
    id: 'stop_vehicle_safely',
    text: 'Lütfen güvenli bir yerde dur.',
  },
  service_required: {
    id: 'service_required',
    text: 'Bu belirti önemli olabilir; en kısa sürede servise kontrol ettir.',
  },
};

/* ══════════════════════════════════════════════════════════════════════════
 * Güvenlik bağlamı (enjekte edilebilir — SAF fonksiyonların girdisi)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Karar için gereken YORUMLANMIŞ güvenlik durumu. Tüm alanlar OPSİYONEL: boş bağlam
 * = güvenli varsayım (online AÇIK). Ham hot-path verisi TAŞIMAZ — yalnız kararlar.
 * Bugün canlı beslenmeyen alanlar (oil/brake/transmission/drowsiness) kernel'ce
 * DESTEKLENİR ama `buildSafetyContext` yalnız gerçek sinyali olanları doldurur
 * (var olmayan sinyal UYDURULMAZ — CLAUDE.md/GEMINI.md).
 */
export interface SafetyContext {
  /** useCognitiveStore MODE_RANK (>= PROTECTION → online kapatılır). */
  cognitiveModeRank?: number;
  reverseActive?: boolean;
  engineOverheat?: boolean;
  oilPressureCritical?: boolean;
  brakeSystemCritical?: boolean;
  transmissionOverheat?: boolean;
  /** Düşük voltaj / şarj sistemi kritik. */
  chargingSystemCritical?: boolean;
  drowsinessCritical?: boolean;
  /** Aktif tanı motoru kararı — en kötü DTC driveSafe=false ise burada false. */
  diagnosticDriveSafe?: boolean;
  /** Aktif tanı motoru — en kötü DTC severity=critical ise true. */
  diagnosticSeverityCritical?: boolean;
}

export type SafetySeverity = 'critical' | 'none';

export interface PreGateResult {
  /** false → online AI çağrısı YAPILMAMALI. */
  allowOnline: boolean;
  reason: string | null;
  /** Varsa: kullanıcıya doğrudan verilecek yerel güvenlik metni (aktif durum). */
  deterministicResponse: string | null;
  safetyTemplateId: SafetyTemplateId | null;
  severity: SafetySeverity;
  driveSafe: boolean;
}

export type PostGateAction = 'passed' | 'replaced' | 'truncated';

export interface PostGateResult {
  /** Kullanıcıya dönecek metin (belki değiştirilmiş/kısaltılmış — GİRDİ MUTATE EDİLMEZ). */
  response: string;
  action: PostGateAction;
  reason: string | null;
}

/* ── Eşikler (SAFETY_ASSISTANT_STANDARD.md §1 + SafetyRuleEngine ile HİZALI) ── */

/** Motor aşırı ısınma eşiği °C — SafetyRuleEngine.COOLANT_OVERHEAT ile aynı. */
const OVERHEAT_C = 118;
/** Geçerli soğutucu aralığı (yanlış-pozitif önleme, standart rule 7). */
const COOLANT_VALID_MIN = 40;
const COOLANT_VALID_MAX = 130;
/** 12V düşük voltaj eşiği (standart rule 8: batteryVolt < 11.8 V). */
const LOW_VOLTAGE_V = 11.8;
/** Bağlam üretiminde değerlendirilecek maksimum aktif DTC (bounded). */
const MAX_DTC_EVAL = 12;

/** Cevap uzunluk tavanı — sürüşte kısa (ISO 15008 dikkat), park halinde daha uzun. */
const DRIVING_MAX_CHARS = 200;
const PARK_MAX_CHARS = 400;

/* ══════════════════════════════════════════════════════════════════════════
 * PRE-GATE — online çağrıdan ÖNCE (SAF · asla throw etmez)
 * ════════════════════════════════════════════════════════════════════════ */

function block(
  templateId: SafetyTemplateId,
  reason: string,
  severity: SafetySeverity,
  driveSafe: boolean,
): PreGateResult {
  return {
    allowOnline: false,
    reason,
    deterministicResponse: SAFETY_TEMPLATES[templateId].text,
    safetyTemplateId: templateId,
    severity,
    driveSafe,
  };
}

const ALLOW: PreGateResult = {
  allowOnline: true, reason: null, deterministicResponse: null,
  safetyTemplateId: null, severity: 'none', driveSafe: true,
};

/**
 * Kritik araç durumunda online AI çağrısını engeller. Öncelik: motor/mekanik
 * arızalar → tanı kararı → uykululuk → reverse → bilişsel koruma. İlk eşleşen
 * kazanır (deterministik). Boş/güvenli bağlam → online açık. SAF · throw ETMEZ.
 */
export function evaluatePreGate(ctx: SafetyContext | null | undefined): PreGateResult {
  const c = ctx ?? {};

  if (c.engineOverheat === true)         return block('engine_overheat', 'engine_overheat', 'critical', false);
  if (c.oilPressureCritical === true)    return block('oil_pressure_critical', 'oil_pressure_critical', 'critical', false);
  if (c.brakeSystemCritical === true)    return block('brake_system_critical', 'brake_system_critical', 'critical', false);
  if (c.transmissionOverheat === true)   return block('transmission_overheat', 'transmission_overheat', 'critical', false);
  if (c.chargingSystemCritical === true) return block('charging_system_critical', 'charging_system_critical', 'critical', false);

  // Aktif tanı motoru kararı: driveSafe=false VEYA severity=critical → servise yönlendir.
  if (c.diagnosticSeverityCritical === true || c.diagnosticDriveSafe === false) {
    return block('service_required', 'diagnostic_unsafe', 'critical', false);
  }

  if (c.drowsinessCritical === true)     return block('drowsiness_critical', 'drowsiness_critical', 'critical', false);

  // Reverse: aktif manevra — online sohbet başlatma (kısa erteleme). Arıza değil.
  if (c.reverseActive === true)          return block('reverse_attention', 'reverse_active', 'none', true);

  // Bilişsel koruma (>= PROTECTION): online kapat AMA yerel güvenlik metni ÜRETME
  // (fiziksel arıza yok) → çağıran offline'a düşer.
  if (typeof c.cognitiveModeRank === 'number' && c.cognitiveModeRank >= MODE_RANK.PROTECTION) {
    return { allowOnline: false, reason: 'cognitive_protection', deterministicResponse: null,
             safetyTemplateId: null, severity: 'none', driveSafe: true };
  }

  return ALLOW;
}

/** Bağlamda "kritik" (severity=critical ile bloklanan) bir durum var mı. */
function isCriticalContext(ctx: SafetyContext | null | undefined): boolean {
  return evaluatePreGate(ctx).severity === 'critical';
}

/* ══════════════════════════════════════════════════════════════════════════
 * POST-GATE / Response Verifier — kullanıcıya dönmeden ÖNCE (SAF · throw ETMEZ)
 * ════════════════════════════════════════════════════════════════════════ */

/** Yanlış rahatlatma kalıpları — kritik/driveSafe=false durumda kabul edilemez. */
const REASSURANCE_RE =
  /(güvenle|güvenli(?:ce)?\s+devam|sorun\s+yok|problem\s+yok|önemli\s+değil|endişelenme|merak\s+etme|devam\s+edebilir|gidebilirsin|yola\s+devam)/i;

/** Telemetriyle çelişki: kritik ısı varken "motor iyi/normal/serin" demek. */
const TEMP_CONTRADICTION_RE = /(motor|sıcaklık|hararet).{0,20}(iyi|normal|serin|sorunsuz|düşük)/i;

/** Ham/gizli sızıntı kalıpları — VIN(17), koordinat çifti, JSON/markdown bloğu. */
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/;
const COORD_RE = /-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/;
const CODE_FENCE_RE = /```|\{"[a-zA-Z_]+"\s*:/;

const LEAK_SAFE_REPLY = 'Bunu şu an net söyleyemeyeceğim; güvenli olduğunda tekrar bakalım.';

/** Metni cümle sınırında kırpar (yarım cümle robotik algı yaratmasın). */
function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars - 3);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  return end > Math.floor(maxChars * 0.5) ? head.slice(0, end + 1) : `${head}...`;
}

/**
 * Online AI cevabını güvenlik açısından doğrular. GİRDİYİ MUTATE ETMEZ (yeni string
 * döner). SAF · throw ETMEZ. Kurallar:
 *  1. Kritik bağlam (ctx severity=critical) → online cevap TAMAMEN atılır, yerel
 *     deterministic şablonla değiştirilir (online karar YÜKSELTEMEZ).
 *  2. driveSafe=false iken yanlış rahatlatma / telemetri çelişkisi → değiştirilir.
 *  3. Ham/gizli bağlam sızıntısı → güvenli genel yanıtla değiştirilir.
 *  4. Uzun cevap → sürüşte/parkta tavanına cümle sınırında kısaltılır.
 */
export function verifyResponse(
  onlineText: string,
  ctx: SafetyContext | null | undefined,
  opts: { isDriving?: boolean } = {},
): PostGateResult {
  const text = typeof onlineText === 'string' ? onlineText : '';
  const isDriving = opts.isDriving === true;

  // 1. Kritik durumda online cevap kabul edilmez → deterministic override.
  if (isCriticalContext(ctx)) {
    const pre = evaluatePreGate(ctx);
    return {
      response: pre.deterministicResponse ?? SAFETY_TEMPLATES.stop_vehicle_safely.text,
      action: 'replaced',
      reason: 'critical_state_override',
    };
  }

  // 2. driveSafe=false (kritik-severity olmayan) iken yanlış rahatlatma/çelişki.
  const driveUnsafe = (ctx?.diagnosticDriveSafe === false);
  if (driveUnsafe && (REASSURANCE_RE.test(text) || TEMP_CONTRADICTION_RE.test(text))) {
    return { response: SAFETY_TEMPLATES.service_required.text, action: 'replaced', reason: 'false_reassurance' };
  }

  // 3. Ham/gizli sızıntı.
  if (VIN_RE.test(text) || COORD_RE.test(text) || CODE_FENCE_RE.test(text)) {
    return { response: LEAK_SAFE_REPLY, action: 'replaced', reason: 'context_leak' };
  }

  // 4. Uzunluk tavanı (sürüşte kısa).
  const maxChars = isDriving ? DRIVING_MAX_CHARS : PARK_MAX_CHARS;
  if (text.length > maxChars) {
    return { response: truncateAtSentence(text, maxChars), action: 'truncated', reason: 'too_long' };
  }

  return { response: text, action: 'passed', reason: null };
}

/* ══════════════════════════════════════════════════════════════════════════
 * buildSafetyContext — canlı kaynak adaptörü (FAIL-SOFT · her kaynak izole)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Canlı (throttle'lı yorumlanmış) kaynaklardan güvenlik bağlamını üretir. Her
 * kaynak ayrı try/catch: birinin hatası diğerlerini/asistan akışını ETKİLEMEZ
 * (fail-soft). Bugün gerçek sinyali olmayan alanlar (oil/brake/transmission/
 * drowsiness) DOLDURULMAZ — var olmayan sinyal uydurulmaz. Ham hot-path verisi
 * bağlama girmez; yalnız yorumlanmış kararlar.
 */
export function buildSafetyContext(): SafetyContext {
  const ctx: SafetyContext = {};

  // Bilişsel mod (koruma seviyesi).
  try { ctx.cognitiveModeRank = MODE_RANK[useCognitiveStore.getState().currentMode]; }
  catch { /* store yok → mod bilinmiyor (güvenli varsayım) */ }

  // Reverse (geri manevra).
  try { ctx.reverseActive = useSystemStore.getState().isReverseActive === true; }
  catch { /* store yok */ }

  // OBD tek-atım son-değer: motor sıcaklığı + 12V voltaj (yorumlanmış eşiklerle).
  try {
    let temp: number | undefined;
    let volt: number | undefined;
    const unsub = onOBDData((d) => { temp = d.engineTemp; volt = d.batteryVoltage; });
    unsub();
    if (typeof temp === 'number' && temp >= OVERHEAT_C && temp >= COOLANT_VALID_MIN && temp <= COOLANT_VALID_MAX) {
      ctx.engineOverheat = true;
    }
    if (typeof volt === 'number' && volt >= 0 && volt < LOW_VOLTAGE_V) {
      ctx.chargingSystemCritical = true;
    }
  } catch { /* OBD bağlı değil → sinyal yok */ }

  // Aktif tanı motoru kararı (en kötü DTC driveSafe/severity). Bounded + fail-soft.
  try {
    let codes: string[] = [];
    const unsub = onDTCState((s) => {
      codes = (s.codes ?? []).map((x) => x?.code).filter((x): x is string => typeof x === 'string' && x.length > 0);
    });
    unsub();
    if (codes.length > 0) {
      let driveUnsafe = false;
      let critical = false;
      for (const code of codes.slice(0, MAX_DTC_EVAL)) {
        const insight = diagnoseDtc(code);
        if (insight.driveSafe === false) driveUnsafe = true;
        if (insight.severity === 'critical') critical = true;
        if (driveUnsafe && critical) break;
      }
      if (driveUnsafe) ctx.diagnosticDriveSafe = false;
      if (critical) ctx.diagnosticSeverityCritical = true;
    }
  } catch { /* DTC servisi/tanı motoru yok → kararsız (güvenli varsayım) */ }

  return ctx;
}
