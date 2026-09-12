import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { getPerformanceProfilerLabModel } from '../../../platform/devtools/performanceProfilerModel';
import { refreshCanBridgeMetrics } from '../../../platform/perf/canBridgeMetrics';
import { buildPerfBaselineExport, serializePerfBaseline }
  from '../../../platform/perf/perfBaselineExport';

type Model = ReturnType<typeof getPerformanceProfilerLabModel>;

const CARD = 'rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]';
const ROW = 'border-b border-[var(--oem-line)] px-3 py-1 font-mono text-[9px] last:border-b-0';
const HEAD = `${ROW} font-bold text-[var(--oem-ink-1)]`;

/** Ölçülmemiş değer `—` gösterilir; **0 YAZILMAZ** (0 bir ölçümdür). */
function fmt(value: number | null, unit: string): string {
  if (value === null) return '—';
  const v = Math.abs(value) >= 100 ? Math.round(value)
    : Math.abs(value) >= 1 ? Math.round(value * 10) / 10
      : Math.round(value * 1000) / 1000;
  return unit === 'none' ? String(v) : `${v} ${unit}`;
}

/** Ölçüm sınıfına göre renk — hüküm DEĞİL, yalnız "ölçüldü mü" ayrımı. */
function kindTone(kind: string): string {
  if (kind === 'MEASURED') return 'text-[var(--oem-ok)]';
  if (kind === 'DERIVED') return 'text-[var(--oem-info)]';
  return 'text-[var(--oem-ink-3)]';
}

/**
 * ARCH-06/F1 gözlem yüzeyi — SALT OKUNUR.
 *
 * Benchmark ÇALIŞTIRMAZ, sayaç SIFIRLAMAZ, mod DEĞİŞTİRMEZ, cache BOŞALTMAZ,
 * servis BAŞLATMAZ. Açılışta TEK okuma yapar; yenileme ELLEDİR (timer YOK).
 *
 * Bu ekran **T2** kademesidir: pahalı projeksiyon yalnız burası MOUNT
 * edildiğinde koşar. Ekran kapalıyken T0 sayaçları çalışmaya devam eder ama
 * hiçbir toplama yapılmaz.
 */
export const PerformanceProfilerScreen = memo(function PerformanceProfilerScreen() {
  const mountedRef = useRef(true);
  const [model, setModel] = useState<Model>(() => getPerformanceProfilerLabModel());

  useEffect(() => {
    mountedRef.current = true;
    /* Native CAN sayaçları ASENKRON okunur; açılışta BİR KEZ çekilir ve
       sonuç bir sonraki yenilemede görünür. Okuma yan etkisizdir. */
    void refreshCanBridgeMetrics().then(() => {
      if (mountedRef.current) setModel(getPerformanceProfilerLabModel());
    });
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    void refreshCanBridgeMetrics().finally(() => {
      if (mountedRef.current) setModel(getPerformanceProfilerLabModel());
    });
  }, []);

  /* Taban paketini ÜRETİR ve ekranda gösterir. Ağa ÇIKMAZ, dosya YAZMAZ,
     ölçüm TETİKLEMEZ — yalnız o an ölçülmüş olanı paketler. Nereye
     taşınacağı kullanıcının kararıdır. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const exportBaseline = useCallback(() => {
    const pkg = buildPerfBaselineExport({
      scenario: 'AD_HOC',
      environment: 'UNKNOWN',
    });
    if (mountedRef.current) setBaseline(serializePerfBaseline(pkg));
  }, []);

  const can = model.canBridge;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="performance-profiler">
      <div className={`${CARD} px-3 py-2`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-[11px] font-bold text-[var(--oem-info)]">
            <Activity size={13} /> PERFORMANCE / RUNTIME PROFILER — ARCH-06/F1
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button" onClick={refresh} data-testid="perf-refresh"
              className="flex items-center gap-1 rounded border border-[var(--oem-line)] px-2 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]"
            >
              <RefreshCw size={10} /> YENİLE
            </button>
            <button
              type="button" onClick={exportBaseline} data-testid="perf-baseline-export"
              className="rounded border border-[var(--oem-line)] px-2 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]"
            >
              TABAN ÜRET
            </button>
          </div>
        </div>
        <p className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">
          SALT OKUNUR. Benchmark çalıştırmaz, sayaç sıfırlamaz, mod değiştirmez.
          Ölçülmeyen değer <b>—</b> gösterilir; <b>0 YAZILMAZ</b> (0 bir ölçümdür).
        </p>
        <p className="mt-1 font-mono text-[9px] text-[var(--oem-ink-2)]">
          ÖLÇÜM KAPSAMI: {model.measuredMetricCount}/{model.totalMetricCount} metrik ölçüldü
        </p>
      </div>

      {/* ── BOOT KİLOMETRE TAŞLARI ────────────────────────────────────── */}
      <div className={CARD} data-testid="perf-milestones">
        <div className={HEAD}>BOOT KİLOMETRE TAŞLARI</div>
        {model.milestones.map((m) => (
          <div key={m.milestone} className={ROW}>
            <b>{m.milestone}</b>{' · '}
            <span className={m.status === 'OBSERVED' ? 'text-[var(--oem-ok)]' : 'text-[var(--oem-ink-3)]'}>
              {m.elapsedMs === null ? 'ÖLÇÜLMEDİ' : `+${m.elapsedMs} ms`}
            </span>
            <div className="text-[var(--oem-ink-3)]">{m.provenance ?? 'damga alınmadı'}</div>
          </div>
        ))}
      </div>

      {/* ── SERVİS SÜRELERİ ───────────────────────────────────────────── */}
      <div className={CARD} data-testid="perf-services">
        <div className={HEAD}>SERVİS BAŞLATMA SÜRELERİ ({model.services.length})</div>
        {model.services.length === 0 && (
          <div className={`${ROW} text-[var(--oem-ink-3)]`}>KAYNAK YOK — boot bu oturumda ölçülmedi.</div>
        )}
        {model.services.map((s, i) => (
          <div key={`${s.serviceId}-${i}`} className={ROW}>
            <b>{s.serviceId}</b> · W{s.wave} · {s.durationMs === null ? '—' : `${s.durationMs} ms`}
            {' · '}{s.outcome}{s.blocking ? ' · blocking' : ' · non-blocking'}
          </div>
        ))}
      </div>

      {/* ── NATIVE CAN KÖPRÜSÜ ────────────────────────────────────────── */}
      <div className={CARD} data-testid="perf-can-bridge">
        <div className={HEAD}>NATIVE CAN KÖPRÜSÜ (coalescing kanıtı)</div>
        <div className={`${ROW} text-[var(--oem-ink-3)]`}>durum: {can.state} · {can.reason}</div>
        {can.metrics !== null && (
          <>
            <div className={ROW}>giren çağrı: {can.metrics.inputCount} · JS’e emit: {can.metrics.emitCount}</div>
            <div className={ROW}>
              birleştirilen (ara değer JS’e GİTMEDİ): {can.metrics.coalescedOverwriteCount}
              {' · '}dedup atlanan: {can.metrics.dedupSkippedCount}
            </div>
            <div className={ROW}>
              güvenlik bypass (reverse/parkingBrake): {can.metrics.safetyBypassCount}
              {' · '}pencere: {can.metrics.windowMs} ms
            </div>
            <div className={ROW}>
              sniffer emit: {can.metrics.snifferEmitCount} · sniffer aktif: {String(can.metrics.snifferActive)}
            </div>
          </>
        )}
      </div>

      {/* ── METRİK BÖLÜMLERİ ──────────────────────────────────────────── */}
      {model.sections.map((sec) => (
        <div key={sec.sectionId} className={CARD} data-testid={`perf-section-${sec.sectionId}`}>
          <div className={HEAD}>{sec.sectionId.toUpperCase()}</div>
          {sec.metrics.map((m) => (
            <div key={m.name} className={ROW}>
              <span className={kindTone(m.kind)}>{fmt(m.value, m.unit)}</span>
              {' · '}<b>{m.name}</b>
              <div className="text-[var(--oem-ink-3)]">
                {m.owner} · {m.kind} · {m.freshness}
                {m.sampleWindowMs !== null ? ` · pencere ${Math.round(m.sampleWindowMs)} ms` : ''}
                {m.provenance.length > 0 ? ` · ${m.provenance[0]}` : ''}
              </div>
            </div>
          ))}
          {sec.notes.map((n) => (
            <div key={n} className={`${ROW} text-[var(--oem-warn)]`}>⚠ {n}</div>
          ))}
        </div>
      ))}

      {/* ── TIMER ENVANTERİ ───────────────────────────────────────────── */}
      <div className={CARD} data-testid="perf-timers">
        <div className={HEAD}>TIMER ENVANTERİ ({model.timers.length} bildirilen)</div>
        {model.timers.map((t) => (
          <div key={t.timerId} className={ROW}>
            <b>{t.timerId}</b> · {t.timerClass} · <span className="text-[var(--oem-info)]">{t.decision}</span>
            <div className="text-[var(--oem-ink-3)]">
              {t.owner} · {t.baseCadenceMs === null ? 'kadans —' : `${t.baseCadenceMs} ms`}
              {' · '}baskı: {String(t.pressureSensitive)} · {t.sourceRef}
            </div>
            <div className="text-[var(--oem-ink-3)]">{t.rationale}</div>
          </div>
        ))}
      </div>

      {/* ── HARİTA ÖRNEĞİ YAŞAM DÖNGÜSÜ (F0 açık sorusunun cevabı) ────── */}
      <div className={CARD} data-testid="perf-map-instances">
        <div className={HEAD}>MAPLIBRE ÖRNEK YAŞAM DÖNGÜSÜ</div>
        <div className={ROW}>
          şu an canlı: <b>{model.mapInstances.active}</b>
          {' · '}eşzamanlı zirve: <b>{model.mapInstances.peakConcurrent}</b>
          {' · '}kurulan: {model.mapInstances.createdTotal}
          {' · '}yıkılan: {model.mapInstances.destroyedTotal}
        </div>
        <div className={`${ROW} text-[var(--oem-ink-3)]`}>
          eşzamanlı gözlendi mi: {String(model.mapInstances.concurrentObserved)} —
          zirve &gt; 1 bir ARIZA BEYANI DEĞİLDİR; geçişte kısa örtüşme olabilir.
        </div>
      </div>

      {/* ── RENDER SINIFI SÖZLEŞMESİ ──────────────────────────────────── */}
      <div className={CARD} data-testid="perf-render-class">
        <div className={HEAD}>RENDER SINIFI (etiket — zamanlayıcı DEĞİL)</div>
        {model.renderSurfaces.map((r) => (
          <div key={r.surfaceId} className={ROW}>
            <b>{r.surfaceId}</b> · <span className="text-[var(--oem-info)]">{r.renderClass}</span>
            <div className="text-[var(--oem-ink-3)]">{r.cadenceSource}</div>
            <div className="text-[var(--oem-ink-3)]">{r.notes}</div>
          </div>
        ))}
      </div>

      {/* ── BELLEK BASKI MERDİVENİ (F5) ───────────────────────────────── */}
      <div className={CARD} data-testid="perf-memory-trim">
        <div className={HEAD}>
          BELLEK BASKI MERDİVENİ · kademe: <span className="text-[var(--oem-info)]">
            {model.memoryTrim.currentLevel}</span>
        </div>
        <div className={`${ROW} text-[var(--oem-ink-3)]`}>
          katılımcı: {model.memoryTrim.participantCount}
          {' · '}bayt ölçülen: {model.memoryTrim.measuredByteParticipants}
          {' · '}kademe sayısı: {model.memoryTrim.ladder.length}
        </div>
        {model.memoryTrim.participants.map((pt) => (
          <div key={pt.id} className={ROW}>
            <b>{pt.id}</b> · {pt.participantClass} · kademe: {pt.trimLevel}
            <div className="text-[var(--oem-ink-3)]">
              {pt.owner} · bayt: {pt.estimatedBytes === null ? 'ÖLÇÜLMEDİ' : pt.estimatedBytes}
              {' · '}yeniden kurulum: {pt.rebuildCost} · trim: {pt.trimCount}
            </div>
          </div>
        ))}
        <div className={`${ROW} text-[var(--oem-warn)]`}>
          ⚠ Canlı araç gerçeği, aktif navigasyon, medya oturumu ve güvenlik durumu
          KATILIMCI OLAMAZ — kaydedilmeyen şey silinemez (yapısal koruma).
        </div>
      </div>

      {/* ── KÖPRÜ TRAFİK SINIFLARI (F4) ───────────────────────────────── */}
      <div className={CARD} data-testid="perf-bridge-policy">
        <div className={HEAD}>KÖPRÜ TRAFİK SINIFLARI</div>
        {model.bridgeSurfaces.map((b) => (
          <div key={b.surfaceId} className={ROW}>
            <b>{b.surfaceId}</b> · <span className="text-[var(--oem-info)]">{b.trafficClass}</span>
            {b.safetyCritical && <span className="text-[var(--oem-warn)]"> · GÜVENLİK-KRİTİK</span>}
            <div className="text-[var(--oem-ink-3)]">uygulayan: {b.enforcedBy}</div>
            <div className="text-[var(--oem-ink-3)]">{b.rationale}</div>
          </div>
        ))}
      </div>

      {/* ── SICAK YOL LOG RİSKİ (F2 BACKLOG — bu turda DEĞİŞTİRİLMEDİ) ─── */}
      <div className={CARD} data-testid="perf-hotpath-log">
        <div className={HEAD}>
          SICAK YOL LOG RİSKİ · P0:{model.hotPathLog.byRisk.P0} P1:{model.hotPathLog.byRisk.P1}
          {' '}P2:{model.hotPathLog.byRisk.P2} P3:{model.hotPathLog.byRisk.P3}
        </div>
        {model.hotPathLog.surfaces.map((h) => (
          <div key={h.file} className={ROW}>
            <b>{h.risk}</b> · {h.file}
            <div className="text-[var(--oem-ink-3)]">{h.cadenceSource}</div>
            <div className="text-[var(--oem-ink-3)]">F2: {h.f2Action}</div>
          </div>
        ))}
        {model.hotPathLog.notes.map((n) => (
          <div key={n} className={`${ROW} text-[var(--oem-warn)]`}>⚠ {n}</div>
        ))}
      </div>

      {/* ── TABAN PAKETİ (gizlilik-güvenli) ───────────────────────────── */}
      {baseline !== null && (
        <div className={CARD} data-testid="perf-baseline-output">
          <div className={HEAD}>TABAN PAKETİ — kopyalanabilir JSON</div>
          <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[8px] text-[var(--oem-ink-2)]">
            {baseline}
          </pre>
        </div>
      )}

      {/* ── BELLEK / CACHE ENVANTERİ ──────────────────────────────────── */}
      <div className={CARD} data-testid="perf-memory">
        <div className={HEAD}>BELLEK / CACHE ENVANTERİ ({model.memoryResources.length})</div>
        {model.memoryResources.map((r) => (
          <div key={r.resourceId} className={ROW}>
            <b>{r.resourceId}</b> · {r.memoryClass}
            <div className="text-[var(--oem-ink-3)]">
              {r.owner} · giriş: {r.entries === null ? '—' : r.entries}
              {' · '}bayt: {r.estimatedBytes === null ? 'ÖLÇÜLMEDİ' : r.estimatedBytes}
              {' · '}tavan: {r.configuredLimit === null ? '—' : `${r.configuredLimit} ${r.limitUnit ?? ''}`}
              {' · '}silinebilir: {String(r.evictable)} · baskı kaydı: {String(r.pressureParticipant)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
