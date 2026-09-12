/**
 * serviceProbeModel — P0-VDK-F4B · SERVİS KEŞFİNİN SAF MODELİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SORU ──────────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * "Bilinmeyen bir ECU'da hangi SALT-OKUNUR servisler GERÇEKTEN var?"
 *
 * Cevap TAHMİN DEĞİL KANIT olmalıdır: her satır bir gerçek isteğe ve o isteğe
 * gelen gerçek yanıta dayanır. Sorulmamış bir servis hakkında bu model
 * hiçbir şey söylemez (`NOT_PROBED`).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ YETENEK OTORİTESİ DEĞİLDİR.** Sınıflandırma
 *     `ecuCapabilityModel.deriveServicePresence`tedir (mevcut otorite,
 *     bu turda YENİ EKSENLE genişletildi).
 * (2) **İKİNCİ GÜVENLİK EVRENİ DEĞİLDİR.** Korpus filtresi F4-A kapısını
 *     (`genericPduTransport.judgeGenericPdu`) ve mevcut `discoverySafetyPolicy`
 *     kara listesini KULLANIR; yeni bir izin modeli tanımlamaz.
 * (3) **ÖĞRENME DEĞİLDİR.** FleetMemory/Learning/Self-Healing yazmaz.
 *     Sonuç süreç ömürlüdür; diske ve buluta TEK BAYT gitmez.
 * (4) **KÖR TARAMA YAPMAZ.** Aday servisler YALNIZ CDDL tanımlarından gelir;
 *     `00..FF` servis ya da alt fonksiyon taraması YOKTUR.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 */

import type { EcuVariant, ProtocolClassName, ServiceDef } from '../cddl/schema';
import {
  deriveServicePresence, isServiceProbablyPresent, isPresenceCoverageLoss,
  type ServicePresence,
} from '../ecuCapabilityModel';
import type { PduOutcome } from '../pdu';
import { judgeGenericPdu, GENERIC_UDS_19_SUBS } from '../genericPduTransport';
import { makePdu, pduTarget, FUNCTIONAL_TARGET } from '../pdu';
import { HARD_FORBIDDEN_SERVICES } from './discoverySafetyPolicy';
import type { ReplayGapSignal } from '../virtualTransport';

/* ══════════════════════════════════════════════════════════════════════════
   1) YOKLAMA ADAYI
   ══════════════════════════════════════════════════════════════════════════ */

/** Keşif turunda sorulacak TEK bir istek. */
export interface ProbeSpec {
  /** Kaynak CDDL tanımı — kanıt zinciri kopmasın. */
  readonly serviceDefId: string;
  readonly service: string;
  readonly subFunction: string | null;
  readonly payload: string;
  readonly responseEchoBytes: number;
  /** Bu bir alt fonksiyon yoklaması mı (servis varlığı zaten kanıtlı). */
  readonly isSubFunctionProbe: boolean;
}

/** Korpusa ALINMAYAN aday ve gerekçesi — sessiz eleme YASAK. */
export type ProbeExclusionReason =
  /** CDDL tanımı yazma/aktüatör sınıfında. */
  | 'DESTRUCTIVE_DEF'
  /** Mevcut keşif kara listesinde (`discoverySafetyPolicy`). */
  | 'HARD_FORBIDDEN'
  /** F4-A güvenlik kapısı reddetti (servis ya da alt fonksiyon). */
  | 'SAFETY_GATE'
  /** ECU tanımı bu servisi saymıyor. */
  | 'NOT_ON_ECU'
  /** Aktif protokol bu servis için tanımlı değil. */
  | 'PROTOCOL_MISMATCH';

export const PROBE_EXCLUSION_LABEL: Readonly<Record<ProbeExclusionReason, string>> = {
  DESTRUCTIVE_DEF:   'YAZMA/AKTÜATÖR tanımı — korpusa giremez',
  HARD_FORBIDDEN:    'keşif kara listesinde',
  SAFETY_GATE:       'güvenlik kapısı reddetti',
  NOT_ON_ECU:        'ECU tanımı servisi saymıyor',
  PROTOCOL_MISMATCH: 'aktif protokol uygun değil',
} as const;

export interface ProbeExclusion {
  readonly serviceDefId: string;
  readonly service: string;
  readonly subFunction: string | null;
  readonly reason: ProbeExclusionReason;
}

export interface ProbeCorpus {
  readonly specs: readonly ProbeSpec[];
  readonly excluded: readonly ProbeExclusion[];
}

/** Korpus tavanı — sınırsız yoklama bir tarama değil, bir DoS'tur. */
export const MAX_PROBE_SPECS = 48;

function _target(ecu: EcuVariant) {
  return ecu.addressing === 'functional'
    ? FUNCTIONAL_TARGET
    : pduTarget(ecu.txHeader.length === 0 ? null : ecu.txHeader,
      ecu.rxHeader.length === 0 ? null : ecu.rxHeader, ecu.name);
}

/**
 * Bir adayın hatta çıkabilirliğini ÜÇ BAĞIMSIZ FİLTREYLE sınar.
 *
 * Üçü de fail-closed'dır ve biri diğerinin yerine geçmez:
 *   (1) CDDL `effect` — tanımın kendi beyanı,
 *   (2) `discoverySafetyPolicy.HARD_FORBIDDEN_SERVICES` — mevcut keşif kara listesi,
 *   (3) `judgeGenericPdu` — F4-A kapısının TS aynası (native kapı ayrıca ve
 *       BAĞIMSIZ olarak son sözü söyler).
 */
function _screen(
  def: ServiceDef, sub: string | null, payload: string, ecu: EcuVariant,
): ProbeExclusionReason | null {
  if (def.effect === 'destructive') return 'DESTRUCTIVE_DEF';
  if (HARD_FORBIDDEN_SERVICES.has(def.service.toUpperCase())) return 'HARD_FORBIDDEN';
  const verdict = judgeGenericPdu(makePdu({
    service: def.service, subFunction: sub, payload, target: _target(ecu),
  }));
  return verdict === 'OK' ? null : 'SAFETY_GATE';
}

/**
 * SERVİS SEVİYESİ korpus — her tanım için TEK bir varlık yoklaması.
 *
 * Alt fonksiyonlar BURADA üretilmez: onlar ancak servisin VARLIĞI ölçüldükten
 * sonra (`expandSubFunctionProbes`) doğar. Sıra bilinçlidir — var olmayan bir
 * servisin alt fonksiyonlarını yoklamak hattı boşuna meşgul eder.
 */
export function buildProbeCorpus(
  defs: readonly ServiceDef[], ecu: EcuVariant,
  protocolClass: ProtocolClassName | 'unknown' | null,
): ProbeCorpus {
  const specs: ProbeSpec[] = [];
  const excluded: ProbeExclusion[] = [];
  const seen = new Set<string>();

  for (const def of defs) {
    const sub = def.subFunction;
    const payload = def.argKind === 'literal' ? def.literalPayload
      : def.argKind === 'status_mask' ? (def.literalPayload || 'FF') : '';

    const push = (reason: ProbeExclusionReason): void => {
      excluded.push({ serviceDefId: def.id, service: def.service, subFunction: sub, reason });
    };

    if (!ecu.serviceRefs.includes(def.id)) { push('NOT_ON_ECU'); continue; }
    if (def.protocols.length > 0 && protocolClass !== null && protocolClass !== 'unknown'
        && !def.protocols.includes(protocolClass)) {
      push('PROTOCOL_MISMATCH'); continue;
    }
    /* Argüman İSTEYEN tanımlar (DID/LID) servis VARLIĞI yoklaması için uygun
       değildir: uydurma bir kimlikle gelen `0x31` servis hakkında değil, KİMLİK
       hakkında bilgi verir. Bunlar keşfin DID fazına aittir (bu turda YOK). */
    if (def.argKind === 'data_identifier' || def.argKind === 'dtc_record') {
      push('PROTOCOL_MISMATCH'); continue;
    }

    const reason = _screen(def, sub, payload, ecu);
    if (reason !== null) { push(reason); continue; }

    const key = `${def.service}|${sub ?? ''}|${payload}`;
    if (seen.has(key)) continue;           // aynı istek iki kez sorulmaz
    seen.add(key);
    if (specs.length >= MAX_PROBE_SPECS) { push('SAFETY_GATE'); continue; }

    specs.push({
      serviceDefId: def.id, service: def.service, subFunction: sub, payload,
      responseEchoBytes: def.responseEchoBytes, isSubFunctionProbe: false,
    });
  }
  return { specs, excluded };
}

/**
 * ALT FONKSİYON KEŞFİ — yalnız servis MEVCUTSA.
 *
 * Kör `00..FF` taraması YOKTUR: adaylar F4-A kapısının salt-okunur kümesinden
 * gelir (`01 · 02 · 03 · 06 · 0A`) ve zaten sorulmuş olan alt fonksiyon
 * TEKRAR sorulmaz.
 */
export function expandSubFunctionProbes(
  def: ServiceDef, ecu: EcuVariant, presence: ServicePresence,
  alreadyProbed: ReadonlySet<string>,
): ProbeCorpus {
  const specs: ProbeSpec[] = [];
  const excluded: ProbeExclusion[] = [];
  if (!isServiceProbablyPresent(presence)) return { specs, excluded };
  /* Bu turda alt fonksiyon uzayı tanımlı TEK servis 0x19'dur. Başka bir servis
     için alt fonksiyon üretmek, tanımı olmayan bir uzayda tahmin yürütmektir. */
  if (def.service !== '19') return { specs, excluded };

  for (const sub of GENERIC_UDS_19_SUBS) {
    if (alreadyProbed.has(`19|${sub}`)) continue;
    /* 0x19-02 durum maskesi ister; diğerleri gövdesizdir. Bu, uydurma değil
       ISO 14229-1 tanımıdır ve CDDL `argKind` ile tutarlıdır. */
    const payload = sub === '02' ? 'FF' : '';
    const reason = _screen(def, sub, payload, ecu);
    if (reason !== null) {
      excluded.push({ serviceDefId: def.id, service: '19', subFunction: sub, reason });
      continue;
    }
    specs.push({
      serviceDefId: def.id, service: '19', subFunction: sub, payload,
      responseEchoBytes: 1, isSubFunctionProbe: true,
    });
  }
  return { specs, excluded };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KANIT KAYDI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * TEK bir yoklamanın TAM kanıtı.
 *
 * Görevin istediği her alan burada durur; hiçbiri "sonradan türetilir" diye
 * atılmaz — türetilebilen bir alan bile kaydın kendisinde yoksa, o kayıt
 * gelecekte yeniden yorumlanamaz.
 */
export interface ProbeRecord {
  /** Kanonik ECU anahtarı; fonksiyonel yoklamada `null`. */
  readonly ecuKey: string | null;
  readonly ecuLabel: string | null;
  readonly txHeader: string | null;
  readonly rxHeader: string | null;
  readonly service: string;
  readonly subFunction: string | null;
  readonly serviceDefId: string;
  /** `encodePduRequest` künyesi — replay ile AYNI biçim. */
  readonly requestIdentity: string;
  readonly outcome: PduOutcome;
  readonly nrc: number | null;
  readonly latencyMs: number | null;
  /** F1-B oturum kanıtı: açıldı mı / hangi komutla. Ölçülmediyse `null`. */
  readonly sessionOpened: boolean | null;
  readonly sessionCommand: string | null;
  /** Taşımanın kendi sınıf etiketi (kanıt). */
  readonly transportKind: string | null;
  /** Kanonik iz korelasyon kimliği — probe ↔ iz eşleşsin. */
  readonly traceCorrelationId: string | null;
  readonly protocol: string | null;
  readonly classification: ServicePresence;
  /** Sınırlı gerekçe metni — sınıflandırma NEDEN böyle. */
  readonly reason: string;
  /** Ölçüm damgası — ENJEKTE edilir (sahte tarih YASAK). */
  readonly atMs: number | null;
  /** Aynı yoklama kaç kez yapıldı (tekrar bir kanıttır). */
  readonly count: number;
  /**
   * P0-VDK-F4C — bu satır HATTA ÇIKMADAN öğrenme belleğinden mi geldi.
   *
   * `true` ise istek GÖNDERİLMEDİ ve sınıflandırma ÖNCEKİ canlı ölçümdendir.
   * Bunu gizlemek, kullanıcıya "şimdi ölçtüm" izlenimi vermek olurdu.
   */
  readonly reusedFromLearning: boolean;
  /** Yeniden kullanım kararı (atlandıysa `REUSE`; ölçüldüyse NEDEN ölçüldüğü). */
  readonly reuseDecision: string | null;
}

/** Dedup anahtarı — aynı ECU'da aynı isteğin TEK satırı olur. */
export function probeKey(r: Pick<ProbeRecord, 'ecuKey' | 'service' | 'subFunction'>): string {
  return `${r.ecuKey ?? 'FUNC'}|${r.service}|${r.subFunction ?? ''}`;
}

/**
 * KANIT GÜNCELLEME SEMANTİĞİ — pazarlıksız.
 *
 * Aynı (ECU × servis × alt fonksiyon) tekrar yoklanırsa yeni satır AÇILMAZ.
 * Ama hangi sonucun KAZANACAĞI önemlidir:
 *
 *  · **ÖLÇÜLMÜŞ bir sonuç, ölçülmemiş bir sonuçla EZİLEMEZ.** Bir kez
 *    `PRESENT` ölçülmüş servis, sonraki turda ECU sustu diye `UNKNOWN`
 *    olmaz — bu, kanıtı gürültüyle silmek olurdu.
 *  · Ölçülmüş sonucun üstüne YALNIZ ölçülmüş sonuç yazılır (en taze kazanır).
 *  · Sayaç HER durumda artar: kaç kez sorulduğu ayrı bir gerçektir.
 */
export function mergeProbeRecord(prev: ProbeRecord | null, next: ProbeRecord): ProbeRecord {
  if (prev === null) return next;
  const prevMeasured = !isPresenceCoverageLoss(prev.classification);
  const nextMeasured = !isPresenceCoverageLoss(next.classification);
  const count = prev.count + 1;
  if (prevMeasured && !nextMeasured) {
    /* Kanıt KORUNUR; yalnız sayaç ve son damga ilerler. */
    return { ...prev, count, atMs: next.atMs ?? prev.atMs };
  }
  return { ...next, count };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BOŞLUK SİNYALİ — MEVCUT SÖZLÜK
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Sınıflandırmadan `gapRegistry` sinyali türetir.
 *
 * ⚠️ Yeni sinyal TANIMLANMAZ: sözlük `ReplayGapSignal`dır.
 * `ABSENT` ve `PRESENT` boşluk DEĞİLDİR — ikisi de ölçülmüş gerçektir.
 */
export function gapSignalForPresence(
  p: ServicePresence, isSubFunctionProbe: boolean,
): ReplayGapSignal | null {
  switch (p) {
    case 'PRESENT':
    case 'ABSENT':
      return null;
    case 'PRESENT_BUT_CONDITIONED':
      /* Servis var ama bu koşulda okunamadı — yetenek boşluğudur. */
      return 'CAPABILITY_GAP';
    case 'UNKNOWN_TRANSPORT_LIMIT':
      return 'TRANSPORT_LIMITATION';
    case 'UNKNOWN_RESPONSE_SHAPE':
      return 'UNKNOWN_RESPONSE_SHAPE';
    case 'UNKNOWN':
    case 'UNKNOWN_ADDRESSING':
    case 'DEFERRED':
      return isSubFunctionProbe ? 'UNKNOWN_SUBFUNCTION' : 'UNKNOWN_SERVICE';
    case 'PROBE_FORBIDDEN':
    case 'NOT_PROBED':
    default:
      return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ÖZET
   ══════════════════════════════════════════════════════════════════════════ */

export interface DiscoverySummary {
  readonly probed: number;
  readonly present: number;
  readonly absent: number;
  readonly conditioned: number;
  readonly unknown: number;
  readonly transportLimited: number;
  readonly deferred: number;
  readonly forbidden: number;
  /** En son görülen NRC (kanıt) — hiç görülmediyse `null`. */
  readonly lastNrc: number | null;
  /** Yoklama HİÇ yapılmadı mı — ekranda `0` DEĞİL "KAYNAK YOK" demek için. */
  readonly neverProbed: boolean;
}

export function summarizeProbes(records: readonly ProbeRecord[]): DiscoverySummary {
  let present = 0, absent = 0, conditioned = 0, unknown = 0;
  let transportLimited = 0, deferred = 0, forbidden = 0;
  let lastNrc: number | null = null;
  let lastAt = -Infinity;

  for (const r of records) {
    switch (r.classification) {
      case 'PRESENT': present++; break;
      case 'ABSENT': absent++; break;
      case 'PRESENT_BUT_CONDITIONED': conditioned++; break;
      case 'UNKNOWN_TRANSPORT_LIMIT': transportLimited++; break;
      case 'DEFERRED': deferred++; break;
      case 'PROBE_FORBIDDEN': forbidden++; break;
      default: unknown++; break;
    }
    if (r.nrc !== null && (r.atMs ?? 0) >= lastAt) { lastNrc = r.nrc; lastAt = r.atMs ?? 0; }
  }

  return {
    probed: records.length,
    present, absent, conditioned, unknown, transportLimited, deferred, forbidden,
    lastNrc,
    neverProbed: records.length === 0,
  };
}

/** Sınıflandırma için insan-okunur, SINIRLI gerekçe metni. */
export function presenceReason(
  outcome: PduOutcome, nrc: number | null, detail: string | null,
): string {
  const p = deriveServicePresence(outcome, nrc);
  if (p === 'ABSENT') return 'ECU 7F-11 (serviceNotSupported) dedi';
  if (p === 'PRESENT') return 'pozitif yanıt geldi';
  if (p === 'PRESENT_BUT_CONDITIONED') {
    return nrc === null
      ? 'negatif yanıt geldi ama NRC okunamadı — ECU yanıt verdiğine göre servis VAR'
      : `NRC 0x${nrc.toString(16).toUpperCase().padStart(2, '0')} — servis yokluğu DEĞİL`;
  }
  return detail === null ? `taşıma sonucu: ${outcome}` : `${outcome} · ${detail}`;
}
