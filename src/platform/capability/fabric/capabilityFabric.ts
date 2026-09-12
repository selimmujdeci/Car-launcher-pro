/**
 * capabilityFabric.ts — **MAVİ F5 · KONTROLLÜ GİRİŞ KAPISI (çalışma zamanı).**
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * Mavi'nin beyninden gelen bir eylem ÖNERİSİNİ, kanonik yürütücüye teslim
 * edilmeden ÖNCE şu sırayla değerlendirir:
 *
 *   LLM önerisi
 *     → şema doğrulaması        (`capabilityResolver`)
 *     → capability çözümlemesi  (katalog)
 *     → izin                    (`exposedToBrain` — availability DEĞİL)
 *     → availability kanıtı     (`capabilityRegistry` — KANITLI olumsuz kapatır)
 *     → [KANONİK ZİNCİR]        `maviActionAuthority` → `AiSafetyGate` → onay
 *     → [KANONİK YÜRÜTÜCÜ]      `commandExecutor.dispatchIntent`
 *
 * ── NE YAPMAZ (F5'in en sert sınırı) ────────────────────────────────────────
 *  · **YÜRÜTMEZ.** Hiçbir servis çağırmaz, hiçbir intent dispatch etmez,
 *    konuşmaz, UI açmaz, store yazmaz. Köşeli parantezli iki adım BAŞKA
 *    modüllere aittir ve bu dosya onları TAKLİT ETMEZ.
 *  · **İKİNCİ GERÇEKLİK KAYNAĞI KURMAZ.** Güvenlik/onay kararı `maviActionAuthority`
 *    tarafından verilir; buradaki `requiresConfirmation` yalnız BİLGİDİR.
 *    İkisi çelişirse KANONİK olan kazanır (kilitli).
 *  · **DAVRANIŞ DEĞİŞTİRMEZ (varsayılan).** Şalter kapalıyken kapı yalnız
 *    GÖZLEM yapar (`shadow`): karar üretir, ÖLÇER, ama hiçbir eylemi
 *    engellemez → cihaz davranışı bugünküyle BİREBİR aynıdır.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · Her genel API try/catch'lidir ve ASLA throw etmez (fail-soft).
 *  · Bounded tanı sayaçları; **PII YOK** — transkript · parametre değeri ·
 *    kişi adı · adres · VIN · konum bu katmana GİRMEZ.
 */

import {
  capabilityRegistry, type CapabilityStatus,
} from '../capabilityRegistry';
import type {
  AvailabilityEvidence, CapabilityActionRequest, CapabilityFailure,
  CapabilityObservation, CapabilityOperationDef, CapabilityRoute,
} from './capabilityContract';
import { resolveCapabilityAction } from './capabilityResolver';
import { findByLegacyIntent } from './carosCapabilityCatalog';

/* ══════════════════════════════════════════════════════════════════════════
 * Şalter — VARSAYILAN GÖLGE (shadow)
 * ════════════════════════════════════════════════════════════════════════ */

/** Yerel/LAB kaldıracı — YALNIZ tam `"true"` zorlayıcı kipi açar (fail-closed). */
export const MAVI_F5_ENFORCE_FLAG = 'mavi.capabilityFabric.enforce';

/**
 * Uzak yapılandırma bayrağı adı (değeri composition root enjekte eder).
 *
 * ── NEDEN VAR (MAVI-F13 · final dar düzeltme) ───────────────────────────────
 * `setCapabilityFabricEnforceRemoteFlag` bu dosyada tanımlıydı ve yorumu
 * "composition root'tan beslenir" diyordu — ama **üretimde hiç çağrılmıyordu**
 * ve bir uzak anahtar ADI bile yoktu. Yani F5'in filo şalteri KAĞITTA vardı,
 * kodda YOKTU: LAB `mavi_capability_fabric_enforce` adını AÇIK bayraklar
 * listesine yazıyordu, oysa o adla hiçbir yerden açılamıyordu (#1039'un
 * düzelttiği "bilgi var, besleyen yok" kusurunun ikizi).
 *
 * **Neden silinmedi de bağlandı:** F5, kullanıcı komutunu gerçekten
 * ENGELLEYEBİLEN tek Mavi bayrağıdır (`allow: enforced ? !wouldBlock : true`).
 * Böyle bir kapının geri alma yolu cihaz-yerel `localStorage` olamaz —
 * `MAVI_FLAG_EXIT_CRITERIA` §1 her bayrak için "DEFAULT ON (uzak bayrak filoya
 * açık, **rollback tek şalter**)" ve "İKİ temiz sürüm" aşamalarını şart koşar;
 * satır 5'in kaldırma şartı da "zorlayıcı kip iki sürüm temiz kaldıktan sonra"
 * der. Bunların hiçbiri filo şalteri olmadan ölçülemez.
 *
 * Ad bilinçli olarak LAB'ın ZATEN bildirdiği dizedir → yeni sözcük dağarcığı
 * üretilmez, etiket ile gerçek aynı anda doğrulanır.
 */
export const MAVI_F5_ENFORCE_REMOTE_FLAG = 'mavi_capability_fabric_enforce';

let _remoteEnforce = false;

/**
 * Composition root'tan uzak bayrağı bağlar (F0/F3/F4 deseniyle AYNI).
 * Bu modül `remoteConfigService`i import ETMEZ — saf ve test edilebilir kalır;
 * okuma sorumluluğu bileşim kökündedir (ikinci config otoritesi doğmaz).
 */
export function setCapabilityFabricEnforceRemoteFlag(enabled: boolean): void {
  _remoteEnforce = enabled === true;
}

/**
 * Kapı ZORLAYICI mı (`true`) yoksa yalnız GÖZLEMCİ mi (`false`).
 *
 * **Varsayılan `false` (gölge) BİLİNÇLİDİR:** F5'in ilk turunda kapının
 * gerçek trafikte ne kadar doğru karar verdiği ÖLÇÜLMEDEN eylem engellemek,
 * çalışan bir komutu sessizce öldürme riskidir. Gölge kipte karar üretilir ve
 * telemetriye yazılır; kullanıcı hiçbir fark görmez.
 */
export function isCapabilityFabricEnforcing(): boolean {
  if (_remoteEnforce) return true;
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(MAVI_F5_ENFORCE_FLAG) === 'true';
  } catch { return false; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Availability kanıtı
 * ════════════════════════════════════════════════════════════════════════ */

/** KANITLA olumsuz sayılan registry durumları — yalnız bunlar yolu kapatır. */
const NEGATIVE_STATUSES: ReadonlySet<CapabilityStatus> = new Set<CapabilityStatus>([
  'unavailable', 'unsupported', 'restricted',
]);

/**
 * Bir işlemin gerektirdiği registry kimliklerinin availability özetini çıkarır.
 *
 * **POLİTİKA:** kimliklerden HERHANGİ BİRİ kanıtla olumsuzsa → `UNAVAILABLE`.
 * TÜMÜ kanıtla available ise → `AVAILABLE`. Diğer her durum (kanıt yok · bayat ·
 * registry okunamadı · gereksinim listesi boş) → `UNKNOWN` ve yol KAPANMAZ.
 * Gerekçe `capabilityContract.AvailabilityEvidence` başlığındadır.
 */
export function readAvailability(def: CapabilityOperationDef): AvailabilityEvidence {
  try {
    const ids = def.requiredCapabilities;
    if (ids.length === 0) return 'UNKNOWN';        // kanıt İSTENMİYOR → iddia da yok
    let allAvailable = true;
    for (const id of ids) {
      const rec = capabilityRegistry.getCapability(id);
      if (!rec) { allAvailable = false; continue; }  // kayıt yok → kanıt yok
      if (NEGATIVE_STATUSES.has(rec.status)) return 'UNAVAILABLE';
      /* Bayat kanıt available TUTAMAZ (registry ilkesi) — ama olumsuz da
       * sayılmaz; `UNKNOWN`a düşer. */
      if (!(rec.available === true && rec.stale === false)) allAvailable = false;
    }
    return allAvailable ? 'AVAILABLE' : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';                               // fail-soft: kapı körleşmez
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kapı kararı
 * ════════════════════════════════════════════════════════════════════════ */

export interface FabricDecision {
  /** Eylemin bu turda yürütülmesine kapı izin veriyor mu. */
  readonly allow: boolean;
  readonly route: CapabilityRoute;
  /** Çözülen işlem (yoksa `null` → legacy). */
  readonly def: CapabilityOperationDef | null;
  /** Doğrulanmış parametreler — **değerler telemetriye GİTMEZ.** */
  readonly args: Readonly<Record<string, string | number | boolean>>;
  readonly availability: AvailabilityEvidence;
  /** Reddin bounded sebebi (izin verildiyse `null`). */
  readonly failure: CapabilityFailure | null;
  /** Makine-okur gerekçe kodu — PII TAŞIMAZ. */
  readonly reason: string;
  /** Kapı ZORLAYICI mıydı; `false` ise `allow` her hâlükârda `true`dur. */
  readonly enforced: boolean;
  /** Zorlayıcı OLSAYDI karar ne olurdu (gölge kipte ölçüm alanı). */
  readonly wouldBlock: boolean;
}

function decision(p: Partial<FabricDecision> & { route: CapabilityRoute }): FabricDecision {
  const enforced = isCapabilityFabricEnforcing();
  const wouldBlock = p.wouldBlock === true;
  return Object.freeze({
    /* GÖLGE KİPTE ASLA ENGELLEME: karar ölçülür, uygulanmaz. */
    allow: enforced ? !wouldBlock : true,
    route: p.route,
    def: p.def ?? null,
    args: p.args ?? Object.freeze({}),
    availability: p.availability ?? 'UNKNOWN',
    failure: p.failure ?? null,
    reason: p.reason ?? '',
    enforced,
    wouldBlock,
  });
}

/**
 * Beyin önerisini değerlendirir.
 *
 * `legacyIntent` katalogda YOKSA karar `LEGACY_FALLBACK`tir ve **daima izin
 * verilir** — F5 eski yolu kapatmaz, yalnız yeni yolu ölçülebilir kılar.
 */
export function evaluateCapabilityRequest(request: CapabilityActionRequest): FabricDecision {
  try {
    const res = resolveCapabilityAction(request);

    if (!res.ok) {
      if (res.failure === 'CAPABILITY_NOT_FOUND') {
        /* Katalog kapsamı dışı → ESKİ YOL. Engelleme YOK; yalnız sayılır. */
        _bumpRoute('LEGACY_FALLBACK');
        return decision({
          route: 'LEGACY_FALLBACK', failure: 'CAPABILITY_NOT_FOUND',
          reason: res.reason, wouldBlock: false,
        });
      }
      /* Şema düştü → capability yolunda BU ÖNERİ GEÇERSİZDİR. */
      _bumpRoute('CAPABILITY');
      _bumpFailure(res.failure);
      return decision({
        route: 'CAPABILITY', failure: res.failure, reason: res.reason, wouldBlock: true,
      });
    }

    const def = res.def;
    _bumpRoute('CAPABILITY');

    /* İZİN — availability'den AYRI eksen. Beyne kapalı bir işlem, cihazda
     * mevcut olsa bile Mavi tarafından ÖNERİLEMEZ. */
    if (request.provenance === 'llm_proposal' && !def.exposedToBrain) {
      _bumpFailure('PERMISSION_DENIED');
      return decision({
        route: 'CAPABILITY', def, args: res.args, failure: 'PERMISSION_DENIED',
        reason: 'brain:not_exposed', availability: readAvailability(def), wouldBlock: true,
      });
    }

    /* AVAILABILITY — yalnız KANITLI olumsuz kapatır. */
    const availability = readAvailability(def);
    if (availability === 'UNAVAILABLE') {
      _bumpFailure('UNAVAILABLE');
      return decision({
        route: 'CAPABILITY', def, args: res.args, failure: 'UNAVAILABLE',
        reason: 'registry:negative_evidence', availability, wouldBlock: true,
      });
    }

    /* Buradan sonrası KANONİK ZİNCİRİN İŞİDİR: güvenlik sınıfı, hareket
     * politikası, açık onay ve port kontrolü `maviActionAuthority`de yapılır.
     * Bu kapı onları TEKRARLAMAZ — tekrar etseydi iki karar kaynağı doğardı. */
    _bumpAllowed();
    return decision({
      route: 'CAPABILITY', def, args: res.args, availability, reason: 'ok', wouldBlock: false,
    });
  } catch {
    /* FAIL-SOFT: kapı çökerse eylem ESKİ YOLDAN geçer (regresyon yok). */
    return decision({ route: 'LEGACY_FALLBACK', reason: 'fabric:exception', wouldBlock: false });
  }
}

/**
 * Eski `intent` adından kanonik istek üretir — beyin çıktısını capability
 * yoluna bağlayan TEK köprü. Katalogda karşılığı yoksa `null` döner
 * (çağıran eski yola devam eder).
 *
 * **Parametreler ADIYLA taşınır:** `SemanticResult` alan adları katalog şema
 * adlarıyla BİREBİR aynıdır → ikinci bir eşleme sözlüğü (ve onun sessizce
 * kayma riski) YOKTUR.
 */
export function requestFromLegacyIntent(
  intent: string,
  fields: Readonly<Record<string, unknown>>,
  confidence: number,
  provenance: CapabilityActionRequest['provenance'] = 'llm_proposal',
): CapabilityActionRequest | null {
  try {
    const def = findByLegacyIntent(intent);
    if (!def) return null;
    const parameters: Record<string, unknown> = {};
    for (const name of Object.keys(def.parameters)) {
      let v = fields[name];
      /* TAKMA AD: yürütücünün sessiz yedeğini AYNALA. Katalog bu yedeği
       * bilmezse kapı, yürütücünün sorunsuz çalıştıracağı bir öneriyi
       * `INVALID_ARGUMENT` sayar ve zorlayıcı kipte ÇALIŞAN komut ölür. */
      if (v === undefined || v === null || v === '') {
        for (const alias of def.parameterAliases?.[name] ?? []) {
          const a = fields[alias];
          if (a !== undefined && a !== null && a !== '') { v = a; break; }
        }
      }
      if (v !== undefined && v !== null && v !== '') parameters[name] = v;
    }
    return Object.freeze({
      capabilityId: def.capabilityId,
      operation: def.operation,
      parameters: Object.freeze(parameters),
      confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0,
      provenance,
      confirmationState: def.requiresConfirmation ? 'pending' : 'not_required',
    });
  } catch { return null; }
}

/**
 * Beyin çıktısını (eski `intent` + alanlar) TEK adımda değerlendirir —
 * çağıranın capability/legacy ayrımını elle yapmasına gerek kalmaz.
 *
 * Katalogda karşılığı olmayan intent `LEGACY_FALLBACK` kararı alır ve **daima
 * izin verilir**: F5 eski yolu kapatmaz.
 */
export function evaluateLegacyIntent(
  intent: string,
  fields: Readonly<Record<string, unknown>>,
  confidence: number,
  provenance: CapabilityActionRequest['provenance'] = 'llm_proposal',
): FabricDecision {
  try {
    const req = requestFromLegacyIntent(intent, fields, confidence, provenance);
    if (!req) {
      _bumpRoute('LEGACY_FALLBACK');
      return decision({
        route: 'LEGACY_FALLBACK', failure: 'CAPABILITY_NOT_FOUND',
        reason: 'catalog:no_legacy_match', wouldBlock: false,
      });
    }
    return evaluateCapabilityRequest(req);
  } catch {
    return decision({ route: 'LEGACY_FALLBACK', reason: 'fabric:exception', wouldBlock: false });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlem sınıflandırması
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kanonik `IntentExecutionResult.status` → capability gözlem seviyesi.
 *
 * **DÜRÜSTLÜK TAVANI UYGULANIR:** yürütücü "başarılı" dese bile, işlemin
 * `observationCeiling`i `ACCEPTED` ise sonuç `ACCEPTED` olarak raporlanır —
 * çünkü o yolda başarıyı DOĞRULAYAN bir kanıt yoktur. Böylece sistem
 * doğrulayamadığı bir şey için "yaptım" diyemez (`isSuccessObservation`).
 */
export function classifyObservation(
  status: string,
  ceiling: CapabilityOperationDef['observationCeiling'],
): CapabilityObservation {
  const raw: CapabilityObservation = (() => {
    switch (status) {
      case 'succeeded':          return 'EXECUTED';
      case 'started':            return 'ACCEPTED';
      case 'failed':             return 'FAILED';
      case 'denied':             return 'FAILED';
      case 'unsupported':        return 'FAILED';
      case 'needs_confirmation': return 'REQUESTED';
      case 'not_handled':        return 'UNKNOWN';
      case 'unknown':            return 'UNKNOWN';
      default:                   return 'UNKNOWN';
    }
  })();
  if (raw !== 'EXECUTED') return raw;
  /* Tavan uygulaması — yalnız BAŞARI iddiasını sınırlar, hatayı değil. */
  return ceiling === 'ACCEPTED' ? 'ACCEPTED' : 'EXECUTED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded tanı — CAROS LAB · **PII YOK**
 * ════════════════════════════════════════════════════════════════════════ */

const MAX_COUNTER = 1_000_000;
const bump = (v: number): number => (v >= MAX_COUNTER ? MAX_COUNTER : v + 1);

let _capabilityRoutes = 0;
let _legacyRoutes = 0;
let _allowed = 0;
const _failures: Record<string, number> = {};
const _observations: Record<string, number> = {};

function _bumpRoute(r: CapabilityRoute): void {
  if (r === 'CAPABILITY') _capabilityRoutes = bump(_capabilityRoutes);
  else _legacyRoutes = bump(_legacyRoutes);
}
function _bumpFailure(f: CapabilityFailure): void {
  _failures[f] = bump(_failures[f] ?? 0);
}
function _bumpAllowed(): void { _allowed = bump(_allowed); }

/**
 * MAVI-F6 · SON GÖZLEM DEVRİ.
 *
 * Plan koordinatörü her adımın GERÇEK sonucunu bilmek zorundadır ama
 * `AIResultHandler` sözleşmesi `void` döner (durum taşımaz). Sözleşmeyi
 * genişletmek yerine, `commandExecutor`ın F5'te ZATEN yazdığı gözlem burada
 * tek atışlık bir yuvada devredilir.
 *
 * **YALNIZ ARDIŞIK YÜRÜTMEDE GEÇERLİDİR** (plan koordinatörü her adımı `await`
 * eder). Paralel yürütme eklenirse bu yuva yarışa girer — bu yüzden ardışık
 * sıra kilitlidir (`capabilityPlanRunner` + kilit testi).
 */
let _lastObservation: CapabilityObservation | null = null;

/** Yürütme sonucundan gelen gözlem seviyesini kaydeder (bounded). */
export function recordCapabilityObservation(o: CapabilityObservation): void {
  try {
    _observations[o] = bump(_observations[o] ?? 0);
    _lastObservation = o;
  } catch { /* fail-soft */ }
}

/** Son gözlemi OKUR ve yuvayı TEMİZLER (tek atışlık — bayat değer okunamaz). */
export function takeLastCapabilityObservation(): CapabilityObservation | null {
  const o = _lastObservation;
  _lastObservation = null;
  return o;
}

/* MAVI-F6 · bileşik plan sayaçları — **ADET ve bounded sınıf**, parametre YOK. */
let _plansBuilt = 0;
let _planItems = 0;
let _planDependencies = 0;
const _planResults: Record<string, number> = {};

/** Bir planın bounded özetini kaydeder (LAB gözlemi). */
export function recordCapabilityPlan(info: {
  itemCount: number; dependencyCount: number; resultClass: string;
}): void {
  try {
    _plansBuilt = bump(_plansBuilt);
    if (Number.isFinite(info.itemCount) && info.itemCount > 0) {
      _planItems = Math.min(MAX_COUNTER, _planItems + Math.floor(info.itemCount));
    }
    if (Number.isFinite(info.dependencyCount) && info.dependencyCount > 0) {
      _planDependencies = Math.min(MAX_COUNTER, _planDependencies + Math.floor(info.dependencyCount));
    }
    if (typeof info.resultClass === 'string' && info.resultClass) {
      _planResults[info.resultClass] = bump(_planResults[info.resultClass] ?? 0);
    }
  } catch { /* fail-soft */ }
}

export interface CapabilityFabricDiagnostics {
  readonly enforcing: boolean;
  readonly capabilityRoutes: number;
  readonly legacyRoutes: number;
  readonly allowed: number;
  /** Kapsama oranı yüzde — `capability / (capability + legacy)`. */
  readonly coveragePercent: number;
  readonly failures: Readonly<Record<string, number>>;
  readonly observations: Readonly<Record<string, number>>;
  /** MAVI-F6: kurulan bileşik plan adedi. */
  readonly plansBuilt: number;
  /** MAVI-F6: planlardaki toplam YAŞAYAN adım adedi. */
  readonly planItems: number;
  /** MAVI-F6: adımlar arası toplam bağımlılık adedi. */
  readonly planDependencies: number;
  /** MAVI-F6: plan sonucu dağılımı — bounded enum. */
  readonly planResults: Readonly<Record<string, number>>;
}

export function getCapabilityFabricDiagnostics(): CapabilityFabricDiagnostics {
  const total = _capabilityRoutes + _legacyRoutes;
  return Object.freeze({
    enforcing: isCapabilityFabricEnforcing(),
    capabilityRoutes: _capabilityRoutes,
    legacyRoutes: _legacyRoutes,
    allowed: _allowed,
    coveragePercent: total > 0 ? Math.round((_capabilityRoutes / total) * 100) : 0,
    failures: Object.freeze({ ..._failures }),
    observations: Object.freeze({ ..._observations }),
    plansBuilt: _plansBuilt,
    planItems: _planItems,
    planDependencies: _planDependencies,
    planResults: Object.freeze({ ..._planResults }),
  });
}

/** @internal — testler arası izolasyon. */
export function _resetCapabilityFabricForTest(): void {
  _remoteEnforce = false;
  _lastObservation = null;
  _capabilityRoutes = 0; _legacyRoutes = 0; _allowed = 0;
  for (const k of Object.keys(_failures)) delete _failures[k];
  for (const k of Object.keys(_observations)) delete _observations[k];
  _plansBuilt = 0; _planItems = 0; _planDependencies = 0;
  for (const k of Object.keys(_planResults)) delete _planResults[k];
}
