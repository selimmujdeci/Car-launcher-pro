/**
 * AiMechanicScreen — CAROS LAB · AI · AI MECHANIC.
 *
 * ── BU EKRAN NE DEĞİLDİR ───────────────────────────────────────────────
 * Bir tamir/servis paneli DEĞİLDİR. Burada öneri, tavsiye, parça, maliyet
 * veya "şunu yaptır" cümlesi YOKTUR (paket şartı §5 — P1 yalnız TEŞHİS).
 *
 * ── AI MECHANIC KARAR ÜRETMEZ ──────────────────────────────────────────
 * Ekrandaki her satır MAVI Reasoning Engine'in ÜRETTİĞİ bir kararın mekanik
 * dile çevrilmiş hâlidir. Güven MAVI'den AYNEN gelir; şiddet yalnız
 * karar+güven ikilisinin sunum sıralamasıdır. Yeni karar/güven/kanıt YOK.
 *
 * YAPMADIKLARI (aktif komut YOK):
 *   · karar üretme/yazma · durum ilerletme · kanıt yazma · sunucuya yazma
 *   · ağ çağrısı · timer/abonelik kurma · LLM çağrısı
 * Açılışta TEK okuma + elle YENİLE.
 *
 * ── GİZLİLİK ───────────────────────────────────────────────────────────
 * Araç/sürücü ADI yok · plaka yok · VIN yok · konum yok — yalnız kısaltılmış
 * teknik referans (`veh:xxxxxxxx`) ve bounded kodlar.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Wrench, ShieldAlert, HelpCircle, Scale, GitBranch,
  Inbox, Thermometer, BatteryWarning, Fuel, Plug, Cpu, Snowflake,
} from 'lucide-react';
import { readAiMechanic, type MechanicReadout } from '../../../platform/aiMechanic/aiMechanicSources';
import {
  MECHANIC_CATEGORIES,
  type MechanicAnalysis, type MechanicCategory,
  type MechanicAnalysisState, type MechanicSeverity,
} from '../../../platform/aiMechanic/aiMechanicModel';

/* ── OEM tokenlar ──────────────────────────────────────────────────────── */

const OK   = 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]';
const WARN = 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]';
const BAD  = 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]';
const NONE = 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]';
const INFO = 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]';

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

/* ── Etiketler (bounded — serbest metin YOK) ───────────────────────────── */

const CATEGORY_LABEL: Record<MechanicCategory, string> = {
  ENGINE: 'MOTOR', COOLING: 'SOĞUTMA', BATTERY: 'AKÜ', FUEL: 'YAKIT',
  OBD: 'OBD/TANI', TEMPERATURE: 'SICAKLIK', CONNECTIVITY: 'BAĞLANTI',
  UNKNOWN: 'BİLİNMİYOR',
};

const CATEGORY_ICON: Record<MechanicCategory, React.ReactNode> = {
  ENGINE: <Cpu size={11} />, COOLING: <Snowflake size={11} />,
  BATTERY: <BatteryWarning size={11} />, FUEL: <Fuel size={11} />,
  OBD: <Wrench size={11} />, TEMPERATURE: <Thermometer size={11} />,
  CONNECTIVITY: <Plug size={11} />, UNKNOWN: <HelpCircle size={11} />,
};

const STATE_LABEL: Record<MechanicAnalysisState, string> = {
  SUPPORTED: 'DOĞRULANDI', UNSUPPORTED: 'OLUMSUZ KANIT', UNKNOWN: 'BİLİNMİYOR',
  INSUFFICIENT_EVIDENCE: 'KANIT YETERSİZ', CONFLICTED_EVIDENCE: 'KANIT ÇELİŞKİLİ',
  EXPIRED_EVIDENCE: 'KANIT SÜRESİ DOLMUŞ',
};

function stateTone(s: MechanicAnalysisState): string {
  if (s === 'SUPPORTED')   return OK;
  if (s === 'UNSUPPORTED') return BAD;
  return NONE;                       // bilinmeyen/çelişkili/eksik → NÖTR
}

function severityTone(s: MechanicSeverity): string {
  if (s === 'CRITICAL') return BAD;
  if (s === 'WARNING')  return WARN;
  if (s === 'NONE')     return OK;
  return NONE;
}

/** Kısaltılmış teknik referans — TAM kimlik ASLA gösterilmez (gizlilik). */
function shortRef(prefix: string, id: string | null): string {
  if (!id) return '—';
  return `${prefix}:${id.slice(0, 8)}`;
}

/* ── Satır ─────────────────────────────────────────────────────────────── */

const AnalysisRow = memo(function AnalysisRow({ a }: { a: MechanicAnalysis }) {
  return (
    <div className="border-b border-[var(--oem-line)] px-2 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={INFO}>
          <span className="mr-1">{CATEGORY_ICON[a.diagnosticCategory]}</span>
          {CATEGORY_LABEL[a.diagnosticCategory]}
        </Chip>
        <Chip tone={stateTone(a.state)}>{STATE_LABEL[a.state]}</Chip>
        <Chip tone={severityTone(a.severity)}>ŞİDDET {a.severity}</Chip>
        <Chip tone={NONE}>GÜVEN {a.confidence}</Chip>
        <Chip tone={NONE}>{a.confidenceReason}</Chip>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-[color:var(--oem-ink-3)]">
        <span>{a.analysisId.slice(0, 18)}…</span>
        <span>{shortRef('veh', a.vehicleId)}</span>
        <span>{shortRef('drv', a.driverId)}</span>
        <span>{shortRef('trip', a.tripId)}</span>
        <span>kanıt {a.evidenceCount}</span>
        <span>çelişki {a.conflictCount}</span>
        <span>MAVI durumu {a.reasoningState}</span>
      </div>
      {/* MUHAKEME ZİNCİRİ (paket şartı §6): hangi karar · hangi kanıt. */}
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[color:var(--oem-ink-3)]">
        <GitBranch size={10} />
        <span className="font-mono">karar {a.reasoningId.slice(0, 8)}</span>
        <span>←</span>
        <span className="font-mono">
          {a.evidenceIds.length === 0
            ? 'kanıt YOK'
            : a.evidenceIds.slice(0, 3).map((e) => e.slice(0, 8)).join(' · ')}
          {a.evidenceIds.length > 3 ? ` (+${a.evidenceIds.length - 3})` : ''}
        </span>
      </div>
    </div>
  );
});

/* ── Ekran ─────────────────────────────────────────────────────────────── */

export default function AiMechanicScreen() {
  const [snap, setSnap] = useState<MechanicReadout | null>(null);
  const [read, setRead] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    // Saat BURADA okunur; saf katmanlar `nowMs`i parametre olarak alır.
    const s = readAiMechanic(Date.now());
    if (!mountedRef.current) return;
    setSnap(s);
    setRead(true);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — timer/abonelik YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const sum = snap?.summary ?? null;

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-2 text-[12px] text-[color:var(--oem-ink)]">

      {/* Başlık + YENİLE */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold tracking-wide">
          <Wrench size={13} /> AI MECHANIC
          <span className="text-[10px] font-normal text-[color:var(--oem-ink-3)]">
            · SALT-OKUNUR TEŞHİS · KARAR ÜRETMEZ
          </span>
        </div>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1 rounded border border-[var(--oem-line-strong)]
                     bg-[var(--oem-surface-2)] px-2 py-1 text-[11px]"
        >
          <RefreshCw size={11} /> YENİLE
        </button>
      </div>

      {/* Okuma başarısız — boş küme VARSAYILMAZ */}
      {read && snap === null && (
        <div className="rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] p-2">
          <div className="flex items-center gap-1.5 font-medium text-[color:var(--oem-danger)]">
            <ShieldAlert size={12} /> OKUNAMADI
          </div>
          <p className="mt-1 text-[11px] text-[color:var(--oem-ink-2)]">
            Karar defteri okunamadı. Bu <b>&quot;analiz yok&quot; DEMEK DEĞİLDİR</b> — kaynak
            erişilemedi.
          </p>
        </div>
      )}

      {snap && (
        <>
          {/* Kaynak dürüstlüğü */}
          {snap.source === 'NONE' && (
            <div className="rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] p-2">
              <div className="flex items-center gap-1.5 font-medium text-[color:var(--oem-warn)]">
                <Inbox size={12} /> KARAR KÖPRÜSÜ BAĞLI DEĞİL
              </div>
              <p className="mt-1 text-[11px] text-[color:var(--oem-ink-2)]">
                Karar omurgası sunucuda yaşar. Liste boşsa bu <b>&quot;araç sağlıklı&quot;
                ANLAMINA GELMEZ</b>; henüz hiçbir karar okunmamıştır.
              </p>
            </div>
          )}

          {/* Sayaçlar */}
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Stat label="ANALİZ" value={sum ? String(sum.analysisTotal) : '—'} />
            <Stat label="BİLİNMEYEN" value={sum ? String(sum.unknownCount) : '—'} />
            <Stat label="ÇELİŞKİLİ" value={sum ? String(sum.conflictCount) : '—'} />
            <Stat label="SÜRESİ DOLMUŞ" value={sum ? String(sum.expiredCount) : '—'} />
            <Stat
              label="KESİN ORAN"
              value={sum && sum.conclusiveRatio !== null
                ? `%${Math.round(sum.conclusiveRatio * 100)}` : 'ÖLÇÜLMEDİ'}
            />
            <Stat
              label="YÜKSEK GÜVEN"
              value={sum && sum.highConfidenceRatio !== null
                ? `%${Math.round(sum.highConfidenceRatio * 100)}` : 'ÖLÇÜLMEDİ'}
            />
            <Stat label="KAPSAM DIŞI KARAR" value={String(snap.outOfScopeCount)} />
            <Stat label="REDDEDİLEN" value={String(snap.rejectedCount)} />
          </div>

          {/* Kategori dağılımı */}
          <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium">
              <Scale size={11} /> KATEGORİ DAĞILIMI
            </div>
            <div className="flex flex-wrap gap-1">
              {MECHANIC_CATEGORIES.map((c) => (
                <Chip key={c} tone={sum && sum.byCategory[c] > 0 ? INFO : NONE}>
                  {CATEGORY_LABEL[c]} {sum ? sum.byCategory[c] : '—'}
                </Chip>
              ))}
            </div>
          </div>

          {/* Analiz listesi */}
          <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
            <div className="border-b border-[var(--oem-line)] px-2 py-1 text-[11px] font-medium">
              ANALİZLER ({snap.analyses.length})
            </div>
            {snap.analyses.length === 0 ? (
              <div className="px-2 py-3 text-[11px] text-[color:var(--oem-ink-3)]">
                Analiz yok. Bu <b>&quot;sorun yok&quot; DEĞİL</b>, &quot;henüz mekanik
                kapsamda karar üretilmedi&quot; demektir.
              </div>
            ) : (
              snap.analyses.map((a) => <AnalysisRow key={a.analysisId} a={a} />)
            )}
          </div>

          {/* Sözleşme beyanı — ekran ne YAPMAZ */}
          <p className="px-1 text-[10px] leading-relaxed text-[color:var(--oem-ink-3)]">
            Bu ekran <b>karar üretmez</b>: her satır MAVI Reasoning Engine kararının
            yorumudur. Güven MAVI&apos;den aynen gelir. <b>Öneri · tamir tavsiyesi ·
            parça · maliyet YOKTUR</b> (P1 yalnız teşhis katmanıdır). Kanıt ve karar
            zinciri MAVI&apos;de yaşar; burada yalnız referansı gösterilir.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-[color:var(--oem-ink-3)]">{label}</div>
      <div className="font-mono text-[13px] font-semibold">{value}</div>
    </div>
  );
}
