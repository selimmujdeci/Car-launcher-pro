/**
 * ValidationModeView — Saha Doğrulama Modu paneli (yalnız Developer menüsü).
 *
 * ⚠️ Bu bileşen ÖLÇÜM YAPMAZ. `validationRecorder`'ın anlık görüntüsünü
 * gösterir ve SAF `evaluateValidation` kararını basar.
 *
 * ⚠️ KAYIT PANELE BAĞLI DEĞİLDİR (saha düzeltmesi): eskiden bileşen unmount
 * olunca toplayıcı duruyordu ve panel yeniden açıldığında oturum SIFIRDAN
 * başlıyordu → sekme değiştirmek bile tüm saha verisini siliyordu. Artık kayıt
 * yalnız BAŞLAT/DURDUR düğmeleriyle yönetilir; panel kapanabilir, sürüş devam eder.
 *
 * Bölümler: Kontrol listesi · Test özeti · Ölçümler · Canlı kütük · Rapor.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import {
  startValidationCollector,
  stopValidationCollector,
} from '../../platform/validation/concrete/validationCollector';
import {
  getValidationSnapshot,
  subscribeValidation,
} from '../../platform/validation/validationRecorder';
import { evaluateValidation } from '../../platform/validation/validationVerdict';
import {
  buildValidationReport,
  serializeValidationReport,
} from '../../platform/validation/validationExport';
import {
  isValidationModeEnabled,
  setValidationModeEnabled,
} from '../../platform/validation/validationFlag';
import { setChecklistDone } from '../../platform/validation/validationRecorder';
import {
  checklistByPhase,
  checklistProgress,
  isChecklistId,
  PHASE_LABEL,
} from '../../platform/validation/validationChecklist';
import { buildValidationSummaryText } from '../../platform/validation/validationSummary';
import type { ValidationStatus } from '../../platform/validation/validationTypes';

/* ── Görsel yardımcılar ────────────────────────────────────────────────────── */

const STATUS_ICON: Record<ValidationStatus, string> = {
  pass: '✅', warn: '⚠', fail: '❌', skip: '–',
};

const STATUS_COLOR: Record<ValidationStatus, string> = {
  pass: 'text-green-400', warn: 'text-yellow-400', fail: 'text-red-400', skip: 'text-gray-500',
};

const LEVEL_COLOR = { info: 'text-gray-300', warn: 'text-yellow-400', error: 'text-red-400' } as const;

/** null → "ölçülmedi" (uydurma yok). */
function num(v: number | null, unit = ''): string {
  return v === null ? '—' : `${v}${unit}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-800 last:border-0">
      <span className="text-gray-400 text-xs font-mono">{label}</span>
      <span className="text-gray-100 text-xs font-mono text-right">{value}</span>
    </div>
  );
}

/* ── Panel ─────────────────────────────────────────────────────────────────── */

export const ValidationModeView = memo(function ValidationModeView() {
  const [flagOn, setFlagOn] = useState(() => isValidationModeEnabled());
  const [saveMsg, setSaveMsg] = useState('');
  const [summaryText, setSummaryText] = useState('');

  /* Anlık görüntü STATE'te tutulur (her render'da yeniden okunmaz): ring buffer
     kopyalama maliyeti bir kez ödenir ve `useMemo` gerçekten isabet eder. */
  const [snap, setSnap] = useState(() => getValidationSnapshot());
  const refresh = useCallback(() => { setSnap(getValidationSnapshot()); }, []);

  /* Kayıt değişimlerine abone — cleanup zorunlu (zero-leak).
     Bileşen unmount olunca YALNIZ abonelik kapanır; KAYIT DEVAM EDER. */
  useEffect(() => {
    const off = subscribeValidation(refresh);
    const timer = setInterval(refresh, 1_000);      // süre/ortalama tazeliği
    return () => { off(); clearInterval(timer); };
  }, [refresh]);

  const summary = useMemo(() => evaluateValidation(snap), [snap]);
  const recording = snap.active;
  const progress  = checklistProgress(snap.checklistDone);
  const doneSet   = useMemo(() => new Set(snap.checklistDone), [snap]);

  const handleToggleFlag = useCallback(() => {
    const next = !isValidationModeEnabled();
    setValidationModeEnabled(next);
    if (!next) stopValidationCollector();
    setFlagOn(isValidationModeEnabled());
  }, []);

  /** BAŞLAT: yeni oturum (önceki veri silinir — düğme üstünde uyarılır). */
  const handleStart = useCallback(() => {
    setSummaryText('');
    setSaveMsg('');
    startValidationCollector();
    refresh();
  }, [refresh]);

  /** DURDUR: kayıt biter, toplanan veri rapor için OKUNABİLİR kalır. */
  const handleStop = useCallback(() => {
    stopValidationCollector();
    refresh();
  }, [refresh]);

  const handleChecklist = useCallback((id: string) => {
    if (!isChecklistId(id)) return;                       // fail-closed
    const fresh = getValidationSnapshot();
    setChecklistDone(id, !fresh.checklistDone.includes(id));
    refresh();
  }, [refresh]);

  /** Tek dokunuş: insan-okur saha özeti üret + panoya kopyala. */
  const handleSummary = useCallback(async () => {
    const fresh = getValidationSnapshot();
    const text = buildValidationSummaryText(fresh, evaluateValidation(fresh), Date.now());
    setSummaryText(text);
    try {
      if (Capacitor.isNativePlatform()) await Clipboard.write({ string: text });
      else await navigator.clipboard.writeText(text);
      setSaveMsg('Özet üretildi ve panoya kopyalandı.');
    } catch {
      setSaveMsg('Özet üretildi (panoya kopyalanamadı).');
    }
  }, []);

  const handleExport = useCallback(async () => {
    setSaveMsg('');
    const fresh  = getValidationSnapshot();
    const report = buildValidationReport(fresh, evaluateValidation(fresh), {
      generatedAtWallMs: Date.now(),
      platform:          Capacitor.getPlatform(),
    });
    const body     = serializeValidationReport(report);
    const fileName = `caros-validation-${fresh.sessionId || 'session'}.json`;

    try {
      if (!Capacitor.isNativePlatform()) {
        // Tarayıcı modu: blob indir (geliştirme kolaylığı) — mevcut DebugPanel deseni.
        const blob = new Blob([body], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
        setSaveMsg(`İndirilenler/${fileName}`);
        return;
      }
      // Public Documents → dosya yöneticisi/USB ile paylaşılabilir; izin yoksa
      // app-özel External'a düş (CanDiagPanel ile AYNI desen).
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      let savedPath: string;
      try {
        const res = await Filesystem.writeFile({
          path: fileName, data: body, directory: Directory.Documents,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `Documents/${fileName}`;
      } catch {
        const res = await Filesystem.writeFile({
          path: fileName, data: body, directory: Directory.External,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `External/${fileName}`;
      }
      setSaveMsg(savedPath);
    } catch {
      setSaveMsg('Dosya kaydı başarısız.');
    }
  }, []);

  const handleCopy = useCallback(async () => {
    const fresh  = getValidationSnapshot();
    const body   = serializeValidationReport(
      buildValidationReport(fresh, evaluateValidation(fresh), {
        generatedAtWallMs: Date.now(),
        platform:          Capacitor.getPlatform(),
      }),
    );
    try {
      if (Capacitor.isNativePlatform()) await Clipboard.write({ string: body });
      else await navigator.clipboard.writeText(body);
      setSaveMsg('Rapor panoya kopyalandı.');
    } catch {
      setSaveMsg('Panoya kopyalanamadı.');
    }
  }, []);

  /* ── Şalter kapalı ekranı ─────────────────────────────────────────────── */
  if (!flagOn) {
    return (
      <div className="flex flex-col gap-3 px-1">
        <p className="text-yellow-400 text-xs font-mono">
          Saha Doğrulama Modu KAPALI — hiçbir kayıt tutulmuyor, ek yük yok.
        </p>
        <p className="text-gray-500 text-[11px] font-mono leading-relaxed">
          Bu mod yalnız geliştirici/teknisyen içindir. Açıldığında OBD, performans ve
          Mavi çağrılarının GÜVENLİ metadata'sı kaydedilir. Kişisel veri, ham VIN/MAC
          veya kullanıcı metni kaydedilmez.
        </p>
        <button
          onClick={handleToggleFlag}
          className="self-start px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-mono rounded"
        >
          Doğrulama Modunu AÇ
        </button>
      </div>
    );
  }

  const o = snap.obd;
  const p = snap.perf;

  return (
    <div className="flex flex-col gap-4 px-1">

      {/* ── Genel karar ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-lg ${STATUS_COLOR[summary.overall]}`}>{STATUS_ICON[summary.overall]}</span>
          <span className="text-gray-100 text-sm font-mono">
            {summary.passed} geçti · {summary.warned} uyarı · {summary.failed} düştü · {summary.skipped} ölçülmedi
          </span>
        </div>
        <button
          onClick={handleToggleFlag}
          className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] font-mono rounded"
        >
          KAPAT
        </button>
      </div>
      <div className="text-gray-600 text-[11px] font-mono">
        Oturum {snap.sessionId || '—'} · {Math.round(snap.durationMs / 1000)} sn ·{' '}
        <span className={recording ? 'text-green-400' : 'text-gray-500'}>
          {recording ? '● KAYIT SÜRÜYOR' : snap.sessionId ? 'durduruldu' : 'başlatılmadı'}
        </span>
      </div>

      {/* ── Oturum kontrolü ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {!recording ? (
          <button
            onClick={handleStart}
            className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-mono rounded"
          >
            {snap.sessionId ? 'YENİ OTURUM BAŞLAT' : 'KAYDI BAŞLAT'}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white text-xs font-mono rounded"
          >
            KAYDI DURDUR
          </button>
        )}
        <span className="text-gray-600 text-[10px] font-mono">
          {recording
            ? 'Paneli kapatabilirsin — kayıt sürüşte devam eder.'
            : snap.sessionId
              ? 'Yeni oturum ÖNCEKİ verileri siler; önce raporu al.'
              : 'Kayıt başlamadan hiçbir şey toplanmaz.'}
        </span>
      </div>

      {/* ── Saha kontrol listesi (beyan — ölçüm değil) ── */}
      <div>
        <p className="text-gray-500 text-xs font-mono uppercase mb-2">
          Saha Adımları — {progress.done}/{progress.total} (%{progress.pct})
        </p>
        {!recording && !snap.sessionId ? (
          <p className="text-gray-600 text-[11px] font-mono">Kayıt başlatılınca işaretlenebilir.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {checklistByPhase().map(({ phase, items }) => (
              <div key={phase}>
                <p className="text-gray-500 text-[10px] font-mono mb-1">{PHASE_LABEL[phase]}</p>
                {items.map((item) => {
                  const done = doneSet.has(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleChecklist(item.id)}
                      disabled={!recording}
                      className="w-full text-left flex items-start gap-2 py-1 disabled:opacity-50"
                    >
                      <span className={`text-xs w-4 shrink-0 ${done ? 'text-green-400' : 'text-gray-600'}`}>
                        {done ? '☑' : '☐'}
                      </span>
                      <span className="flex-1">
                        <span className={`text-[11px] font-mono ${done ? 'text-gray-400 line-through' : 'text-gray-200'}`}>
                          {item.label}
                        </span>
                        <span className="block text-gray-600 text-[10px] font-mono">{item.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Test özeti ── */}
      <div>
        <p className="text-gray-500 text-xs font-mono uppercase mb-2">Test Özeti</p>
        <div className="flex flex-col">
          {summary.tests.map((t) => (
            <div key={t.id} className="flex items-start gap-2 py-1 border-b border-gray-800 last:border-0">
              <span className={`${STATUS_COLOR[t.status]} text-xs w-4 shrink-0`}>{STATUS_ICON[t.status]}</span>
              <span className="text-gray-300 text-xs font-mono w-40 shrink-0">{t.label}</span>
              <span className="text-gray-500 text-[11px] font-mono flex-1">{t.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── OBD ── */}
      <div>
        <p className="text-gray-500 text-xs font-mono uppercase mb-2">OBD</p>
        <Row label="Adaptör"          value={`${o.adapterName ?? 'bilinmiyor'}${o.adapterAddrMasked ? ` ${o.adapterAddrMasked}` : ''}`} />
        <Row label="Transport"        value={o.transport} />
        <Row label="Bağlantı süresi"  value={num(o.connectDurationMs, ' ms')} />
        <Row label="Protokol"         value={`${o.protocolActive ?? '—'} (denenen ${o.protocolTried ?? '—'})`} />
        <Row label="VIN"              value={o.vinPresent ? (o.vinMasked ?? 'okundu') : 'okunmadı'} />
        <Row label="ECU sayısı"       value={num(o.ecuCount)} />
        <Row label="PID sayısı"       value={String(o.pidCount)} />
        <Row label="DTC sayısı"       value={num(o.dtcCount)} />
        <Row label="Kopma / deneme"   value={`${o.disconnectCount} / ${o.reconnectAttempts}`} />
      </div>

      {/* ── Performans ── */}
      <div>
        <p className="text-gray-500 text-xs font-mono uppercase mb-2">Performans</p>
        <Row label="Canlı paket"        value={String(p.liveDataSamples)} />
        <Row label="Ort. veri gecikmesi" value={num(p.avgLiveLatencyMs, ' ms')} />
        <Row label="Ort. polling"       value={num(p.avgPollIntervalMs, ' ms')} />
        <Row label="Maks. gecikme"      value={num(p.maxLatencyMs, ' ms')} />
        <Row label="Timeout / kurtarma" value={`${p.timeoutCount} / ${p.recoveryCount}`} />
        <Row label="Bellek (şu an/tepe)" value={`${num(p.memoryUsedMb, ' MB')} / ${num(p.memoryPeakMb, ' MB')}`} />
        <Row label="FPS (ort./min)"     value={`${num(p.avgFps)} / ${num(p.minFps)}`} />
      </div>

      {/* ── Mavi ── */}
      <div>
        <p className="text-gray-500 text-xs font-mono uppercase mb-2">Mavi ({snap.mavi.length} çağrı)</p>
        {snap.mavi.length === 0 ? (
          <p className="text-gray-600 text-[11px] font-mono">Bu oturumda Mavi çağrısı yapılmadı.</p>
        ) : (
          <div className="flex flex-col max-h-48 overflow-y-auto">
            {snap.mavi.slice().reverse().map((r) => (
              <div key={r.id} className="py-1 border-b border-gray-800 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={r.ok ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>{r.ok ? '✅' : '❌'}</span>
                  <span className="text-gray-200 text-[11px] font-mono">{r.intentKind} / {r.operatorTask}</span>
                  <span className="text-gray-500 text-[11px] font-mono ml-auto">{Math.round(r.durationMs)} ms</span>
                </div>
                <div className="text-gray-600 text-[10px] font-mono pl-6">
                  planner:{r.plannerUsed ? '✓' : '✗'} · tool:{r.toolCalls} · usta:{r.mechanicUsed ? '✓' : '✗'} ·
                  bilgi:{r.knowledgeUsed ? '✓' : '✗'} · hafıza:{r.memoryUsed ? '✓' : '✗'} ·
                  bağlam:{r.vehicleContextUsed ? '✓' : '✗'}{r.errorKind ? ` · hata:${r.errorKind}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Canlı kütük ── */}
      <div>
        <p className="text-gray-500 text-xs font-mono uppercase mb-2">Canlı Kütük</p>
        <div className="flex flex-col max-h-56 overflow-y-auto">
          {snap.log.length === 0 ? (
            <p className="text-gray-600 text-[11px] font-mono">Kayıt yok.</p>
          ) : (
            snap.log.slice().reverse().map((e) => (
              <div key={e.id} className="flex gap-2 py-0.5">
                <span className="text-gray-600 text-[10px] font-mono w-14 shrink-0">
                  {(e.tsMonoMs / 1000).toFixed(1)}s
                </span>
                <span className="text-gray-600 text-[10px] font-mono w-10 shrink-0">{e.channel}</span>
                <span className={`${LEVEL_COLOR[e.level]} text-[10px] font-mono flex-1`}>{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Rapor ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleSummary}
          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-mono rounded"
        >
          VALIDATION SUMMARY
        </button>
        <button
          onClick={handleExport}
          className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs font-mono rounded"
        >
          Export Report (JSON)
        </button>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-mono rounded"
        >
          JSON panoya
        </button>
      </div>
      {saveMsg && <span className="text-gray-500 text-[10px] font-mono break-all">{saveMsg}</span>}

      {/* Üretilen özet — panoya kopyalandı, buradan da okunabilir/seçilebilir. */}
      {summaryText && (
        <pre className="text-gray-300 text-[10px] font-mono whitespace-pre-wrap bg-gray-900 border border-gray-800 rounded p-2 max-h-72 overflow-y-auto mb-4">
          {summaryText}
        </pre>
      )}
      <div className="pb-4" />
    </div>
  );
});
