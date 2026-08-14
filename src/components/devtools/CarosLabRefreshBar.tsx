/**
 * CarosLabRefreshBar — CAROS LAB · "TÜMÜNÜ YENİLE" tek tuşu + otomatik tur.
 *
 * NEDEN VAR: LAB deseni "açılışta tek okuma + elle YENİLE"dir. Sahada bir tur
 * kanıt toplamak için 9 ekranı tek tek açıp her birinde YENİLE'ye basmak
 * gerekiyordu; üstelik iki native kanıt önbelleği (#523 poll sayacı, #524 eleme)
 * yalnız ilgili ekran açıldığında doluyordu → "TÜMÜNÜ KOPYALA" sık sık BAYAT
 * kanıtla alınıyordu. Bu çubuk o turu TEK yerden koşturur.
 *
 * ── SINIR (PAZARLIKSIZ) ────────────────────────────────────────────────────
 * YALNIZ mevcut OKUMA çağrılarını tetikler. Bağlantı KURMAZ, YENİDEN BAĞLANMAZ,
 * araca komut GÖNDERMEZ. "TAZE bağlantı kur" ve H-A gibi araca dokunan ekranlar
 * KAPSAM DIŞIDIR — bilinçli kullanıcı eylemi olarak kalırlar.
 *
 * ── ZERO-LEAK ──────────────────────────────────────────────────────────────
 * Periyodik turun SAHİBİ bu bileşendir: LAB kapanınca (unmount) ve uygulama
 * arka plana atılınca (`visibilitychange`) zamanlayıcı DURUR. Abonelik unmount'ta
 * kaldırılır; sökülmüş bileşene setState YAPILMAZ.
 *
 * TEMA: sabit renk YOK — yalnız `--oem-*` token'ları (aydınlık/gece/güneş modu
 * otomatik gelir).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, ChevronDown, ChevronRight, Timer } from 'lucide-react';
import {
  CAROS_LAB_REFRESH_SECTIONS, CAROS_LAB_REFRESH_STATUS_LABEL,
  CAROS_LAB_REFRESH_VERDICT_LABEL, formatRefreshAge, refreshStatusTone,
  summarizeRefreshRun,
  type CarosLabRefreshRun, type CarosLabRefreshTone,
} from '../../platform/devtools/carosLabRefreshModel';
import {
  getCarosLabAutoRefreshMs, getCarosLabRefreshRun, runCarosLabRefreshAll,
  subscribeCarosLabRefresh,
} from '../../platform/devtools/carosLabRefreshRuntime';

const TONE_CLASS: Record<CarosLabRefreshTone, string> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const SECTION_LABEL = new Map(CAROS_LAB_REFRESH_SECTIONS.map((s) => [s.id, s]));

export const CarosLabRefreshBar = memo(function CarosLabRefreshBar() {
  const [run, setRun] = useState<CarosLabRefreshRun>(getCarosLabRefreshRun);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [auto, setAuto] = useState(true);
  const [open, setOpen] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* Tur durumuna abone — unmount'ta KALDIRILIR. */
  useEffect(() => subscribeCarosLabRefresh((r) => {
    if (!mountedRef.current) return;
    setRun(r);
    setNowMs(Date.now());
  }), []);

  const intervalMs = useMemo(() => getCarosLabAutoRefreshMs(), []);

  /* OTOMATİK TUR — sahibi bu bileşendir.
     · LAB kapanınca unmount → cleanup → zamanlayıcı DURUR.
     · Uygulama arka plana atılınca da DURUR; öne gelince bir tur koşup devam eder
       (dönüşte bayat veriyle karşılaşılmasın).
     · Yeniden giriş koruması runtime'dadır: tur uzarsa ikinci tur BAŞLAMAZ. */
  useEffect(() => {
    if (!auto) return;
    const hasDoc = typeof document !== 'undefined';
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const start = () => {
      stop();
      timer = setInterval(() => { void runCarosLabRefreshAll('auto'); }, intervalMs);
    };
    const hidden = () => hasDoc && document.visibilityState === 'hidden';

    const onVisibility = () => {
      if (hidden()) { stop(); return; }
      void runCarosLabRefreshAll('auto');
      start();
    };

    if (!hidden()) {
      void runCarosLabRefreshAll('auto');   // LAB açılır açılmaz ilk tur
      start();
    }
    if (hasDoc) document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      if (hasDoc) document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [auto, intervalMs]);

  const manual = useCallback(() => { void runCarosLabRefreshAll('manual'); }, []);
  const toggleAuto = useCallback(() => { setAuto((v) => !v); }, []);
  const toggleOpen = useCallback(() => { setOpen((v) => !v); }, []);

  const summary = useMemo(() => summarizeRefreshRun(run), [run]);

  /* Sorunlu bölümler ADIYLA görünür — sessiz atlama YOK. */
  const problemNames = summary.problemIds
    .map((id) => SECTION_LABEL.get(id)?.label ?? id)
    .join(' · ');

  return (
    <div
      data-testid="lab-refresh-bar"
      data-verdict={summary.verdict}
      data-cycle={run.cycle}
      className="shrink-0 border-b border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-4 py-1.5"
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
        <button
          type="button"
          data-testid="lab-refresh-all"
          onClick={manual}
          disabled={run.running}
          title="Tüm salt-okunur kanıt bölümlerini tazeler — bağlantı kurmaz, araca komut göndermez"
          className="flex items-center gap-1 rounded border border-[var(--oem-info)] bg-[var(--oem-info-soft)] px-2 py-1 text-[var(--oem-info)] disabled:opacity-50"
        >
          <RefreshCw size={11} /> {run.running ? 'YENİLENİYOR…' : 'TÜMÜNÜ YENİLE'}
        </button>

        <button
          type="button"
          data-testid="lab-refresh-auto"
          data-auto={auto ? 'on' : 'off'}
          onClick={toggleAuto}
          title="LAB açıkken periyodik tazeleme; arka plana atılınca durur"
          className={`flex items-center gap-1 rounded border px-2 py-1 ${
            auto ? TONE_CLASS.ok : TONE_CLASS.muted
          }`}
        >
          <Timer size={11} /> OTO {auto ? `AÇIK (${Math.round(intervalMs / 1000)} sn)` : 'KAPALI'}
        </button>

        <span
          data-testid="lab-refresh-verdict"
          className={`rounded border px-1.5 py-0.5 ${
            summary.verdict === 'ALL_REFRESHED' ? TONE_CLASS.ok
              : summary.verdict === 'PARTIAL' ? TONE_CLASS.warn
                : summary.verdict === 'NONE_REFRESHED' ? TONE_CLASS.bad
                  : TONE_CLASS.muted
          }`}
        >
          {CAROS_LAB_REFRESH_VERDICT_LABEL[summary.verdict]}
        </span>

        <span className="text-[var(--oem-ink-3)]">
          TAZELENDİ {summary.refreshed}/{summary.total} · KAYNAK YOK {summary.unavailable} ·
          OKUNAMADI {summary.failed} · tur #{run.cycle} · {formatRefreshAge(run.finishedAtMs, nowMs)}
        </span>

        <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
          <ShieldCheck size={11} /> SALT OKUNUR — bağlantı kurmaz
        </span>

        <button
          type="button"
          data-testid="lab-refresh-toggle-detail"
          onClick={toggleOpen}
          className="ml-auto flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {open ? 'AYRINTIYI GİZLE' : 'AYRINTI'}
        </button>
      </div>

      {/* Sorunlu bölümler kapalıyken de ADIYLA görünür (sessiz başarısızlık YOK). */}
      {!open && problemNames.length > 0 && (
        <p
          data-testid="lab-refresh-problems"
          className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-warn)]"
        >
          Tazelenemeyen bölümler: {problemNames}
        </p>
      )}

      {open && (
        <div data-testid="lab-refresh-detail" className="mt-1.5">
          {run.results.map((r) => {
            const meta = SECTION_LABEL.get(r.id);
            return (
              <div
                key={r.id}
                data-testid={`lab-refresh-section-${r.id}`}
                data-status={r.status}
                className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-1 py-1 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[10px] text-[var(--oem-ink-2)]">
                      {meta?.label ?? r.id}
                    </span>
                    {meta?.nativePull && (
                      <span className="rounded border border-[var(--oem-line-strong)] px-1 py-0.5 font-mono text-[8px] text-[var(--oem-ink-3)]">
                        NATIVE SAYAÇ
                      </span>
                    )}
                    <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
                      → {meta?.screen ?? '—'}
                    </span>
                  </div>
                  <div className="mt-0.5 break-all font-mono text-[10px] text-[var(--oem-ink)]">
                    {r.detail}
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
                    son başarı: {formatRefreshAge(r.okAtMs, nowMs)}
                    {' · '}son deneme: {formatRefreshAge(r.attemptedAtMs, nowMs)}
                    {r.durationMs !== null ? ` · ${r.durationMs} ms` : ''}
                  </div>
                </div>
                <span
                  title={r.status}
                  className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                    TONE_CLASS[refreshStatusTone(r.status)]
                  }`}
                >
                  {CAROS_LAB_REFRESH_STATUS_LABEL[r.status]}
                </span>
              </div>
            );
          })}

          <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
            Bu tur YALNIZ mevcut okuma çağrılarını tetikler: bağlantı kurmaz, yeniden
            bağlanmaz, araca komut/PID/AT sorgusu göndermez, poll · handshake · Derin
            Tarama başlatmaz. Native uçlar SALT SAYAÇ okumasıdır. "KAYNAK YOK" ile
            "OKUNAMADI" farklı şeylerdir: birincisi kanıt kanalının yokluğu, ikincisi
            okumanın patlamasıdır — hiçbiri sessizce atlanmaz.
          </p>
        </div>
      )}
    </div>
  );
});
