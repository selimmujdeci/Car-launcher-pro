/**
 * aiEvidence.ts — AI EVIDENCE ENGINE: KANONİK MODEL VE SÖZLEŞME (P1).
 *
 * ── AMAÇ ───────────────────────────────────────────────────────────────
 * CAROS PRO'daki bütün AI sistemlerinin ORTAK OMURGASI. Bugün sistem yalnız
 * veri topluyor; yarın Mavi'nin söylediği **her cümle** buradaki bir kanıta
 * geri izlenebilecek. Kanıt karşılığı olmayan bir iddia üretilemeyecek.
 *
 * ── BU PAKET AI CEVABI ÜRETMEZ (BAĞLAYICI) ─────────────────────────────
 * LLM YOK · model YOK · tahmin YOK · öneri YOK · doğal dil YOK.
 * Bir kanıt burada bir CÜMLE değil, KAYNAĞI · KATEGORİSİ · ÖZNESİ ·
 * ÖLÇÜM KALİTESİ ve GEÇERLİLİK PENCERESİ belli bir KAYITTIR.
 *
 * ── BEŞ SÖZLEŞME KURALI ────────────────────────────────────────────────
 *  1. **Kaynaksız kanıt ACTIVE olamaz.** `SOURCE_UNKNOWN` bir kanıt kaynağı
 *     değildir; hangi modülden geldiği bilinmeyen bir iddia kanıt sayılamaz.
 *  2. **Güven kanıttan BAĞIMSIZ yazılamaz.** İstemci/çağıran kendi güvenini
 *     ilan edemez; güven daima kaynak · ölçüm kalitesi · örnek sayısının
 *     EN ZAYIF halkasından türetilir.
 *  3. **Kanıt DEĞİŞMEZDİR.** Öznesi, kategorisi, kaynağı ve doğuş anı
 *     sonradan değiştirilemez; yalnız tazeleme ve süre dolumu yazılabilir.
 *  4. **Süresi dolan kanıt SİLİNMEZ**, `EXPIRED` olur — geçmiş bir iddianın
 *     dayanağı yok edilirse o iddia açıklanamaz hâle gelir.
 *  5. **UNKNOWN gerçek bir cevaptır.** Ölçülmemiş alan `0` DEĞİL, `null`dır
 *     ve kapsam hesabında "eksik" olarak sayılır.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 */

/* ── Kaynak ────────────────────────────────────────────────────────────── */

/**
 * Kanıtın GELDİĞİ modül — zorunlu ve değiştirilemez.
 *
 * ⚠️ `SOURCE_UNKNOWN` bilinçli olarak listede vardır ama **ASLA `ACTIVE`
 * olamaz**: kaynağı bilinmeyen kayıt, sistemin kendi iç hatasının kaydıdır;
 * kanıt olarak kullanılamaz (bkz. `canActivate`).
 */
export const EVIDENCE_SOURCES = [
  'TRIP_ENGINE',
  'DRIVER_DNA',
  'FLEET_INTELLIGENCE',
  'DEEP_SCAN',
  'VEHICLE_IDENTITY',
  'TELEMETRY',
  'BLACKBOX',
  'HEALTH_MONITOR',
  'SOURCE_UNKNOWN',
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export function isEvidenceSource(v: unknown): v is EvidenceSource {
  return typeof v === 'string' && (EVIDENCE_SOURCES as readonly string[]).includes(v);
}

/* ── Kategori ──────────────────────────────────────────────────────────── */

export const EVIDENCE_CATEGORIES = [
  'DRIVER', 'TRIP', 'VEHICLE', 'ENGINE', 'TEMPERATURE', 'FUEL', 'BATTERY',
  'LOCATION', 'CONNECTIVITY', 'DIAGNOSTIC', 'BLACKBOX', 'FLEET', 'UNKNOWN',
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

/* ── Önem ──────────────────────────────────────────────────────────────── */

/**
 * Kanıtın ÖNEMİ — bir karar değil, bir sınıflandırmadır.
 *
 * ⚠️ `CRITICAL` bile tek başına bir aksiyon emri DEĞİLDİR: aksiyon kararı
 * bu katmanın işi değildir (Vehicle Brain'in işidir). Burada yalnız
 * "bu kanıt ne kadar dikkate değer" bilgisi taşınır.
 */
export const EVIDENCE_SEVERITIES = ['INFO', 'NOTICE', 'WARNING', 'CRITICAL'] as const;
export type EvidenceSeverity = (typeof EVIDENCE_SEVERITIES)[number];

/* ── Güven ─────────────────────────────────────────────────────────────── */

export const EVIDENCE_CONFIDENCES =
  ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type EvidenceConfidence = (typeof EVIDENCE_CONFIDENCES)[number];

const CONFIDENCE_ORDER: readonly EvidenceConfidence[] =
  ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];

/** İki güvenin DAHA ZAYIFI — en zayıf halka kuralı. */
export function weakestEvidenceConfidence(
  a: EvidenceConfidence, b: EvidenceConfidence,
): EvidenceConfidence {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

/** Ölçüm kalitesi — `vehicle_trips.*_source` ile aynı sözleşme. */
export const EVIDENCE_PROVENANCES =
  ['MEASURED', 'DERIVED', 'ESTIMATED', 'UNKNOWN'] as const;
export type EvidenceProvenance = (typeof EVIDENCE_PROVENANCES)[number];

/**
 * Kaynağın verebileceği EN YÜKSEK güven.
 *
 * Bir modül, doğası gereği taşıyamayacağı bir güveni İDDİA EDEMEZ:
 * sağlık izleyicisinin sezgisel bir sinyali, ham blackbox kaydıyla aynı
 * ağırlıkta olamaz.
 */
export function sourceConfidenceCeiling(s: EvidenceSource): EvidenceConfidence {
  switch (s) {
    /* Ham kayıt / donanım kimliği / derin tarama: doğrudan ölçüm zinciri. */
    case 'BLACKBOX':          return 'VERY_HIGH';
    case 'DEEP_SCAN':         return 'VERY_HIGH';
    case 'VEHICLE_IDENTITY':  return 'VERY_HIGH';
    /* Ölçümden türetilmiş katmanlar. */
    case 'TELEMETRY':         return 'HIGH';
    case 'TRIP_ENGINE':       return 'HIGH';
    case 'DRIVER_DNA':        return 'HIGH';
    case 'FLEET_INTELLIGENCE':return 'HIGH';
    /* Sezgisel/eşik tabanlı izleme — kanıt olabilir ama en güçlüsü olamaz. */
    case 'HEALTH_MONITOR':    return 'MEDIUM';
    case 'SOURCE_UNKNOWN':    return 'UNKNOWN';
    /* Calisma zamani fail-closed (#497): union disi kaynak `undefined` DEGIL,
       'UNKNOWN' dondurur — SQL `_evidence_source_ceiling` ELSE daliyla birebir.
       `undefined` donseydi `weakestEvidenceConfidence` indexOf(-1) uzerinden
       SESSIZCE en yuksek guveni secerdi: bilinmeyen kaynak en guvenilir sayilirdi. */
    default:                  return 'UNKNOWN';
  }
}

/** Ölçüm kalitesinin verebileceği en yüksek güven. */
export function provenanceConfidenceCeiling(p: EvidenceProvenance): EvidenceConfidence {
  switch (p) {
    case 'MEASURED':  return 'VERY_HIGH';
    case 'DERIVED':   return 'HIGH';
    case 'ESTIMATED': return 'MEDIUM';
    case 'UNKNOWN':   return 'UNKNOWN';
    /* Calisma zamani fail-closed (#497) — SQL ELSE dali ile birebir. */
    default:          return 'UNKNOWN';
  }
}

/**
 * Örnek sayısının verebileceği en yüksek güven.
 *
 * Tek gözlem bir eğilim değildir: bir kez görülen şey `MEDIUM`u aşamaz.
 */
export function sampleConfidenceCeiling(sampleCount: number): EvidenceConfidence {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return 'UNKNOWN';
  if (sampleCount === 1) return 'MEDIUM';
  if (sampleCount < 5) return 'HIGH';
  return 'VERY_HIGH';
}

/**
 * GÜVEN TÜRETİMİ — **tek yol budur**.
 *
 * ⚠️ Güven bir GİRDİ DEĞİLDİR: hiçbir çağıran kendi güvenini yazamaz.
 * Üç tavanın en zayıfı alınır (kaynak · ölçüm kalitesi · örnek sayısı).
 * Bu yüzden `deriveEvidenceConfidence` dışında güven üreten bir yol
 * bulunmamalıdır (testle kilitli).
 */
export function deriveEvidenceConfidence(input: {
  readonly source: EvidenceSource;
  readonly provenance: EvidenceProvenance;
  readonly sampleCount: number;
}): EvidenceConfidence {
  return weakestEvidenceConfidence(
    sourceConfidenceCeiling(input.source),
    weakestEvidenceConfidence(
      provenanceConfidenceCeiling(input.provenance),
      sampleConfidenceCeiling(input.sampleCount),
    ),
  );
}

/* ── Durum ─────────────────────────────────────────────────────────────── */

export const EVIDENCE_STATES = ['ACTIVE', 'EXPIRED', 'SUPERSEDED', 'REJECTED'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** Kanıt neden kullanılamıyor — bounded KOD (serbest metin YOK). */
export const EVIDENCE_REJECT_REASONS = [
  'SOURCE_UNKNOWN',       // hangi modülden geldiği bilinmiyor
  'NO_SUBJECT',           // hiçbir özneye bağlı değil (şirket/araç/sürücü/trip)
  'NO_MEASUREMENT',       // ölçüm yok ve türetilebilir değil
  'CONFIDENCE_UNKNOWN',   // güven türetilemedi
  'TENANT_MISMATCH',      // özne başka şirkete ait
  'IMMUTABLE_VIOLATION',  // değişmezlik ihlali denendi
] as const;
export type EvidenceRejectReason = (typeof EVIDENCE_REJECT_REASONS)[number];

/* ── Kanonik kanıt ─────────────────────────────────────────────────────── */

/**
 * Tek bir kanıt kaydı.
 *
 * ⚠️ Kişisel veri TAŞIMAZ: ad, plaka, VIN, konum koordinatı, rota, ham
 * transkript YOKTUR — yalnız kimlik referansları, sınıflandırma ve sayısal
 * ölçüm.
 *
 * ⚠️ `title`/`message`/`explanation` gibi bir alan **BİLİNÇLİ OLARAK
 * YOKTUR**: cümleyi Mavi kuracak, bu katman kanıtı verir.
 */
export interface AiEvidence {
  readonly id: string;
  readonly companyId: string;
  /** Özneler — biri bile yoksa kanıt bir yere bağlanamaz (bkz. `canActivate`). */
  readonly vehicleId: string | null;
  readonly driverId: string | null;
  readonly tripId: string | null;
  readonly source: EvidenceSource;
  readonly category: EvidenceCategory;
  readonly severity: EvidenceSeverity;
  /** TÜRETİLİR — asla dışarıdan yazılmaz. */
  readonly confidence: EvidenceConfidence;
  readonly provenance: EvidenceProvenance;
  /** Ölçülen metrik adı ve değeri; bilinmiyorsa `null` (sahte 0 YOK). */
  readonly metric: string;
  readonly value: number | null;
  /** Kaç gözleme dayanıyor — güven türetiminin girdisi. */
  readonly sampleCount: number;
  /** İLK görülme anı — tazelemede **DEĞİŞMEZ**. */
  readonly createdAt: number;
  /** En son tazelenme anı. */
  readonly lastSeenAt: number;
  /** Geçerlilik sonu; süresiz kanıt YOKTUR. */
  readonly expiresAt: number;
  readonly state: EvidenceState;
  /** Aynı kanıtın tekrar görülme sayısı (birleştirme kanıtı). */
  readonly refreshCount: number;
  /** Şema sürümü — anlam değişirse ARTAR, eski kayıt yanlış yorumlanmaz. */
  readonly evidenceVersion: number;
  readonly rejectReason: EvidenceRejectReason | null;
}

/** Güncel şema sürümü. */
export const EVIDENCE_VERSION = 1;

/** VARSAYILAN ÖMÜR — süresiz kanıt bayat bilgiyi kanıt gibi sunar. */
export const EVIDENCE_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 gün

/**
 * KANIT KİMLİĞİ — birleştirmenin (merge) çekirdeği.
 *
 * Aynı kimliğe sahip kanıt İKİNCİ KEZ AÇILMAZ: `refreshCount` artar ve
 * ilk görülme anı korunur. Zaman kimliğe DAHİL DEĞİLDİR — aksi hâlde her
 * tazeleme yeni bir "kanıt" üretir ve sayılar şişerdi.
 */
export function evidenceKey(e: Pick<AiEvidence,
  'companyId' | 'source' | 'category' | 'metric'
  | 'vehicleId' | 'driverId' | 'tripId'>): string {
  return [
    e.companyId, e.source, e.category, e.metric,
    e.vehicleId ?? '-', e.driverId ?? '-', e.tripId ?? '-',
  ].join('|');
}

/**
 * Bu kanıt `ACTIVE` olabilir mi — fail-closed kapı.
 *
 * Dört koşul da şart: kaynağı bilinmeli · bir özneye bağlı olmalı · güveni
 * türetilebilmeli · ölçümü ya da türetimi olmalı.
 */
export function canActivate(e: AiEvidence): { ok: true } | {
  ok: false; reason: EvidenceRejectReason;
} {
  if (e.source === 'SOURCE_UNKNOWN') return { ok: false, reason: 'SOURCE_UNKNOWN' };
  if (e.vehicleId === null && e.driverId === null && e.tripId === null) {
    return { ok: false, reason: 'NO_SUBJECT' };
  }
  if (e.value === null && e.provenance === 'UNKNOWN') {
    return { ok: false, reason: 'NO_MEASUREMENT' };
  }
  if (e.confidence === 'UNKNOWN') return { ok: false, reason: 'CONFIDENCE_UNKNOWN' };
  return { ok: true };
}

/** Kanıt verilen anda hâlâ geçerli mi. */
export function isEvidenceValid(e: AiEvidence, nowMs: number): boolean {
  return e.state === 'ACTIVE' && nowMs < e.expiresAt;
}

/* ── Kanıt zinciri ─────────────────────────────────────────────────────── */

/** Kanıtı TÜKETEN katman — zincirin diğer ucu. */
export const EVIDENCE_CONSUMERS = [
  'FLEET_INSIGHT', 'DRIVER_DNA', 'FLEET_TREND', 'FLEET_HEALTH', 'AI_ANSWER',
] as const;
export type EvidenceConsumer = (typeof EVIDENCE_CONSUMERS)[number];

/**
 * Zincir bağı: hangi çıktı hangi kanıta dayanıyor.
 *
 * ⚠️ `AI_ANSWER` bilinçli olarak listede: **gelecekte Mavi'nin ürettiği her
 * cümle** buraya bir bağ yazmak zorunda kalacak. Kanıt bağı olmayan bir AI
 * çıktısı, sistemin açıklayamayacağı bir iddiadır.
 */
export interface EvidenceChainLink {
  readonly evidenceId: string;
  readonly consumer: EvidenceConsumer;
  readonly consumerId: string;
}

export function chainKey(l: EvidenceChainLink): string {
  return `${l.consumer}|${l.consumerId}|${l.evidenceId}`;
}

/* ── Kapsam ────────────────────────────────────────────────────────────── */

export const COVERAGE_SCOPES = ['COMPANY', 'VEHICLE', 'DRIVER', 'TRIP'] as const;
export type CoverageScope = (typeof COVERAGE_SCOPES)[number];

/**
 * Bir öznenin kanıt kapsamı.
 *
 * ⚠️ `ratio` **`null` olabilir** ve bu "kapsam yok" demek DEĞİLDİR;
 * "hesaplanamadı" demektir (ör. hiç kategori beklenmiyorsa bölme yapılamaz).
 * Eksik kategoriler tek tek listelenir — "neyi bilmiyoruz" görünür olur.
 */
export interface EvidenceCoverage {
  readonly scope: CoverageScope;
  readonly subjectId: string;
  readonly expectedCategories: readonly EvidenceCategory[];
  readonly presentCategories: readonly EvidenceCategory[];
  readonly missingCategories: readonly EvidenceCategory[];
  readonly ratio: number | null;
  readonly activeEvidenceCount: number;
  readonly expiredEvidenceCount: number;
  readonly confidence: EvidenceConfidence;
}

/**
 * Bir kapsam için BEKLENEN kategoriler.
 *
 * Beklenti sabittir ve gerçeğe göre AŞAĞI ÇEKİLMEZ: "zaten hiç sıcaklık
 * verimiz yok, o hâlde beklemeyelim" demek, eksikliği görünmez yapardı.
 */
export function expectedCategoriesFor(scope: CoverageScope): readonly EvidenceCategory[] {
  switch (scope) {
    case 'COMPANY': return Object.freeze(['FLEET', 'VEHICLE', 'DRIVER', 'TRIP']);
    case 'VEHICLE': return Object.freeze(
      ['VEHICLE', 'ENGINE', 'TEMPERATURE', 'FUEL', 'BATTERY', 'CONNECTIVITY', 'DIAGNOSTIC']);
    case 'DRIVER':  return Object.freeze(['DRIVER', 'TRIP']);
    case 'TRIP':    return Object.freeze(['TRIP', 'FUEL', 'ENGINE', 'LOCATION']);
  }
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function evidenceSourceLabel(s: EvidenceSource): string {
  switch (s) {
    case 'TRIP_ENGINE':        return 'Yolculuk motoru';
    case 'DRIVER_DNA':         return 'Sürücü DNA';
    case 'FLEET_INTELLIGENCE': return 'Filo zekâsı';
    case 'DEEP_SCAN':          return 'Derin tarama';
    case 'VEHICLE_IDENTITY':   return 'Araç kimliği';
    case 'TELEMETRY':          return 'Telemetri';
    case 'BLACKBOX':           return 'Kara kutu';
    case 'HEALTH_MONITOR':     return 'Sağlık izleyici';
    case 'SOURCE_UNKNOWN':     return 'Kaynak bilinmiyor';
  }
}

export function evidenceCategoryLabel(c: EvidenceCategory): string {
  switch (c) {
    case 'DRIVER':       return 'Sürücü';
    case 'TRIP':         return 'Yolculuk';
    case 'VEHICLE':      return 'Araç';
    case 'ENGINE':       return 'Motor';
    case 'TEMPERATURE':  return 'Sıcaklık';
    case 'FUEL':         return 'Yakıt';
    case 'BATTERY':      return 'Akü';
    case 'LOCATION':     return 'Konum';
    case 'CONNECTIVITY': return 'Bağlantı';
    case 'DIAGNOSTIC':   return 'Tanı';
    case 'BLACKBOX':     return 'Kara kutu';
    case 'FLEET':        return 'Filo';
    case 'UNKNOWN':      return 'Bilinmiyor';
  }
}

export function evidenceStateLabel(s: EvidenceState): string {
  switch (s) {
    case 'ACTIVE':     return 'Geçerli';
    case 'EXPIRED':    return 'Süresi doldu';
    case 'SUPERSEDED': return 'Yerine yenisi geçti';
    case 'REJECTED':   return 'Kanıt sayılmadı';
  }
}

export function evidenceSeverityLabel(s: EvidenceSeverity): string {
  switch (s) {
    case 'INFO':     return 'Bilgi';
    case 'NOTICE':   return 'Dikkat';
    case 'WARNING':  return 'Uyarı';
    case 'CRITICAL': return 'Kritik';
  }
}

export function evidenceRejectReasonLabel(r: EvidenceRejectReason): string {
  switch (r) {
    case 'SOURCE_UNKNOWN':      return 'Kaynak modül bilinmiyor';
    case 'NO_SUBJECT':          return 'Hiçbir özneye bağlı değil';
    case 'NO_MEASUREMENT':      return 'Ölçüm yok';
    case 'CONFIDENCE_UNKNOWN':  return 'Güven türetilemedi';
    case 'TENANT_MISMATCH':     return 'Özne başka şirkete ait';
    case 'IMMUTABLE_VIOLATION': return 'Değişmezlik ihlali';
  }
}

export function evidenceConsumerLabel(c: EvidenceConsumer): string {
  switch (c) {
    case 'FLEET_INSIGHT': return 'Filo içgörüsü';
    case 'DRIVER_DNA':    return 'Sürücü DNA';
    case 'FLEET_TREND':   return 'Filo trendi';
    case 'FLEET_HEALTH':  return 'Filo sağlığı';
    case 'AI_ANSWER':     return 'AI cevabı';
  }
}
