/**
 * observationContract.ts — **MAVİ F7 · GÖZLEM SÖZLEŞMESİ (SAF).**
 *
 * ── NE ÇÖZER ────────────────────────────────────────────────────────────────
 * F5 "dürüstlük tavanı"nı (`observationCeiling`) kurdu ama tavanın ALTINI
 * dolduracak GERÇEK kanıt yoktu: yürütücü ne dediyse o yazılıyordu. F7 bu
 * boşluğu kapatır ve tek bir sözleşmeyi kodla zorlar:
 *
 *   **PROPOSED ≠ REQUESTED ≠ ACCEPTED ≠ EXECUTED ≠ OBSERVED**
 *
 * Mavi yalnız SAHİP OLDUĞU kanıt seviyesine kadar konuşabilir.
 *
 * ── NE DEĞİLDİR (sert sınırlar) ─────────────────────────────────────────────
 *  · **YÜRÜTME OTORİTESİ DEĞİLDİR** — hiçbir eylemi başlatmaz/durdurmaz.
 *  · **GÜVENLİK OTORİTESİ DEĞİLDİR** — onay/hareket/politika kararı vermez.
 *  · **İKİNCİ GERÇEKLİK KAYNAĞI KURMAZ** — kendi durumunu tutmaz; alan
 *    otoritelerini (`navigationService` · `playbackTruth` · ayar deposu) OKUR.
 *    Alan otoritesiyle çelişirse KAZANAN daima alan otoritesidir.
 *  · **KANIT YOKSA İDDİA ÜRETMEZ** — `UNKNOWN`/`ACCEPTED` olduğu gibi kalır.
 *  · **ZAMAN AŞIMI BAŞARIYA DÖNÜŞMEZ** — süresi dolan bekleyen gözlem
 *    `UNKNOWN` kapanır, ASLA `EXECUTED`/`OBSERVED` olmaz.
 *  · **BAYAT KANIT YENİ TURA BAĞLANMAZ** — kanıtın zaman damgası isteğin
 *    damgasından ÖNCEyse `STALE`dir ve hiçbir seviyeyi değiştiremez.
 *
 * ── SAFLIK ──────────────────────────────────────────────────────────────────
 * Yalnız tip import eder. I/O · timer · `Date.now` · global durum · React YOK.
 * Tüm zaman değerleri parametre olarak girer.
 */

import type {
  CapabilityFailure, CapabilityObservation, FabricDomain, ObservationCeiling,
} from '../fabric/capabilityContract';

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt kaynağı — BOUNDED
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir gözlem seviyesinin HANGİ gerçeklikten geldiği.
 *
 * `EXECUTOR_RESULT` bilinçli olarak ayrı tutulur: yürütücünün kendi dönüşü
 * BAĞIMSIZ kanıt DEĞİLDİR (aynı kodun kendisi hakkındaki beyanıdır). Yalnız
 * diğer kaynaklar bağımsız gözlemdir.
 */
export type ObservationSource =
  /** Kanonik `IntentExecutionResult` — bağımsız kanıt DEĞİL, taban. */
  | 'EXECUTOR_RESULT'
  /** `navigationService` hedef sahiplik defteri (rota gerçekten kuruldu mu). */
  | 'NAV_DESTINATION'
  /** `playbackTruth` → `mediaAuthorityEvidence` kaydı (tek medya gerçeği). */
  | 'PLAYBACK_TRUTH'
  /** Ayar deposundan GERİ OKUMA (yazılan değer gerçekten okundu mu). */
  | 'SETTINGS_STORE'
  /** Bu alanda bağımsız gözlem kaynağı YOK — dürüstçe bildirilir. */
  | 'NONE';

/** Kanıtın bu tura ait olup olmadığı. */
export type ObservationFreshness =
  /** Kanıt isteğin ARDINDAN üretildi → bu tura bağlanabilir. */
  | 'FRESH'
  /** Kanıt isteğin ÖNCESİNDEN → başka bir tura aittir, KULLANILMAZ. */
  | 'STALE'
  /** Zaman damgası yok / karşılaştırılamadı → KULLANILMAZ. */
  | 'UNKNOWN';

/** Bir alan otoritesinden okunan kanıt zarfı. */
export interface DomainEvidence {
  readonly source: ObservationSource;
  /** `null` = kanıt YOK (iddia üretilmez). */
  readonly level: CapabilityObservation | null;
  readonly freshness: ObservationFreshness;
  /** Bounded hata sınıfı (varsa) — serbest metin TAŞIMAZ. */
  readonly failure: CapabilityFailure | null;
}

/** Kanıt yok — her adapter'ın güvenli dönüşü. */
export const NO_EVIDENCE: DomainEvidence = Object.freeze({
  source: 'NONE' as ObservationSource,
  level: null,
  freshness: 'UNKNOWN' as ObservationFreshness,
  failure: null,
});

export function evidenceOf(
  source: ObservationSource,
  level: CapabilityObservation | null,
  freshness: ObservationFreshness,
  failure: CapabilityFailure | null = null,
): DomainEvidence {
  return Object.freeze({ source, level, freshness, failure });
}

/**
 * Kanıt tazeliği — **tek karar noktası**. Kanıtın damgası isteğin damgasından
 * önceyse o kanıt BAŞKA bir tura aittir ve bu tura bağlanamaz.
 */
export function freshnessOf(
  evidenceAtMs: number | null, requestedAtMs: number,
): ObservationFreshness {
  if (evidenceAtMs === null || !Number.isFinite(evidenceAtMs)) return 'UNKNOWN';
  if (!Number.isFinite(requestedAtMs)) return 'UNKNOWN';
  return evidenceAtMs >= requestedAtMs ? 'FRESH' : 'STALE';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Dürüstlük tavanı
 * ════════════════════════════════════════════════════════════════════════ */

/** Başarı merdiveni — yalnız BAŞARI iddiaları sıralıdır. */
const SUCCESS_RANK: Readonly<Record<string, number>> = Object.freeze({
  ACCEPTED: 1, EXECUTED: 2, OBSERVED: 3,
});

function rankOf(o: CapabilityObservation | ObservationCeiling): number {
  return SUCCESS_RANK[o] ?? 0;
}

/**
 * Bir seviyeyi işlemin dürüstlük tavanına indirir.
 * Tavan yalnız BAŞARI iddiasını sınırlar; hata/iptal seviyelerine DOKUNMAZ.
 */
export function capToCeiling(
  level: CapabilityObservation, ceiling: ObservationCeiling,
): CapabilityObservation {
  if (rankOf(level) === 0) return level;                 // FAILED · UNKNOWN · …
  return rankOf(level) > rankOf(ceiling) ? ceiling : level;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Uzlaştırma (reconciliation)
 * ════════════════════════════════════════════════════════════════════════ */

export interface ReconcileInput {
  /** Yürütücüden türetilmiş taban seviye (tavan zaten uygulanmış). */
  readonly base: CapabilityObservation;
  readonly evidence: DomainEvidence;
  readonly ceiling: ObservationCeiling;
}

export interface ReconciledObservation {
  readonly level: CapabilityObservation;
  /** Nihai seviyeyi HANGİ kaynak belirledi. */
  readonly source: ObservationSource;
  /** Bağımsız kanıt bir BAŞARI iddiasını düşürdü mü (dürüstlük ölçümü). */
  readonly downgraded: boolean;
  /** Bağımsız kanıt seviyeyi yükseltti mi. */
  readonly upgraded: boolean;
  readonly failure: CapabilityFailure | null;
}

function outcome(
  level: CapabilityObservation, source: ObservationSource,
  base: CapabilityObservation, failure: CapabilityFailure | null,
): ReconciledObservation {
  return Object.freeze({
    level, source,
    downgraded: rankOf(base) > 0 && rankOf(level) < rankOf(base),
    upgraded: rankOf(level) > rankOf(base),
    failure,
  });
}

/**
 * Taban seviye ile bağımsız kanıtı uzlaştırır.
 *
 * **KURALLAR (kilitli — sıra önemlidir):**
 *  1. `CANCELLED` / `REQUESTED` taban TERMİNALDİR — iptal ve onay-bekleme bu
 *     turun gerçeğidir; sonradan gelen kanıt onları geçersiz KILAMAZ.
 *  2. `FAILED` taban yükseltilemez — yürütücü açıkça düştüyse bağımsız kanıt
 *     onu başarıya ÇEVİREMEZ (aksi hâlde hata gizlenirdi).
 *  3. Kanıt yoksa ya da **FRESH değilse** taban AYNEN kalır. Bayat kanıt ve
 *     zaman aşımı hiçbir seviyeyi değiştirmez.
 *  4. Kanıt `FAILED`/`CANCELLED` ise KAZANIR — alan otoritesi yürütücünün
 *     iyimser dönüşünü EZER (sahte başarının kapandığı yer).
 *  5. Kanıt `UNKNOWN`/`REQUESTED` ise başarı iddiası `ACCEPTED`e DÜŞÜRÜLÜR:
 *     iş teslim edildi ama doğrulanamadı.
 *  6. Kanıt BAŞARI taşıyorsa **kanıt yönetir** (tavana indirilerek): hem
 *     yükseltebilir hem SINIRLAYABİLİR. Yürütücünün iyimser beyanı alan
 *     otoritesini EZEMEZ.
 */
export function reconcileObservation(input: ReconcileInput): ReconciledObservation {
  const base = input.base;
  const ev = input.evidence;

  if (base === 'CANCELLED' || base === 'REQUESTED') {
    return outcome(base, 'EXECUTOR_RESULT', base, ev.failure);
  }
  if (base === 'FAILED') {
    return outcome('FAILED', 'EXECUTOR_RESULT', base, ev.failure ?? 'EXECUTION_FAILED');
  }
  if (ev.level === null || ev.freshness !== 'FRESH') {
    return outcome(base, 'EXECUTOR_RESULT', base, null);
  }
  if (ev.level === 'FAILED') {
    return outcome('FAILED', ev.source, base, ev.failure ?? 'EXECUTION_FAILED');
  }
  if (ev.level === 'CANCELLED') {
    return outcome('CANCELLED', ev.source, base, ev.failure ?? 'CANCELLED');
  }
  if (ev.level === 'UNKNOWN' || ev.level === 'REQUESTED') {
    /* Bağımsız kaynak "olduğunu göremiyorum" diyor → başarı iddiası düşer. */
    if (rankOf(base) >= rankOf('EXECUTED')) {
      return outcome('ACCEPTED', ev.source, base, ev.failure ?? 'OBSERVATION_UNKNOWN');
    }
    return outcome(base, 'EXECUTOR_RESULT', base, ev.failure);
  }

  /* Kanıt BAŞARI taşıyor → **ALAN OTORİTESİ YÖNETİR.**
   * Burada `max(base, kanıt)` ALINMAZ. Alınsaydı yürütücünün iyimser
   * `EXECUTED` beyanı, alan otoritesinin "teslim ettim ama doğrulayamıyorum"
   * (`ACCEPTED`) gerçeğini EZERDİ — F7'nin kapattığı kusurun ta kendisi.
   * Kanıt hem YÜKSELTİR hem SINIRLAR; tavan yine de aşılamaz. */
  const capped = capToCeiling(ev.level, input.ceiling);
  return outcome(capped, ev.source, base, null);
}

/* ══════════════════════════════════════════════════════════════════════════
 * AYAR PORTU KANITI — F5'in açık "sahte-ACK" borcunun kapandığı sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * `applySetting` portunun DÖNDÜRDÜĞÜ kanıt.
 *
 * **NEDEN VAR (F5 borcu, kütük #986/b):** port `void` dönüyordu ve yürütücü
 * porta ULAŞSA DA ULAŞMASA DA koşulsuz *"Ayar uygulandı"* diyordu. Port hiç
 * bağlanmamışsa bile kullanıcı ayarın değiştiğini duyuyordu. Artık port ne
 * yaptığını BİLDİRİR ve kanıt üretemediğinde bunu DÜRÜSTÇE söyler.
 *
 * **GİZLİLİK:** yalnız ayar ANAHTARI (kayıt sabiti) ve bounded sınıf taşınır;
 * ayarın DEĞERİ bu zarfa GİRMEZ.
 */
export type SettingApplyEvidence =
  /** Değer yazıldı ve depodan GERİ OKUNDU → bağımsız gözlem. */
  | { readonly kind: 'APPLIED'; readonly key: string }
  /** Komut gönderildi ama kanıt DÖNMÜYOR (ör. native WiFi/Bluetooth). */
  | { readonly kind: 'DELIVERED'; readonly key: string }
  /** Yalnız ilgili ayar yüzeyi açıldı — **ayar UYGULANMADI**. */
  | { readonly kind: 'SURFACE_OPENED'; readonly key: string }
  /** Uygulanamadı (değer yok · geri okuma tutmadı · anahtar tanınmadı). */
  | { readonly kind: 'REJECTED'; readonly key: string; readonly reason: string };

/** Ayar kanıtını gözlem seviyesine çevirir — SAF, tavan çağıranda uygulanır. */
export function evidenceFromSettingApply(
  e: SettingApplyEvidence | null | undefined,
): DomainEvidence {
  if (!e) {
    /* Port HİÇ YOK / hiç çağrılmadı → başarı iddiası kurulamaz. */
    return evidenceOf('NONE', 'FAILED', 'FRESH', 'EXECUTION_FAILED');
  }
  switch (e.kind) {
    case 'APPLIED':        return evidenceOf('SETTINGS_STORE', 'OBSERVED', 'FRESH');
    case 'DELIVERED':      return evidenceOf('NONE', 'ACCEPTED', 'FRESH');
    case 'SURFACE_OPENED': return evidenceOf('NONE', 'ACCEPTED', 'FRESH');
    case 'REJECTED':       return evidenceOf('SETTINGS_STORE', 'FAILED', 'FRESH', 'EXECUTION_FAILED');
    default:               return NO_EVIDENCE;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bekleyen gözlem (deferred) — BOUNDED sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kanıtı YÜRÜTME ANINDA doğmayan alanlar için bekleyen kayıt.
 *
 * **NEDEN GEREKLİ:** navigasyonda rota isteği asenkrondur (geocode → rota).
 * Yürütücü döndüğünde hedef defterinde HENÜZ kayıt yoktur. Bekleyen gözlem bu
 * gerçeği ÖLÇER; **söylenmiş cümleyi DEĞİŞTİRMEZ** — bu yüzden konuşma metni
 * zaten `ACCEPTED` seviyesindedir ve doğrulama İDDİA ETMEZ. Sonradan gelen
 * kanıt yalnız KAYDI (LAB/telemetri) dürüstleştirir.
 *
 * **BAĞLAMA (correlation):** `turnId` + `requestedAtMs` + alan tabanı birlikte
 * taşınır. Kanıt yalnız `tsMs >= requestedAtMs` olduğunda bağlanır → geç gelen
 * kanıt YANLIŞ tura yazılamaz.
 */
export interface PendingObservation {
  readonly key: string;
  readonly capabilityId: string;
  readonly operation: string;
  readonly domain: FabricDomain;
  readonly ceiling: ObservationCeiling;
  /** Tur kimliği — `null` ise bağlama YALNIZ zaman damgasıyla yapılır. */
  readonly turnId: string | null;
  readonly requestedAtMs: number;
  /** Bu andan sonra kanıt beklenmez; kayıt `UNKNOWN` kapanır. */
  readonly deadlineMs: number;
  /** Alan tabanı (ör. hedef defteri uzunluğu) — kanıt bunun ÜSTÜNE aranır. */
  readonly baseline: number;
  readonly base: CapabilityObservation;
}

/** Bekleyen kaydın kapanış sınıfı — BOUNDED. */
export type PendingSettlement =
  /** Kanıt geldi ve bu tura bağlandı. */
  | 'EVIDENCE'
  /** Süre doldu, kanıt YOK → `UNKNOWN` (ASLA başarı). */
  | 'EXPIRED'
  /** Bounded kuyrukta yer açmak için düşürüldü → `UNKNOWN`. */
  | 'EVICTED';

/**
 * Kanıtsız kapanış — **başarıya ASLA dönüşmez** (kilitli).
 * Zaten terminal olan taban (FAILED/CANCELLED/REQUESTED) korunur; başarı
 * iddiası taşıyan taban `UNKNOWN`a düşürülür.
 */
export function settleWithoutEvidence(p: PendingObservation): ReconciledObservation {
  const terminal = p.base === 'CANCELLED' || p.base === 'REQUESTED' || p.base === 'FAILED';
  const level: CapabilityObservation = terminal ? p.base : 'UNKNOWN';
  return outcome(level, 'NONE', p.base, terminal ? null : 'OBSERVATION_UNKNOWN');
}
