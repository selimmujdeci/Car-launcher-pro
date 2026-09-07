/**
 * MapDataPlatformScreen — CAROS LAB · Araç · Harita Veri Platformu.
 *
 * SALT-OKUNUR. `platform/mapdata` sözleşme katmanının beyan edilmiş durumunu
 * gösterir; hiçbir komut GÖNDERMEZ.
 *
 * YAPMADIKLARI (pazarlıksız): sağlayıcı bağlama/çözme · veri kümesi indirme ·
 * ağ çağrısı · lisans kabulü · fusion çalıştırma · timer/polling/abonelik ·
 * yeni global store.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * İKİNCİ OTORİTE DEĞİL: burada gösterilen hak/eşik/politika değerleri
 * kanonik modüllerden AYNEN okunur; ekran kendi hükmünü üretmez ve hiçbir
 * değeri üretim kararına geri beslemez.
 *
 * ÇALIŞMA ZAMANI HARİTA GERÇEĞİ BURADA DEĞİLDİR: onun sahibi NAV v3 L1
 * `MapStore`tur ve `Navigation Core` ekranında gözlenir.
 *
 * GİZLİLİK: koordinat · adres · sorgu metni · kullanıcı verisi bu ekrana
 * GELMEZ. Yalnız sözleşme, hak ve politika değerleri gösterilir.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Layers, Scale } from 'lucide-react';
import {
  readMapDataSnapshot, type MapDataRawSnapshot,
} from '../../../platform/devtools/mapDataSources';
import {
  buildMapDataFields, buildBuildingGapFields, deriveMapDataVerdict, summarizeLicenses, mapDataHeadline,
  MAP_DATA_LAB_VERDICT_LABEL, PORT_LABEL, PORT_UNBOUND_REASON,
  type MapDataLabVerdict,
} from '../../../platform/devtools/mapDataLabModel';
import {
  OBSERVABILITY_LABEL, type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';
import type { PotentialBuildingGap } from '../../../platform/mapdata/resolvers/buildingGapDetector';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

/** "Sağlayıcı yok" bir ARIZA DEĞİLDİR — bilgi tonunda gösterilir. */
const VERDICT_STYLE: Record<MapDataLabVerdict, string> = {
  CONTRACTS_ONLY:  'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  PARTIALLY_BOUND: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  FULLY_BOUND:     'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  UNAVAILABLE:     'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const GATE_STYLE: Record<string, string> = {
  ALLOW:                 'text-[var(--oem-good)]',
  ALLOW_WITH_ATTRIBUTION:'text-[var(--oem-info)]',
  DENY:                  'text-[var(--oem-ink-3)]',
};

const GATE_SHORT: Record<string, string> = {
  ALLOW: 'İZİN',
  ALLOW_WITH_ATTRIBUTION: 'İZİN+ATIF',
  DENY: 'RED',
};

const FieldRow = memo(function FieldRow({ field }: { field: InspectorField }) {
  return (
    <div
      data-testid={`mdp-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source} · LAB okuma anı damgalanmaz
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

export interface MapDataPlatformScreenProps {
  /** Mevcut detector çıktısı; ekran saklamaz, yalnız açılışta/YENİLE'de okur. */
  readonly gapEvidence?: readonly PotentialBuildingGap[] | null;
}

export const MapDataPlatformScreen = memo(function MapDataPlatformScreen({
  gapEvidence = null,
}: MapDataPlatformScreenProps) {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<MapDataRawSnapshot>(() => readMapDataSnapshot(gapEvidence));

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readMapDataSnapshot(gapEvidence));
  }, [gapEvidence]);

  const fields  = useMemo(() => buildMapDataFields(snap), [snap]);
  const gapFields = useMemo(() => buildBuildingGapFields(snap), [snap]);
  const verdict = useMemo(() => deriveMapDataVerdict(snap), [snap]);
  const lic     = useMemo(() => summarizeLicenses(snap.sources), [snap.sources]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="map-data-platform">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Layers size={12} /> HARİTA VERİ PLATFORMU
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — veri indirmez, sağlayıcı bağlamaz
          </span>
          <button
            type="button"
            data-testid="mdp-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ekran L1 MapStore&apos;un ALTINDAKİ veri üretim katmanını gösterir.
          Çalışma zamanı harita gerçeği (karo/graf/POI durumu) burada DEĞİL,
          Navigation Core ekranındadır — ikinci harita gerçeği yüzeyi kurulmaz.
          Koordinat, adres ve sorgu metni bu ekrana hiç gelmez. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Gap evidence — bina gerçeği değildir */}
      <div
        data-testid="mdp-gap-observatory"
        data-publishable="false"
        className="shrink-0 rounded border border-[var(--oem-warn)] bg-[var(--oem-surface-1)]"
      >
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-[var(--oem-warn)]">
          GAP EVIDENCE ≠ MAP TRUTH
        </div>
        <div className="px-3 py-1.5 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          PotentialBuildingGap bir BUILDING değildir. Bu yüzey MapStore yazamaz,
          resolver hükmünü değiştiremez, renderer/routing/CEH davranışı üretemez.
          Evidence akışı bağlı değilse sayılar UNKNOWN kalır. Yalnız elle YENİLE vardır.
        </div>
        {gapFields.map((f) => <FieldRow key={f.id} field={f} />)}
      </div>

      {/* Hüküm */}
      <div
        data-testid="mdp-verdict"
        data-verdict={verdict}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict]}`}
      >
        DURUM: {MAP_DATA_LAB_VERDICT_LABEL[verdict]}
        <div className="mt-1 text-[10px] leading-relaxed opacity-80">{mapDataHeadline(verdict, snap)}</div>
        <div className="mt-1 text-[9px] opacity-50">
          &quot;Sağlayıcı bağlı değil&quot; bir arıza DEĞİLDİR: sözleşme fazında doğru hâl budur.
          Bağlı sağlayıcı olması da veri KAPSAMI olduğu anlamına gelmez.
        </div>
      </div>

      {/* Portlar */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          Sağlayıcı portları
        </div>
        {snap.ports.map((p) => (
          <div
            key={p.portId}
            data-testid={`mdp-port-${p.portId}`}
            data-bound={p.bound ? 'true' : 'false'}
            className="border-b border-[var(--oem-line)] px-3 py-1.5 last:border-b-0"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{PORT_LABEL[p.portId]}</span>
              <span className={`font-mono text-[11px] ${p.bound ? 'text-[var(--oem-good)]' : 'text-[var(--oem-ink-3)]'}`}>
                {p.bound ? (p.providerId ?? 'BAĞLI') : 'BAĞLI DEĞİL'}
              </span>
            </div>
            {!p.bound && (
              <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
                {PORT_UNBOUND_REASON[p.portId]}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lisans kapısı — GERÇEKTEN çalıştırılır */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="flex items-center gap-1 border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          <Scale size={11} /> Lisans kapısı · offline paketleme
        </div>
        <div className="px-3 py-1 font-mono text-[9px] text-[var(--oem-ink-3)]">
          İZİN {lic.offlineAllowed} · RED {lic.offlineDenied} · share-alike {lic.shareAlike}
          {lic.attributionMissing > 0 ? ` · atıf metni eksik ${lic.attributionMissing}` : ''}
        </div>
        {snap.sources.map((s) => (
          <div
            key={s.sourceId}
            data-testid={`mdp-source-${s.sourceId}`}
            data-offline={s.gates.OFFLINE_PACKAGING}
            className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-[var(--oem-line)] px-3 py-1.5"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[11px] text-[var(--oem-ink)]">{s.sourceId}</span>
                <span className="font-mono text-[10px] text-[var(--oem-ink-2)]">{s.license}</span>
                {s.shareAlike && (
                  <span className="rounded border border-[var(--oem-warn)] px-1 font-mono text-[9px] text-[var(--oem-warn)]">
                    share-alike
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
                {s.provenanceNote}
              </div>
            </div>
            <span className={`h-fit shrink-0 font-mono text-[10px] ${GATE_STYLE[s.gates.OFFLINE_PACKAGING] ?? ''}`}>
              {GATE_SHORT[s.gates.OFFLINE_PACKAGING] ?? s.gates.OFFLINE_PACKAGING}
            </span>
          </div>
        ))}
      </div>

      {/* Alanlar */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          Sözleşme ve politika
        </div>
        {fields.map((f) => <FieldRow key={f.id} field={f} />)}
      </div>
    </div>
  );
});

export default MapDataPlatformScreen;
