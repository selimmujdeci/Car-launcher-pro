/**
 * BlackBoxReplayView — CAROS LAB · Kayıt Oynatma (replay-log).
 *
 * İKİ AYRI DEFTER:
 *   1. CANLI HALKA TAMPON (1 Hz, RAM) — süreç ölünce kaybolur.
 *   2. KALICI KAZA GÜNLÜKLERİ (`crash-log-*`, diskte) — kaza anındaki tampon.
 *
 * (2) uzun süre YAZILIYOR ama OKUNMUYORDU (envanter denetimi E-33):
 * `listCrashLogKeys` · `readCrashLog` · `deleteCrashLog` ürün yolunda sıfır
 * çağırana sahipti → kaza günlükleri diskte birikiyor, hiçbir yüzeyde
 * görünmüyordu.
 *
 * GİZLİLİK (kural 6): kaza kaydındaki lat/lng bu ekrana TAŞINMAZ — yalnız
 * "konum örneği VAR/YOK" bilgisi gösterilir. Koordinat, hız izi ve ham slot
 * dizisi ekrana basılmaz.
 *
 * Kalıcı defter TIMER KURMAZ: açılışta bir okuma + elle YENİLE (LAB deseni).
 */

import { memo, useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, HardDrive } from 'lucide-react';
import {
  getReplayData, listCrashLogKeys, readCrashLog, deleteCrashLog,
  getBlackBoxSnapshot, getCrashDetectionHealth,
} from '../../platform/security/blackBoxService';
import type { BlackBoxSample } from '../../platform/security/blackBoxService';

function fmtTs(epochMs: number): string {
  const d = new Date(epochMs);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => n.toString().padStart(2, '0'))
    .join(':');
}

function fmtNum(v: number | null, mul = 1, unit = ''): string {
  if (v === null || v < 0) return '—';
  return `${Math.round(v * mul)}${unit}`;
}

/* Görünen etiketler Türkçe; ham veri (ThermalLevel 0–3 · mem 'OK'|'MOD'|'CRIT')
   DEĞİŞMEZ — yalnız sunum çevrilir. */
const THERM = ['NORMAL', 'ILIK', 'SICAK', '🔴KRİTİK'];
const MEM_LABEL: Readonly<Record<'OK' | 'MOD' | 'CRIT', string>> = {
  OK: 'NORMAL', MOD: 'ORTA', CRIT: 'KRİTİK',
};

/* ── Kalıcı kaza günlükleri (disk) ───────────────────────────────────────── */

/** Ekrana çıkan kaza özeti — PII/konum İÇERMEZ (yalnız varlık bilgisi). */
interface CrashLogSummary {
  readonly key: string;
  /** Kayıt okunamadıysa `null` — sahte 0/sahte tarih ÜRETİLMEZ. */
  readonly crashAt: number | null;
  readonly peakG: number | null;
  readonly sampleCount: number | null;
  /** Tamponda gerçek konum örneği var mı — KOORDİNAT GÖSTERİLMEZ. */
  readonly hasLocation: boolean | null;
  readonly readable: boolean;
}

function summarizeCrashLogs(): CrashLogSummary[] {
  let keys: string[] = [];
  try { keys = listCrashLogKeys(); } catch { return []; }
  return keys.map((key) => {
    const rec = (() => { try { return readCrashLog(key); } catch { return null; } })();
    if (!rec) {
      return {
        key, crashAt: null, peakG: null, sampleCount: null,
        hasLocation: null, readable: false,
      };
    }
    const buffer = Array.isArray(rec.buffer) ? rec.buffer : [];
    return {
      key,
      crashAt: Number.isFinite(rec.crashAt) ? rec.crashAt : null,
      peakG: Number.isFinite(rec.peakG) ? rec.peakG : null,
      sampleCount: buffer.length,
      hasLocation: buffer.some((s) => s.lat !== 0 || s.lng !== 0),
      readable: true,
    };
  }).sort((a, b) => (b.crashAt ?? 0) - (a.crashAt ?? 0));
}

function fmtCrashTime(epochMs: number | null): string {
  if (epochMs === null) return 'OKUNAMADI';
  const d = new Date(epochMs);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const CrashLogSection = memo(function CrashLogSection() {
  /* Açılışta TEK okuma — LAB deseni (`useState` lazy initializer). `useEffect`
     ile okumak, sunucu/statik render'da bölümü kalıcı BOŞ gösterirdi. */
  const [logs, setLogs] = useState<CrashLogSummary[]>(() => summarizeCrashLogs());
  const [liveSamples, setLiveSamples] = useState<number | null>(
    () => { try { return getBlackBoxSnapshot().length; } catch { return null; } });
  const [health, setHealth] = useState<ReturnType<typeof getCrashDetectionHealth> | null>(
    () => { try { return getCrashDetectionHealth(); } catch { return null; } });
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  /** Tek okuma — timer YOK. */
  const reload = useCallback(() => {
    setLogs(summarizeCrashLogs());
    try { setLiveSamples(getBlackBoxSnapshot().length); } catch { setLiveSamples(null); }
    try { setHealth(getCrashDetectionHealth()); } catch { setHealth(null); }
    setConfirmKey(null);
  }, []);

  const remove = useCallback((key: string) => {
    try { deleteCrashLog(key); } catch { /* fail-soft */ }
    reload();
  }, [reload]);

  return (
    <div
      data-testid="bb-crash-logs"
      className="shrink-0 border-t border-[var(--oem-line-strong)] bg-[var(--oem-surface)]"
    >
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--oem-ink-3)]">
          <HardDrive size={11} />
          KALICI KAZA GÜNLÜKLERİ — {logs.length} kayıt
          {liveSamples !== null && ` · canlı tampon ${liveSamples} örnek`}
          {health && ` · bu oturumda yazılan ${health.recorded}`
            + ` · hareket kanıtsız reddedilen ${health.rejectedNoMotion}`}
        </span>
        <button
          type="button"
          data-testid="bb-crash-refresh"
          onClick={reload}
          className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={11} />YENİLE
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="px-2 pb-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
          KAYIT YOK — diskte `crash-log-*` kaydı bulunmuyor.
          {' '}(Bu, &quot;kaza olmadı&quot; demektir; &quot;kaza algılama çalışmıyor&quot; DEMEZ.)
        </div>
      ) : (
        <div className="max-h-[38%] divide-y divide-[var(--oem-line)] overflow-auto">
          {logs.map((log) => (
            <div
              key={log.key}
              data-testid={`bb-crash-row-${log.key}`}
              className="flex items-center justify-between gap-2 px-2 py-1 font-mono text-[10px]"
            >
              <span className="min-w-0 truncate text-[var(--oem-ink-2)]">
                <span className="text-[var(--oem-ink)]">{fmtCrashTime(log.crashAt)}</span>
                {' · '}
                {log.readable
                  ? <>
                    tepe {log.peakG === null ? 'BİLİNMİYOR' : `${log.peakG.toFixed(2)} G`}
                    {' · '}{log.sampleCount ?? 'BİLİNMİYOR'} örnek
                    {' · konum örneği '}
                    {log.hasLocation === null ? 'BİLİNMİYOR' : log.hasLocation ? 'VAR' : 'YOK'}
                  </>
                  : <span className="text-[var(--oem-warn)]">KAYIT OKUNAMADI (bozuk veya erişilemez)</span>}
                <span className="ml-1.5 text-[var(--oem-ink-3)]">{log.key}</span>
              </span>
              {confirmKey === log.key ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    data-testid={`bb-crash-delete-confirm-${log.key}`}
                    onClick={() => remove(log.key)}
                    className="rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] px-2 py-0.5 text-[10px] text-[var(--oem-danger)]"
                  >
                    KALICI SİL
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmKey(null)}
                    className="rounded border border-[var(--oem-line-strong)] px-2 py-0.5 text-[10px] text-[var(--oem-ink-3)]"
                  >
                    VAZGEÇ
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  data-testid={`bb-crash-delete-${log.key}`}
                  onClick={() => setConfirmKey(log.key)}
                  className="flex shrink-0 items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-0.5 text-[10px] text-[var(--oem-ink-3)]"
                >
                  <Trash2 size={10} />SİL
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="px-2 pb-1.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        Konum (lat/lng) bu ekrana TAŞINMAZ — yalnız örneğin var olup olmadığı
        gösterilir. En fazla 5 kayıt saklanır; eskiler otomatik düşer.
      </div>
    </div>
  );
});

export const BlackBoxReplayView = memo(function BlackBoxReplayView() {
  const [rows, setRows] = useState<BlackBoxSample[]>([]);

  useEffect(() => {
    const refresh = () => setRows(getReplayData().slice().reverse()); // en yeni üstte
    refresh();
    const t = setInterval(refresh, 2_000);
    return () => clearInterval(t);
  }, []);

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center text-[var(--oem-ink-3)] text-xs font-mono">
          Canlı tampon boş… BlackBox 1 Hz örnekleme aktif değil.
        </div>
        <CrashLogSection />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="text-[var(--oem-ink-3)] text-[10px] font-mono px-1 py-1 shrink-0">
        ■ BlackBox Replay — son {rows.length} kayıt · 1 Hz · en yeni üstte · 2s yenileme
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[var(--oem-ink-3)] border-b border-[var(--oem-line)] sticky top-0 bg-[var(--oem-surface-0)] z-10">
              <th className="text-left   px-2 py-1 font-normal">ZAMAN</th>
              <th className="text-right  px-2 py-1 font-normal">HIZ</th>
              <th className="text-right  px-2 py-1 font-normal">RPM</th>
              <th className="text-right  px-2 py-1 font-normal">YAKIT</th>
              <th className="text-right  px-2 py-1 font-normal">VİTES</th>
              <th className="text-right  px-2 py-1 font-normal">TERM</th>
              <th className="text-right  px-2 py-1 font-normal">MEM</th>
              <th className="text-left   px-2 py-1 font-normal">WORKER</th>
              <th className="text-left   px-2 py-1 font-normal">SON-CMD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const spdKmh  = s.signals.spd !== null ? s.signals.spd * 3.6 : null;
              const hasDead = Object.values(s.workers).some((w) => w === 'dead');
              const rowCls  = hasDead
                ? 'text-[var(--oem-danger)]'
                : s.env.mem === 'CRIT'
                  ? 'text-[var(--oem-warn)]'
                  : 'text-[var(--oem-ink-2)]';
              return (
                <tr key={i} className={`border-b border-[var(--oem-line)] hover:bg-[var(--oem-surface-2)] ${rowCls}`}>
                  <td className="px-2 py-0.5 text-[var(--oem-ink-3)]">{fmtTs(s.ts)}</td>
                  <td className="px-2 py-0.5 text-right">{fmtNum(spdKmh, 1, ' km/h')}</td>
                  <td className="px-2 py-0.5 text-right">{fmtNum(s.signals.rpm)}</td>
                  <td className="px-2 py-0.5 text-right">{fmtNum(s.signals.fuel, 1, '%')}</td>
                  <td className="px-2 py-0.5 text-right">{s.signals.gear ?? '—'}</td>
                  <td className={`px-2 py-0.5 text-right ${s.env.therm >= 2 ? 'text-[var(--oem-danger)]' : ''}`}>
                    {THERM[s.env.therm] ?? String(s.env.therm)}
                  </td>
                  <td className={`px-2 py-0.5 text-right ${s.env.mem !== 'OK' ? 'text-[var(--oem-warn)]' : 'text-[var(--oem-ink-3)]'}`}>
                    {MEM_LABEL[s.env.mem] ?? s.env.mem}
                  </td>
                  <td className="px-2 py-0.5">
                    {Object.entries(s.workers).map(([k, v]) => (
                      <span key={k} className={`mr-1.5 ${v === 'dead' ? 'text-[var(--oem-danger)]' : 'text-[var(--oem-ink-3)]'}`}>
                        {k.replace('Compute', '')}:{v === 'dead' ? '✗' : '✓'}
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-0.5 text-[var(--oem-ink-3)] max-w-[80px] truncate">
                    {s.lastCmd ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CrashLogSection />
    </div>
  );
});
