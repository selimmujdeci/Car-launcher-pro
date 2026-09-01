/**
 * vdkReplayModel.ts — VDK REPLAY blokunun SAF görünüm modeli (P0-VDK-F2B).
 *
 * BU DOSYA YENİ BİR OTORİTE DEĞİLDİR: replay başlatmaz, parite hesaplamaz,
 * "çalıştı/çalışmadı" kararını KENDİ üretmez. `virtualTransport` muhasebesini
 * ve `canonicalTrace` damgasını SINIFLANDIRIR ve fail-closed bir hüküm türetir.
 *
 * PARALEL MİMARİ YOK: gözlemlenebilirlik ilkelleri `sessionInspectorModel`den
 * AYNEN yeniden kullanılır (`OBSERVED · DERIVED · UNAVAILABLE · STALE`).
 *
 * ── DÜRÜSTLÜK KURALLARI (pazarlıksız) ───────────────────────────────────────
 *  · Koşu YOKSA sayaçlar `0` DEĞİL, KAYNAK YOK'tur.
 *  · `matched > 0` TEK BAŞINA "PASS" hükmü VERMEZ; uyuşmazlık/iptal/tükenme
 *    varsa hüküm düşer.
 *  · Bilinmeyen durum `UNKNOWN`tur ve `UNKNOWN` bir BAŞARI DEĞİLDİR.
 *  · Ham istek/yanıt gövdesi bu ekrana GİRMEZ (kaynağı da taşımaz).
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · modül durumu yok.
 */

import {
  observed, derived, unavailable,
  type InspectorField,
} from './sessionInspectorModel';
import type { VdkReplayRawSnapshot } from './vdkReplaySources';
import {
  CONFORMANCE_OUTCOME_LABEL, CONFORMANCE_PROVENANCE_LABEL, CONFORMANCE_VERDICT_LABEL,
} from '../obd/conformanceRun';

/* ══════════════════════════════════════════════════════════════════════════
   1) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export type ReplayLabVerdict =
  /** Her istek izdeki ölçülmüş karşılığını buldu; sapma YOK. */
  | 'PASS'
  /** Ürün izle uyuşmayan bir soru sordu ya da ölçüm tükendi. */
  | 'PARITY_MISMATCH'
  /** Koşu açılamadı — iz boş/canlı/zaman ekseni bozuk. */
  | 'TRACE_INVALID'
  /** Koşu var ama henüz hiç istek gelmedi ya da yarıda kaldı. */
  | 'INCOMPLETE'
  /** Sınıflandırılamadı — fail-closed. */
  | 'UNKNOWN';

export const REPLAY_VERDICT_LABEL: Readonly<Record<ReplayLabVerdict, string>> = {
  PASS:            'PARİTE — her istek izdeki ölçümle karşılandı',
  PARITY_MISMATCH: 'SAPMA — istek izle uyuşmadı ya da ölçüm tükendi',
  TRACE_INVALID:   'İZ GEÇERSİZ — koşu açılamadı',
  INCOMPLETE:      'EKSİK — koşu tamamlanmadı',
  UNKNOWN:         'BİLİNMİYOR — fail-closed',
} as const;

/**
 * Hüküm — **fail-closed**.
 *
 * Sıra bilinçlidir: en kesin KUSUR önce. Bir koşuda hem eşleşme hem uyuşmazlık
 * varsa hüküm `PARITY_MISMATCH`tir; "çoğu tuttu" diye PASS DEMEK, tam da
 * regresyon kasasının yalan söylemeye başladığı yerdir.
 */
export function deriveReplayVerdict(s: VdkReplayRawSnapshot): ReplayLabVerdict {
  if (s.replayRunId === null) return 'UNKNOWN';           // koşu HİÇ açılmadı
  if (s.requested === null) return 'TRACE_INVALID';
  if ((s.mismatched ?? 0) > 0 || (s.exhausted ?? 0) > 0
    || (s.noRecordedResponse ?? 0) > 0 || (s.timingInvalid ?? 0) > 0) {
    return 'PARITY_MISMATCH';
  }
  if ((s.cancelled ?? 0) > 0) return 'INCOMPLETE';
  if (s.requested === 0) return 'INCOMPLETE';
  if ((s.matched ?? 0) === s.requested) return 'PASS';
  return 'UNKNOWN';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) BÖLÜMLER
   ══════════════════════════════════════════════════════════════════════════ */

export type VrSectionId =
  'conformance' | 'run' | 'accounting' | 'parity' | 'functional' | 'isolation' | 'gaps';

export const VR_SECTION_ORDER: readonly VrSectionId[] = [
  'conformance', 'run', 'accounting', 'parity', 'functional', 'isolation', 'gaps',
] as const;

export const VR_SECTION_TITLE: Readonly<Record<VrSectionId, string>> = {
  conformance: '1 · Uygunluk Koşusu (canlı ↔ FAST ↔ TIMED)',
  run:        '2 · Koşu',
  accounting: '3 · Teslim Muhasebesi',
  parity:     '4 · Parite',
  functional: '5 · Fonksiyonel DTC Çözümleyicisi (Mode 03/07/0A)',
  isolation:  '6 · İzolasyon',
  gaps:       '7 · Yapısal Boşluk Sinyalleri + Sicil',
} as const;

export interface VrSection {
  readonly id: VrSectionId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

export interface VdkReplayView {
  readonly verdict: ReplayLabVerdict;
  readonly verdictLabel: string;
  readonly sections: readonly VrSection[];
}

const SRC = 'obd/virtualTransport · obd/vdkTransport · obd/canonicalTrace';
const FN_SRC = 'obd/functionalDtc · obd/functionalDtcSource · obd/functionalDtcEvidence';
const CF_SRC = 'obd/conformanceRun · obd/conformanceLedger';
const GAP_SRC = 'obd/gapRegistry';
const PDU_SRC = 'obd/pdu · obd/pduTransport';

/** Sayaç alanı — `null` kaynak yok, `0` GERÇEK sıfırdır. İkisi KARIŞMAZ. */
function count(id: string, label: string, v: number | null, note: string): InspectorField {
  if (v === null) return unavailable({ id, label, source: SRC, note }, 'Koşu yok — sayaç ÜRETİLMEZ.');
  return observed({ id, label, source: SRC, note }, String(v));
}

export function buildVdkReplayView(s: VdkReplayRawSnapshot): VdkReplayView {
  const verdict = deriveReplayVerdict(s);

  const run: InspectorField[] = [
    observed({
      id: 'active', label: 'Koşu aktif', source: SRC,
      note: 'Replay AKTİFKEN hiçbir tanı çağrısı canlı hatta gitmez.',
    }, s.active ? 'EVET' : 'HAYIR'),
    s.replayRunId === null
      ? unavailable({ id: 'runId', label: 'Replay koşu kimliği', source: SRC, note: 'Koşu açılmadı.' })
      : observed({ id: 'runId', label: 'Replay koşu kimliği', source: SRC, note: 'Enjekte edilir; rastgele DEĞİL.' }, s.replayRunId),
    s.sourceTraceId === null
      ? unavailable({ id: 'srcTrace', label: 'Kaynak iz', source: SRC, note: 'Koşu açılmadı.' })
      : observed({ id: 'srcTrace', label: 'Kaynak iz', source: SRC, note: 'İçe aktarılmış, checksum doğrulanmış paket.' }, s.sourceTraceId),
    s.mode === null
      ? unavailable({ id: 'mode', label: 'Zamanlama modu', source: SRC, note: 'Koşu açılmadı.' })
      : observed({
        id: 'mode', label: 'Zamanlama modu', source: SRC,
        note: 'FAST: bekleme yok (regresyon) · TIMED: izdeki gecikme yeniden üretilir.',
      }, s.mode),
    count('srcEvents', 'Kaynak izdeki olay', s.sourceEventCount, 'İzin taşıdığı toplam ölçüm.'),
  ];

  const accounting: InspectorField[] = [
    count('requested', 'İstek', s.requested, 'Ürünün replay taşımasına sorduğu toplam.'),
    count('matched', 'Eşleşen', s.matched, 'Künyesi doğrulanıp ölçülmüş yanıtı teslim edilen.'),
    count('mismatched', 'Uyuşmayan', s.mismatched, 'İzde HİÇ olmayan istek — yanıt UYDURULMADI.'),
    count('exhausted', 'Tükenen', s.exhausted, 'İstek izde vardı ama kayıtlı yanıtları bitti.'),
    count('noResp', 'Yanıt ölçülmemiş', s.noRecordedResponse, '"Yanıt gelmedi" DEĞİL — ölçülmedi.'),
    count('cancelled', 'İptal', s.cancelled, 'Koşu kapandıktan sonra gelen istek.'),
    count('timingInvalid', 'Zaman geçersiz', s.timingInvalid, 'Monotonik zaman geri gitti.'),
    count('unconsumed', 'Tüketilmemiş olay', s.unconsumed, 'Ürün izin tamamını çalıştırmadı — sessiz DEĞİL.'),
  ];

  const parity: InspectorField[] = [
    derived({
      id: 'verdict', label: 'Hüküm', source: 'devtools/vdkReplayModel.deriveReplayVerdict',
      note: 'Kusur varsa PASS DENMEZ; "çoğu tuttu" bir hüküm değildir.',
    }, verdict),
    s.outcomeCounts === null
      ? unavailable({ id: 'dist', label: 'Sonuç dağılımı', source: SRC, note: 'Teslim yok.' })
      : observed({
        id: 'dist', label: 'Sonuç dağılımı', source: SRC,
        note: 'Kanonik replay sonuç sınıfları.',
      }, Object.entries(s.outcomeCounts).map(([k, v]) => `${k}:${v}`).join(' · ')),
  ];

  /* ── P0-VDK-F3A · AKTİF PDU TAŞIMASI ─────────────────────────────────────
     "Hangi taşıma altta" ve "ne taşıyabiliyor" soruları ekranda AÇIKÇA
     yanıtlanır. Taşınamayan servis bir ARAÇ eksikliği DEĞİLDİR — ekran bu
     ayrımı yazar, aksi hâlde taşıma sınırı araç kusuru sanılırdı. */
  const pduFields: InspectorField[] = s.pduCapabilities === null
    ? [unavailable({
      id: 'pdu-cap', label: 'PDU taşıması', source: PDU_SRC,
      note: 'Taşıma yeteneği okunamadı.',
    })]
    : [
      observed({
        id: 'pdu-kind', label: 'Aktif PDU taşıması', source: PDU_SRC,
        note: 'Üst katman bu seçimi BİLMEZ; yarın DoIP/J2534 aynı yerden girer.',
      }, s.pduCapabilities.kind),
      observed({
        id: 'pdu-services', label: 'Taşınabilen servisler', source: PDU_SRC,
        note: 'ÖLÇÜM: köprüde karşılığı OLAN servisler. Listede olmayan bir servis '
          + '"araç desteklemiyor" DEMEK DEĞİLDİR — sorulamadı demektir.',
      }, s.pduCapabilities.supportedServices.join(' · ')),
      observed({
        id: 'pdu-arbitrary', label: 'Genel ham PDU yolu', source: PDU_SRC,
        note: 'Bugün HİÇBİR taşımada yok — yeni servis köprü değişikliği gerektirir '
          + '(F3 açık borcu).',
      }, s.pduCapabilities.supportsArbitraryPdu ? 'VAR' : 'YOK'),
    ];

  const isolation: InspectorField[] = [
    ...pduFields,
    s.traceProvenanceMode === null
      ? unavailable({ id: 'prov', label: 'İz yazım damgası', source: SRC, note: 'Okunamadı.' })
      : observed({
        id: 'prov', label: 'İz yazım damgası', source: SRC,
        note: 'Replay koşusunda `replay` olmalı — canlı defter kirlenmez.',
      }, s.traceProvenanceMode),
    count('liveEvents', 'Defterdeki olay', s.liveTraceEventCount, 'Bu süreçteki kanonik iz.'),
    count('replayEvents', 'Replay damgalı olay', s.replayStampedEventCount,
      'Replay turunun yazdığı satırlar — canlı ölçümle KARIŞTIRILAMAZ.'),
    derived({
      id: 'mix', label: 'Karışım denetimi', source: 'devtools/vdkReplayModel',
      note: 'Aktif koşuda CANLI damgalı olay yazılıyorsa izolasyon kusurludur.',
    }, s.active && s.liveTraceEventCount !== null && s.replayStampedEventCount !== null
      ? (s.liveTraceEventCount === s.replayStampedEventCount ? 'TEMİZ' : 'KARIŞIK')
      : null),
  ];

  const fnGaps: InspectorField[] = [
    s.functionalGapSignals.length === 0
      ? observed({
        id: 'fn-gaps', label: 'Fonksiyonel boşluk sinyalleri', source: FN_SRC,
        note: 'Bu süreçte fonksiyonel çözümde yapısal boşluk ölçülmedi.',
      }, 'YOK')
      : observed({
        id: 'fn-gaps', label: 'Fonksiyonel boşluk sinyalleri', source: FN_SRC,
        note: 'BU FAZDA ÇÖZÜLMEZ — ileride Diagnostic Gap Resolver okuyacak.',
      }, s.functionalGapSignals.join(' · ')),
  ];

  const gaps: InspectorField[] = [
    ...fnGaps,
    s.gapSignals === null
      ? unavailable({ id: 'gaps', label: 'Boşluk sinyalleri', source: SRC, note: 'Koşu yok.' })
      : s.gapSignals.length === 0
        ? observed({
          id: 'gaps', label: 'Boşluk sinyalleri', source: SRC,
          note: 'Bu koşuda yapısal boşluk ölçülmedi.',
        }, 'YOK')
        : observed({
          id: 'gaps', label: 'Boşluk sinyalleri', source: SRC,
          note: 'BU FAZDA ÇÖZÜLMEZ — ileride Discovery/Capability katmanı okuyacak.',
        }, s.gapSignals.join(' · ')),
  ];

  /* ── P0-VDK-F2C1 · FONKSİYONEL ÇÖZÜMLEYİCİ ───────────────────────────────
     "Kodları KİM çözdü" sorusu ekranda AÇIKÇA yanıtlanır. `LEGACY_NATIVE`
     görülürse kanonik paritenin KANITLANMADIĞI yazılır — sessiz geçilmez. */
  const functional: InspectorField[] = s.functionalEntries.length === 0
    ? [unavailable({
      id: 'fn-none', label: 'Fonksiyonel çözüm', source: FN_SRC,
      note: 'Bu süreçte Mode 03/07/0A okuması yapılmadı.',
    }, 'Henüz tur koşulmadı — sayaç ÜRETİLMEZ.')]
    : s.functionalEntries.flatMap((e) => {
      const legacy = e.provenance === 'LEGACY_NATIVE';
      const gap = e.provenance === 'NONE';
      const fields: InspectorField[] = [
        observed({
          id: `fn-${e.mode}-src`, label: `Mode ${e.mode} · kaynak`, source: FN_SRC,
          note: legacy
            ? 'LEGACY native listesi kullanıldı — KANONİK PARİTE KANITLANMADI.'
            : gap
              ? 'Ne ham gövde ne native listesi var — sonuç YOK (fail-closed).'
              : 'Kanonik TS çözümleyicisi ürün otoritesidir.',
        }, `${e.provenance}${e.replay ? ' · REPLAY' : ''}`),
        observed({
          id: `fn-${e.mode}-out`, label: `Mode ${e.mode} · çözüm sonucu`, source: FN_SRC,
          note: 'MEVCUT DtcReadSemanticOutcome sözlüğü — ikinci sınıf yok.',
        }, e.parserOutcome ?? (legacy ? 'KANONİK ÇÖZÜM YOK' : 'UNKNOWN')),
        observed({
          id: `fn-${e.mode}-parity`, label: `Mode ${e.mode} · parite`, source: FN_SRC,
          note: e.parity === 'MISMATCH'
            ? 'KANONİK ≠ NATIVE. Kanonik kazandı; çelişki GİZLENMEDİ.'
            : e.parity === 'WITNESS_ABSENT'
              ? 'Replay: native tanık yok — karşılaştırma yapılamadı.'
              : 'Kanonik ve native tanık karşılaştırıldı.',
        }, e.parityDetail === null ? e.parity : `${e.parity} — ${e.parityDetail}`),
        count(`fn-${e.mode}-bytes`, `Mode ${e.mode} · ham hane`, e.inputBytes,
          'Ölçüm; ham gövdenin KENDİSİ taşınmaz.'),
        count(`fn-${e.mode}-rec`, `Mode ${e.mode} · çözülen kayıt`, e.recordsDecoded,
          'Kanonik çözüm yoksa KAYNAK YOK — 0 DEĞİL.'),
        count(`fn-${e.mode}-pad`, `Mode ${e.mode} · dolgu yuvası`, e.paddingRecords,
          '`0000` yuvaları — kod değil ama ölçüm.'),
        count(`fn-${e.mode}-left`, `Mode ${e.mode} · artık hane`, e.leftoverBytes,
          'Yuvaya oturmayan hane; yapısal olarak 0 beklenir.'),
        observed({
          id: `fn-${e.mode}-attr`, label: `Mode ${e.mode} · ECU atfı`, source: FN_SRC,
          note: 'UNKNOWN = kimlik ölçülmedi; tek ECU VARSAYILMAZ.',
        }, e.ecuAttribution),
      ];
      if (e.block !== null) {
        fields.push(observed({
          id: `fn-${e.mode}-block`, label: `Mode ${e.mode} · engel`, source: FN_SRC,
          note: 'Ham gövde neden ürün otoritesi olamadı.',
        }, e.block));
      }
      if (e.malformedReason !== null) {
        fields.push(observed({
          id: `fn-${e.mode}-bad`, label: `Mode ${e.mode} · bozukluk`, source: FN_SRC,
          note: 'Bozukluk GİZLENMEZ; sonuç temiz SAYILMAZ.',
        }, e.malformedReason));
      }
      return fields;
    });

  /* ── P0-VDK-F2C2 · UYGUNLUK KOŞUSU ───────────────────────────────────────
     Koşu HİÇ yapılmadıysa satırlar KAYNAK YOK'tur — "geçti" VARSAYILMAZ.
     `provenance` en kritik alandır: masa başı simülasyonunun PASS vermesi
     SAHA DOĞRULAMASI SAYILMAZ ve ekran bunu açıkça yazar. */
  const c = s.conformance;
  const conformance: InspectorField[] = c === null
    ? [unavailable({
      id: 'cf-none', label: 'Uygunluk koşusu', source: CF_SRC,
      note: 'Bu süreçte uygunluk koşusu YAPILMADI.',
    }, 'Koşu yok — hüküm ÜRETİLMEZ.')]
    : [
      observed({
        id: 'cf-verdict', label: 'Uygunluk hükmü', source: CF_SRC,
        note: 'PASS YALNIZ sıfır fark VE sıfır ölçülmemiş alanla verilir.',
      }, `${c.verdict} — ${CONFORMANCE_VERDICT_LABEL[c.verdict]}`),
      observed({
        id: 'cf-provenance', label: 'Kanıt kaynağı', source: CF_SRC,
        note: c.provenance === 'FIELD'
          ? 'GERÇEK ARAÇ izi — saha kanıtı.'
          : 'MASA BAŞI simülasyonu. PASS verse bile SAHA DOĞRULAMASI SAYILMAZ.',
      }, `${c.provenance} — ${CONFORMANCE_PROVENANCE_LABEL[c.provenance]}`),
      observed({
        id: 'cf-counts', label: 'Denetim sayımı', source: CF_SRC,
        note: 'UNMEASURED bir başarı DEĞİLDİR — koşu EKSİK kalır.',
      }, `MATCH ${c.counts.match} · MISMATCH ${c.counts.mismatch} · UNMEASURED ${c.counts.unmeasured}`),
      observed({
        id: 'cf-stage', label: 'Ulaşılan aşama', source: CF_SRC,
        note: 'COMPARE dışı bir aşama koşunun YARIDA kaldığını gösterir.',
      }, c.stage),
      c.abort === null
        ? observed({
          id: 'cf-abort', label: 'Kesinti', source: CF_SRC,
          note: 'Koşu tüm aşamaları tamamladı.',
        }, 'YOK')
        : observed({
          id: 'cf-abort', label: 'Kesinti', source: CF_SRC,
          note: 'Kesinti GİZLENMEZ; koşu hüküm veremez.',
        }, `${c.abort} — ${c.abortDetail ?? ''}`),
      c.sourceTraceId === null
        ? unavailable({ id: 'cf-trace', label: 'Kaynak iz', source: CF_SRC, note: 'İz üretilmedi.' })
        : observed({
          id: 'cf-trace', label: 'Kaynak iz', source: CF_SRC,
          note: 'Koşunun canlı turunda üretilen iz.',
        }, `${c.sourceTraceId} · ${c.sourceEventCount} olay`),
      c.packageChecksum === null
        ? unavailable({ id: 'cf-checksum', label: 'Paket checksum', source: CF_SRC, note: 'Paket üretilmedi.' })
        : observed({
          id: 'cf-checksum', label: 'Paket checksum', source: CF_SRC,
          note: 'FNV-1a; aynı ölçüm aynı paketi üretir.',
        }, c.packageChecksum),
      c.mismatchLayers.length === 0
        ? observed({
          id: 'cf-layers', label: 'Fark katmanları', source: CF_SRC,
          note: 'Hiçbir katmanda sapma ölçülmedi.',
        }, 'YOK')
        : observed({
          id: 'cf-layers', label: 'Fark katmanları', source: CF_SRC,
          note: 'Kök nedene EN YAKIN katman başta.',
        }, c.mismatchLayers.join(' → ')),
      ...c.checks.filter((x) => x.outcome !== 'MATCH').slice(0, 12).map((x) => observed({
        id: `cf-chk-${x.id}`, label: x.label, source: CF_SRC,
        note: x.detail ?? CONFORMANCE_OUTCOME_LABEL[x.outcome],
      }, x.outcome)),
    ];

  /* Boşluk sicili — gelecekteki çözücünün girdisi; bugün ÇÖZÜLMEZ. */
  const registry: InspectorField[] = s.gapRegistry.length === 0
    ? [observed({
      id: 'gap-reg', label: 'Boşluk sicili', source: GAP_SRC,
      note: 'Bu süreçte yapısal boşluk KAYDEDİLMEDİ.',
    }, 'BOŞ')]
    : [
      observed({
        id: 'gap-reg', label: 'Boşluk sicili', source: GAP_SRC,
        note: 'KAYIT amaçlıdır — hiçbir boşluk otomatik kapatılmaz.',
      }, s.gapRegistry.slice(0, 8)
        .map((e) => `${e.signal}@${e.context}×${e.count}`).join(' · ')),
      count('gap-reg-drop', 'Sicil tavanı düşümü', s.gapRegistryDropped,
        'Tavan aşımı SESSİZ DEĞİLDİR.'),
    ];

  const byId: Record<VrSectionId, InspectorField[]> = {
    conformance, run, accounting, parity, functional, isolation,
    gaps: [...gaps, ...registry],
  };

  return {
    verdict,
    verdictLabel: REPLAY_VERDICT_LABEL[verdict],
    sections: VR_SECTION_ORDER.map((id) => ({ id, title: VR_SECTION_TITLE[id], fields: byId[id] })),
  };
}
