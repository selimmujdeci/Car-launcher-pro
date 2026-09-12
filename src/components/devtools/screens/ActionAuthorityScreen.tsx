/**
 * ActionAuthorityScreen — CAROS LAB · AI · Eylem Otoritesi (MAVI-M4-LAB).
 *
 * SALT-OKUNUR. Mavi'nin TEK eylem otoritesinin (`action/maviActionAuthority`)
 * defterini, kapı kararlarını ve sayaçlarını gösterir; hiçbir şeyi DEĞİŞTİRMEZ.
 *
 * YAPMADIKLARI (pazarlıksız):
 *  · Hiçbir action ÇALIŞTIRMAZ — çalıştırma butonu YOKTUR.
 *  · Bekleyen onayı ONAYLAMAZ / İPTAL ETMEZ — o butonlar YOKTUR.
 *  · Kapı DEĞERLENDİRMEZ (`evaluateVehicleAction` bu ağaçtan çağrılmaz) —
 *    çağrılsaydı gözlem, gözlediği sayaçları kirletirdi.
 *  · Köprü / OBD / native / ağ / TTS çağrısı YOK.
 *  · Yeni global store KURMAZ.
 *
 * YAŞAM DÖNGÜSÜ: host `{open && <X/>}` deseniyle render eder → ekran KAPALIYKEN
 * bileşen MOUNT DEĞİLDİR, dolayısıyla polling YAPISAL OLARAK ÇALIŞAMAZ.
 * Varsayılan davranış repo LAB desenidir: açılışta TEK okuma + elle YENİLE.
 * İsteğe bağlı otomatik yenileme VARSAYILAN KAPALIDIR; açılırsa düşük frekanslı
 * (2 sn) çalışır ve unmount'ta `clearInterval` ile TEMİZLENİR (zero-leak).
 *
 * GİZLİLİK: ham kullanıcı komutu · kişi adı · telefon numarası · sağlayıcı cevabı ·
 * konum · VIN bu ekrana HİÇ GELMEZ (kaynak katmanı yalnız enum/kimlik/sayı taşır).
 * Bekleyen onay yalnız VAR/YOK'tur. Kopyalama butonu YOKTUR.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Lock, Timer } from 'lucide-react';
import { readActionAuthoritySnapshot } from '../../../platform/devtools/actionAuthoritySources';
import {
  buildAaSections, buildAaActionRows, buildAaDecisionRows, countByAaClass,
  AA_DECISION_TONE_LABEL,
  type AaRawSnapshot, type AaDecisionTone, type AaRiskTone,
} from '../../../platform/devtools/actionAuthorityModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

/** Otomatik yenileme periyodu — DÜŞÜK frekans (Mali-400 / düşük-uç bütçesi). */
const AUTO_REFRESH_MS = 2_000;

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const TONE_STYLE: Record<AaDecisionTone, string> = {
  ALLOWED: 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  BLOCKED: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  CONFIRM: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NEUTRAL: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const RISK_STYLE: Record<AaRiskTone, string> = {
  HIGH:    'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  MEDIUM:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  LOW:     'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  UNKNOWN: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`aa-field-${field.id}`}
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

export const ActionAuthorityScreen = memo(function ActionAuthorityScreen() {
  // Açılışta TEK okuma. Otomatik yenileme VARSAYILAN KAPALI.
  const [snap, setSnap] = useState<AaRawSnapshot>(() => readActionAuthoritySnapshot());
  const [auto, setAuto] = useState(false);

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    try { setSnap(readActionAuthoritySnapshot()); } catch { /* ekran ÇÖKMEZ */ }
  }, []);

  /* Otomatik yenileme — YALNIZ `auto` açıkken timer kurulur; kapatılınca ve
     unmount'ta MUTLAKA temizlenir. Ekran kapalıyken bileşen zaten mount değildir
     → bu effect hiç çalışmaz (polling yapısal olarak imkânsız). */
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(refresh, AUTO_REFRESH_MS);
    return () => { clearInterval(id); };
  }, [auto, refresh]);

  const sections     = useMemo(() => buildAaSections(snap), [snap]);
  const actionRows   = useMemo(() => buildAaActionRows(snap), [snap]);
  const decisionRows = useMemo(() => buildAaDecisionRows(snap), [snap]);
  const classCounts  = useMemo(() => countByAaClass(sections), [sections]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="action-authority">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={13} className="shrink-0 text-[var(--oem-good)]" />
          <span className="font-mono text-[11px] text-[var(--oem-ink)]">Eylem Otoritesi · SALT-OKUNUR</span>
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ekran hiçbir eylemi çalıştırmaz, bekleyen onayı onaylamaz veya iptal etmez.
          Ham komut, kişi adı ve telefon numarası bu yüzeye hiç gelmez — bekleyen onay
          yalnız VAR/YOK olarak gösterilir.
        </p>
      </div>

      {/* Kontroller — YALNIZ okuma tazeleme (eylem tetikleyen buton YOK) */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={refresh}
          data-testid="aa-refresh"
          className="flex items-center gap-1.5 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2.5 py-1 font-mono text-[10px] text-[var(--oem-ink)]"
        >
          <RefreshCw size={11} /> YENİLE
        </button>
        <button
          type="button"
          onClick={() => setAuto((v) => !v)}
          data-testid="aa-auto-toggle"
          aria-pressed={auto}
          className={`flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[10px] ${
            auto
              ? 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]'
              : 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]'
          }`}
        >
          <Timer size={11} /> OTOMATİK {auto ? 'AÇIK (2 sn)' : 'KAPALI'}
        </button>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(classCounts) as Observability[]).map((k) =>
            classCounts[k] > 0 ? (
              <span key={k} className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[k]}`}>
                {OBSERVABILITY_LABEL[k]} {classCounts[k]}
              </span>
            ) : null,
          )}
        </div>
      </div>

      {/* Bölümler: bekleyen onay + sayaçlar */}
      {sections.map((s) => (
        <section key={s.id} data-testid={`aa-section-${s.id}`} className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
          <h3 className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] text-[var(--oem-ink-2)]">
            {s.title}
          </h3>
          {s.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
        </section>
      ))}

      {/* 3 · Eylem defteri (Action Registry) */}
      <section data-testid="aa-section-registry" className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <h3 className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] text-[var(--oem-ink-2)]">
          3 · Eylem Defteri {actionRows ? `(${actionRows.length})` : ''}
        </h3>
        {actionRows === null ? (
          <p data-testid="aa-registry-unavailable" className="px-2 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            KAYNAK YOK — defter okunamadı.
          </p>
        ) : actionRows.length === 0 ? (
          <p className="px-2 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">Defter boş.</p>
        ) : (
          actionRows.map((a) => (
            <div
              key={a.key}
              data-testid={`aa-action-${a.actionId}`}
              data-risk={a.risk}
              className="border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${RISK_STYLE[a.riskTone]}`}>
                  {a.risk.toUpperCase()}
                </span>
                <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{a.actionId}</span>
                <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">{a.intent}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
                <span>onay: {a.requiresConfirmation ? 'GEREKLİ' : 'gerekmez'}</span>
                <span>capability: {a.capability ?? 'port gerekmez'}</span>
                <span>vehicleScope: {a.vehicleScope ?? 'ECU dışı'}</span>
                <span>motion: {a.motionPolicy}</span>
              </div>
              {(a.requiresConfirmation || a.requiresStopped) && (
                <div className="mt-0.5 flex items-center gap-1 text-[9px] text-[var(--oem-warn)]">
                  <Lock size={9} className="shrink-0" />
                  {a.requiresStopped
                    ? 'Yalnız DOĞRULANMIŞ duruşta yürür (unknown ≠ park).'
                    : 'Açık kullanıcı onayı olmadan yürümez.'}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {/* 4 · Son kapı kararları (en yeni → en eski, bounded) */}
      <section data-testid="aa-section-decisions" className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <h3 className="border-b border-[var(--oem-line)] px-2 py-1 font-mono text-[10px] text-[var(--oem-ink-2)]">
          4 · Son Kapı Kararları {decisionRows ? `(${decisionRows.length}/${snap.capacity})` : ''} · en yeni → en eski
        </h3>
        {decisionRows === null ? (
          <p data-testid="aa-decisions-unavailable" className="px-2 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            KAYNAK YOK — karar halkası okunamadı.
          </p>
        ) : decisionRows.length === 0 ? (
          <p data-testid="aa-decisions-empty" className="px-2 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            Henüz kapı kararı yok (halka gerçekten boş).
          </p>
        ) : (
          decisionRows.map((d) => (
            <div
              key={d.key}
              data-testid={`aa-decision-${d.actionId}`}
              data-status={d.status}
              className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{d.actionId}</span>
                  <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">{d.intent}</span>
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
                  {d.status} · {d.reason}
                  {formatAge(d.atMs, snap.readAt) ? <> · {formatAge(d.atMs, snap.readAt)}</> : <> · zaman damgası yok</>}
                </div>
              </div>
              <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${TONE_STYLE[d.tone]}`}>
                {AA_DECISION_TONE_LABEL[d.tone]}
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  );
});
