/**
 * MaviConsoleScreen — CAROS LAB · AI · Mavi Konsolu (Faz A7).
 *
 * SALT-OKUNUR. Mavi sesli asistanın RAM'deki yaşam döngüsü ve teşhis durumlarını
 * gösterir; hiçbir şeyi DEĞİŞTİRMEZ.
 *
 * YAPMADIKLARI (pazarlıksız): dinleme başlat/durdur · wake word aç/kapa · TTS
 * konuşturma · AI sağlayıcısına istek · retry/reset · komut dispatch · devre kesici
 * sıfırlama · yeni timer/polling/abonelik · yeni global store.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni (Session Inspector · Runtime Scheduling ·
 * KWP İzleyici · Araç Parmak İzi · Adaptör Tanılama) periyodik yenileme kullanmaz —
 * açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK: transcript metni · son komut metni · konuşma geçmişi · öneri metinleri
 * ve ses hatası MESAJI bu ekrana HİÇ GELMEZ (kaynak katmanı yalnız VAR/YOK ve ADET
 * taşır). Kopyalama butonu YOKTUR.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, Mic, FlaskConical } from 'lucide-react';
import { readMaviConsoleSnapshot } from '../../../platform/devtools/maviConsoleSources';
import {
  runMaviScenarios, SCENARIO_SIMULATION_LABEL,
  type ScenarioRunSummary,
} from '../../../platform/devtools/maviScenarioRunner';
import {
  buildMaviSections, buildMaviDiagRows, deriveMaviVerdict, countByMaviClass,
  MAVI_VERDICT_LABEL, MAX_MAVI_DIAG_ROWS,
  type MaviVerdict, type MaviRawSnapshot,
} from '../../../platform/devtools/maviConsoleModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const VERDICT_STYLE: Record<MaviVerdict, string> = {
  READY:           'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  RUNNING:         'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  AI_BLOCKED:      'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  MIC_UNAVAILABLE: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  ERROR:           'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNKNOWN:         'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`mavi-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
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

export const MaviConsoleScreen = memo(function MaviConsoleScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<MaviRawSnapshot>(() => readMaviConsoleSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readMaviConsoleSnapshot());
  }, []);

  /* ── SİMÜLASYON: senaryo koşucusu (elle tetiklenir — TIMER YOK) ─────────
     Koşu senkron ve deterministiktir; gerçek araç/ağ/telefon/TTS'e DOKUNMAZ.
     Koşu sonrası snapshot tazelenir ki karar satırları "E" bölümünde görünsün. */
  const [scenarios, setScenarios] = useState<ScenarioRunSummary | null>(null);
  const runScenarios = useCallback(() => {
    if (!mountedRef.current) return;
    let summary: ScenarioRunSummary | null = null;
    try { summary = runMaviScenarios(); } catch { summary = null; }  // ekran ÇÖKMEZ
    if (!mountedRef.current) return;
    setScenarios(summary);
    setSnap(readMaviConsoleSnapshot());
  }, []);

  const sections    = useMemo(() => buildMaviSections(snap), [snap]);
  const diagRows    = useMemo(() => buildMaviDiagRows(snap), [snap]);
  const verdict     = useMemo(() => deriveMaviVerdict(snap), [snap]);
  const classCounts = useMemo(() => countByMaviClass(sections), [sections]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="mavi-console">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Mic size={12} /> MAVİ KONSOLU
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — dinleme/TTS/AI isteği başlatmaz
          </span>
          <button
            type="button"
            data-testid="mavi-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {classCounts.OBSERVED} · TÜRETİLDİ {classCounts.DERIVED} ·
            KAYNAK YOK {classCounts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Yalnız mevcut senkron getter'lar okunur: mikrofon açılmaz, TTS konuşturulmaz,
          AI sağlayıcısına istek gitmez, komut çalıştırılmaz. Periyodik yenileme YOKTUR.
          GİZLİLİK: transcript metni, son komut metni, konuşma geçmişi ve öneri metinleri
          bu ekrana HİÇ GELMEZ — yalnız VAR/YOK ve ADET gösterilir; kopyalama butonu yoktur.
        </p>
      </div>

      {/* Hüküm — fail-closed */}
      <div
        data-testid="mavi-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        MAVİ DURUMU: {MAVI_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Kaynak okunamazsa hüküm BİLİNMİYOR kalır — "hazır" VARSAYILMAZ. Repoda tanımsız
          bir durum dizesi de tahmin edilmez.
        </div>
      </div>

      {/* SİMÜLASYON — deterministik senaryo koşucusu */}
      <div
        data-testid="mavi-scenario-panel"
        className="shrink-0 rounded border border-[var(--oem-warn)] bg-[var(--oem-surface-1)]"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
          <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            <FlaskConical size={12} /> F · Senaryo Koşucusu
          </span>
          {/* Bu etiket UI'dan KALDIRILAMAZ — bir kilit testi varlığını zorlar. */}
          <span
            data-testid="mavi-scenario-simulation-label"
            className="rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--oem-warn)]"
          >
            {SCENARIO_SIMULATION_LABEL}
          </span>
          <button
            type="button"
            data-testid="mavi-scenario-run"
            onClick={runScenarios}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 font-mono text-[10px] text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            {scenarios === null ? 'SENARYOLARI ÇALIŞTIR' : 'TEKRAR ÇALIŞTIR'}
          </button>
          {scenarios !== null && (
            <span data-testid="mavi-scenario-totals" className="font-mono text-[10px] text-[var(--oem-ink-3)]">
              PASS {scenarios.passed} · FAIL {scenarios.failed} · TOPLAM {scenarios.total}
              {scenarios.trailRowCount !== null && ` · İZ SATIRI ${scenarios.trailRowCount}`}
            </span>
          )}
        </div>

        <p className="px-3 py-1.5 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Senaryolar GERÇEK üretim fonksiyonlarını enjekte edilmiş bağımlılıklarla çağırır:
          gerçek EventBus'a olay yayınlanmaz, TTS konuşmaz, telefon/navigasyon/OBD/ağ/storage
          çağrılmaz, üretim tekilleri değiştirilmez. Saat enjekte edilir → aynı girdi aynı sonuç.
          Bu bir cihaz veya araç doğrulaması DEĞİLDİR; kütükteki 🔴 maddeleri 🟢 YAPMAZ.
        </p>

        {scenarios !== null && (
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[10px]">
              <thead className="text-[var(--oem-ink-3)]">
                <tr className="border-t border-[var(--oem-line)]">
                  <th className="px-2 py-1 text-left">#</th>
                  <th className="px-2 py-1 text-left">SENARYO</th>
                  <th className="px-2 py-1 text-left">SONUÇ</th>
                  <th className="px-2 py-1 text-left">BEKLENEN</th>
                  <th className="px-2 py-1 text-left">GERÇEKLEŞEN</th>
                  <th className="px-2 py-1 text-left">SEBEP / SUSTURMA</th>
                  <th className="px-2 py-1 text-left">GÜVEN</th>
                  <th className="px-2 py-1 text-left">KANIT</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.results.map((r, i) => (
                  <tr
                    key={r.id}
                    data-testid={`mavi-scenario-row-${r.id}`}
                    data-pass={r.pass ? 'true' : 'false'}
                    className="border-t border-[var(--oem-line)] align-top"
                  >
                    <td className="px-2 py-1 text-[var(--oem-ink-3)]">{i + 1}</td>
                    <td className="px-2 py-1 text-[var(--oem-ink-2)]">{r.title}</td>
                    <td className={`px-2 py-1 font-bold ${r.pass ? 'text-[var(--oem-good)]' : 'text-[var(--oem-danger)]'}`}>
                      {r.pass ? 'PASS' : 'FAIL'}
                    </td>
                    <td className="px-2 py-1 text-[var(--oem-ink-3)]">{r.expected}</td>
                    <td className="px-2 py-1 text-[var(--oem-ink-3)]">{r.actual}</td>
                    <td className="px-2 py-1 text-[var(--oem-ink-3)]">
                      {r.reasonCode ?? 'BİLİNMİYOR'}
                      {r.suppressionReason ? ` · sustur:${r.suppressionReason}` : ''}
                      {r.errorCode ? ` · hata:${r.errorCode}` : ''}
                    </td>
                    <td className="px-2 py-1 text-[var(--oem-ink-3)]">
                      {/* Kaynağı yoksa SAHTE DEĞER basılmaz. */}
                      {r.confidence !== undefined && r.confidenceScale !== undefined
                        ? `${r.confidence} (${r.confidenceScale})`
                        : 'KAYNAK YOK'}
                    </td>
                    <td className="px-2 py-1 text-[var(--oem-ink-3)]">{r.evidenceSummary ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bölümler */}
      {sections.map((sec) => (
        <div
          key={sec.id}
          data-testid={`mavi-section-${sec.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {sec.title}
            </span>
            {sec.id === 'quota' && (
              <span className="rounded border border-[var(--oem-line-strong)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
                SAĞLAYICILAR AYRI — TOPLANMAZ
              </span>
            )}
          </div>
          <div>
            {sec.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      {/* B · Tanı satırları — EN YENİDEN ESKİYE */}
      <div
        data-testid="mavi-diag-table"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            B · Tanı Aşamaları (en yeni → en eski)
          </span>
          {diagRows === null && (
            <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
              <AlertTriangle size={10} /> KAYNAK OKUNAMADI
            </span>
          )}
        </div>

        {diagRows === null && (
          <div className="px-3 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            Tanı halkası okunamadı. BOŞ halka ile OKUNAMADI ayrı şeydir — 0 gösterilmez.
          </div>
        )}
        {diagRows !== null && diagRows.length === 0 && (
          <div className="px-3 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            Halka GERÇEKTEN boş: bu oturumda hiç ses tanı olayı kaydedilmedi (okuma başarılı).
          </div>
        )}
        {diagRows !== null && diagRows.map((r) => (
          <div
            key={`${r.index}-${r.stage}`}
            data-testid={`mavi-diag-row-${r.index}`}
            data-stage={r.stage}
            className="grid grid-cols-[auto_1fr] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
          >
            <span className="font-mono text-[10px] text-[var(--oem-ink-3)]">#{r.index}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2 font-mono text-[11px]">
                <span className="text-[var(--oem-ink)]">{r.stage}</span>
                <span className="text-[9px] text-[var(--oem-ink-3)]">{r.atLabel}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[9px] text-[var(--oem-ink-2)]">
                <span>
                  transcript uzunluğu: {r.transcriptLength === null ? '—' : r.transcriptLength}
                </span>
                <span>rota: {r.route ?? '—'}</span>
                <span>niyet: {r.intent ?? '—'}</span>
                <span
                  className={r.errorCode ? 'text-[var(--oem-danger)]' : undefined}
                >
                  hata kodu: {r.errorCode ?? '—'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        En çok {MAX_MAVI_DIAG_ROWS} satır gösterilir (repo halkası 40 kayıt tutar) — kırpma
        EN YENİLERİ korur. `transcript uzunluğu` bir SAYIDIR, metnin kendisi değildir.
        DÜRÜSTLÜK: AI sağlık okuması tam saf DEĞİLDİR — süresi ZATEN DOLMUŞ bir devre
        kesici penceresini kapatır (yarı-açık geçiş). Bu geçişin vadesi gelmiştir; okuma
        yeni devre AÇMAZ ve ağ çağrısı yapmaz. AI sağlığı ile sağlayıcı kotası AYRI
        motorlardır ve birleştirilmez.
      </p>
    </div>
  );
});
