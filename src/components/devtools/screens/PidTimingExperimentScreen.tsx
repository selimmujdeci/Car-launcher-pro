/**
 * PidTimingExperimentScreen — CAROS LAB · Geliştirici · H-A DENEYİ (kütük #518-HA).
 *
 * ⚠️ BU EKRAN SALT-OKUNUR DEĞİLDİR — LAB'ın istisnasıdır.
 * Gözlemlenebilirlik kuralı 4 ("LAB ekranı aktif komut GÖNDERMEMELİ") pasif GÖZLEM
 * ekranları içindir. Burası bir ÖLÇÜM ARACIDIR: araca Mode-01 sorgusu gönderir ve
 * `ATST` (ELM327 yanıt bekleme süresi) ayarını GEÇİCİ olarak değiştirir. İstisna
 * bilinçlidir ve şu sınırlarla çerçevelenmiştir:
 *   · Yalnız KULLANICI açıkça başlatırsa koşar — açılışta HİÇBİR ŞEY göndermez.
 *   · Yalnız okuma sorguları (Mode 01) — araca YAZMA, DTC silme, adaptasyon YOK.
 *   · `ATST` bitişte her hâlükârda geri alınır (native `finally`).
 *   · Ürünün eleme öğrenmesi (ExtendedNoDataTracker) BESLENMEZ — deney ölçtüğü
 *     şeyi bozmaz.
 *   · İptal edilebilir; tavanlı (PID ve tur sayısı sınırlı).
 *
 * Analiz burada YAPILMAZ — `pidTimingExperimentModel` (saf, 18 birim testi) yapar.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Play, Square, AlertTriangle, Timer } from 'lucide-react';
import {
  startPidTimingExperiment, abortPidTimingExperiment, readPidTimingExperiment,
  DEFAULT_ROUNDS, DEFAULT_ST_HEX_B,
} from '../../../platform/obd/pidTimingExperiment';
import {
  buildPidTimingReport, EXPERIMENT_VERDICT_LABEL, PID_VERDICT_LABEL,
  type PidTimingReport,
} from '../../../platform/obd/pidTimingExperimentModel';
import { getWatchedExtendedPids } from '../../../platform/obd/extendedPidService';

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const BAD  = 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';

const UNAVAILABLE = 'UNAVAILABLE';

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--oem-line)] bg-[var(--oem-surface-1)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--oem-ink-2)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** ms — ölçüm yoksa UNAVAILABLE (sahte 0 YOK). */
function ms(v: number | null): string {
  return v === null || !Number.isFinite(v) ? UNAVAILABLE : `${Math.round(v)}ms`;
}
/** oran — ölçüm yoksa UNAVAILABLE. */
function pct(v: number | null): string {
  return v === null || !Number.isFinite(v) ? UNAVAILABLE : `%${Math.round(v * 100)}`;
}

function verdictTone(v: string): string {
  if (v === 'ATST_KOKTU') return OK;
  if (v === 'ATST_KOK_DEGIL') return WARN;
  if (v === 'BELIRSIZ') return BAD;
  return NONE;
}

function PidTimingExperimentScreenBase() {
  const [report, setReport] = useState<PidTimingReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mountedRef = useRef(true);

  /* Açılışta YALNIZ okuma — hiçbir komut gönderilmez. */
  const refresh = useCallback(async () => {
    const raw = await readPidTimingExperiment();
    if (!mountedRef.current) return;
    setReport(raw === null ? null : buildPidTimingReport(raw));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();                       // tek okuma; timer/abonelik YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const onStart = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      /* PID listesi ÜRÜNÜN izlediği listeden gelir — burada liste UYDURULMAZ. */
      let pids: string[] = [];
      try { pids = getWatchedExtendedPids(); } catch { pids = []; }
      if (pids.length === 0) {
        /* Kapı listesi boşsa deneyin hedefi bilinmiyor: kullanıcı önce OBD'ye
           bağlanmalı. Varsayılan PID listesi UYDURULMAZ. */
        setNote('İzlenen PID YOK — OBD bağlı ve bir ekran sinyal izliyor olmalı. Varsayılan liste UYDURULMAZ.');
        return;
      }
      const r = await startPidTimingExperiment(pids, DEFAULT_ROUNDS, DEFAULT_ST_HEX_B);
      if (!mountedRef.current) return;
      if (!r.started) setNote(`Başlatılamadı: ${r.reason ?? 'bilinmeyen sebep'}`);
      else setNote('Deney başladı — birkaç dakika sürer. YENİLE ile ilerlemeyi izleyin.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const onAbort = useCallback(async () => {
    await abortPidTimingExperiment();
    if (mountedRef.current) setNote('İptal istendi — çalışan komut kesilmez.');
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--oem-ink-1)]">
            H-A Deneyi — ATST yanıt süresi
          </h2>
          <p className="text-[11px] text-[var(--oem-ink-3)]">
            A: mevcut ayar · B: ATST {DEFAULT_ST_HEX_B} — aynı bağlantı, {DEFAULT_ROUNDS} tur.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button" onClick={() => void onStart()} disabled={busy}
            className="inline-flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-2 py-1 text-[11px] text-[var(--oem-warn)] disabled:opacity-50"
          >
            <Play size={11} /> BAŞLAT
          </button>
          <button
            type="button" onClick={() => void onAbort()}
            className="inline-flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[11px] text-[var(--oem-ink-2)]"
          >
            <Square size={11} /> İPTAL
          </button>
          <button
            type="button" onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[11px] text-[var(--oem-ink-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
      </div>

      <p className="flex items-start gap-1.5 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] p-2 text-[11px] text-[var(--oem-warn)]">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span>
          <b>Bu ekran araca SORGU GÖNDERİR</b> — LAB&apos;ın salt-okunur kuralının bilinçli
          istisnası. Yalnız Mode-01 okuma; yazma/silme/adaptasyon YOK. ATST bitişte
          geri alınır, ürünün eleme öğrenmesi beslenmez. Açılışta hiçbir şey gönderilmez.
        </span>
      </p>

      {note && (
        <p className="text-[11px] text-[var(--oem-ink-2)]">{note}</p>
      )}

      {report === null ? (
        <Section title="Durum">
          <p className="text-[12px] text-[var(--oem-ink-3)]">
            {UNAVAILABLE} — native köprü okunamadı (eski APK veya tarayıcı modu).
          </p>
        </Section>
      ) : (
        <>
          <Section title="Hüküm">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={verdictTone(report.verdict)}>
                {EXPERIMENT_VERDICT_LABEL[report.verdict]}
              </Chip>
              <Chip tone={NONE}>durum: {report.status}</Chip>
            </div>
            {report.verdictNote && (
              <p className="mt-2 text-[11px] text-[var(--oem-ink-2)]">{report.verdictNote}</p>
            )}
            {report.failReason && (
              <p className="mt-1 text-[11px] text-[var(--oem-danger)]">hata: {report.failReason}</p>
            )}
          </Section>

          <Section title="Aşama toplamları">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="text-[var(--oem-ink-3)]">
                  <tr>
                    <th className="py-1 pr-2">aşama</th><th className="pr-2">ATST</th>
                    <th className="pr-2">deneme</th><th className="pr-2">NO_DATA</th>
                    <th className="pr-2">OK p50/p95/max</th>
                    <th className="pr-2">NO_DATA p50/p95/max</th>
                    <th>süre</th>
                  </tr>
                </thead>
                <tbody className="text-[var(--oem-ink-1)]">
                  {report.totals.map((t) => (
                    <tr key={t.phase} className="border-t border-[var(--oem-line)]">
                      <td className="py-1 pr-2">{t.phase}</td>
                      <td className="pr-2">{t.stApplied}</td>
                      <td className="pr-2">{t.attempts}</td>
                      <td className="pr-2">{pct(t.noDataRate)}</td>
                      <td className="pr-2">{ms(t.successMs.p50)}/{ms(t.successMs.p95)}/{ms(t.successMs.max)}</td>
                      <td className="pr-2">{ms(t.noDataMs.p50)}/{ms(t.noDataMs.p95)}/{ms(t.noDataMs.max)}</td>
                      <td>{t.wallMs === null ? UNAVAILABLE : `${Math.round(t.wallMs / 1000)}s`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="0x23 — yakıt rayı basıncı (deneyin somut hedefi)">
            {report.target23 === null ? (
              <p className="text-[12px] text-[var(--oem-ink-3)]">
                {UNAVAILABLE} — 0x23 bu deneyde ölçülmedi.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[var(--oem-ink-1)]">
                <Chip tone={report.target23.verdict === 'SURE_ILE_KURTULDU' ? OK : NONE}>
                  {PID_VERDICT_LABEL[report.target23.verdict]}
                </Chip>
                <span>A: {pct(report.target23.a?.noDataRate ?? null)} NO_DATA</span>
                <span>→ B: {pct(report.target23.b?.noDataRate ?? null)}</span>
                <span>· OK p95 A {ms(report.target23.a?.successMs.p95 ?? null)}</span>
                <span>B {ms(report.target23.b?.successMs.p95 ?? null)}</span>
              </div>
            )}
          </Section>

          <Section title="PID başına (rotasyon tasarımının girdisi)">
            {report.perPid.length === 0 ? (
              <p className="text-[12px] text-[var(--oem-ink-3)]">{UNAVAILABLE} — örnek yok.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] font-mono">
                  <thead className="text-[var(--oem-ink-3)]">
                    <tr>
                      <th className="py-1 pr-2">PID</th>
                      <th className="pr-2">A NO_DATA</th><th className="pr-2">B NO_DATA</th>
                      <th className="pr-2">A OK p95</th><th className="pr-2">B OK p95</th>
                      <th>hüküm</th>
                    </tr>
                  </thead>
                  <tbody className="text-[var(--oem-ink-1)]">
                    {report.perPid.map((p) => (
                      <tr key={p.pid} className="border-t border-[var(--oem-line)]">
                        <td className="py-1 pr-2">{p.pid}</td>
                        <td className="pr-2">{pct(p.a?.noDataRate ?? null)}</td>
                        <td className="pr-2">{pct(p.b?.noDataRate ?? null)}</td>
                        <td className="pr-2">{ms(p.a?.successMs.p95 ?? null)}</td>
                        <td className="pr-2">{ms(p.b?.successMs.p95 ?? null)}</td>
                        <td>{PID_VERDICT_LABEL[p.verdict]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <p className="flex items-start gap-1.5 text-[11px] text-[var(--oem-ink-3)]">
            <Timer size={12} className="mt-0.5 shrink-0" />
            <span>
              PID başına p95 süreleri, ileride sabit tek ATST yerine <b>PID başına uyarlanmış
              bekleme</b> tasarımının girdisidir — bu ekran yalnız &quot;düzeldi mi&quot;
              sorusunu değil, &quot;hangi sinyal ne kadar bekliyor&quot; sorusunu da yanıtlar.
            </span>
          </p>
        </>
      )}
    </div>
  );
}

export const PidTimingExperimentScreen = memo(PidTimingExperimentScreenBase);
