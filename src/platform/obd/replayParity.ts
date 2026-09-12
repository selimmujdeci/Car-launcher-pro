/**
 * replayParity — P0-VDK-F2B · GERÇEK ↔ REPLAY PARİTE MUHASEBESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bir replay "çalıştı" demek hiçbir şey kanıtlamaz. Kanıtlanması gereken şey
 * şudur: **aynı ham baytlar, aynı ürün sonucunu üretti mi?** Ayrıştıysa
 * NEREDE ayrıştı — hatta mı, çözücüde mi, oturumda mı, otoritede mi?
 *
 * Bu ayrımı ölçmeden "replay geçti" demek, ürünün geçmişte defalarca ödediği
 * kusuru yeniden davet eder: zincirin bir halkası sessizce veri düşürür ve
 * yeşil test onu ÖRTER.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SESSİZ TOLERANS YOK ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Fark bulunursa `PARITY_MISMATCH` denir ve KATMANI söylenir. "Küçük fark",
 * "muhtemelen önemsiz", "yuvarlama" gibi bir kavram YOKTUR. Ölçülemeyen bir
 * alan farkı `UNKNOWN` katmanına düşer ve yine kusur sayılır.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok.
 */

import type { TraceEvent } from './canonicalTrace';

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

/** Farkın DOĞDUĞU katman — "bir yerde bozuldu" yeterli bir cevap değildir. */
export type ParityLayer =
  | 'TRANSPORT'
  | 'PARSER'
  | 'SESSION'
  | 'AUTHORITY'
  | 'VERDICT'
  | 'UNKNOWN';

export const PARITY_LAYER_LABEL: Readonly<Record<ParityLayer, string>> = {
  TRANSPORT: 'taşıma — istek/yanıt/NRC dizisi',
  PARSER:    'çözümleyici — ham gövdeden çıkan kayıtlar',
  SESSION:   'oturum — açılış/keepalive sonucu',
  AUTHORITY: 'otorite — kanonik DTC defteri',
  VERDICT:   'hüküm — kapsam/karar',
  UNKNOWN:   'sınıflandırılamadı — fail-closed',
} as const;

/**
 * Karşılaştırılabilir ürün sonucu.
 *
 * ⚠️ Alanların TAMAMI ÖLÇÜMDÜR. Hiçbiri "hesaplanmış beklenti" değildir —
 * parite, iki ÖLÇÜMÜ karşılaştırır, bir ölçümü bir tahminle değil.
 */
export interface ParitySnapshot {
  /* ── TRANSPORT ────────────────────────────────────────────────────────── */
  /** Sırayla gönderilen ham istekler (`ECU|op|sub|raw`). */
  readonly requests: readonly string[];
  /** Sırayla ölçülen ham yanıtlar; ölçülmediyse `null`. */
  readonly responses: readonly (string | null)[];
  readonly transportOutcomes: readonly (string | null)[];
  readonly nrcs: readonly (number | null)[];
  /* ── SESSION (F1-B) ───────────────────────────────────────────────────── */
  readonly sessionOutcomes: readonly string[];
  readonly testerPresentOutcomes: readonly string[];
  /* ── ISO-TP TUNING (F1-C) ─────────────────────────────────────────────── */
  readonly tuningOutcomes: readonly string[];
  readonly tuningRestoreOutcomes: readonly string[];
  /* ── FONKSİYONEL ÇÖZÜMLEYİCİ (P0-VDK-F2C1) ────────────────────────────
     Mode 03/07/0A artık KANONİK TS çözümleyicisinden geçer. Bu alanlar
     "aynı ham gövde aynı kodları verdi mi" sorusunu doğrudan ölçer.
     `undefined` = bu koşumda ölçülmedi (eski çağıran) — SIFIR DEĞİL. */
  readonly functionalProvenance?: readonly string[];
  readonly functionalOutcomes?: readonly string[];
  readonly functionalCodeIdentities?: readonly string[];
  /* ── PARSER ───────────────────────────────────────────────────────────── */
  readonly parserDtcCount: number;
  /** `P0380(11)|09` — kod + alt kod + ham status. Sıra ÖNEMLİ. */
  readonly parserDtcIdentities: readonly string[];
  /* ── AUTHORITY ────────────────────────────────────────────────────────── */
  readonly authorityDtcCount: number;
  readonly authorityDtcIdentities: readonly string[];
  /* ── VERDICT ──────────────────────────────────────────────────────────── */
  readonly coverage: string | null;
  readonly verdict: string | null;
}

export interface ParityMismatch {
  readonly layer: ParityLayer;
  readonly field: string;
  readonly real: string;
  readonly replay: string;
  readonly detail: string;
}

export type ParityVerdict = 'PASS' | 'PARITY_MISMATCH';

export interface ParityResult {
  readonly verdict: ParityVerdict;
  readonly mismatches: readonly ParityMismatch[];
  /** Fark bulunan katmanlar — en erken (en aşağı) katman ÖNCE. */
  readonly layers: readonly ParityLayer[];
}

/* ══════════════════════════════════════════════════════════════════════════
   2) İZDEN ANLIK GÖRÜNTÜ
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir olayın karşılaştırılabilir istek künyesi. */
function requestKey(e: TraceEvent): string {
  return `${e.ecuTxHeader ?? '-'}|${e.operation}|${e.subFunction ?? '-'}|${e.rawRequest ?? '-'}`;
}

/**
 * İzin taşıma/oturum/tuning kısmını çıkarır.
 *
 * Parser/authority alanları İZDE YOKTUR (iz hüküm taşımaz) — onları çağıran
 * ürün defterinden verir. Bu ayrım bilinçlidir: iz ÖLÇÜMDÜR, defter HÜKÜMDÜR
 * ve ikisi tek yapıda karışırsa hangi katmanın ayrıştığı ölçülemez.
 */
export function transportSnapshotFromTrace(events: readonly TraceEvent[]): Pick<
  ParitySnapshot,
  'requests' | 'responses' | 'transportOutcomes' | 'nrcs'
  | 'sessionOutcomes' | 'testerPresentOutcomes'
  | 'tuningOutcomes' | 'tuningRestoreOutcomes'
> {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const io = ordered.filter((e) => e.direction === 'request_response');
  return {
    requests: io.map(requestKey),
    responses: io.map((e) => e.rawResponse),
    transportOutcomes: io.map((e) => e.transportOutcome),
    nrcs: io.map((e) => e.nrc),
    sessionOutcomes: ordered
      .filter((e) => e.operation === 'session_open')
      .map((e) => `${e.ecuTxHeader ?? '-'}:${e.transportOutcome ?? 'UNKNOWN'}`),
    testerPresentOutcomes: ordered
      .filter((e) => e.operation === 'tester_present')
      .map((e) => `${e.ecuTxHeader ?? '-'}:${e.transportOutcome ?? 'UNKNOWN'}`),
    tuningOutcomes: ordered
      .filter((e) => e.operation === 'isotp_tuning_apply')
      .map((e) => `${e.ecuTxHeader ?? '-'}:${e.transportOutcome ?? 'UNKNOWN'}`),
    tuningRestoreOutcomes: ordered
      .filter((e) => e.operation === 'isotp_tuning_restore')
      .map((e) => `${e.ecuTxHeader ?? '-'}:${e.transportOutcome ?? 'UNKNOWN'}`),
  };
}

/**
 * Fonksiyonel çözümleyici kanıtından karşılaştırılabilir görüntü çıkarır.
 *
 * ⚠️ `provenance` KASITLI olarak parite alanıdır: canlı turda `CANONICAL_TS`
 * iken replay'de `LEGACY_NATIVE` çıkarsa, kodlar tesadüfen aynı olsa bile
 * ürün ONLARI FARKLI BİR OTORİTEDEN almıştır ve bu bir sapmadır.
 * `parity` alanı KARŞILAŞTIRILMAZ: canlı turda native tanık VARDIR, replay'de
 * yoktur (`WITNESS_ABSENT`) — bu tasarım gereğidir, sapma değil.
 */
export function functionalSnapshotFromEvidence(
  entries: readonly {
    readonly mode: string; readonly provenance: string;
    readonly parserOutcome: string | null; readonly authorityCodeCount: number;
  }[],
  codesByMode: ReadonlyMap<string, readonly string[]>,
): Pick<ParitySnapshot, 'functionalProvenance' | 'functionalOutcomes' | 'functionalCodeIdentities'> {
  const ordered = [...entries].sort((a, b) => a.mode.localeCompare(b.mode));
  return {
    functionalProvenance: ordered.map((e) => `${e.mode}:${e.provenance}`),
    functionalOutcomes: ordered.map((e) => `${e.mode}:${e.parserOutcome ?? 'UNKNOWN'}`),
    functionalCodeIdentities: ordered.flatMap((e) =>
      (codesByMode.get(e.mode) ?? []).map((c) => `${e.mode}:${c}`)),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KARŞILAŞTIRMA
   ══════════════════════════════════════════════════════════════════════════ */

function _cmpList(
  out: ParityMismatch[], layer: ParityLayer, field: string,
  real: readonly (string | number | null)[], replay: readonly (string | number | null)[],
): void {
  if (real.length !== replay.length) {
    out.push({
      layer, field, real: String(real.length), replay: String(replay.length),
      detail: `${field}: ${real.length} → ${replay.length} (adet farkı)`,
    });
    return;
  }
  for (let i = 0; i < real.length; i++) {
    const a = real[i] ?? null; const b = replay[i] ?? null;
    if (a !== b) {
      out.push({
        layer, field: `${field}[${i}]`, real: String(a), replay: String(b),
        detail: `${field} #${i}: "${String(a)}" → "${String(b)}"`,
      });
    }
  }
}

function _cmpScalar(
  out: ParityMismatch[], layer: ParityLayer, field: string,
  real: string | number | null, replay: string | number | null,
): void {
  if ((real ?? null) !== (replay ?? null)) {
    out.push({
      layer, field, real: String(real), replay: String(replay),
      detail: `${field}: "${String(real)}" → "${String(replay)}"`,
    });
  }
}

/** Katman önceliği — en AŞAĞI katman kök nedene en yakındır. */
const LAYER_ORDER: readonly ParityLayer[] =
  ['TRANSPORT', 'SESSION', 'PARSER', 'AUTHORITY', 'VERDICT', 'UNKNOWN'];

/**
 * İki ölçümü karşılaştırır ve **farkın katmanını** söyler.
 *
 * Sıra rastgele değildir: taşıma farkı varsa çözücü farkı ONUN SONUCUdur;
 * kök nedeni en aşağı katman verir. Bu yüzden `layers` alanı aşağıdan
 * yukarıya sıralanır ve ilk eleman kök nedene en yakın olandır.
 */
export function compareParity(real: ParitySnapshot, replay: ParitySnapshot): ParityResult {
  const m: ParityMismatch[] = [];

  _cmpList(m, 'TRANSPORT', 'requests', real.requests, replay.requests);
  _cmpList(m, 'TRANSPORT', 'responses', real.responses, replay.responses);
  _cmpList(m, 'TRANSPORT', 'transportOutcomes', real.transportOutcomes, replay.transportOutcomes);
  _cmpList(m, 'TRANSPORT', 'nrcs', real.nrcs, replay.nrcs);

  _cmpList(m, 'SESSION', 'sessionOutcomes', real.sessionOutcomes, replay.sessionOutcomes);
  _cmpList(m, 'SESSION', 'testerPresentOutcomes', real.testerPresentOutcomes, replay.testerPresentOutcomes);
  /* Tuning bir TAŞIMA gerçeğidir (ISO-TP akış kontrolü) — kendi katmanı YOK,
     ikinci bir sınıflandırma sözlüğü KURULMAZ. */
  _cmpList(m, 'TRANSPORT', 'tuningOutcomes', real.tuningOutcomes, replay.tuningOutcomes);
  _cmpList(m, 'TRANSPORT', 'tuningRestoreOutcomes', real.tuningRestoreOutcomes, replay.tuningRestoreOutcomes);

  /* Fonksiyonel çözümleyici PARSER katmanındadır — ikinci katman AÇILMAZ.
     Alan yalnız İKİ tarafta da ölçüldüyse karşılaştırılır; tek taraflı ölçüm
     sahte bir fark üretirdi. */
  if (real.functionalProvenance !== undefined && replay.functionalProvenance !== undefined) {
    _cmpList(m, 'PARSER', 'functionalProvenance', real.functionalProvenance, replay.functionalProvenance);
  }
  if (real.functionalOutcomes !== undefined && replay.functionalOutcomes !== undefined) {
    _cmpList(m, 'PARSER', 'functionalOutcomes', real.functionalOutcomes, replay.functionalOutcomes);
  }
  if (real.functionalCodeIdentities !== undefined && replay.functionalCodeIdentities !== undefined) {
    _cmpList(m, 'PARSER', 'functionalCodeIdentities',
      real.functionalCodeIdentities, replay.functionalCodeIdentities);
  }
  _cmpScalar(m, 'PARSER', 'parserDtcCount', real.parserDtcCount, replay.parserDtcCount);
  _cmpList(m, 'PARSER', 'parserDtcIdentities', real.parserDtcIdentities, replay.parserDtcIdentities);

  _cmpScalar(m, 'AUTHORITY', 'authorityDtcCount', real.authorityDtcCount, replay.authorityDtcCount);
  _cmpList(m, 'AUTHORITY', 'authorityDtcIdentities', real.authorityDtcIdentities, replay.authorityDtcIdentities);

  _cmpScalar(m, 'VERDICT', 'coverage', real.coverage, replay.coverage);
  _cmpScalar(m, 'VERDICT', 'verdict', real.verdict, replay.verdict);

  const present = new Set(m.map((x) => x.layer));
  return {
    verdict: m.length === 0 ? 'PASS' : 'PARITY_MISMATCH',
    mismatches: m,
    layers: LAYER_ORDER.filter((l) => present.has(l)),
  };
}

/** Farkın kök nedene en yakın katmanı; fark yoksa `null`. */
export function rootMismatchLayer(r: ParityResult): ParityLayer | null {
  return r.layers[0] ?? null;
}
