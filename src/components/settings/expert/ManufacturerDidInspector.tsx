/**
 * ManufacturerDidInspector — Patch 12D: üretici-özel UDS DID profil seçici + saha keşif aracı.
 *
 * İki bölüm:
 *  1) Profil seçici — 'none' / 'universal-uds' / 'renault-dacia' arasında seçim; seçim
 *     `settings.manufacturerDidProfileId`'e yazılır, gerçek yükleme/kaldırma useLayoutServices
 *     effect'i (syncManufacturerDidProfile) tarafından yapılır — bu bileşen yalnız AYAR yazar,
 *     servisi DOĞRUDAN çağırmaz (tek kaynak: hook, ayar değişince otomatik tetiklenir).
 *  2) DID keşif aracı — didDiscoveryService.startDiscovery için minimal UI. T507 gibi adb'siz
 *     cihazlarda tek dışa aktarma yolu budur: seçilebilir metin kutusu + panoya kopyala
 *     (Clipboard plugin, OBDDiagnosticTimeline ile AYNI fail-soft desen).
 *
 * MALI-400: tarama YALNIZ kullanıcı butona basınca başlar, iptal edilebilir (AbortController),
 * DID'ler arası 150ms bekleme zaten didDiscoveryService'te (DoS gibi davranmasın).
 */

import { memo, useCallback, useRef, useState } from 'react';
import { Search, Square, Copy, Fingerprint } from 'lucide-react';
import { Clipboard } from '@capacitor/clipboard';
import { useStore } from '../../../store/useStore';
import {
  MANUFACTURER_DID_PROFILE_LABELS,
} from '../../../platform/obd/profiles';
import type { ManufacturerDidProfileId } from '../../../platform/obd/profiles';
import {
  startDiscovery, exportDiscoveryResultsAsJson,
  type DidDiscoveryOutcome, type DidDiscoveryProgress,
} from '../../../platform/obd/didDiscoveryService';

const PROFILE_IDS: readonly ManufacturerDidProfileId[] = ['none', 'universal-uds', 'renault-dacia'];

export const ManufacturerDidInspector = memo(function ManufacturerDidInspector() {
  const profileId = useStore((s) => s.settings.manufacturerDidProfileId);
  const updateSettings = useStore((s) => s.updateSettings);

  const [tx, setTx] = useState('7E0');
  const [rx, setRx] = useState('7E8');
  const [from, setFrom] = useState('2200');
  const [to, setTo] = useState('22FF');

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<DidDiscoveryProgress | null>(null);
  const [outcome, setOutcome] = useState<DidDiscoveryOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const onStart = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setOutcome(null);
    setProgress(null);
    try {
      const result = await startDiscovery({
        tx: tx.trim().toUpperCase(),
        rx: rx.trim().toUpperCase(),
        from: from.trim().toUpperCase(),
        to: to.trim().toUpperCase(),
        onProgress: setProgress,
        signal: controller.signal,
      });
      setOutcome(result);
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  }, [tx, rx, from, to]);

  const onCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onCopy = useCallback(async () => {
    if (!outcome) return;
    const json = exportDiscoveryResultsAsJson({ tx: tx.trim().toUpperCase(), rx: rx.trim().toUpperCase() }, outcome);
    try {
      await Clipboard.write({ string: json });
    } catch {
      try { await navigator.clipboard.writeText(json); } catch { /* yoksay — seçilebilir metin zaten var */ }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [outcome, tx, rx]);

  const exportedJson = outcome ? exportDiscoveryResultsAsJson({ tx, rx }, outcome) : '';

  return (
    <section
      className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 flex flex-col gap-4"
      aria-label="Üretici DID Profili ve Keşif Aracı"
    >
      <div className="flex items-center gap-2">
        <Fingerprint className="h-3.5 w-3.5 text-blue-400" />
        <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/35">
          Üretici DID Profili (Mode 22 / UDS)
        </p>
      </div>

      {/* ── Profil seçici ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {PROFILE_IDS.map((id) => (
          <label
            key={id}
            className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 cursor-pointer"
          >
            <input
              type="radio"
              name="manufacturerDidProfileId"
              checked={profileId === id}
              onChange={() => updateSettings({ manufacturerDidProfileId: id })}
              style={{ accentColor: '#22d3ee' }}
            />
            <span className="text-[11px] font-bold text-white/80">{MANUFACTURER_DID_PROFILE_LABELS[id]}</span>
          </label>
        ))}
      </div>

      {/* ── DID keşif aracı ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-t border-white/5 pt-3">
        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/25">
          Saha Keşif Aracı — ECU + DID aralığı tara
        </p>

        <div className="grid grid-cols-2 gap-2">
          <_HexField label="TX (istek header)" value={tx} onChange={setTx} disabled={scanning} />
          <_HexField label="RX (yanıt filtre)" value={rx} onChange={setRx} disabled={scanning} />
          <_HexField label="Başlangıç DID" value={from} onChange={setFrom} disabled={scanning} />
          <_HexField label="Bitiş DID" value={to} onChange={setTo} disabled={scanning} />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={scanning}
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40"
          >
            <Search className="h-3.5 w-3.5" />
            {scanning ? 'Taranıyor…' : 'Taramayı Başlat'}
          </button>
          {scanning && (
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-[11px] font-black uppercase tracking-widest"
            >
              <Square className="h-3.5 w-3.5" />
              İptal
            </button>
          )}
        </div>

        {scanning && progress && (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-[width]"
                style={{ width: `${((progress.index + 1) / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-white/40">
              {progress.did} — {progress.index + 1}/{progress.total}
            </span>
          </div>
        )}

        {outcome && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold text-white/50">
              {outcome.summary.scanned} DID tarandı — {outcome.summary.positive} pozitif,{' '}
              {outcome.summary.negative} desteklenmiyor
              {outcome.summary.stopReason !== 'completed' && (
                <span className="text-amber-400"> ({_stopReasonLabel(outcome.summary.stopReason)})</span>
              )}
            </p>

            {outcome.results.length > 0 && (
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {outcome.results.map((r) => (
                  <div
                    key={r.did}
                    className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10px]"
                  >
                    <span className="text-cyan-300 font-bold">{r.did}</span>
                    <span className="text-white/60">{r.dataHex}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Cihaz üstünden dışa aktarma (adb'siz cihazlar için tek yol) — seçilebilir metin + kopyala */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/25">
                  Dışa aktar (JSON)
                </span>
                <button
                  type="button"
                  onClick={onCopy}
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-300"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? 'Kopyalandı' : 'Panoya Kopyala'}
                </button>
              </div>
              <textarea
                readOnly
                value={exportedJson}
                rows={4}
                className="w-full rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-[9px] text-white/60 select-all"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
});

function _stopReasonLabel(reason: DidDiscoveryOutcome['summary']['stopReason']): string {
  switch (reason) {
    case 'aborted': return 'iptal edildi';
    case 'connection_lost': return 'bağlantı koptu — kısmi sonuç';
    case 'plugin_unavailable': return 'native platform yok';
    default: return reason;
  }
}

function _HexField({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (v: string) => void; disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[8px] font-black uppercase tracking-[0.2em] text-white/25">{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-9 rounded-lg border border-white/10 bg-white/[0.03] px-2 font-mono text-[11px] text-white/80 outline-none disabled:opacity-40"
        maxLength={8}
      />
    </label>
  );
}
