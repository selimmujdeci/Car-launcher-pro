/**
 * OBDDiagnosticTimeline — OBD Teşhis Timeline UI (Faz 1 MVP).
 *
 * Pasif gözlemci: obdDiagnosticRecorder'daki event'leri bir zaman çizelgesi
 * olarak gösterir. İki mod:
 *   • Basit  → her adım için anlaşılır Türkçe sebep + önerilen eylem.
 *   • Teknik → command / response / protocol / süre / transport + ham detay.
 *
 * Native'e dokunmaz; yalnızca recorder'a abone olur (zero-leak: effect cleanup
 * ile unsubscribe). Kopyala (panoya metin) + JSON dışa aktar butonları içerir.
 */
import { memo, useEffect, useReducer, useState, useCallback } from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, Info,
  Copy, Braces, ChevronRight,
} from 'lucide-react';
import { Clipboard } from '@capacitor/clipboard';
import {
  subscribe, getEvents, getSession, exportJson, exportText,
} from '../../platform/obdDiagnosticRecorder';
import type { ObdDiagEvent, ObdDiagStatus, ObdStage } from '../../platform/obdDiagnosticTypes';

/* ── Aşama → Türkçe etiket ─────────────────────────────────── */
const STAGE_LABEL: Record<ObdStage, string> = {
  permission:     'İzin',
  bluetooth:      'Bluetooth',
  scan:           'Tarama',
  deviceFound:    'Cihaz bulundu',
  select:         'Cihaz seçimi',
  bond:           'Eşleşme',
  connectBle:     'BLE bağlantı',
  connectClassic: 'Classic bağlantı',
  elmInit:        'ELM başlatma',
  protocol:       'Protokol',
  ecuQuery:       'ECU sorgu',
  liveData:       'Canlı veri',
  disconnect:     'Bağlantı koptu',
  retry:          'Yeniden deneme',
};

/* ── Durum → renk + ikon ───────────────────────────────────── */
interface StatusStyle { color: string; ring: string; Icon: typeof Info; spin?: boolean; }
const STATUS_STYLE: Record<ObdDiagStatus, StatusStyle> = {
  success: { color: 'text-emerald-400', ring: 'border-emerald-400/30', Icon: CheckCircle2 },
  fail:    { color: 'text-red-400',     ring: 'border-red-400/30',     Icon: XCircle },
  warn:    { color: 'text-amber-400',   ring: 'border-amber-400/30',   Icon: AlertTriangle },
  pending: { color: 'text-sky-400',     ring: 'border-sky-400/30',     Icon: Loader2, spin: true },
  info:    { color: 'text-white/60',    ring: 'border-white/10',       Icon: Info },
};

/* ── Tek satır ─────────────────────────────────────────────── */
const TimelineRow = memo(function TimelineRow({ ev, technical }: { ev: ObdDiagEvent; technical: boolean }) {
  const st = STATUS_STYLE[ev.status];
  const { Icon } = st;

  const techBits = [
    ev.transport !== 'unknown' ? ev.transport : null,
    ev.protocol,
    ev.command ? `cmd ${ev.command}` : null,
    ev.response ? `→ ${ev.response}` : null,
    ev.durationMs != null ? `${Math.round(ev.durationMs)}ms` : null,
    ev.reason,
  ].filter(Boolean).join('  ·  ');

  return (
    <div className={`flex items-start gap-2.5 rounded-lg border ${st.ring} bg-white/[0.02] px-3 py-2`}>
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${st.color} ${st.spin ? 'animate-spin' : ''}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-bold text-[13px] ${st.color}`}>{STAGE_LABEL[ev.stage]}</span>
          <span className="text-white/25 text-[10px] tabular-nums">{(ev.tsMonoMs / 1000).toFixed(2)}s</span>
        </div>

        {/* Basit mod: Türkçe sebep + önerilen eylem */}
        {!technical && ev.userMessage && (
          <div className="text-white/70 text-[12px] leading-relaxed mt-0.5">{ev.userMessage}</div>
        )}
        {!technical && ev.nextAction && (
          <div className="flex items-center gap-1 text-sky-300/80 text-[11px] mt-1">
            <ChevronRight className="w-3 h-3 shrink-0" />
            <span>{ev.nextAction}</span>
          </div>
        )}

        {/* Teknik mod: ham detay */}
        {technical && (
          <div className="mt-0.5 space-y-0.5">
            {techBits && (
              <div className="text-white/55 text-[11px] font-mono break-all">{techBits}</div>
            )}
            {ev.technicalMessage && (
              <div className="text-white/40 text-[11px] font-mono break-all">{ev.technicalMessage}</div>
            )}
            {ev.userMessage && (
              <div className="text-white/50 text-[11px]">{ev.userMessage}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/* ── Ana bileşen ───────────────────────────────────────────── */
export const OBDDiagnosticTimeline = memo(function OBDDiagnosticTimeline() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [technical, setTechnical] = useState(false);
  const [copied, setCopied] = useState(false);

  // Recorder'a abone ol — değişimde yeniden render (zero-leak: effect cleanup).
  useEffect(() => subscribe(force), []);

  const events = getEvents();
  const session = getSession();

  const copyText = useCallback(async () => {
    const text = exportText();
    try {
      await Clipboard.write({ string: text });
    } catch {
      try { await navigator.clipboard.writeText(text); } catch { /* yoksay */ }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, []);

  const exportJsonFile = useCallback(() => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.sessionId || 'obd-diag'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [session.sessionId]);

  return (
    <div className="flex flex-col gap-2">
      {/* Başlık + kontroller */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-white/40 uppercase tracking-wider text-[11px] font-bold">
          Teşhis Zaman Çizelgesi
        </span>
        <div className="flex items-center gap-1.5">
          {/* Basit / Teknik toggle */}
          <button
            type="button"
            onClick={() => setTechnical((v) => !v)}
            className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] font-bold text-white/70 transition-colors active:scale-95"
          >
            {technical ? 'Teknik' : 'Basit'}
          </button>
          <button
            type="button"
            onClick={copyText}
            disabled={events.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] font-bold text-white/70 transition-colors active:scale-95 disabled:opacity-40"
            aria-label="Panoya kopyala"
          >
            <Copy className="w-3 h-3" />
            {copied ? 'Kopyalandı' : 'Kopyala'}
          </button>
          <button
            type="button"
            onClick={exportJsonFile}
            disabled={events.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] font-bold text-white/70 transition-colors active:scale-95 disabled:opacity-40"
            aria-label="JSON dışa aktar"
          >
            <Braces className="w-3 h-3" />
            JSON
          </button>
        </div>
      </div>

      {/* Liste */}
      {events.length === 0 ? (
        <div className="text-white/30 text-[12px] text-center py-6 border border-dashed border-white/10 rounded-lg">
          Henüz teşhis verisi yok. Bağlantı başlatılınca adımlar burada görünür.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[42vh] overflow-y-auto pr-0.5">
          {events.map((ev) => (
            <TimelineRow key={ev.id} ev={ev} technical={technical} />
          ))}
        </div>
      )}

      {/* Cihaz/sonuç özeti */}
      {session.device && (
        <div className="text-white/30 text-[10px] font-mono pt-1 border-t border-white/5">
          {session.device.name || '(adsız)'} · {session.device.addrMasked} · {session.device.transport} · {session.outcome}
        </div>
      )}
    </div>
  );
});
