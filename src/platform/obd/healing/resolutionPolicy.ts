/**
 * resolutionPolicy — P0-VDK-F5A · GÜVENLİ ÖLÇÜM ADAYLARI ve DETERMİNİSTİK SEÇİM.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU KÖR YENİDEN DENEME DEĞİLDİR ────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Kör retry "aynı şeyi bir daha yap"tır. Buradaki politika şunu sorar:
 *   1. Boşluğun KÖK NEDENİ ne?
 *   2. O kök nedeni AZALTABİLECEK hangi GÜVENLİ ölçümler var?
 *   3. Hangisi en çok belirsizliği en az maliyetle ve en az riskle azaltır?
 *   4. O yol daha önce AYNI sonuçla başarısız oldu mu?
 *
 * Rastgelelik YOK · AI sezgisi YOK · olasılıksal ağırlık YOK.
 * Skor formülü AÇIK, tam sayı aritmetiğiyle ve test edilebilir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── GÜVENLİK (PAZARLIKSIZ) ────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bu politika **hiçbir koşulda** destructive bir aksiyon üretemez. Aday
 * kümesi zaten yalnız OKUMA/ölçüm eylemlerinden oluşur; ayrıca
 * `assertCandidateSafe` MEVCUT `DESTRUCTIVE_SERVICES` aynasına karşı ikinci
 * bir kapı kurar. TS bozulsa bile F4-A native kapısı üçüncü kapıdır.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import { DESTRUCTIVE_SERVICES, GENERIC_READ_ONLY_SERVICES } from '../genericPduTransport';
import { HARD_FORBIDDEN_SERVICES } from '../discovery/discoverySafetyPolicy';
import type { GapClass, ResolvableGap, RootCauseClass } from './gapModel';
import { isMeasurementResolvable } from './gapModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) KÖK NEDEN SINIFLANDIRMASI
   ══════════════════════════════════════════════════════════════════════════ */

/** NRC 0x11 — serviceNotSupported. Kanıtlı YOK demektir (ISO 14229-1 A.1). */
export const NRC_SERVICE_NOT_SUPPORTED = 0x11;
/** NRC 0x12 — subFunctionNotSupported. Servis VAR, alt fonksiyon yok. */
export const NRC_SUBFUNCTION_NOT_SUPPORTED = 0x12;

/**
 * Boşluğu kök neden sınıfına eşler.
 *
 * ⚠️ EN ÖNEMLİ KURAL: `lastNrc === 0x11` KANITLI YOKLUKTUR. Bir boşluk
 * kaydı olsa bile bu NRC varsa yeniden ölçüm bir şey ÖĞRETMEZ — kök neden
 * `UNKNOWN` değil, ölçüm gerektirmeyen bir araç sınırıdır. Politika bunu
 * `NO_SAFE_ACTION` ile karşılar (aşağıda) ve gereksiz yoklama üretmez.
 */
export function classifyRootCause(gap: ResolvableGap): RootCauseClass {
  if (gap.origin === 'CAPABILITY_CONFLICT') return 'CAPABILITY_CONTESTED';
  if (gap.origin === 'CAPABILITY_STALE') return 'CAPABILITY_STALE';

  /* Taşıma sınırı, sınıfından ÖNCE gelir: köprü taşıyamadıysa araç hakkında
     hiçbir şey ölçülmedi ve "yetenek yok" demek en pahalı yalandır. */
  if (gap.transportLimited) return 'TRANSPORT_BOUND';

  const c: GapClass = gap.gapClass;
  switch (c) {
    case 'TRANSPORT_LIMITATION':
      return 'TRANSPORT_BOUND';
    case 'PARSER_GAP':
    case 'PARSER_PARITY_MISMATCH':
    case 'MALFORMED_DTC_BODY':
    case 'UNEXPECTED_SID':
    case 'LEGACY_NATIVE_ONLY':
      return 'PARSER_BOUND';
    case 'UNKNOWN_ECU_ATTRIBUTION':
    case 'UNKNOWN_ECU_VARIANT':
      return 'ATTRIBUTION_UNRESOLVED';
    case 'UNKNOWN_SERVICE':
    case 'UNKNOWN_SUBFUNCTION':
    case 'UNKNOWN_RESPONSE_SHAPE':
    case 'CAPABILITY_GAP':
      return gap.sessionConditioned ? 'SESSION_CONDITIONED' : 'CAPABILITY_UNMEASURED';
    default:
      return 'UNKNOWN';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   2) ADAY SÖZLÜĞÜ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Güvenli ölçüm adayları.
 *
 * Hepsi OKUMA ya da OKUMA-eşdeğeri ölçümlerdir. Yazma · aktüatör · kodlama ·
 * güvenlik erişimi · reset · silme adayı **YOKTUR ve EKLENEMEZ**.
 */
export type MeasurementCandidateKind =
  /** Servis varlığını yeniden yokla (F4-B `runServiceDiscovery`). */
  | 'REPROBE_SERVICE'
  /** Alt fonksiyon varlığını yeniden yokla (servis varlığı kanıtlıyken). */
  | 'REPROBE_SUBFUNCTION'
  /** Tanı oturumunu yeniden aç (F1-B kirası). */
  | 'REOPEN_SESSION'
  /** TesterPresent canlılığını doğrula (F1-B keepalive kanıtı). */
  | 'VERIFY_TESTER_PRESENT'
  /** ISO-TP akış kontrolü uygulanmış hâlde yeniden ölç (F1-C). */
  | 'APPLY_ISOTP_TUNING'
  /** Tuning sonrası geri yükleme gerçekten oldu mu (F1-C restore kanıtı). */
  | 'VERIFY_ISOTP_RESTORE'
  /** Güvenli bütçe içinde süreyi artırıp yeniden ölç. */
  | 'INCREASE_TIMEOUT_WITHIN_SAFE_BUDGET'
  /** Yanıtın sahibini fiziksel adresle doğrula. */
  | 'VERIFY_ECU_ATTRIBUTION'
  /** Ham izin bir kez daha toplanmasını iste (çözücü onarımı için girdi). */
  | 'REQUEST_ADDITIONAL_RAW_TRACE'
  /** ECU kimlik/varyant kanıtı topla (salt-okunur kimlik servisleri). */
  | 'DISCOVER_VARIANT_EVIDENCE'
  /** Güvenli hiçbir ölçüm yok — israf üretmek yerine dur. */
  | 'NO_SAFE_ACTION'
  /** Sınıflandırılamadı. FAIL-CLOSED. */
  | 'UNKNOWN';

export const CANDIDATE_LABEL: Readonly<Record<MeasurementCandidateKind, string>> = {
  REPROBE_SERVICE:                     'servisi yeniden yokla',
  REPROBE_SUBFUNCTION:                 'alt fonksiyonu yeniden yokla',
  REOPEN_SESSION:                      'tanı oturumunu yeniden aç',
  VERIFY_TESTER_PRESENT:               'TesterPresent canlılığını doğrula',
  APPLY_ISOTP_TUNING:                  'ISO-TP akış kontrolüyle yeniden ölç',
  VERIFY_ISOTP_RESTORE:                'ISO-TP geri yüklemesini doğrula',
  INCREASE_TIMEOUT_WITHIN_SAFE_BUDGET: 'güvenli bütçede süreyi artırıp ölç',
  VERIFY_ECU_ATTRIBUTION:              'ECU atfını fiziksel adresle doğrula',
  REQUEST_ADDITIONAL_RAW_TRACE:        'ek ham iz topla',
  DISCOVER_VARIANT_EVIDENCE:           'ECU varyant kanıtı topla',
  NO_SAFE_ACTION:                      'GÜVENLİ ÖLÇÜM YOK — israf üretilmez',
  UNKNOWN:                             'BİLİNMİYOR',
} as const;

/**
 * Bu fazda GERÇEKTEN hatta çıkabilen adaylar.
 *
 * F5A yalnız SALT-OKUNUR ölçüm çalıştırır ve bunların hepsi MEVCUT F4-B
 * `runServiceDiscovery` yolundan geçer — resolver kendi PDU motorunu KURMAZ.
 *
 * Dışarıda kalanlar yanlış ya da gereksiz DEĞİLDİR; ön koşulları bu fazın
 * kapsamı dışındadır (oturum durumu değiştirmek · ham iz kanalı açmak ·
 * zaman aşımı bütçesini oynatmak). Seçilirlerse boşluk `BLOCKED` olur ve
 * gerekçe AÇIKÇA kaydedilir — sessizce `RESOLVED` sayılmaz.
 */
export const EXECUTABLE_CANDIDATES: ReadonlySet<MeasurementCandidateKind> =
  Object.freeze(new Set<MeasurementCandidateKind>([
    'REPROBE_SERVICE',
    'REPROBE_SUBFUNCTION',
    'APPLY_ISOTP_TUNING',
    'VERIFY_ECU_ATTRIBUTION',
    'DISCOVER_VARIANT_EVIDENCE',
    /* ── P0-VDK-F5C ────────────────────────────────────────────────────────
       Oturum-koşullu ölçümler artık çalıştırılabilir — ama YALNIZ ölçülmüş
       oturum kanıtı varsa (`CandidateContext.sessionEvidenceAvailable`).
       "Yeniden aç" demek TS'ten kör `10 xx` göndermek DEĞİLDİR: asıl
       salt-okunur yoklama normal F4-B yolundan tekrarlanır ve oturum,
       gerekiyorsa, native'in ATOMİK `SESSION_REQUIRED` dalında açılır. */
    'REOPEN_SESSION',
    'VERIFY_TESTER_PRESENT',
  ]));

/** Risk derecesi — düşük olan tercih edilir. Yalnız ölçüm riski, araç riski DEĞİL. */
export type CandidateRisk = 'NONE' | 'LOW' | 'MEDIUM';

const RISK_WEIGHT: Readonly<Record<CandidateRisk, number>> = {
  NONE: 0, LOW: 1, MEDIUM: 3,
} as const;

export interface MeasurementCandidate {
  readonly kind: MeasurementCandidateKind;
  /** Hangi kök nedeni azaltabilir. */
  readonly addresses: RootCauseClass;
  /** Ön koşul sağlandı mı — sağlanmadıysa çalıştırılmaz. */
  readonly prerequisiteMet: boolean;
  /** Ön koşul metni (sağlansa da sağlanmasa da AÇIK yazılır). */
  readonly prerequisite: string;
  /** Bu ölçüm başarılı olursa hangi kanıt beklenir. */
  readonly expectedEvidence: string;
  /** Tahmini istek maliyeti (adet) — bütçe muhasebesi. */
  readonly requestCost: number;
  /** Tahmini süre maliyeti (ms) — bütçe muhasebesi. */
  readonly timeCostMs: number;
  readonly risk: CandidateRisk;
  /** Belirsizlik azaltma kazancı (0–10, deterministik). */
  readonly informationGain: number;
  /** Bu boşluk için bu aday daha önce kaç kez denendi. */
  readonly priorAttempts: number;
  /** Bu fazda hatta çıkabilir mi. */
  readonly executable: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) GÜVENLİK KAPISI — aday üretiminin İKİNCİ kilidi
   ══════════════════════════════════════════════════════════════════════════ */

const DESTRUCTIVE_SET: ReadonlySet<string> = Object.freeze(
  new Set(DESTRUCTIVE_SERVICES.map((s) => s.toUpperCase())),
);

/**
 * Bir adayın hedef servisinin güvenli olup olmadığı.
 *
 * FAIL-CLOSED: destructive kümede olan · keşif kara listesinde olan ya da
 * genel köprü beyaz listesinde OLMAYAN hiçbir servis için aday üretilmez.
 * Üç bağımsız kontrol; biri diğerinin yerine geçmez.
 */
export function isServiceSafeForHealing(service: string | null): boolean {
  if (service === null) return false;
  const s = service.trim().toUpperCase();
  if (s.length !== 2) return false;
  if (DESTRUCTIVE_SET.has(s)) return false;
  if (HARD_FORBIDDEN_SERVICES.has(s)) return false;
  return GENERIC_READ_ONLY_SERVICES.has(s);
}

/**
 * Üretilmiş bir aday listesini denetler.
 *
 * Bu fonksiyon bir TESTTİR, üretim yolunda da çağrılır: politika bozulsa bile
 * destructive bir aday dışarı sızamaz.
 */
export function assertCandidatesSafe(
  gap: ResolvableGap, candidates: readonly MeasurementCandidate[],
): readonly MeasurementCandidate[] {
  if (candidates.length === 0) return candidates;
  /* Hatta çıkacak her aday hedefli olmak zorundadır ve hedef servis güvenli
     olmalıdır. Hedefsiz "kör tarama" adayı bu kapıdan geçemez. */
  const safe = candidates.filter((c) => {
    if (!EXECUTABLE_CANDIDATES.has(c.kind)) return true;   // hatta çıkmayan aday
    if (!isServiceSafeForHealing(gap.target.service)) return false;
    /* ── P0-VDK-F6D-2 · İKİNCİ KAPI (aynı otorite, yeni otorite DEĞİL) ────
       Atıf boşluğunda hedef ECU bilinmiyorsa hiçbir aday hatta ÇIKAMAZ.
       Yukarıdaki `candidatesFor` kapısı zaten üretmiyor; bu kat, ileride
       biri oraya yeni bir executable aday eklerse **sessizce sızmasını**
       engeller. Kapsam DAR: yalnız atıf sınıfı. */
    if (gap.gapClass === 'UNKNOWN_ECU_ATTRIBUTION') {
      return typeof gap.target.ecuKey === 'string' && gap.target.ecuKey.length > 0;
    }
    return true;
  });
  return safe;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ANTİ-DÖNGÜ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Aynı (boşluk + aday + gözlenen sonuç) üçlüsü için deneme TAVANI.
 *
 * `2` bilinçlidir: bir ölçüm tek seferlik bir hat gürültüsünden düşmüş
 * olabilir, ikincisi bunu eler. Üçüncü deneme yeni bilgi ÜRETMEZ — yalnız
 * araca trafik bindirir. Tavan aşılınca boşluk `EXHAUSTED` olur ve YENİ
 * CANLI KANIT gelmeden yeniden başlamaz.
 */
export const MAX_ATTEMPTS_PER_TRIPLE = 2;

/** Bir boşluk için TOPLAM deneme tavanı (farklı adaylar dâhil). */
export const MAX_ATTEMPTS_PER_GAP = 4;

/** Anti-döngü defterinin anahtarı — üçlü DETERMİNİSTİKTİR. */
export function attemptKey(
  gapKeyValue: string, kind: MeasurementCandidateKind, observedOutcome: string,
): string {
  return `${gapKeyValue}|${kind}|${observedOutcome}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ADAY ÜRETİMİ
   ══════════════════════════════════════════════════════════════════════════ */

export interface CandidateContext {
  /** Aktif protokol CAN mı — ISO-TP tuning yalnız CAN'de anlamlıdır. */
  readonly isCan: boolean;
  /** Genel köprü var mı (F4-A). Yoksa hedefli PDU ölçümü yapılamaz. */
  readonly genericBridge: boolean;
  /** Hedefin adreslenebilirliği KANITLI mı (KWP fail-closed). */
  readonly targetVerified: boolean;
  /** Bu boşluk+aday çifti daha önce kaç kez aynı sonuçla denendi. */
  readonly priorAttemptsFor: (kind: MeasurementCandidateKind) => number;
  /**
   * P0-VDK-F5C — bu boşlukta ÖLÇÜLMÜŞ oturum kanıtı var mı.
   *
   * `false` ise oturum adayları listede KALIR ama ön koşulu sağlanmaz ve
   * `BLOCKED` olur: hangi oturumun açılacağı bilinmeden istek gönderilmez
   * (magic session byte YASAK).
   */
  readonly sessionEvidenceAvailable?: boolean;
}

function _c(
  kind: MeasurementCandidateKind, addresses: RootCauseClass,
  prerequisiteMet: boolean, prerequisite: string, expectedEvidence: string,
  requestCost: number, timeCostMs: number, risk: CandidateRisk,
  informationGain: number, priorAttempts: number,
): MeasurementCandidate {
  return Object.freeze({
    kind, addresses, prerequisiteMet, prerequisite, expectedEvidence,
    requestCost, timeCostMs, risk, informationGain, priorAttempts,
    executable: EXECUTABLE_CANDIDATES.has(kind) && prerequisiteMet,
  });
}

/**
 * Bir boşluk için güvenli ölçüm adaylarını üretir.
 *
 * Aday üretmek bir ÖLÇÜM DEĞİLDİR — hiçbir şey hatta çıkmaz. Liste boş
 * dönerse çağıran `NO_SAFE_ACTION` görür ve boşluğu israfla yıpratmaz.
 */
export function candidatesFor(
  gap: ResolvableGap, root: RootCauseClass, ctx: CandidateContext,
): readonly MeasurementCandidate[] {
  /* KANITLI YOKLUK: ECU "bu servis yok" dedi. Yeniden sormak yeni bilgi
     üretmez; bu, F4-C'nin kanıtlı ABSENT kuralının ölçüm tarafındaki
     karşılığıdır. Aday ÜRETİLMEZ. */
  if (gap.lastNrc === NRC_SERVICE_NOT_SUPPORTED && gap.gapClass !== 'UNKNOWN_SUBFUNCTION') {
    return [];
  }
  /* Çözücü kusuru ölçümle kapanmaz — yeniden sormak aynı baytı getirir. */
  if (!isMeasurementResolvable(root)) {
    return root === 'PARSER_BOUND'
      ? [_c('REQUEST_ADDITIONAL_RAW_TRACE', root, false,
        'ham iz kanalı bu fazda açık değil',
        'çözücü onarımı için ek ham gövde', 1, 400, 'NONE', 4,
        ctx.priorAttemptsFor('REQUEST_ADDITIONAL_RAW_TRACE'))]
      : [];
  }
  /* Hedefsiz boşluk ölçülemez — kör ECU/adres taraması YASAKTIR. */
  const hasTarget = isServiceSafeForHealing(gap.target.service);
  const bridge = ctx.genericBridge;
  const out: MeasurementCandidate[] = [];

  const preOk = hasTarget && bridge && ctx.targetVerified;
  const preText = !hasTarget ? 'hedef servis yok/güvenli değil'
    : !bridge ? 'genel PDU köprüsü yok'
      : !ctx.targetVerified ? 'hedef adreslenebilirliği kanıtlı değil'
        : 'hedef güvenli · köprü var · adres kanıtlı';

  switch (root) {
    case 'CAPABILITY_UNMEASURED':
    case 'CAPABILITY_STALE':
    case 'CAPABILITY_CONTESTED': {
      const isSub = gap.gapClass === 'UNKNOWN_SUBFUNCTION'
        || gap.target.subFunction !== null;
      const gain = root === 'CAPABILITY_CONTESTED' ? 9
        : root === 'CAPABILITY_STALE' ? 6 : 8;
      out.push(_c(
        isSub ? 'REPROBE_SUBFUNCTION' : 'REPROBE_SERVICE', root, preOk, preText,
        isSub ? 'alt fonksiyon için PRESENT/ABSENT sınıflandırması'
          : 'servis için PRESENT/ABSENT sınıflandırması',
        1, 300, 'NONE', gain,
        ctx.priorAttemptsFor(isSub ? 'REPROBE_SUBFUNCTION' : 'REPROBE_SERVICE'),
      ));
      break;
    }

    case 'SESSION_CONDITIONED': {
      /* P0-VDK-F5C — erişim oturuma bağlı. Doğru ölçüm, asıl yoklamayı oturum
         AÇIKKEN tekrarlamaktır; oturum native'in atomik dalında açılır.
         ÖN KOŞUL: ölçülmüş oturum kanıtı (komut ya da oturum ailesi NRC). */
      const sessionOk = ctx.sessionEvidenceAvailable === true;
      const sessionPre = sessionOk
        ? 'ölçülmüş oturum kanıtı var · hedef güvenli · köprü var'
        : 'ölçülmüş oturum kanıtı YOK — kör 10 xx gönderilmez';
      out.push(_c('REOPEN_SESSION', root, sessionOk && preOk, sessionPre,
        'oturum açık hâlde asıl yoklamanın pozitif yanıtı', 2, 700, 'LOW', 9,
        ctx.priorAttemptsFor('REOPEN_SESSION')));
      out.push(_c('VERIFY_TESTER_PRESENT', root, sessionOk && preOk, sessionPre,
        'oturum canlılığı kanıtı (3E → 7E 00)', 1, 200, 'NONE', 5,
        ctx.priorAttemptsFor('VERIFY_TESTER_PRESENT')));
      /* Oturumdan bağımsız olarak yeniden yoklama YİNE de bilgi üretebilir
         (koşul değişmiş olabilir) — düşük kazanç, sıfır risk. */
      out.push(_c('REPROBE_SERVICE', root, preOk, preText,
        'koşul değiştiyse pozitif yanıt', 1, 300, 'NONE', 4,
        ctx.priorAttemptsFor('REPROBE_SERVICE')));
      break;
    }

    case 'TRANSPORT_BOUND': {
      /* ⚠️ TAŞIMA SINIRI ARAÇ SINIRI DEĞİLDİR: burada "unsupported" ilan
         edilmez. CAN'de akış kontrolü ölçümü denenir; CAN değilse güvenli
         ölçüm yoktur ve bu DÜRÜSTÇE söylenir. */
      if (ctx.isCan) {
        out.push(_c('APPLY_ISOTP_TUNING', root, preOk, preText,
          'tam çok-frame yanıt (BUFFER_FULL/TRUNCATED yok)', 1, 450, 'LOW', 8,
          ctx.priorAttemptsFor('APPLY_ISOTP_TUNING')));
        out.push(_c('VERIFY_ISOTP_RESTORE', root, false,
          'geri yükleme doğrulaması F5A kapsamı dışında',
          'tuning sonrası ayarların geri alındığı kanıtı', 1, 200, 'NONE', 3,
          ctx.priorAttemptsFor('VERIFY_ISOTP_RESTORE')));
      }
      out.push(_c('INCREASE_TIMEOUT_WITHIN_SAFE_BUDGET', root, false,
        'zaman aşımı bütçesi oynatmak F5A kapsamı dışında',
        'daha uzun beklemede tamamlanan yanıt', 1, 900, 'LOW', 5,
        ctx.priorAttemptsFor('INCREASE_TIMEOUT_WITHIN_SAFE_BUDGET')));
      break;
    }

    case 'ATTRIBUTION_UNRESOLVED': {
      /* ── P0-VDK-F6D-2 · HEDEFSİZ ATIF ÖLÇÜLEMEZ ───────────────────
         ══════════════════════════════════════════════════════════════
         ÖLÇÜLEN KUSUR: yukarıdaki `hasTarget` YALNIZ **servisi** sınar
         (`isServiceSafeForHealing(gap.target.service)`) — **ECU'yu sınamaz.**
         Fonksiyonel (7DF) atıf boşluğunda servis bellidir (`03`) ama SAHİP
         bilinmez; `hasTarget` yine `true` çıkıyor, `VERIFY_ECU_ATTRIBUTION`
         `executable` oluyor ve çözücü ölçümü **taramanın hedef ECU'suna**
         (`input.ecu`) gönderiyordu — yani boşluğun sahibi olmayan bir ECU'ya.
         Sonuç: 1 istek harcanır, hiçbir atıf kanıtı üretilmez.

         ATıF boşluğunun TANIMI "sahibi bilinmiyor"dur; hedef olarak taramanın
         ECU'sunu kullanmak sorunun kendisini cevap sanmaktır. `ecuKey`
         UYDURULMAZ → güvenli ölçüm YOKTUR.

         KAPSAM DAR: bu kapı YALNIZ atıf dalındadır. Diğer kök nedenlerde
         `ecuKey === null` MEŞRUDUR (ör. `discovery:<svc>` bağlamından gelen
         yetenek boşluğu: soru "bu serviste ne var", "kim cevapladı" DEĞİL)
         ve oradaki davranış BİREBİR korunur. */
      const ownerKnown = typeof gap.target.ecuKey === 'string'
        && gap.target.ecuKey.length > 0;
      if (!ownerKnown) {
        return assertCandidatesSafe(gap, [_c('NO_SAFE_ACTION', root, false,
          'atıf hedefi (ECU) BİLİNMİYOR — adres UYDURULMAZ, tarama ECU’su '
          + 'atıf hedefi SAYILMAZ',
          'sahibi ölçülmüş bir fiziksel yanıt', 0, 0, 'NONE', 0,
          ctx.priorAttemptsFor('NO_SAFE_ACTION'))]);
      }
      out.push(_c('VERIFY_ECU_ATTRIBUTION', root, preOk, preText,
        'fiziksel adresten gelen yanıtın sahibi', 1, 350, 'NONE', 8,
        ctx.priorAttemptsFor('VERIFY_ECU_ATTRIBUTION')));
      out.push(_c('DISCOVER_VARIANT_EVIDENCE', root, preOk, preText,
        'ECU kimlik/varyant kaydı', 1, 350, 'NONE', 6,
        ctx.priorAttemptsFor('DISCOVER_VARIANT_EVIDENCE')));
      break;
    }

    default:
      break;
  }

  return assertCandidatesSafe(gap, out);
}

/* ══════════════════════════════════════════════════════════════════════════
   6) SKOR ve SEÇİM
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Deterministik skor — **bilgi kazancı / maliyet** politikası.
 *
 *   skor = gain×100  −  requestCost×20  −  (timeCostMs/100)  −  risk×15
 *          −  priorAttempts×40  −  (executable değilse 500)
 *
 * Sayıların hepsi tam sayıdır ve kayan nokta karşılaştırması yapılmaz.
 * Ağırlıkların sırası bilinçlidir:
 *  · `priorAttempts` cezası tek bir denemeden sonra bile adayı ciddi biçimde
 *    geriye atar → aynı yol kendiliğinden terk edilir (kör retry'nin tersi).
 *  · `executable` olmayan aday listede KALIR ama asla ilk seçilmez → kararın
 *    kendisi görünür olur, gizlenmez.
 */
export function scoreCandidate(c: MeasurementCandidate): number {
  let s = c.informationGain * 100;
  s -= c.requestCost * 20;
  s -= Math.round(c.timeCostMs / 100);
  s -= RISK_WEIGHT[c.risk] * 15;
  s -= c.priorAttempts * 40;
  if (!c.executable) s -= 500;
  return s;
}

export interface SelectionResult {
  readonly candidate: MeasurementCandidate | null;
  readonly kind: MeasurementCandidateKind;
  readonly reason: string;
  /** Skorlanmış aday listesi (LAB gösterir) — en yüksek skor önde. */
  readonly ranked: readonly MeasurementCandidate[];
}

/**
 * En iyi adayı seçer. Rastgelelik YOK; eşitlikte ad sırası KIRAR (deterministik).
 */
export function selectCandidate(
  candidates: readonly MeasurementCandidate[],
  totalAttemptsForGap: number,
): SelectionResult {
  const ranked = [...candidates].sort((a, b) => {
    const d = scoreCandidate(b) - scoreCandidate(a);
    if (d !== 0) return d;
    return a.kind.localeCompare(b.kind);
  });

  if (ranked.length === 0) {
    return {
      candidate: null, kind: 'NO_SAFE_ACTION', ranked,
      reason: 'bu boşluk için güvenli ve bilgi üretecek bir ölçüm YOK',
    };
  }
  if (totalAttemptsForGap >= MAX_ATTEMPTS_PER_GAP) {
    return {
      candidate: null, kind: 'NO_SAFE_ACTION', ranked,
      reason: `boşluk başına deneme tavanı doldu (${MAX_ATTEMPTS_PER_GAP})`,
    };
  }

  const best = ranked[0];
  if (best.priorAttempts >= MAX_ATTEMPTS_PER_TRIPLE) {
    return {
      candidate: null, kind: 'NO_SAFE_ACTION', ranked,
      reason: `en iyi aday (${CANDIDATE_LABEL[best.kind]}) aynı sonuçla `
        + `${best.priorAttempts} kez denendi — tavan ${MAX_ATTEMPTS_PER_TRIPLE}`,
    };
  }
  if (!best.executable) {
    return {
      candidate: best, kind: best.kind, ranked,
      reason: `en iyi aday ${CANDIDATE_LABEL[best.kind]} ama ön koşul yok: `
        + best.prerequisite,
    };
  }
  return {
    candidate: best, kind: best.kind, ranked,
    reason: `bilgi kazancı ${best.informationGain}/10 · maliyet `
      + `${best.requestCost} istek · risk ${best.risk} · önceki deneme `
      + `${best.priorAttempts} → skor ${scoreCandidate(best)}`,
  };
}
