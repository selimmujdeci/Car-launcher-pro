/**
 * RoadHazardRule — altıncı Guardian analiz kuralı — GUARDIAN-AI-G7.
 *
 * `weatherRiskRule.ts` desenini izler: SAF, deterministik, fail-closed,
 * severity TAMAMEN KATEGORİK (DI ile gelen `policy.severityByHazard`
 * haritasından). `guardian/models.ts`teki `GuardianRuleResult` sözleşmesine
 * uyar (`ruleId:'road-hazard'`) — `guardianEngine.ts`e OTOMATİK bağlanmaz
 * (DI ile gelecek). GPS/harita API/internet/topluluk-servisi/OBD/Mavi/UI/store
 * YOK; yalnız `../models` (guardian tipleri) içe aktarılır. Diğer kurallardan
 * HİÇBİR ŞEY import edilmez — her kural bağımsız.
 *
 * ÖNEMLİ FARK (weather'a göre): weather ANLIK ortam koşuluydu (`distanceMeters=0`).
 * Yol tehlikesi ise İLERİDE bir noktadadır — bu yüzden event, DI ile verilen
 * GERÇEK `hazard.distanceMeters` değerini TAŞIR. Bu mesafe kuralın İÇİNDE
 * UYDURULMAZ/TÜRETİLMEZ, yalnızca doğrulanıp (finite, negatif değil) aynen
 * geçirilir — curve/speed-limit kurallarındaki "mesafe DI'dan gelir" ilkesiyle
 * tutarlı. Bu kuralın girdisinde araç hızı / uyarı-penceresi (lead-time) YOKTUR;
 * bu yüzden ETA-tabanlı bir pencere KAPISI (curve/speed'deki gibi) uygulanMAZ —
 * hız/lead-time DI ile gelmediğinden ETA hesaplanamaz, uydurulmaz.
 *
 * ── GÜVENLİK ANAYASASI (mutlak — diğer guardian kurallarıyla AYNI) ──────────
 *   - Direksiyon/fren/gaz kontrolü YOK.
 *   - "Ani fren yap" denmez (CRITICAL'de bile).
 *   - "Kesin kaza var" / "Yol tamamen kapalı" gibi KESİN hükümler verilmez —
 *     yalnız "bildirildi" türünden ihtiyatlı gözlemler (topluluk/aftermarket
 *     verisi güvenilmezdir; panik yaratılmaz).
 *   - Tehlike TAHMİNİ/UYDURMA YOK — `hazardType` yoksa VEYA `'unknown'` ise
 *     (belirsiz/tespit edilememiş) risk ÜRETİLMEZ.
 *
 * ── FAIL-CLOSED (event-yok, throw DEĞİL) ─────────────────────────────────────
 *   - `hazard.hazardType` yok → olay YOK.
 *   - `hazard.hazardType === 'unknown'` → olay YOK (asla tehlike tahmini).
 *   - `policy.severityByHazard[hazardType] === 'NONE'` → olay YOK.
 *   - `hazard.confidence` < `MINIMUM_HAZARD_CONFIDENCE` → olay YOK.
 *
 * ── EKSİK-EŞLEME → THROW (bilinçli tasarım kararı — weather ile AYNI) ────────
 * `hazardType` BİLİNEN bir tip ise (accident/roadwork/obstacle/lane_closed/
 * animal/flood/rockfall) VE `policy.severityByHazard`de bu tip için giriş
 * YOKSA → **THROW**. Aksi halde çağıranın haritayı eksik doldurması (ör.
 * `flood` girişini UNUTMASI) SESSİZCE kritik bir uyarının hiç üretilmemesine
 * yol açardı — tam olarak bu motorun önlemek istediği türden bir güvenlik
 * açığı. `'unknown'`/`undefined` için eşleme ARANMAZ (zaten event-yok dalı).
 */
import type { GuardianRiskEvent, GuardianRuleResult, GuardianSeverity } from '../models';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

export type RoadHazardType =
  | 'accident'
  | 'roadwork'
  | 'obstacle'
  | 'lane_closed'
  | 'animal'
  | 'flood'
  | 'rockfall'
  | 'unknown';

/** `GuardianSeverity` veya `'NONE'` (risk yok anlamına gelir — event üretilmez). */
export type RoadHazardSeverityOrNone = GuardianSeverity | 'NONE';

/** İleride bildirilen tek bir yol tehlikesi. Harita/GPS/internet/topluluk
 *  PARSER'ı burada YOK — bu veri zaten normalize edilmiş halde DI ile gelir. */
export interface RoadHazardInput {
  /** Deterministik event id'sinde kullanılır — zorunlu, boş olamaz. */
  id:              string;
  hazardType?:     RoadHazardType;
  /** Sürücüye olan mesafe (metre) — DI'dan gelir, kuralda UYDURULMAZ.
   *  finite ve negatif-olmayan olmalı (0 geçerli). */
  distanceMeters:  number;
  confidence:      number;
  source?:         string;
}

/** DI ile gelen kategorik severity haritası — bu dosyada GÖMÜLÜ severity
 *  değeri YOKTUR, tamamen çağırana bağlıdır (magic map YASAK). */
export interface RoadHazardSeverityByHazard {
  accident?:     RoadHazardSeverityOrNone;
  roadwork?:     RoadHazardSeverityOrNone;
  obstacle?:     RoadHazardSeverityOrNone;
  lane_closed?:  RoadHazardSeverityOrNone;
  animal?:       RoadHazardSeverityOrNone;
  flood?:        RoadHazardSeverityOrNone;
  rockfall?:     RoadHazardSeverityOrNone;
  unknown?:      RoadHazardSeverityOrNone; // ARANMAZ (unknown zaten event-yok) — yalnız tip tamlığı
}

export interface RoadHazardRiskPolicyInput {
  severityByHazard: RoadHazardSeverityByHazard;
}

export interface RoadHazardRiskInput {
  hazard:  RoadHazardInput;
  policy:  RoadHazardRiskPolicyInput;
}

/* ── Merkezi isimli sabitler (magic number/magic map YASAK) ──────────────── */

export const ROAD_HAZARD_RULE_ID = 'road-hazard';

/** `hazard.confidence` bu eşiğin ALTINDAYSA olay üretilmez (throw DEĞİL,
 *  sessizce olay yok). Sınırda (`=== eşik`) olay ÜRETİLİR (testle kilitli).
 *  Diğer guardian kurallarındaki AYNI değer, bağımsız sabit. */
const MINIMUM_HAZARD_CONFIDENCE = 0.3;

/** `hazard.source` verilmezse kullanılan varsayılan kaynak etiketi. */
const DEFAULT_HAZARD_SOURCE = 'road-hazard-rule';

/** Sabit başlık — hazard tipinden bağımsız (kesin hüküm içermez). */
const TITLE_TEXT = 'Yol tehlikesi bildirildi';

/** Anayasaya uygun, ihtiyatlı öneri metni — "ani fren"/"kesin" YOK. */
const RECOMMENDED_ACTION_TEXT = 'Dikkatli ilerle ve yol koşullarını takip et.';

/** Tip-bazlı İHTİYATLI mesaj metinleri — severity DEĞİL, yalnız açıklama.
 *  Hepsi "bildirildi/bulunuyor" dilinde (kesin hüküm YOK). `'unknown'` burada
 *  YOK (o dal zaten event-yok — mesaj hiç kurulmaz). */
const HAZARD_MESSAGES: Readonly<Record<Exclude<RoadHazardType, 'unknown'>, string>> = {
  accident:    'İleride bir kaza bildirimi bulunuyor.',
  roadwork:    'İleride yol çalışması bildirildi.',
  obstacle:    'Yolda engel bildirildi.',
  lane_closed: 'İleride şerit kapanması bildirildi.',
  animal:      'Yolda hayvan çıkma ihtimali bildirildi.',
  flood:       'İleride su baskını bildirildi.',
  rockfall:    'İleride kaya düşmesi bildirildi.',
};

/** Geçerli severity token kümesi — `severityByHazard` değerlerini doğrulamak
 *  için (models.ts'ten runtime DEĞER import ETMEDEN — bağımsız yerel kopya,
 *  diğer guardian kurallarındaki izolasyon deseniyle tutarlı). */
const VALID_SEVERITY_TOKENS: ReadonlySet<string> = new Set([
  'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'NONE',
]);

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/** confidence savunmacı clamp — diğer guardian kurallarıyla AYNI davranış
 *  (bağımsız kopya — navigation/guardian dışına import YOK). */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function emptyResult(): GuardianRuleResult {
  return { ruleId: ROAD_HAZARD_RULE_ID, riskEvents: [] };
}

/* ── Doğrulama — SÖZLEŞME/programlama hatası → THROW ─────────────────────────
 * (gerçek-dünya eksik/belirsiz veri — undefined/'unknown'/'NONE'/düşük
 * confidence — buraya GİRMEZ; o durumlar `evaluateRoadHazardRisk` içinde
 * sessizce boş sonuçla ele alınır.) */
function validateInput(input: RoadHazardRiskInput): void {
  const hazard = input?.hazard;
  const policy = input?.policy;

  if (!hazard) {
    throw new RangeError('evaluateRoadHazardRisk: hazard zorunludur.');
  }
  if (typeof hazard.id !== 'string' || hazard.id.length === 0) {
    throw new RangeError(`evaluateRoadHazardRisk: hazard.id zorunludur (boş olamaz) — event id için gerekli.`);
  }
  if (!Number.isFinite(hazard.distanceMeters) || hazard.distanceMeters < 0) {
    throw new RangeError(`evaluateRoadHazardRisk: geçersiz hazard.distanceMeters (${hazard.distanceMeters}) — finite ve negatif-olmayan olmalı (0 geçerli).`);
  }
  if (!Number.isFinite(hazard.confidence)) {
    throw new RangeError(`evaluateRoadHazardRisk: geçersiz hazard.confidence (${hazard.confidence}) — NaN/Infinity olamaz.`);
  }

  if (!policy || !policy.severityByHazard) {
    throw new RangeError('evaluateRoadHazardRisk: policy.severityByHazard zorunludur.');
  }

  // Haritada TANIMLI olan her değer geçerli bir token OLMALI (bütünlük —
  // hatayı ilk kullanımda değil, ilk ÇAĞRIDA yakala).
  for (const [key, value] of Object.entries(policy.severityByHazard)) {
    if (value !== undefined && !VALID_SEVERITY_TOKENS.has(value)) {
      throw new RangeError(
        `evaluateRoadHazardRisk: severityByHazard.${key} geçersiz değer ('${value}') — GuardianSeverity veya 'NONE' olmalı.`,
      );
    }
  }

  // Verilen BİLİNEN hazard tipi için eşleme ZORUNLU — kritik bir tip (ör.
  // 'flood') haritada unutulursa SESSİZCE kaybolmasın. 'unknown'/undefined
  // için eşleme ARANMAZ (zaten event-yok dalına düşer).
  const hazardType = hazard.hazardType;
  if (hazardType !== undefined && hazardType !== 'unknown') {
    if (policy.severityByHazard[hazardType] === undefined) {
      throw new RangeError(
        `evaluateRoadHazardRisk: severityByHazard['${hazardType}'] için eşleme tanımlı değil — politika eksik (kritik bir tehlike sessizce düşmesin).`,
      );
    }
  }
}

/* ── Ana kural ────────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. Girdi (`hazard`/`policy` ve iç alanları) MUTASYONA
 * UĞRATILMAZ. Aynı girdi her zaman AYNI çıktıyı üretir — `Date.now`/
 * `Math.random`/global durum YOK.
 */
export function evaluateRoadHazardRisk(input: RoadHazardRiskInput): GuardianRuleResult {
  validateInput(input);

  const { hazard, policy } = input;
  const hazardConfidence = clamp01(hazard.confidence);

  // 1) Tip yok VEYA 'unknown' → olay YOK (tehlike tahmini/uydurma YASAK).
  const hazardType = hazard.hazardType;
  if (hazardType === undefined || hazardType === 'unknown') {
    return emptyResult();
  }

  // 2) Kategorik severity — DI haritasından (validateInput bu anahtarın
  //    tanımlı olduğunu garanti eder). 'NONE' → olay YOK.
  const mappedSeverity = policy.severityByHazard[hazardType] as RoadHazardSeverityOrNone;
  if (mappedSeverity === 'NONE') {
    return emptyResult();
  }
  const severity: GuardianSeverity = mappedSeverity;

  // 3) Confidence eşik altındaysa (eksik/güvenilmez bildirim) olay YOK.
  if (hazardConfidence < MINIMUM_HAZARD_CONFIDENCE) {
    return emptyResult();
  }

  const source = hazard.source ?? DEFAULT_HAZARD_SOURCE;

  const event: GuardianRiskEvent = {
    id:                `${ROAD_HAZARD_RULE_ID}:${hazard.id}`, // deterministik
    type:              'ROAD_HAZARD',
    severity,
    // İleride bir tehlike — DI ile gelen GERÇEK mesafe (weather'daki 0'dan
    // farklı; kuralda uydurulmaz, aynen geçirilir).
    distanceMeters:    hazard.distanceMeters,
    title:             TITLE_TEXT,
    message:           HAZARD_MESSAGES[hazardType],
    recommendedAction: RECOMMENDED_ACTION_TEXT,
    confidence:        hazardConfidence, // event conf <= hazard conf (burada eşit — üst sınır)
    source,
  };

  return { ruleId: ROAD_HAZARD_RULE_ID, riskEvents: [event] };
}
