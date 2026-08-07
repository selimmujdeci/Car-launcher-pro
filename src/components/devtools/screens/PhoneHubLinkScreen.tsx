/**
 * PhoneHubLinkScreen — CAROS LAB · İletişim · Phone Hub Canlı Bağlantı Tanısı (P1-A).
 *
 * ── BU EKRAN NEDEN DÜĞME İÇERİYOR ───────────────────────────────────────────
 * CAROS LAB kuralı "aktif komut göndermez"dir ve bu ekran o kuralı BOZMAZ:
 * buradaki düğmeler ARACA, ECU'ya veya OBD'ye hiçbir şey göndermez. Yalnızca
 * CAROS'un KENDİ Phone Hub sunucusunun yaşam döngüsünü yönetir (başlat/durdur/
 * kes/unut/sıfırla). Gözlenen sistem ile yönetilen sistem burada aynıdır ve
 * bu araç, saha turunda bağlantıyı tekrar üretebilmek için gereklidir.
 *
 * ── ZAMANLAYICI YOK ─────────────────────────────────────────────────────────
 * Açılışta tek atışlık native pull + elle YENİLE. `setInterval` YOKTUR
 * (CAROS LAB deseni). `mountedRef` ile async sonuç sökülmüş bileşene YAZILMAZ.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Doğrulama kodu · oturum anahtarı · nonce · MAC · cihaz adı · telefon numarası ·
 * ham yük bu ekrana HİÇ GELMEZ. Doğrulama kodu YALNIZ kullanıcı ekranındadır;
 * LAB burada yalnız "onay bekleniyor mu" bilgisini görür.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Play, Square, Unplug, Trash2, RotateCcw, Download, ShieldAlert,
} from 'lucide-react';
import { readPhoneHubLinkSnapshot } from '../../../platform/devtools/phoneHubLinkSources';
import {
  refreshPhoneHubLink, startPhoneHubServer, stopPhoneHubServer,
  disconnectPhoneHubSession, forgetTrustedPhone, resetPhoneHubCounters,
} from '../../../platform/phoneHub/phoneHubLink';
import {
  buildPhoneHubLinkView, buildPhoneHubLinkExport,
  type PhoneHubLinkView,
} from '../../../platform/devtools/phoneHubLinkModel';
import {
  OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';
import { copyTextFailSoft, describeClipboardRoute } from '../../../platform/devtools/carosLabClipboard';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const FieldRow = memo(function FieldRow({ field }: { field: InspectorField }) {
  return (
    <div
      data-testid={`phl-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">{field.source}</div>
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

const ActionButton = memo(function ActionButton({
  label, icon: Icon, onClick, disabled, testId, danger,
}: {
  label: string;
  icon: typeof Play;
  onClick: () => void;
  disabled: boolean;
  testId: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-[10px] transition-colors disabled:opacity-40 ${
        danger
          ? 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]'
          : 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]'
      }`}
    >
      <Icon size={12} />
      {label}
    </button>
  );
});

export function PhoneHubLinkScreen() {
  const mountedRef = useRef(true);
  const [view, setView] = useState<PhoneHubLinkView>(
    () => buildPhoneHubLinkView(readPhoneHubLinkSnapshot()));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      await refreshPhoneHubLink();
    } finally {
      if (mountedRef.current) {
        setView(buildPhoneHubLinkView(readPhoneHubLinkSnapshot()));
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    return () => { mountedRef.current = false; };
  }, [reload]);

  /** Eylem → sonuç → TAZELE. Sonucu uydurmadan, native'e yeniden sorarak. */
  const runAction = useCallback(async (
    action: () => Promise<{ ok: boolean; errorCode: string | null; userMessage: string | null }>,
    successText: string,
  ) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (!mountedRef.current) return;
      setNotice(result.ok
        ? successText
        : `BAŞARISIZ — ${result.errorCode ?? 'UNKNOWN_ERROR'}`
          + (result.userMessage ? ` (${result.userMessage})` : ''));
      await refreshPhoneHubLink();
    } finally {
      if (mountedRef.current) {
        setView(buildPhoneHubLinkView(readPhoneHubLinkSnapshot()));
        setBusy(false);
      }
    }
  }, []);

  const exportJson = useCallback(async () => {
    const text = buildPhoneHubLinkExport(view, Date.now());
    const route = await copyTextFailSoft(text);
    if (mountedRef.current) setNotice(describeClipboardRoute(route, text.length));
  }, [view]);

  const headlineTone = useMemo(() => {
    if (!view.present) return 'border-[var(--oem-line-strong)] text-[var(--oem-ink-3)]';
    if (view.trulyEstablished) return 'border-[var(--oem-good)] text-[var(--oem-good)]';
    if (view.awaitingUserConfirmation) return 'border-[var(--oem-warn)] text-[var(--oem-warn)]';
    return 'border-[var(--oem-line-strong)] text-[var(--oem-ink-2)]';
  }, [view]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3" data-testid="phone-hub-link-screen">

      {/* ── Özet ───────────────────────────────────────────────────── */}
      <div
        data-testid="phl-headline"
        className={`rounded border bg-[var(--oem-surface-2)] px-3 py-2 font-mono text-[12px] ${headlineTone}`}
      >
        {view.headline}
      </div>

      {/* ── Eylemler ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          testId="phl-start" label="Server'ı Başlat" icon={Play} disabled={busy}
          onClick={() => void runAction(startPhoneHubServer, 'Sunucu başlatıldı')} />
        <ActionButton
          testId="phl-stop" label="Server'ı Durdur" icon={Square} disabled={busy}
          onClick={() => void runAction(stopPhoneHubServer,
            'Sunucu durduruldu — worker, soket ve oturum bırakıldı')} />
        <ActionButton
          testId="phl-refresh" label="Tanıyı Yenile" icon={RefreshCw} disabled={busy}
          onClick={() => void reload()} />
        <ActionButton
          testId="phl-disconnect" label="Session'ı Kes" icon={Unplug} disabled={busy}
          onClick={() => void runAction(disconnectPhoneHubSession,
            'Oturum kesildi — sunucu dinlemeye devam ediyor')} />
        <ActionButton
          testId="phl-reset-counters" label="Sayaçları Sıfırla" icon={RotateCcw} disabled={busy}
          onClick={() => void runAction(resetPhoneHubCounters,
            'Sayaçlar sıfırlandı — aktif bağlantı KESİLMEDİ')} />
        <ActionButton
          testId="phl-export" label="PII'siz Tanı JSON'u" icon={Download} disabled={busy}
          onClick={() => void exportJson()} />
        <ActionButton
          testId="phl-forget" label="Trusted Phone'u Unut" icon={Trash2} disabled={busy} danger
          onClick={() => void runAction(forgetTrustedPhone, 'Güven kaydı silindi')} />
      </div>

      {notice && (
        <div
          data-testid="phl-notice"
          className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2 py-1.5 font-mono text-[10px] text-[var(--oem-ink-2)]"
        >
          {notice}
        </div>
      )}

      {/* ── Saha ölçümü bekleyenler ────────────────────────────────── */}
      <div
        data-testid="phl-field-test-required"
        className="rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-3 py-2"
      >
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] text-[var(--oem-warn)]">
          <ShieldAlert size={12} />
          SAHA ÖLÇÜMÜ BEKLEYEN (kod okumasıyla kapatılamaz)
        </div>
        <ul className="list-inside list-disc space-y-0.5 text-[10px] leading-relaxed text-[var(--oem-ink-2)]">
          {view.fieldTestRequired.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>

      {/* ── Bölümler ───────────────────────────────────────────────── */}
      {view.sections.map((section) => (
        <div
          key={section.id}
          data-testid={`phl-section-${section.id}`}
          className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface)]"
        >
          <div className="border-b border-[var(--oem-line-strong)] px-2 py-1.5 font-mono text-[10px] text-[var(--oem-ink-3)]">
            {section.title}
          </div>
          <div>
            {section.fields.map((field) => <FieldRow key={field.id} field={field} />)}
          </div>
        </div>
      ))}

      {/* ── Olaylar ────────────────────────────────────────────────── */}
      <div
        data-testid="phl-section-events"
        className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface)]"
      >
        <div className="border-b border-[var(--oem-line-strong)] px-2 py-1.5 font-mono text-[10px] text-[var(--oem-ink-3)]">
          TANI OLAYLARI · düşen {view.droppedEventCount} · maskelenen {view.redactedEventCount}
        </div>
        {view.events.length === 0 ? (
          <div className="px-2 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
            KAYNAK YOK — olay defteri boş veya native köprü okunamadı.
          </div>
        ) : (
          <div className="divide-y divide-[var(--oem-line)]">
            {view.events.map((event) => (
              <div
                key={event.id}
                data-testid={`phl-event-${event.id}`}
                className="px-2 py-1 font-mono text-[10px] text-[var(--oem-ink-2)]"
              >
                <span className="text-[var(--oem-ink-3)]">{event.side}</span>
                {' · '}{event.category}{' · '}{event.stage}
                {' · '}<span className="text-[var(--oem-ink)]">{event.code}</span>
                {' · g'}{event.generation}
                {event.details && (
                  <span className="text-[var(--oem-ink-3)]">{' — '}{event.details}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
