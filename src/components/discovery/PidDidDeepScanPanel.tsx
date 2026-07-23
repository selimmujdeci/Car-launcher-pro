/**
 * PidDidDeepScanPanel — P0 Deep PID/DID Explorer Faz-1 · minimum "PID/DID Keşfi" ekranı (§H).
 *
 * YENİ, BAĞIMSIZ bileşen — `DiscoveryDashboard.tsx` (PASİF gözlem ekranı, DOKUNULMADI) ile
 * KARIŞTIRILMASIN: bu panel AKTİF, güvenlik-kapılı derin taramayı BAŞLATIR/İZLER/İPTAL EDER
 * (discoveryLive.getLiveDiscoveryCoordinator). Henüz hiçbir router/ayar ekranına BAĞLANMADI
 * (kirli dosyalara dokunmamak için wiring ERTELENDİ — rapor: "Kalan Riskler").
 *
 * Kullanıcıya dürüst not (görev §H): "Cevap veren her veri otomatik eklenmez. Yalnız anlamı
 * ve güvenliği doğrulanmış veriler eklenir."
 */

import { memo, useCallback, useRef, useState } from 'react';
import { Radar, Square, ShieldCheck } from 'lucide-react';
import { getLiveDiscoveryCoordinator } from '../../platform/obd/discovery/discoveryLive';
import type { DiscoveryProgress, DiscoverySessionResult } from '../../platform/obd/discovery/discoveryCoordinator';

const STATUS_POLL_MS = 400;

export const PidDidDeepScanPanel = memo(function PidDidDeepScanPanel() {
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  const [result, setResult] = useState<DiscoverySessionResult | null>(null);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const onStart = useCallback(() => {
    const coordinator = getLiveDiscoveryCoordinator();
    setRunning(true);
    setResult(null);
    stopPolling();
    pollRef.current = setInterval(() => setProgress(coordinator.status()), STATUS_POLL_MS);
    void coordinator.start().then((r) => {
      setResult(r);
      setProgress(coordinator.status());
      setRunning(false);
      stopPolling();
    });
  }, [stopPolling]);

  const onCancel = useCallback(() => {
    getLiveDiscoveryCoordinator().cancel();
  }, []);

  const counts = progress ?? {
    phase: 'idle', scannedDidCount: 0, totalDidCandidates: 0,
    verifiedCount: 0, unknownCount: 0, suspiciousCount: 0, rejectedCount: 0,
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/90">
      <div className="flex items-center gap-2 text-base font-semibold">
        <Radar size={18} className="text-cyan-400" />
        <span>PID/DID Keşfi</span>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-cyan-500/10 p-3 text-xs text-cyan-200">
        <ShieldCheck size={16} className="mt-0.5 shrink-0" />
        <span>Cevap veren her veri otomatik eklenmez. Yalnız anlamı ve güvenliği doğrulanmış veriler eklenir.</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Durum" value={counts.phase} />
        <Stat label="Taranan / Aday" value={`${counts.scannedDidCount} / ${counts.totalDidCandidates}`} />
        <Stat label="Doğrulanan" value={String(counts.verifiedCount)} />
        <Stat label="Bilinmeyen" value={String(counts.unknownCount)} />
        <Stat label="Şüpheli" value={String(counts.suspiciousCount)} />
        <Stat label="Reddedilen" value={String(counts.rejectedCount)} />
      </div>

      {result && (
        <div className="text-xs text-white/60">
          Standart PID bulundu: {result.standardPids.length} · Durma nedeni: {result.stopReason}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onStart}
          disabled={running}
          className="flex-1 rounded-lg bg-cyan-600 px-3 py-2 font-medium text-white disabled:opacity-40"
        >
          {running ? 'Taranıyor…' : 'Keşfi Başlat'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={!running}
          className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 font-medium text-white disabled:opacity-40"
        >
          <Square size={14} /> İptal
        </button>
      </div>
    </div>
  );
});

const Stat = memo(function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
});
