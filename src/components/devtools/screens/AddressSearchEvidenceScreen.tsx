/**
 * AddressSearchEvidenceScreen — CAROS LAB · Araç · Adres Arama Kanıtı.
 *
 * SALT-OKUNUR. Adres arama denemelerinin kanıt defterini gösterir; hiçbir arama
 * BAŞLATMAZ, hiçbir sağlayıcıya istek göndermez.
 *
 * NEDEN VAR (teşhis turu 2026-08-11): kullanıcı sahada "adreslerin ~%40'ı
 * bulunamıyor" dedi ve ölçüm denendiğinde ürünün hiçbir arama denemesini
 * KAYDETMEDİĞİ ortaya çıktı. Bu ekran o boşluğun gözlem yüzeyidir: hangi
 * katmanın cevapladığı, kullanıcının sunulanı SEÇİP SEÇMEDİĞİ ve başarısızlığın
 * hangi sebep sınıfına girdiği burada görünür.
 *
 * YAPMADIKLARI (pazarlıksız): arama tetikleme · sağlayıcı seçme · sorgu
 * değiştirme · rota kurma · yeni timer/polling/abonelik · yeni global store.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK (kural 6): aranan ADRES METNİ, sokak adı ve koordinat BU EKRANA
 * GELMEZ — defter zaten metni saklamaz. Yalnız sorgunun BİÇİMİ (sözcük sayısı,
 * "numaralı yol var mı", "kapı no var mı" gibi bayraklar), adetler ve süreler
 * gösterilir. Adres = ev adresi = PII.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, MapPinned, AlertTriangle } from 'lucide-react';
import {
  readAddressSearchSnapshot, readProviderStatus,
  type AddressSearchRawSnapshot,
} from '../../../platform/devtools/addressSearchSources';
import {
  buildAddressSearchView, describeRecord,
  ADDRESS_SEARCH_VERDICT_LABEL, type AddressSearchVerdict,
} from '../../../platform/devtools/addressSearchModel';
import {
  ADDRESS_SEARCH_FAILURE_LABEL, ADDRESS_SEARCH_GAP_LABEL,
} from '../../../platform/geo/addressSearchLedger';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

/** Hüküm rozeti — "kayıt yok" NÖTR kalır, asla "sağlıklı" görünmez. */
const VERDICT_STYLE: Record<AddressSearchVerdict, string> = {
  NO_DATA:           'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  HEALTHY:           'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  FAILURES_PRESENT:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  DOMINANT_CAUSE:    'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  EVIDENCE_TOO_THIN: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  UNAVAILABLE:       'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`as-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
        {field.note && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
        )}
      </div>
      <span
        title={field.klass}
        className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}
      >
        {OBSERVABILITY_LABEL[field.klass]}
      </span>
    </div>
  );
});

export const AddressSearchEvidenceScreen = memo(function AddressSearchEvidenceScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<AddressSearchRawSnapshot>(() => readAddressSearchSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* Sağlayıcı durumu ASENKRON tek okuma (Keystore erişimi senkron değil).
     Sonuç geldiğinde bileşen sökülmüşse state YAZILMAZ. */
  const loadProvider = useCallback((base: AddressSearchRawSnapshot) => {
    void readProviderStatus().then((st) => {
      if (!mountedRef.current || st === null) return;
      setSnap({ ...base, providerName: st.name, providerHasKey: st.hasKey });
    });
  }, []);

  useEffect(() => { loadProvider(snap); /* açılışta bir kez */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    const fresh = readAddressSearchSnapshot();
    setSnap(fresh);
    loadProvider(fresh);
  }, [loadProvider]);

  const view = useMemo(() => buildAddressSearchView(snap), [snap]);

  const classCounts = useMemo(() => {
    const c: Record<Observability, number> = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
    for (const card of view.cards) for (const f of card.fields) c[f.klass] += 1;
    return c;
  }, [view.cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="address-search-evidence">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <MapPinned size={12} /> ADRES ARAMA KANITI
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — arama başlatmaz
          </span>
          <button
            type="button"
            data-testid="as-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {classCounts.OBSERVED} · TÜRETİLDİ {classCounts.DERIVED} ·
            KAYNAK YOK {classCounts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Aranan ADRES METNİ, sokak adı ve koordinat bu ekrana HİÇ GELMEZ — defter zaten
          metni saklamaz. Yalnız sorgunun biçimi (sözcük sayısı, "numaralı yol var mı",
          "kapı no var mı"), adetler, sınıflar ve süreler gösterilir. Defter yalnız RAM'de
          yaşar; oturum bitince silinir. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Hüküm — kanıt yetersizse sınıf İDDİA EDİLMEZ */}
      <div
        data-testid="as-verdict"
        data-verdict={view.verdict}
        title={view.verdict}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[view.verdict]}`}
      >
        ARAMA GERÇEĞİ: {ADDRESS_SEARCH_VERDICT_LABEL[view.verdict]}
        <div className="mt-1 text-[10px] leading-relaxed opacity-80">{view.verdictNote}</div>
        <div className="mt-1 text-[9px] opacity-50">
          "Sonuç döndü" ile "aradığı yer bulundu" AYNI ŞEY DEĞİLDİR. Bu ekran ikisini
          ayırır: kullanıcı sunulan listeden bir şey seçmediyse o deneme ÇÖZÜLMÜŞ SAYILMAZ.
        </div>
      </div>

      {/* Sonraki ölçüm — enstrümantasyon borcu */}
      {view.nextMeasurement !== null && (
        <div
          data-testid="as-next-measurement"
          data-gap={view.nextMeasurement}
          className="shrink-0 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-3 py-2 font-mono text-[10px] text-[var(--oem-warn)]"
        >
          <span className="flex items-center gap-1 font-bold">
            <AlertTriangle size={11} /> ÖNCE BUNU ÖLÇ
          </span>
          <div className="mt-1 text-[10px] leading-relaxed opacity-90">
            {ADDRESS_SEARCH_GAP_LABEL[view.nextMeasurement]}
          </div>
          <div className="mt-1 text-[9px] opacity-70">
            En çok eksik olan kanıt budur. Kapatılmadan kök neden aramak tahmin olur.
          </div>
        </div>
      )}

      {/* Kartlar */}
      {view.cards.map((card) => (
        <div
          key={card.id}
          data-testid={`as-card-${card.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {card.title}
            </span>
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      {/* Deneme defteri — en yeni önce. Metin YOK, yalnız biçim + sınıf. */}
      <div
        data-testid="as-records"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            7 · Deneme Defteri ({view.recent.length})
          </span>
          <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
            en yeni önce · sorgu metni GÖSTERİLMEZ
          </span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {view.recent.length === 0 && (
            <div className="px-2 py-3 text-center font-mono text-[10px] text-[var(--oem-ink-3)]">
              Bu oturumda hiç arama denemesi kaydedilmedi.
            </div>
          )}
          {view.recent.map((rec, i) => (
            <div
              key={`${rec.atMs}-${i}`}
              data-testid={`as-record-${i}`}
              data-failure={rec.refinedFailureClass}
              data-outcome={rec.outcome}
              className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] text-[var(--oem-ink)]">
                  {describeRecord(rec)}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-[var(--oem-ink-3)]">
                  güven {rec.confidence}
                  {rec.providerMs !== null ? ` · ${rec.providerMs} ms` : ' · süre yok'}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
                {ADDRESS_SEARCH_FAILURE_LABEL[rec.refinedFailureClass]}
              </div>
              <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
                {rec.note}
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
                {rec.sourceRef}
                {rec.evidenceGap.length > 0 && (
                  <> · eksik kanıt: {rec.evidenceGap.map((g) => ADDRESS_SEARCH_GAP_LABEL[g]).join(', ')}</>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default AddressSearchEvidenceScreen;
