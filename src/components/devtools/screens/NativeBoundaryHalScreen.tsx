/**
 * NativeBoundaryHalScreen — ARCH-04/F5 · Native Boundary / HAL (SALT-OKUNUR).
 *
 * TAMAMEN OKUMA: izin istemez · servis başlatmaz/durdurmaz · PDU göndermez ·
 * oynat/duraklat yapmaz · Bluetooth açmaz · geri çağrı enjekte etmez ·
 * fallback zorlamaz · depoyu temizlemez · CAN dinleyicisi başlatmaz.
 *
 * Timer ve abonelik YOKTUR: açılışta tek okuma + elle YENİLE.
 */
import { memo, useCallback, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { readNativeBoundarySnapshot } from '../../../platform/devtools/nativeBoundarySources';
import { BRIDGE_AVAILABILITY_IS_NOT_AUTHORIZATION } from '../../../platform/native/nativeHalEvidence';

const NA = 'KAYNAK YOK';

export const NativeBoundaryHalScreen = memo(function NativeBoundaryHalScreen() {
  const [snapshot, setSnapshot] = useState(() => readNativeBoundarySnapshot());
  const refresh = useCallback(() => setSnapshot(readNativeBoundarySnapshot()), []);

  if (snapshot === null) {
    return <div data-testid="native-boundary-hal" className="p-3 font-mono text-[10px]">
      {NA} — native sınır kanıdı okunamadı; sonuç uydurulmadı.
    </div>;
  }

  const { hal, conformance, negotiation, phoneIngress, obdProvenance, canProvenance, storageWrites } = snapshot;

  return <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="native-boundary-hal">
    <div className="rounded border border-[var(--oem-line)] p-3">
      <div className="flex items-center gap-2 font-mono text-[11px]">
        <ShieldCheck size={13} /> NATIVE BOUNDARY / HAL — READ ONLY
      </div>
      <div className="mt-1 font-mono text-[9px] opacity-70">{BRIDGE_AVAILABILITY_IS_NOT_AUTHORIZATION}</div>
      <div className="mt-1 font-mono text-[9px] opacity-70">
        KAYNAK BAĞLI ≠ DOMAIN HAZIR · İZİN VERİLDİ ≠ HAZIR · YETENEK VAR ≠ İŞLEM BAŞARILI · YEDEK AKTİF ≠ ASIL SAĞLIKLI
      </div>
      <button type="button" data-testid="nbh-refresh" onClick={refresh} className="mt-2 inline-flex items-center gap-1 font-mono text-[9px]">
        <RefreshCw size={11} /> YENİLE
      </button>
    </div>

    <section data-testid="nbh-sources" className="rounded border border-[var(--oem-line)] p-3 font-mono text-[9px]">
      <div className="mb-1 opacity-70">KAYNAKLAR ({hal.sources.length}) · atlatma={hal.authorityBypassCount}</div>
      {hal.sources.map((s) => <div key={s.sourceId} data-testid={`nbh-source-${s.sourceId}`} className="border-t border-[var(--oem-line)] py-1">
        <div>{s.sourceId} · owner={s.owner} · bridge={s.bridge}</div>
        <div>permission={s.readiness.permissionState} · capability={s.readiness.capabilityAvailable} · ready={s.readiness.serviceReady} · op={s.readiness.operationAllowed} · lastResult={s.lastResultClass}</div>
        <div>fallback={s.readiness.fallback} · resilience={s.readiness.resilience} · generation={s.sessionGeneration ?? NA} · staleGuard={String(s.staleGuard)} · staleRejected={s.staleRejectedCount ?? NA}</div>
        <div>blockers={s.readiness.blockers.join(', ') || 'YOK'} · reason={s.readiness.reason}</div>
        <div className="opacity-70">provenance={s.readiness.provenance.join(' · ') || NA}</div>
        <div className="opacity-70">{s.notes}</div>
      </div>)}
    </section>

    <section data-testid="nbh-conformance" className="rounded border border-[var(--oem-line)] p-3 font-mono text-[9px]">
      <div className="mb-1 opacity-70">
        UYGUNLUK MATRİSİ · PASS={conformance.pass} · PARTIAL={conformance.partial} · UNKNOWN={conformance.unknown}
        {' · '}uygulama açığı={conformance.implementationGaps.join(', ') || 'YOK'}
        {' · '}kanıt açığı={conformance.evidenceGaps.join(', ') || 'YOK'}
      </div>
      {conformance.rows.map((r) => <div key={r.capabilityId} data-testid={`nbh-conformance-${r.capabilityId}`} className="border-t border-[var(--oem-line)] py-1">
        <div>{r.capabilityId} · owner={String(r.ownerKnown)} · bridge={String(r.bridgeKnown)} · result={String(r.resultSemanticsKnown)} · stale={String(r.staleGuardObserved)} · permission={String(r.permissionSemanticsKnown)} · fallback={String(r.fallbackSemanticsKnown)} · privacy={String(r.privacyGuard)} · bypass={String(r.authorityBypassRisk)} · status={r.status} · gap={r.gap}</div>
        <div className="opacity-70">{r.evidence}</div>
      </div>)}
    </section>

    <section data-testid="nbh-negotiation" className="rounded border border-[var(--oem-line)] p-3 font-mono text-[9px]">
      <div className="mb-1 opacity-70">
        YETENEK PAZARLIĞI · toplam={negotiation.total} · var={negotiation.available} · yok={negotiation.notSupported} · bilinmiyor={negotiation.unknown}
        {' · '}yedeksiz eksik={negotiation.unsupportedWithoutFallback.join(', ') || 'YOK'}
      </div>
      {negotiation.rows.map((m) => <div key={m.id} data-testid={`nbh-method-${m.id}`}>
        {m.id} · {m.bridge}.{m.method} · methodKnown={String(m.methodKnown)} · available={m.methodAvailable === null ? NA : String(m.methodAvailable)} · capability={m.nativeCapabilityKnown} · resultSemantics={String(m.resultSemanticsKnown)} · fallback={String(m.fallbackAvailable)} · operationProven={String(m.operationProven)} · status={m.status} · {m.reason}
      </div>)}
    </section>

    <section data-testid="nbh-phone" className="rounded border border-[var(--oem-line)] p-3 font-mono text-[9px]">
      <div className="mb-1 opacity-70">PHONE NATIVE GİRİŞ (companion otoritesine ÖNERİ — gerçek YAZILMAZ)</div>
      {phoneIngress === null ? <div>{NA}</div> : <>
        <div>stage={phoneIngress.stage} · acceptedGeneration={phoneIngress.acceptedGeneration ?? NA} · accepted={phoneIngress.acceptedCount} · stale={phoneIngress.staleRejectedCount} · malformed={phoneIngress.malformedRejectedCount} · unavailable={phoneIngress.unavailableCount}</div>
        <div>doğrudan companion gerçeği yazımı={phoneIngress.directCompanionTruthWrites}</div>
        {phoneIngress.recent.length === 0 ? <div>giriş olayı ÖLÇÜLMEDİ</div>
          : phoneIngress.recent.map((e) => <div key={e.seq}>#{e.seq} · {e.verdict} · stage={e.stage} · gen={e.generation ?? NA} · caps={e.capabilityCount} · err={e.lastErrorCode ?? 'YOK'} · {e.reason}</div>)}
      </>}
    </section>

    <section data-testid="nbh-obd" className="rounded border border-[var(--oem-line)] p-3 font-mono text-[9px]">
      <div className="mb-1 opacity-70">OBD NATIVE SINIR KÖKENİ (ham PDU/ham yanıt TAŞINMAZ)</div>
      {obdProvenance === null ? <div>{NA}</div> : <>
        <div>toplam={obdProvenance.total} · bayat epoch={obdProvenance.staleEpochResults} · kapı reddi={obdProvenance.safetyGateDenials} · taşınamadı={obdProvenance.transportUnsupported} · bayat sonuç gerçeğe yazıldı={obdProvenance.staleResultsAcceptedAsTruth}</div>
        {obdProvenance.recent.length === 0 ? <div>PDU ÖLÇÜLMEDİ</div>
          : obdProvenance.recent.map((r) => <div key={r.seq}>#{r.seq} · {r.bridgeMethod} · svc={r.serviceRef} · target={r.targetRef ?? NA} · reqEpoch={r.requestEpoch ?? NA} · resEpoch={r.resultEpoch ?? NA} · freshness={r.freshness} · result={r.nativeResultClass} · latency={r.latencyMs ?? NA} · bytes={r.byteCount ?? NA} · gate={r.gateReason ?? 'YOK'}</div>)}
      </>}
    </section>

    <section data-testid="nbh-can" className="rounded border border-[var(--oem-line)] p-3 font-mono text-[9px]">
      <div className="mb-1 opacity-70">CAN NATIVE SINIR KÖKENİ (köprü ANLAM ÜRETMEZ)</div>
      {canProvenance === null ? <div>{NA}</div> : <>
        <div>kayıt={canProvenance.registrations} · engellenen çift kayıt={canProvenance.duplicateRegistrationsBlocked} · bayat geri çağrı={canProvenance.staleCallbacksRejected} · geç handle={canProvenance.lateHandlesDisposed} · ilk çerçeve={canProvenance.firstFrames} · anlam çıkarımı={canProvenance.semanticInferences}</div>
        {canProvenance.recent.length === 0 ? <div>CAN olayı ÖLÇÜLMEDİ</div>
          : canProvenance.recent.map((r) => <div key={r.seq}>#{r.seq} · {r.eventClass} · gen={r.listenerGeneration ?? NA}/{r.currentGeneration ?? NA} · basis={r.timestampBasis} · nativeTs={r.nativeObservedAtMs ?? NA} · bus={r.busContext ?? NA} · src={r.frameSourceClass} · drop={r.dropErrorClass}</div>)}
      </>}
    </section>

    <section data-testid="nbh-storage" className="rounded border border-[var(--oem-line)] p-3 font-mono text-[9px]">
      <div className="mb-1 opacity-70">SAFESTORAGE TAMAMLANMA KANITI (kısmi tamamlanma BAŞARI DEĞİL)</div>
      {storageWrites === null ? <div>{NA}</div> : <>
        <div>toplam={storageWrites.totalWrites} · başarılı={storageWrites.successCount} · kısmi={storageWrites.partialFailureCount} · yalnız yedek={storageWrites.backupOnlyCount} · düşen={storageWrites.failedCount} · açık={storageWrites.openWrites}</div>
        {storageWrites.recent.length === 0 ? <div>yazım ÖLÇÜLMEDİ</div>
          : storageWrites.recent.map((w) => <div key={w.seq}>#{w.seq} · {w.key} · path={w.path} · bytes={w.byteLength ?? NA} · req={String(w.stages.writeRequested)} · tmp={String(w.stages.tempWriteCompleted)} · stat={String(w.stages.statVerified)} · rename={String(w.stages.renameCompleted)} · verify={String(w.stages.verifyReadCompleted)} · cache={String(w.stages.cacheUpdated)} · backup={String(w.stages.backupUpdated)} · outcome={w.finalOutcome} · failureStage={w.failureStage ?? 'YOK'} · durable={String(w.durableWriteProven)}</div>)}
      </>}
    </section>
  </div>;
});
