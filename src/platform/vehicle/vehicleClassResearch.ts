/**
 * vehicleClassResearch.ts — araç yasal sınıfı için DIŞ KAYNAK araştırması.
 *
 * ── GÜVENLİK / GİZLİLİK SÖZLEŞMESİ (görev §4 + §11, pazarlıksız) ────────────
 *  · İstek YALNIZ yapılandırılmış **backend proxy** üzerinden gider. Uygulama
 *    bundle'ına HİÇBİR sağlayıcı anahtarı gömülmez; proxy yoksa araştırma
 *    yapılmaz (`BLOCKED_NO_BACKEND`) — sessizce başka bir uca düşülmez.
 *  · Gönderilen VIN bilgisi **ilk 9 hanedir** (WMI+VDS). 10–17. haneler model
 *    yılı ve SERİ NUMARASIDIR; onlar backend'e bile GİTMEZ.
 *  · Yanıt YALNIZ VERİ olarak işlenir: HTML/JS çalıştırılmaz, `innerHTML`
 *    kullanılmaz, ham sayfa içeriği cihaza KALICI YAZILMAZ. Yalnız daraltılmış
 *    alanlar (sınıf + künye) alınır.
 *  · Sınırlı zaman aşımı + sınırlı deneme. Sonsuz retry YOK, navigasyon
 *    tick'inde sorgu YOK — yalnız ARAÇ KİMLİĞİ değişince.
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 * Tek bir kaynağın "Doblo panelvandır" demesi ruhsat sınıfı KANITI DEĞİLDİR.
 * Backend iki bağımsız kaynak doğrulaması yaptıysa `agreementCount ≥ 2` bildirir
 * ve güven ona göre verilir; aksi hâlde sonuç `TRUSTED_DATABASE` + düşük güvenle
 * yalnız ADAY üretir ve kullanıcı doğrulaması istenir.
 */

import type {
  VehicleClassClaim, VehicleClassSourceRef,
  LegalVehicleCategory, RegistrationBodyType, VehicleClassSource,
} from './legalVehicleClass';

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç tipleri
 * ════════════════════════════════════════════════════════════════════════ */

export type ResearchOutcome =
  /** Kaynak(lar) tek sınıfta birleşti. */
  | 'RESOLVED'
  /** Kaynaklar farklı sınıflar döndürdü. */
  | 'CONFLICTED'
  /** Aynı model hem M1 hem N1 satılıyor — ayırt edilemedi. */
  | 'AMBIGUOUS'
  /** Kaynak bulunamadı. */
  | 'UNAVAILABLE'
  /** İnternet yok. */
  | 'BLOCKED_NETWORK'
  /** Backend proxy yapılandırılmamış (anahtar gömmek YASAK). */
  | 'BLOCKED_NO_BACKEND'
  /** Girdi yetersiz (marka/model/VIN öneki yok). */
  | 'BLOCKED_NO_IDENTITY'
  /** Zaman aşımı / ağ hatası / bozuk yanıt. */
  | 'FAILED'
  /** Hiç denenmedi. */
  | 'IDLE';

export const RESEARCH_OUTCOME_LABEL: Readonly<Record<ResearchOutcome, string>> = {
  RESOLVED:           'ÇÖZÜLDÜ',
  CONFLICTED:         'KAYNAKLAR ÇELİŞİYOR',
  AMBIGUOUS:          'VARYANTLAR AYRIŞMIYOR',
  UNAVAILABLE:        'KAYNAK BULUNAMADI',
  BLOCKED_NETWORK:    'İNTERNET YOK',
  BLOCKED_NO_BACKEND: 'BACKEND YAPILANDIRILMADI',
  BLOCKED_NO_IDENTITY:'ARAÇ KİMLİĞİ YETERSİZ',
  FAILED:             'BAŞARISIZ',
  IDLE:               'DENENMEDİ',
} as const;

export interface VehicleClassResearchRequest {
  /** VIN'in ilk 9 hanesi — seri numarası İÇERMEZ. `null` = VIN yok. */
  readonly vinPrefix: string | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly modelYear: number | null;
  readonly countryCode: 'TR';
}

export interface VehicleClassResearchResult {
  readonly outcome: ResearchOutcome;
  /** Üretilen kanıt(lar) — `AMBIGUOUS`/`CONFLICTED`'te birden fazla olabilir. */
  readonly claims: readonly VehicleClassClaim[];
  readonly attemptedAt: number;
  /** Başarısızlık gerekçesi (insan-okur, hassas veri İÇERMEZ). */
  readonly failureReason: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yanıt doğrulama — dış veri ASLA güvenilmez, daraltılır
 * ════════════════════════════════════════════════════════════════════════ */

const _CATEGORIES: ReadonlySet<string> = new Set([
  'M1', 'M1G', 'M2', 'M3', 'N1', 'N1G', 'N2', 'N3',
]);
const _BODIES: ReadonlySet<string> = new Set([
  'AUTOMOBILE', 'PANELVAN', 'VAN', 'PICKUP', 'MINIBUS', 'BUS', 'TRUCK', 'TRACTOR',
]);
const _SOURCES: ReadonlySet<string> = new Set([
  'OFFICIAL_VIN_LOOKUP', 'MANUFACTURER_DATA', 'TRUSTED_DATABASE',
]);

/** Künye uzunluk sınırları — şişkin/kötü niyetli yanıtı budar. */
const _MAX_CLAIMS = 4;
const _MAX_REFS = 4;
const _MAX_TEXT = 200;

function _str(v: unknown, max = _MAX_TEXT): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : null;
}

/** URL yalnız `https:` olabilir — `javascript:`/`data:` künyesi REDDEDİLİR. */
function _httpsUrl(v: unknown): string | null {
  const s = _str(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

function _refs(v: unknown, nowMs: number): VehicleClassSourceRef[] {
  if (!Array.isArray(v)) return [];
  const out: VehicleClassSourceRef[] = [];
  for (const raw of v.slice(0, _MAX_REFS)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const url = _httpsUrl(r.url);
    if (!url) continue;
    out.push({
      url,
      title: _str(r.title) ?? url,
      retrievedAt: typeof r.retrievedAt === 'number' && Number.isFinite(r.retrievedAt)
        ? r.retrievedAt : nowMs,
    });
  }
  return out;
}

/** Backend'in `agreementCount`'una göre güven — tek kaynak VERIFIED üretemez. */
export function confidenceFromAgreement(
  source: VehicleClassSource, agreementCount: number,
): number {
  if (source === 'OFFICIAL_VIN_LOOKUP') return agreementCount >= 2 ? 0.95 : 0.85;
  if (source === 'MANUFACTURER_DATA')   return agreementCount >= 2 ? 0.8 : 0.65;
  return agreementCount >= 2 ? 0.7 : 0.5;   // TRUSTED_DATABASE
}

/** Araştırma kanıtının geçerlilik süresi — 180 gün (ruhsat sınıfı seyrek değişir). */
export const RESEARCH_CLAIM_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Ham backend yanıtını kanıtlara çevirir. Doğrulanamayan her şey ATILIR;
 * hiçbir alan uydurulmaz.
 */
export function parseResearchResponse(raw: unknown, nowMs: number): VehicleClassClaim[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const body = raw as Record<string, unknown>;
  const list = Array.isArray(body.results) ? body.results : [];
  const out: VehicleClassClaim[] = [];

  for (const item of list.slice(0, _MAX_CLAIMS)) {
    if (typeof item !== 'object' || item === null) continue;
    const it = item as Record<string, unknown>;

    const cat = _str(it.legalVehicleCategory, 8)?.toUpperCase() ?? '';
    const body2 = _str(it.registrationBodyType, 16)?.toUpperCase() ?? '';
    const src = _str(it.source, 32)?.toUpperCase() ?? '';
    if (!_CATEGORIES.has(cat)) continue;
    if (!_SOURCES.has(src)) continue;

    const agreement = typeof it.agreementCount === 'number'
      && Number.isFinite(it.agreementCount) ? Math.max(1, Math.floor(it.agreementCount)) : 1;
    const refs = _refs(it.sourceRefs, nowMs);
    // Künyesiz kanıt KABUL EDİLMEZ — "kaynaksız kullanma" kuralı (görev §0).
    if (refs.length === 0) continue;

    out.push({
      legalVehicleCategory: cat as LegalVehicleCategory,
      registrationBodyType: (_BODIES.has(body2) ? body2 : 'UNKNOWN') as RegistrationBodyType,
      source: src as VehicleClassSource,
      confidence: confidenceFromAgreement(src as VehicleClassSource, agreement),
      verifiedAt: nowMs,
      expiresAt: nowMs + RESEARCH_CLAIM_TTL_MS,
      sourceRefs: refs,
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Araştırma çağrısı
 * ════════════════════════════════════════════════════════════════════════ */

/** Uç nokta başına iptal süresi — ölü isteği uzun tutmak telsizi boşuna açar. */
export const RESEARCH_TIMEOUT_MS = 8_000;

export interface ResearchDeps {
  readonly fetchFn: typeof fetch;
  readonly nowMs: number;
  /** `navigator.onLine` — `null` = bilinmiyor (engelleme yapılmaz). */
  readonly online: boolean | null;
  /** Backend proxy tabanı; boş/`null` → `BLOCKED_NO_BACKEND`. */
  readonly backendBase: string | null;
  readonly timeoutMs?: number;
}

function _fail(outcome: ResearchOutcome, nowMs: number, reason: string | null = null): VehicleClassResearchResult {
  return { outcome, claims: [], attemptedAt: nowMs, failureReason: reason };
}

/**
 * Backend proxy üzerinden sınıf araştırması yapar. ASLA throw etmez.
 *
 * Not: `deps` enjekte edilir → testler ağa çıkmaz, saat sabittir.
 */
export async function researchVehicleClass(
  req: VehicleClassResearchRequest,
  deps: ResearchDeps,
): Promise<VehicleClassResearchResult> {
  const now = deps.nowMs;

  if (!req.vinPrefix && !(req.make && req.model)) {
    return _fail('BLOCKED_NO_IDENTITY', now, 'VIN öneki ve marka/model yok');
  }
  if (deps.online === false) {
    return _fail('BLOCKED_NETWORK', now, 'cihaz çevrimdışı');
  }
  const base = (deps.backendBase ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    return _fail('BLOCKED_NO_BACKEND', now,
      'VITE_VEHICLE_API_BASE tanımsız — anahtar gömmek yasak, doğrudan sağlayıcıya çıkılmaz');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? RESEARCH_TIMEOUT_MS);
  try {
    const res = await deps.fetchFn(`${base}/api/vehicle/class-lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vinPrefix: req.vinPrefix,
        make: req.make,
        model: req.model,
        modelYear: req.modelYear,
        countryCode: req.countryCode,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return _fail('FAILED', now, `HTTP ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return _fail('FAILED', now, 'yanıt JSON değil');

    const raw = await res.json() as Record<string, unknown>;
    const claims = parseResearchResponse(raw, now);
    if (claims.length === 0) {
      const declared = _str(raw?.outcome, 32)?.toUpperCase();
      if (declared === 'UNAVAILABLE') return _fail('UNAVAILABLE', now, 'sağlayıcı sonuç bulamadı');
      return _fail('UNAVAILABLE', now, 'doğrulanabilir künyeli kanıt yok');
    }

    const keys = new Set(claims.map((c) => `${c.legalVehicleCategory}/${c.registrationBodyType}`));
    if (keys.size > 1) {
      /* Aynı modelin farklı sınıfları → AMBIGUOUS; kaynaklar birbirini
         yalanlıyorsa CONFLICTED. Ayrım: kategori bile farklıysa çelişki. */
      const cats = new Set(claims.map((c) => c.legalVehicleCategory));
      return {
        outcome: cats.size > 1 ? 'CONFLICTED' : 'AMBIGUOUS',
        claims, attemptedAt: now, failureReason: null,
      };
    }
    return { outcome: 'RESOLVED', claims, attemptedAt: now, failureReason: null };
  } catch (e) {
    const aborted = (e as { name?: string } | null)?.name === 'AbortError';
    return _fail('FAILED', now, aborted ? 'zaman aşımı' : 'ağ hatası');
  } finally {
    clearTimeout(timer);
  }
}
