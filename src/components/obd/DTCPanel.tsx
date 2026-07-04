import { memo } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Trash2, Info, ShieldAlert } from 'lucide-react';
import {
  useDTCState,
  readDTCCodes, clearDTCCodes,
  type DTCCode, type DTCSeverity,
} from '../../platform/dtcService';
import { SensorPanel } from './SensorPanel';

/* ── Severity config ─────────────────────────────────────── */

const SEV: Record<DTCSeverity, { color: string; bg: string; border: string; label: string }> = {
  critical: {
    /* Kritik arıza → danger token */
    color: 'text-[color:var(--oem-danger)]',
    bg:    'bg-[var(--oem-danger-soft)]',
    border:'border-[var(--oem-danger)]',
    label: 'Kritik',
  },
  warning: {
    /* Uyarı → warn token */
    color: 'text-[color:var(--oem-warn)]',
    bg:    'bg-[var(--oem-warn-soft)]',
    border:'border-[var(--oem-warn)]',
    label: 'Uyarı',
  },
  info: {
    /* Bilgi → info token */
    color: 'text-[color:var(--oem-info)]',
    bg:    'bg-[var(--oem-info-soft)]',
    border:'border-[var(--oem-info)]',
    label: 'Bilgi',
  },
};

/* ── DTC Code card ───────────────────────────────────────── */

const DTCCodeCard = memo(function DTCCodeCard({ code }: { code: DTCCode }) {
  const cfg = SEV[code.severity];

  return (
    <div className={`rounded-2xl border p-4 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Code + badge */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`font-black text-lg tracking-widest tabular-nums ${cfg.color}`}>
              {code.code}
            </span>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border ${cfg.color} ${cfg.border} ${cfg.bg}`}>
              {cfg.label}
            </span>
            <span className="text-[color:var(--oem-ink-3)] text-[10px]">{code.system}</span>
          </div>

          {/* Description */}
          <div className="text-[color:var(--oem-ink)] text-sm font-semibold leading-snug mb-2">
            {code.description}
          </div>

          {/* Possible causes */}
          {code.possibleCauses.length > 0 && (
            <div>
              <div className="flex items-center gap-1 text-[color:var(--oem-ink-3)] text-[10px] uppercase tracking-widest mb-1.5">
                <Info className="w-3 h-3" />
                Olası Nedenler
              </div>
              <div className="flex flex-wrap gap-1.5">
                {code.possibleCauses.map((cause, i) => (
                  <span
                    key={i}
                    /* Olası neden etiketi → surface-2 / oem-line */
                    className="text-[10px] text-[color:var(--oem-ink-2)] bg-[var(--oem-surface-2)] border border-[var(--oem-line)] px-2 py-0.5 rounded-full"
                  >
                    {cause}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${cfg.color}`} />
      </div>
    </div>
  );
});

/* ── Main panel ──────────────────────────────────────────── */

function DTCPanelInner({ active = false }: { active?: boolean }) {
  const dtc = useDTCState();

  const criticalCount = dtc.codes.filter((c) => c.severity === 'critical').length;
  const warningCount  = dtc.codes.filter((c) => c.severity === 'warning').length;

  const lastReadStr = dtc.lastReadAt
    ? new Date(dtc.lastReadAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
      style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehavior: 'contain' } as React.CSSProperties}
    >
    <div className="flex flex-col gap-5 p-6 glass-card border-none !shadow-none">

      {/* ── Title row ──────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            {/* Başlık ikonu → warn token (tanı/uyarı semantiği) */}
            <div className="w-10 h-10 rounded-xl bg-[var(--oem-warn-soft)] border border-[var(--oem-warn)] flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-[color:var(--oem-warn)]" />
            </div>
            <div>
              <span className="text-[color:var(--oem-ink)] font-black text-lg uppercase tracking-widest">Arıza Teşhisi</span>
              {lastReadStr && (
                <div className="text-[color:var(--oem-ink-2)] text-[11px] font-bold uppercase tracking-wider mt-0.5 opacity-60">
                  Son tarama: {lastReadStr}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Severity counters */}
        <div className="flex items-center gap-2.5">
          {criticalCount > 0 && (
            /* Kritik sayaç rozeti → danger token */
            <div className="bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)] rounded-full px-3 py-1.5 text-[color:var(--oem-danger)] text-[10px] font-black uppercase tracking-wider shadow-sm">
              {criticalCount} KRİTİK
            </div>
          )}
          {warningCount > 0 && (
            /* Uyarı sayaç rozeti → warn token */
            <div className="bg-[var(--oem-warn-soft)] border border-[var(--oem-warn)] rounded-full px-3 py-1.5 text-[color:var(--oem-warn)] text-[10px] font-black uppercase tracking-wider shadow-sm">
              {warningCount} UYARI
            </div>
          )}
        </div>
      </div>

      {/* ── Action buttons ─────────────────────────────── */}
      <div className="flex gap-4">
        <button
          onClick={readDTCCodes}
          disabled={dtc.isReading}
          className="flex-1 h-14 flex items-center justify-center gap-3 rounded-2xl font-black text-sm uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-md"
          /* Tarama butonu → accent token (aksiyon/birincil) */
          style={{ background: 'var(--oem-accent-soft)', border: '1px solid var(--oem-accent)', color: 'var(--oem-accent)' }}
        >
          <RefreshCw className={`w-5 h-5 ${dtc.isReading ? 'animate-spin' : ''}`} />
          {dtc.isReading ? 'OKUNUYOR…' : 'TARAMAYI BAŞLAT'}
        </button>

        <button
          onClick={clearDTCCodes}
          disabled={dtc.isClearing || dtc.codes.length === 0}
          /* Temizle butonu → danger token (yıkıcı eylem) */
          className="flex-1 h-14 flex items-center justify-center gap-3 bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)] text-[color:var(--oem-danger)] rounded-2xl font-black text-sm uppercase tracking-widest hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-md"
        >
          <Trash2 className={`w-5 h-5 ${dtc.isClearing ? 'animate-spin' : ''}`} />
          {dtc.isClearing ? 'SİLİNİYOR…' : 'HAFIZAYI TEMİZLE'}
        </button>
      </div>

      {/* ── Codes / empty state ────────────────────────── */}
      <div className="flex-1">
        {dtc.codes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-5 glass-card border-none !shadow-none">
            {dtc.lastReadAt && !dtc.error ? (
              <>
                {/* Sistem temiz → good token (pozitif durum) */}
              <div className="w-20 h-20 rounded-full bg-[var(--oem-good-soft)] flex items-center justify-center border border-[var(--oem-good)]">
                  <CheckCircle2 className="w-10 h-10 text-[color:var(--oem-good)]" />
                </div>
                <div className="text-center">
                  <div className="text-[color:var(--oem-good)] font-black text-xl uppercase tracking-widest">SİSTEM TEMİZ</div>
                  <div className="text-[color:var(--oem-ink-2)] text-sm font-bold mt-2 opacity-70 uppercase tracking-wider">
                    Araç sistemleri normal çalışıyor
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Henüz tarama yapılmadı → surface-3 / oem-line */}
                <div className="w-20 h-20 rounded-full bg-[var(--oem-surface-3)] flex items-center justify-center border border-[var(--oem-line-strong)]">
                  <AlertTriangle className="w-10 h-10 text-[color:var(--oem-ink-2)] opacity-40" />
                </div>
                <div className="text-center">
                  <div className="text-[color:var(--oem-ink-2)] font-black text-lg uppercase tracking-widest opacity-60">HENÜZ TARAMA YAPILMADI</div>
                  <div className="text-[color:var(--oem-ink-2)] text-[11px] font-bold mt-2 opacity-40 uppercase tracking-widest">
                    OBD TARAMASI İÇİN BUTONA BASIN
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Sort: critical first */}
            {[...dtc.codes]
              .sort((a, b) => {
                const order: Record<DTCSeverity, number> = { critical: 0, warning: 1, info: 2 };
                return order[a.severity] - order[b.severity];
              })
              .map((code) => (
                <DTCCodeCard key={code.code} code={code} />
              ))}
          </div>
        )}
      </div>

      {/* ── Canlı sensörler (Patch 9A) ─────────────────── */}
      {/* Abonelik yaşam döngüsü `active`e bağlı: drawer kapaliyken native EXTENDED
          polling tamamen durur (DrawerShell unmount etmez — görünürlük prop'la gelir). */}
      <SensorPanel active={active} />

      {/* ── Error ─────────────────────────────────────── */}
      {dtc.error && (
        /* Hata mesajı → danger token */
        <div className="bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)] rounded-2xl p-5 text-[color:var(--oem-danger)] text-sm font-bold flex items-start gap-3 shadow-lg">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          {dtc.error}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[color:var(--oem-ink-2)] text-[10px] font-bold text-center leading-relaxed opacity-40 uppercase tracking-[0.1em] px-8">
        Tanımlamalar genel OBD-II standartlarına dayanmaktadır.
        Kesin teşhis için yetkili servise başvurun.
      </p>
    </div>
    </div>
  );
}

export const DTCPanel = memo(DTCPanelInner);


