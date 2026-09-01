/**
 * aiMemoryModel — CAROS LAB · Bellek Gezgini SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (servis importu yok → mock'suz test).
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 *  · Kaynak okunamadıysa `UNAVAILABLE`; "0 kayıt" ile KARIŞTIRILMAZ.
 *  · Araç geçmişi otoritesi BAĞLI DEĞİLSE 0 bir ÖLÇÜM DEĞİLDİR — ayrı söylenir.
 *  · Damgası olmayan kaydın yaşı HESAPLANMAZ.
 *  · İçerik hiçbir biçimde (metin · uzunluk · özet · hash) taşınmaz.
 */

import {
  observed, derived, unavailable, formatAge,
  type InspectorField,
} from './sessionInspectorModel';
import type { MemoryRecordShape } from './aiMemorySources';

const SRC_SHORT  = 'ai/memory/shortTermMemory.getShortTermMemory';
const SRC_MAVI   = 'ai/memory/concrete/maviMemorySources';
const SRC_POLICY = 'ai/memory/{memoryEngine,sensitiveMemoryGuard}';
/* MAVI-F10 · kanonik hafıza cephesi ve yolculuk hafızası. */
const SRC_CANON = 'assistant/maviMemory.getMaviMemoryDiagnostics';
const SRC_TRIP  = 'assistant/tripMemory.getTripMemoryDiagnostics';

/** Girdi tipi YAPISALDIR — `aiMemorySources` çıktısının şeklidir. */
export interface AiMemoryFieldsInput {
  readonly shortTerm: readonly MemoryRecordShape[] | null;
  readonly shortTermCapacity: number;
  readonly preferenceCount: number | null;
  readonly vehicleFactCount: number | null;
  readonly vehicleHistoryWired: boolean;
  readonly confidentVehicleFactCount: number | null;
  readonly maxTextLength: number;
  readonly minVehicleFactConfidence: number;
  readonly budgetMaxRecords: number;
  readonly budgetMaxLongTerm: number;
  readonly budgetMaxShortTerm: number;
  readonly budgetMaxChars: number;
  readonly nowMs: number;
  /** MAVI-F10 · kanonik hafıza tanısı. `null` = okunamadı. */
  readonly canonical: CanonicalMemoryShape | null;
  /** MAVI-F10 · yolculuk hafızası tanısı. `null` = okunamadı. */
  readonly trip: TripMemoryShape | null;
}

/**
 * MAVI-F10 · bounded kanonik hafıza satırı.
 * **İÇERİK ALANI YOKTUR** (metin · uzunluk · özet · hash) — kilit testiyle korunur.
 */
export interface CanonicalMemoryShape {
  readonly explicitCount: number;
  readonly inferredCount: number;
  readonly inferredPromoted: number;
  readonly correctedCount: number;
  readonly contradictedCount: number;
  readonly suppressionCount: number;
  readonly rejectedSensitive: number;
  readonly corrections: number;
  readonly forgets: number;
  readonly forgottenRecords: number;
  readonly historyPurges: number;
  readonly projections: number;
  readonly persistFailures: number;
  readonly lastPersistOk: boolean;
  readonly legacyImported: number;
  readonly legacyRejected: number;
  readonly schemaDropped: number;
  readonly conversationPurgeBound: boolean;
  readonly inferredProducerWired: boolean;
  readonly minEvidence: number;
  readonly maxExplicit: number;
  readonly maxInferred: number;
}

/** MAVI-F10 · bounded yolculuk hafızası satırı — kayıt metni TAŞINMAZ. */
export interface TripMemoryShape {
  readonly scopeBound: boolean;
  readonly hasActiveTrip: boolean;
  readonly recordCount: number;
  readonly capacity: number;
  readonly written: number;
  readonly rejectedSensitive: number;
  readonly droppedOverflow: number;
  readonly tripsSealed: number;
}

/* ── Hüküm ───────────────────────────────────────────────────────────────── */

export type MemoryVerdict =
  /** Kısa dönem okuması düştü. */
  | 'UNAVAILABLE'
  /** Hiç kayıt yok — uygulama yeni başlamış olabilir (RAM hafıza). */
  | 'EMPTY'
  /** Kayıt var, kapasitenin altında. */
  | 'LEARNING'
  /** Halka tampon DOLU — en eski kayıt her yenisinde düşüyor. */
  | 'AT_CAPACITY';

export const MEMORY_VERDICT_LABEL: Readonly<Record<MemoryVerdict, string>> = {
  UNAVAILABLE: 'OKUNAMADI',
  EMPTY:       'BOŞ — bu oturumda kayıt yok',
  LEARNING:    'KAYIT VAR',
  AT_CAPACITY: 'TAMPON DOLU — en eski kayıt düşüyor',
} as const;

export type MemoryTone = 'ok' | 'muted' | 'warn';

export function memoryVerdictTone(v: MemoryVerdict): MemoryTone {
  return v === 'LEARNING' ? 'ok' : v === 'AT_CAPACITY' ? 'warn' : 'muted';
}

export function deriveMemoryVerdict(input: {
  readonly shortTerm: readonly MemoryRecordShape[] | null;
  readonly capacity: number;
}): MemoryVerdict {
  if (input.shortTerm === null) return 'UNAVAILABLE';
  if (input.shortTerm.length === 0) return 'EMPTY';
  return input.shortTerm.length >= input.capacity ? 'AT_CAPACITY' : 'LEARNING';
}

/** Köken sınıfına göre adet — içerik taşımaz. */
export function countByOrigin(
  records: readonly MemoryRecordShape[] | null,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  if (records === null) return out;
  for (const r of records) out[r.origin] = (out[r.origin] ?? 0) + 1;
  return out;
}

/** En eski geçerli damga; `null` = hiç damgalı kayıt yok. */
export function oldestStampMs(
  records: readonly MemoryRecordShape[] | null,
): number | null {
  if (records === null) return null;
  let oldest: number | null = null;
  for (const r of records) {
    if (!(r.atMs > 0)) continue;            // damga YOK — yaşa katılmaz
    if (oldest === null || r.atMs < oldest) oldest = r.atMs;
  }
  return oldest;
}

/* ── Alanlar ─────────────────────────────────────────────────────────────── */

export function buildMemoryFields(i: AiMemoryFieldsInput): readonly InspectorField[] {
  const out: InspectorField[] = [];

  if (i.shortTerm === null) {
    out.push(unavailable({
      id: 'st-count', label: 'Kısa dönem kayıt', source: SRC_SHORT, note: '',
    }, 'Okuma hata verdi — "0 kayıt" ile KARIŞTIRILMAZ.'));
  } else {
    out.push(observed({
      id: 'st-count', label: 'Kısa dönem kayıt', source: SRC_SHORT,
      note: 'Yalnız RAM · süreç-ömürlü: uygulama yeniden başlayınca BOŞ başlar, hiçbir kalıcı depoya yazılmaz.',
    }, `${i.shortTerm.length}/${i.shortTermCapacity}`));

    const oldest = oldestStampMs(i.shortTerm);
    out.push(oldest === null
      ? unavailable({ id: 'st-oldest', label: 'En eski kaydın yaşı', source: SRC_SHORT, note: '' },
          i.shortTerm.length === 0 ? 'Kayıt yok.' : 'Damgalı kayıt yok — yaş HESAPLANMAZ.')
      : derived({
          id: 'st-oldest', label: 'En eski kaydın yaşı', source: SRC_SHORT,
          note: 'Damgadan türetildi; damgasız kayıtlar hesaba KATILMAZ.',
          updatedAt: oldest,
        }, formatAge(oldest, i.nowMs)));

    const byOrigin = countByOrigin(i.shortTerm);
    const originText = Object.keys(byOrigin).length === 0
      ? null
      : Object.entries(byOrigin).map(([k, v]) => `${k}=${v}`).join(' · ');
    out.push(originText === null
      ? unavailable({ id: 'st-origin', label: 'Köken dağılımı', source: SRC_SHORT, note: '' },
          'Kayıt yok.')
      : observed({
          id: 'st-origin', label: 'Köken dağılımı', source: SRC_SHORT,
          note: 'Yalnız SINIF ve ADET — kayıt içeriği bu ekrana HİÇ GELMEZ.',
        }, originText));
  }

  out.push(i.preferenceCount === null
    ? unavailable({ id: 'pref-count', label: 'Kullanıcı tercihi', source: SRC_MAVI, note: '' },
        'Okunamadı.')
    : observed({
        id: 'pref-count', label: 'Kullanıcı tercihi', source: SRC_MAVI,
        note: 'Uzun dönem gerçekler — yalnız ADET taşınır, metin taşınmaz.',
      }, i.preferenceCount));

  if (!i.vehicleHistoryWired) {
    out.push(unavailable({
      id: 'veh-facts', label: 'Araç geçmişi gerçeği', source: SRC_MAVI, note: '',
    }, 'Otorite BAĞLI DEĞİL (parmak izi veya bellek deposu yok) → burada 0 bir ÖLÇÜM DEĞİLDİR.'));
  } else {
    out.push(observed({
      id: 'veh-facts', label: 'Araç geçmişi gerçeği', source: SRC_MAVI,
      note: 'Otorite bağlı; 0 geçerli bir cevaptır (henüz öğrenilmedi).',
    }, i.vehicleFactCount ?? 0));

    out.push(i.confidentVehicleFactCount === null
      ? unavailable({ id: 'veh-confident', label: 'Eşik üstü güvenli gerçek', source: SRC_MAVI, note: '' },
          'Hesaplanamadı.')
      : derived({
          id: 'veh-confident', label: 'Eşik üstü güvenli gerçek', source: SRC_MAVI,
          note: `Yalnız güveni ≥ ${i.minVehicleFactConfidence} olanlar taşınır; altındakiler bloğa GİRMEZ.`,
        }, i.confidentVehicleFactCount));
  }

  out.push(observed({
    id: 'policy-guard', label: 'Hassas veri kapısı', source: SRC_POLICY,
    note: 'Her kayıt kapıdan geçer: VIN · plaka · telefon · e-posta · IBAN/kart · API anahtarı · koordinat · uzun rakam dizisi REDDEDİLİR. Geçemeyen kayıt SAKLANMAZ.',
  }, `azami ${i.maxTextLength} karakter`));

  out.push(observed({
    id: 'policy-budget', label: 'Blok bütçesi', source: SRC_POLICY,
    note: 'Bir görevde taşınacak azami kayıt ve karakter — token sınırı ve gizlilik birlikte.',
  }, `kayıt ${i.budgetMaxRecords} (uzun ${i.budgetMaxLongTerm} · kısa ${i.budgetMaxShortTerm}) · ${i.budgetMaxChars} karakter`));

  /* ── MAVI-F10 · KANONİK HAFIZA (TURN / TRIP / LONG_TERM) ────────────────── */
  /* `undefined` da `null` gibi ele alınır — eksik girdi ASLA çökertmez. */
  const c = i.canonical ?? null;
  if (c === null) {
    out.push(unavailable({
      id: 'canon-root', label: 'Kanonik hafıza', source: SRC_CANON, note: '',
    }, 'Okunamadı.'));
  } else {
    out.push(observed({
      id: 'canon-long', label: 'Uzun dönem kayıt', source: SRC_CANON,
      note: 'BEYAN ile ÇIKARIM ASLA aynı listede değildir. Beyan (EXPLICIT) '
        + 'güven 1 ve DECAY YOK; çıkarım (INFERRED) kanıttan türetilir, zamanla '
        + 'zayıflar ve kanıt eşiğini aşana kadar prompt bloğuna GİREMEZ.',
    }, `beyan ${c.explicitCount}/${c.maxExplicit} · çıkarım ${c.inferredCount}/${c.maxInferred} `
      + `(eşiği aşan ${c.inferredPromoted}, en az ${c.minEvidence} kanıt)`));

    out.push(c.inferredProducerWired
      ? observed({ id: 'canon-learn', label: 'Öğrenme kaynağı', source: SRC_CANON, note: '' },
        'BAĞLI')
      : unavailable({
        id: 'canon-learn', label: 'Öğrenme kaynağı (inferred üretici)', source: SRC_CANON,
        note: 'Port AÇIK ama üretimde ÇAĞIRANI YOK: repoda bir tercihi davranıştan '
          + 'çıkaracak güvenilir ve gizlilik-temiz üretim sinyali ÖLÇÜLEMEDİ. '
          + 'Olmayan sinyalden öğrenme UYDURULMADI — açık borç. LLM bu porta '
          + 'ERİŞEMEZ (yapısal kilit).',
      }, 'BAĞLI DEĞİL — çıkarım üretilmiyor'));

    out.push(observed({
      id: 'canon-correct', label: 'Düzeltme / çelişki', source: SRC_CANON,
      note: 'Düzeltme KÖR SİLMEZ: güven sıfıra iner, kayıt CORRECTED işaretlenir ve '
        + 'aynı çıkarım 30 gün yeniden üretilemez (mühür). Çelişen beyanlar '
        + 'SİLİNMEZ, CONTRADICTED işaretlenir ve prompt bloğunda GÖRÜNÜR kalır — '
        + 'hangisinin geçerli olduğunu Mavi kullanıcıya sorar.',
    }, `düzeltilmiş ${c.correctedCount} · çelişkili ${c.contradictedCount} · `
      + `mühür ${c.suppressionCount} · düzeltme olayı ${c.corrections}`));

    out.push(observed({
      id: 'canon-forget', label: 'Unutma', source: SRC_CANON,
      note: 'Silinen hafıza prompt bloğuna DÖNMEZ: kalıcı kayıt + yolculuk kaydı + '
        + 'KONUŞMA GEÇMİŞİ birlikte temizlenir. Geçmiş portu bağlı değilse bu '
        + 'AÇIKÇA bildirilir ve "sildim" DENMEZ.',
    }, `${c.forgets} talep · ${c.forgottenRecords} kayıt · geçmiş temizleme `
      + `${c.conversationPurgeBound ? `BAĞLI (${c.historyPurges})` : 'BAĞLI DEĞİL'}`));

    out.push(c.lastPersistOk
      ? observed({
        id: 'canon-persist', label: 'Kalıcılaştırma', source: SRC_CANON,
        note: 'Depo yazımı başarısızsa "hatırladım" DENMEZ — çağıran dürüst '
          + 'cümleyi bu bayraktan kurar.',
      }, `SON YAZIM BAŞARILI · toplam hata ${c.persistFailures}`)
      : unavailable({
        id: 'canon-persist', label: 'Kalıcılaştırma', source: SRC_CANON,
        note: 'Son yazım DÜŞTÜ (kota/bozuk depo). Bu durumda hafıza "kaydedildi" '
          + 'diye sunulmaz.',
      }, `SON YAZIM DÜŞTÜ · toplam hata ${c.persistFailures}`));

    out.push(observed({
      id: 'canon-privacy', label: 'Gizlilik kapısı (kanonik yol)', source: SRC_CANON,
      note: 'Kapı HEM YAZMA HEM OKUMA yolunda uygulanır. F10 öncesi canlı yolda '
        + '(REMEMBER → addFact, prompt → buildMemoryPromptSection) kapı HİÇ '
        + 'YOKTU — yalnız bayrağı KAPALI motorun üzerindeydi. Eski depodan içe '
        + 'aktarımda hassas kayıtlar TAŞINMADI.',
    }, `reddedilen ${c.rejectedSensitive} · eski depodan alınan ${c.legacyImported} `
      + `(reddedilen ${c.legacyRejected}) · şema dışı düşen ${c.schemaDropped}`));

    out.push(observed({
      id: 'canon-projection', label: 'Prompt izdüşümü', source: SRC_CANON,
      note: 'Her turda TÜM hafıza dökülmez: bağlam alanına göre daraltılır '
        + '(navigasyon · medya · araç · kişisel) ve kayıt/karakter tavanına '
        + 'uyar. Blok "VERİdir, TALİMAT DEĞİLDİR" etiketiyle girer.',
    }, `${c.projections} izdüşüm`));
  }

  /* ── MAVI-F10 · YOLCULUK HAFIZASI ───────────────────────────────────────── */
  const t = i.trip ?? null;
  if (t === null) {
    out.push(unavailable({
      id: 'trip-root', label: 'Yolculuk hafızası', source: SRC_TRIP, note: '',
    }, 'Okunamadı.'));
  } else if (!t.scopeBound) {
    out.push(unavailable({
      id: 'trip-root', label: 'Yolculuk hafızası', source: SRC_TRIP,
      note: 'Kapsam kaynağı BAĞLI DEĞİL → yolculuk hafızası yazmaz/okumaz. '
        + 'Uydurma yolculuk kimliği ÜRETİLMEZ.',
    }, 'KAPSAM BAĞLI DEĞİL'));
  } else if (!t.hasActiveTrip) {
    out.push(unavailable({
      id: 'trip-root', label: 'Yolculuk hafızası', source: SRC_TRIP,
      note: 'Aktif yolculuk YOK → TRIP kaydı alınmaz. Anahtar mevcut ve gerçek '
        + 'bir olgudan (ActiveTrip.startTime) TÜRETİLİR; yeni kimlik sistemi yok.',
    }, 'AKTİF YOLCULUK YOK'));
  } else {
    out.push(observed({
      id: 'trip-root', label: 'Yolculuk hafızası', source: SRC_TRIP,
      note: 'YALNIZ RAM · yolculuk anahtarlı · bounded. Yeni yolculuk eskisini '
        + 'DEVRALMAZ: anahtar değişince önceki yolculuk mühürlenir ve kayıtları '
        + 'düşer. Yolculuk özeti AÇIK izin olmadan kalıcılaşmaz.',
    }, `${t.recordCount}/${t.capacity} kayıt · yazılan ${t.written} · `
      + `mühürlenen yolculuk ${t.tripsSealed}`));

    out.push(observed({
      id: 'trip-guard', label: 'Yolculuk kapısı', source: SRC_TRIP,
      note: 'Ham transkript YAZILMAZ: yalnız bounded konu kimliği, yapılan iş ve '
        + 'açık kalan konu. Hassas içerik kapıda REDDEDİLİR.',
    }, `reddedilen ${t.rejectedSensitive} · taşma ${t.droppedOverflow}`));
  }

  return out;
}
