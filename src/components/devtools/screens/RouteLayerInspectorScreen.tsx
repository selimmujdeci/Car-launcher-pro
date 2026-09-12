/**
 * RouteLayerInspectorScreen — CAROS LAB · Runtime · Rota Katman Denetçisi (#623).
 *
 * NEDEN VAR: #622'de cihazda ÖLÇÜLDÜ ki gece rotası ekranda hâlâ soluk
 * (çekirdek lum 0,128–0,184 · hedef 0,42), ama kök TEŞHİS EDİLEMEDİ: `apk:safe`
 * artefaktında CDP kapalıdır, MapLibre'nin GERÇEK paint değerleri cihazdan
 * okunamıyordu. Ekran görüntüsü SONUCU gösterir, SEBEBİ göstermez. Bu ekran
 * sebebi gösterir: haritada gerçekten hangi renk/opaklık/gradient yazılı.
 *
 * SALT-OKUNUR. Haritaya YAZMAZ, rota ÇİZDİRMEZ, stil YÜKLETMEZ, katman
 * eklemez/kaldırmaz. Hiçbir komut göndermez.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK: rota geometrisi, koordinat, hedef adı ve adres BU EKRANA GELMEZ —
 * yalnız katman kimlikleri ve paint skalerleri okunur.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Layers, AlertTriangle } from 'lucide-react';
import {
  readRouteLayerSnapshot, type RouteLayerRawSnapshot,
} from '../../../platform/devtools/routeLayerSources';
import {
  buildRouteLayerView, type RouteLayerRow, type RouteFindingSeverity,
} from '../../../platform/devtools/routeLayerModel';
import {
  OBSERVABILITY_LABEL, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const SEVERITY_STYLE: Record<RouteFindingSeverity, string> = {
  ROOT: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  WARN: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  INFO: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const SEVERITY_LABEL: Record<RouteFindingSeverity, string> = {
  ROOT: 'KÖK ADAYI',
  WARN: 'UYARI',
  INFO: 'BİLGİ',
};

const Row = memo(function Row({ row }: { row: RouteLayerRow }) {
  return (
    <div
      data-testid={`rl-row-${row.id}`}
      data-class={row.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{row.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{row.value}</span>
        </div>
        {row.note && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{row.note}</div>
        )}
      </div>
      <span
        title={row.klass}
        className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[row.klass]}`}
      >
        {OBSERVABILITY_LABEL[row.klass]}
      </span>
    </div>
  );
});

export const RouteLayerInspectorScreen = memo(function RouteLayerInspectorScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<RouteLayerRawSnapshot>(() => readRouteLayerSnapshot());
  /* Yaş hesabı için okuma anı — `Date.now` EKRANDA tutulur, model SAF kalır. */
  const [readAt, setReadAt] = useState<number>(() => Date.now());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    setSnap(readRouteLayerSnapshot());
    setReadAt(Date.now());
  }, []);

  const view = useMemo(
    () => buildRouteLayerView(snap.probe, snap.decision, readAt),
    [snap, readAt],
  );

  const roots = view.findings.filter((f) => f.severity === 'ROOT');

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="route-layer-inspector">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Layers size={12} /> ROTA KATMAN DENETÇİSİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — haritaya yazmaz
          </span>
          <button
            type="button"
            data-testid="rl-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="rl-probe-klass"
            data-class={view.probeKlass}
            className={`rounded border px-1.5 py-0.5 ${CLASS_STYLE[view.probeKlass]}`}
          >
            {snap.live ? 'CANLI HARİTA' : 'SON FOTOĞRAF'} · {OBSERVABILITY_LABEL[view.probeKlass]}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          {view.probeNote} Rota geometrisi, koordinat ve hedef adı bu ekrana HİÇ gelmez.
          Periyodik yenileme YOKTUR. Beklenen karar `maneuverTier: 0 · hazardHigh: false`
          ile hesaplanır — manevra/tehlike ANLIK durumdur ve fotoğrafın anını taşımaz,
          bu yüzden kılıf rengi farkı tek başına kusur SAYILMAZ.
        </p>
      </div>

      {/* Kök bulgusu — fail-closed: bulgu yoksa "sorun yok" DEMEZ */}
      <div
        data-testid="rl-verdict"
        data-roots={roots.length}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${
          roots.length > 0 ? SEVERITY_STYLE.ROOT : 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]'
        }`}
      >
        {roots.length > 0
          ? <>KÖK ADAYI BULUNDU: {roots.length} adet</>
          : view.visibilityMeasured
            ? <>KÖK ADAYI YOK — rota GÖRÜNÜRLÜĞÜ ölçüldü ve boya kuralları da temiz.
                Yine de bu "ekranda doğru görünüyor" DEMEK DEĞİLDİR: piksel
                parlaklığı yalnız `adb screencap` ile ölçülür.</>
            : <>KÖK ADAYI YOK — ama GÖRÜNÜRLÜK ÖLÇÜLMEDİ. Bu, "rota doğru
                görünüyor" DEMEK DEĞİLDİR; rota ekranın tamamen dışında olsa
                bile paint kuralları sessiz kalır (#625'te cihazda ölçüldü).</>}
      </div>

      {/* Bulgular */}
      {view.findings.length > 0 && (
        <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
          <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            Bulgular
          </div>
          {view.findings.map((f) => (
            <div
              key={f.id}
              data-testid={`rl-finding-${f.id}`}
              data-severity={f.severity}
              className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${SEVERITY_STYLE[f.severity]}`}>
                  {f.severity === 'ROOT' && <AlertTriangle size={9} className="mr-1 inline" />}
                  {SEVERITY_LABEL[f.severity]}
                </span>
                <span className="font-mono text-[11px] text-[var(--oem-ink)]">{f.title}</span>
              </div>
              <div className="mt-0.5 break-all text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
                {f.evidence}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Görünürlük — "boya doğru" ile "ekranda var" AYNI ŞEY DEĞİLDİR (#625) */}
      <div
        data-testid="rl-visibility"
        data-measured={view.visibilityMeasured ? '1' : '0'}
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          Rota Ekranda mı (görünürlük)
        </div>
        {view.visibilityRows.map((r) => <Row key={r.id} row={r} />)}
      </div>

      {/* Yığın gerçeği */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          Yığın / Kaynak
        </div>
        {view.rows.map((r) => <Row key={r.id} row={r} />)}
      </div>

      {/* Katman katman paint gerçeği */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          Katmanlar (alt → üst)
        </div>
        {view.layerRows.length === 0
          ? <div className="px-3 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
              Katman okunamadı — fotoğraf yok ya da harita örneği mevcut değildi.
            </div>
          : view.layerRows.map((r) => <Row key={r.id} row={r} />)}
      </div>

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KAPSAM SINIRI (dürüstlük): bu ekran haritanın PAINT SÖZLEŞMESİNİ ve
        rotanın GÖRÜŞ ALANINDA olup olmadığını okur — ekranda gerçekten hangi
        pikselin çizildiğini ÖLÇMEZ. WebGL çıktısı yalnız `adb screencap` ile
        ölçülür (CDP ekran görüntüsü WebGL'i yakalamaz). "Paint doğru" ile
        "ekranda doğru görünüyor" AYNI ŞEY DEĞİLDİR; bu ekran ikisini birbirine
        karıştırmaz. #625'te cihazda ölçüldü: boya kusursuzken rota görüş
        alanının tamamen dışındaydı ve paint kurallarının hiçbiri tetiklenmedi.
      </p>
    </div>
  );
});
