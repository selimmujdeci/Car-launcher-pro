/**
 * DiagnosticReportModal — PR-4: ortak "Tanı Gönder" modalı.
 *
 * TÜM giriş noktaları (Ayarlar SupportSnapshotCard · global buton · Dev Inspector)
 * AYNI modalı kullanır. Kullanıcı: problemi yazar → kategori seçer → gönderilecek
 * veriyi önizler → AÇIK RIZA verir → gönderir → rapor numarasını (reportId) alır.
 *
 * ── Gizlilik / rıza (ZORUNLU) ──────────────────────────────────────────────
 *  • Rıza kutusu işaretlenMEDEN hiçbir upload başlamaz (buildDiagnosticPreview
 *    yalnız payload'ı KURAR — göndermez).
 *  • Yeni veri kaynağı / telemetri / tracking YOK. PII kuralları + redaction
 *    remoteLogService'te aynen korunur (kullanıcı notu da maskelenir).
 *  • Önizleme: boyut · gönderilecek bölümler · maskelenen · gönderilmeyen bilgi.
 *
 * ── Teslimat gerçeği (PR-3) ────────────────────────────────────────────────
 *  Gönderim sonucu "Kuyrukta" (kabul) → awaitDelivery ile gerçek "Gönderildi"
 *  (sunucu UUID kanıtı). Yalancı "Gönderildi" YOK. reportId kopyalanabilir.
 */
import { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import {
  buildDiagnosticPreview, awaitDelivery,
  DIAGNOSTIC_CATEGORIES,
  type DiagnosticPreview, type DiagnosticReportMeta, type SnapshotTriggerOutcome,
} from '../../platform/remoteLogService';
import { deliveryLabel, type DeliveryState } from '../../platform/diagnosticDelivery';

export interface DiagnosticReportModalProps {
  open:    boolean;
  onClose: () => void;
  /** Rıza sonrası gerçek gönderim — giriş noktasına özgü (support/self_test/inspector). */
  send:    (meta: DiagnosticReportMeta) => Promise<SnapshotTriggerOutcome>;
  title?:  string;
}

type Phase = 'form' | 'sending' | 'result';

const ACCEPT_MSG: Record<string, string> = {
  queued:         'Kuyrukta — teslim bekleniyor…',
  queued_offline: 'Çevrimdışı — internet gelince gönderilecek',
  cooldown:       'Az önce gönderdiniz — lütfen biraz bekleyin',
  error:          'Gönderilemedi — tekrar deneyin',
  not_paired:     "Cihaz eşlenmemiş — Ayarlar → Mobil Bağlantı'dan eşleştirin",
};

function fmtSize(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function DiagnosticReportModal({ open, onClose, send, title }: DiagnosticReportModalProps) {
  const [phase, setPhase]       = useState<Phase>('form');
  const [note, setNote]         = useState('');
  const [category, setCategory] = useState<string>('Diğer');
  const [consent, setConsent]   = useState(false);

  const [preview, setPreview]         = useState<DiagnosticPreview | null>(null);
  const [previewErr, setPreviewErr]   = useState(false);

  const [statusKey, setStatusKey]     = useState<string>('queued');
  const [detailMsg, setDetailMsg]     = useState('');
  const [reportId, setReportId]       = useState<string | null>(null);
  const [delivery, setDelivery]       = useState<DeliveryState | null>(null);
  const [copied, setCopied]           = useState(false);

  const copyTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef   = useRef(true);

  // Açılışta durumu sıfırla + önizlemeyi KUR (upload YOK — yalnız payload boyutu).
  useEffect(() => {
    if (!open) return;
    aliveRef.current = true;
    setPhase('form'); setNote(''); setCategory('Diğer'); setConsent(false);
    setPreview(null); setPreviewErr(false);
    setStatusKey('queued'); setDetailMsg(''); setReportId(null); setDelivery(null); setCopied(false);

    void buildDiagnosticPreview()
      .then((p) => { if (aliveRef.current) setPreview(p); })
      .catch(() => { if (aliveRef.current) setPreviewErr(true); });

    return () => { aliveRef.current = false; };
  }, [open]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  if (!open) return null;

  const canSend = consent && phase === 'form';

  async function handleSend() {
    // RIZA KAPISI: rıza yoksa ASLA gönderme (upload başlamaz).
    if (!consent || phase !== 'form') return;
    setPhase('sending');

    const meta: DiagnosticReportMeta = { note: note.trim() || undefined, category };
    let outcome: SnapshotTriggerOutcome;
    try { outcome = await send(meta); }
    catch { outcome = { status: 'error', reportId: null }; }
    if (!aliveRef.current) return;

    setStatusKey(outcome.status);
    setReportId(outcome.reportId);
    setDetailMsg(ACCEPT_MSG[outcome.status] ?? outcome.status);
    setPhase('result');

    // Kabul edildiyse GERÇEK teslimi bekle (sunucu UUID'si) — yalancı "Gönderildi" yok.
    if ((outcome.status === 'queued' || outcome.status === 'queued_offline') && outcome.reportId) {
      const final = await awaitDelivery(outcome.reportId);
      if (aliveRef.current) { setDelivery(final); setDetailMsg(deliveryLabel(final)); }
    }
  }

  function handleCopy() {
    if (!reportId) return;
    try { void navigator.clipboard?.writeText(reportId); } catch { /* pano yoksa sessiz */ }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => { if (aliveRef.current) setCopied(false); }, 2000);
  }

  const accepted = statusKey === 'queued' || statusKey === 'queued_offline';

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Tanı Raporu Gönder"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,   // reverse(100000)/portrait(99999) altında
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(2,6,14,0.72)', backdropFilter: 'blur(4px)', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-2xl overflow-hidden flex flex-col"
        style={{
          maxWidth: 440, maxHeight: '90vh',
          background: 'var(--oem-surface-0)', border: '1px solid var(--oem-line)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Başlık */}
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--oem-line)' }}>
          <div className="text-[13px] font-black" style={{ color: 'var(--oem-ink)' }}>
            {title ?? 'Tanı Raporu Gönder'}
          </div>
          <button onClick={onClose} aria-label="Kapat"
            className="p-1 rounded-lg" style={{ color: 'var(--oem-ink-2)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3" style={{ minHeight: 0 }}>
          {phase === 'form' && (
            <div className="flex flex-col gap-3">
              {/* Kategori */}
              <div>
                <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--oem-ink-2)' }}>
                  Kategori
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DIAGNOSTIC_CATEGORIES.map((c) => {
                    const on = category === c;
                    return (
                      <button key={c} onClick={() => setCategory(c)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold"
                        style={{
                          background: on ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${on ? 'rgba(96,165,250,0.55)' : 'rgba(255,255,255,0.08)'}`,
                          color: on ? '#93c5fd' : 'var(--oem-ink-2)',
                        }}>
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Açıklama */}
              <div>
                <label htmlFor="diag-note" className="text-[11px] font-bold mb-1.5 block"
                  style={{ color: 'var(--oem-ink-2)' }}>
                  Problem açıklaması <span style={{ color: 'var(--oem-ink-3)' }}>(isteğe bağlı)</span>
                </label>
                <textarea
                  id="diag-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder="Ne oldu? Ne zaman? (Kişisel bilgi yazmayın — otomatik maskelenir.)"
                  className="w-full rounded-lg px-2.5 py-2 text-[12px] resize-none"
                  style={{
                    background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)',
                    color: 'var(--oem-ink)', outline: 'none',
                  }}
                />
                <div className="text-[10px] text-right mt-0.5" style={{ color: 'var(--oem-ink-3)' }}>
                  {note.length}/1000
                </div>
              </div>

              {/* Önizleme */}
              <div className="rounded-lg px-2.5 py-2"
                style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
                <div className="text-[11px] font-bold mb-1 flex items-center gap-1.5"
                  style={{ color: 'var(--oem-ink-2)' }}>
                  <ShieldCheck size={12} /> Gönderilecek veri önizlemesi
                </div>
                {previewErr ? (
                  <div className="text-[11px]" style={{ color: '#f87171' }}>Önizleme hazırlanamadı.</div>
                ) : !preview ? (
                  <div className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--oem-ink-3)' }}>
                    <Loader2 size={12} className="animate-spin" /> Hesaplanıyor…
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[11px]" style={{ color: 'var(--oem-ink-2)' }}>
                      Boyut: <b>{fmtSize(preview.sizeBytes)}</b>
                      {note.trim() && <span style={{ color: 'var(--oem-ink-3)' }}> · Açıklamanız eklenecek</span>}
                    </div>
                    {preview.willTruncate && (
                      <div className="text-[10px] flex items-center gap-1" style={{ color: '#fbbf24' }}>
                        <AlertTriangle size={11} /> Rapor 64 KB'yi aşıyor — sunucu kısaltacak.
                      </div>
                    )}
                    <details>
                      <summary className="text-[10px] font-bold cursor-pointer" style={{ color: 'var(--oem-ink-3)' }}>
                        {preview.sections.length} bölüm gönderilecek
                      </summary>
                      <div className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--oem-ink-3)' }}>
                        {preview.sections.map((s) => s.label).join(' · ')}
                      </div>
                    </details>
                    <div className="text-[10px]" style={{ color: '#6ee7b7' }}>
                      Maskelenir: {preview.masked.map((m) => m.split(' →')[0]).join(', ')}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--oem-ink-3)' }}>
                      Gönderilmez: {preview.notSent.slice(0, 5).join(', ')}…
                    </div>
                  </div>
                )}
              </div>

              {/* Açık rıza */}
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5" style={{ accentColor: '#34d399' }} />
                <span className="text-[11px]" style={{ color: 'var(--oem-ink-2)' }}>
                  Yukarıdaki teknik veriyi ve açıklamamı destek ekibine <b>göndermeyi onaylıyorum</b>.
                  Konum, kimlik ve cihaz kişisel bilgisi gönderilmez.
                </span>
              </label>
            </div>
          )}

          {phase === 'sending' && (
            <div className="flex items-center gap-2 py-6 justify-center text-[12px]"
              style={{ color: 'var(--oem-ink-2)' }}>
              <Loader2 size={16} className="animate-spin" /> Gönderiliyor…
            </div>
          )}

          {phase === 'result' && (
            <div className="flex flex-col gap-2.5 py-2">
              <div className="text-[12px] font-bold"
                style={{ color: delivery === 'delivered' ? '#34d399'
                  : accepted ? '#60a5fa' : '#f87171' }}>
                {detailMsg}
              </div>
              {reportId && accepted && (
                <div className="rounded-lg px-2.5 py-2 flex items-center justify-between gap-2"
                  style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)' }}>
                  <div className="min-w-0">
                    <div className="text-[10px]" style={{ color: 'var(--oem-ink-3)' }}>Rapor Numarası</div>
                    <div className="text-[12px] font-mono font-bold truncate"
                      style={{ color: 'var(--oem-ink)' }}>{reportId}</div>
                  </div>
                  <button onClick={handleCopy} aria-label="Rapor numarasını kopyala"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold flex-shrink-0"
                    style={{ background: 'rgba(96,165,250,0.14)', border: '1px solid rgba(96,165,250,0.3)', color: '#93c5fd' }}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Kopyalandı' : 'Kopyala'}
                  </button>
                </div>
              )}
              <div className="text-[10px]" style={{ color: 'var(--oem-ink-3)' }}>
                Destek için bu numarayı iletin.
              </div>
            </div>
          )}
        </div>

        {/* Aksiyonlar */}
        <div className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--oem-line)' }}>
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold"
            style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line)', color: 'var(--oem-ink-2)' }}>
            {phase === 'result' ? 'Kapat' : 'Vazgeç'}
          </button>
          {phase !== 'result' && (
            <button onClick={() => { void handleSend(); }}
              disabled={!canSend}
              className="px-3.5 py-1.5 rounded-xl text-[11px] font-black disabled:opacity-40"
              style={{ background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.3)', color: '#6ee7b7' }}>
              {phase === 'sending' ? 'Gönderiliyor…' : 'Gönder'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
