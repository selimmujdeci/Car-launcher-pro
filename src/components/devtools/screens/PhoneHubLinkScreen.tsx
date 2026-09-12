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
 * Oturum anahtarı · nonce · MAC · cihaz adı · telefon numarası · ham yük bu
 * ekrana HİÇ GELMEZ.
 *
 * Doğrulama kodu bir İSTİSNADIR ve sınırı dardır: kod ANLIK GÖRÜNTÜYE,
 * MODELE, OLAY DEFTERİNE ve JSON DIŞA AKTARIMINA GİRMEZ. Yalnız kullanıcı
 * "Kodu Göster"e bastığında native'den O AN okunur, yalnız bileşen state'inde
 * yaşar ve onay/ret sonrası ile ekran sökülürken SİLİNİR. Kod ekranda
 * gösterilmeden onay vermek, karşı tarafın kimliğini doğrulamadan güven
 * kurmak olurdu (MITM) — bu yüzden onay yüzeyi kodu göstermek zorundadır.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Play, Square, Unplug, Trash2, RotateCcw, Download, ShieldAlert,
  KeyRound, Check, X,
} from 'lucide-react';
import { readPhoneHubLinkSnapshot } from '../../../platform/devtools/phoneHubLinkSources';
import {
  refreshPhoneHubLink, startPhoneHubServer, stopPhoneHubServer,
  disconnectPhoneHubSession, forgetTrustedPhone, resetPhoneHubCounters,
  confirmPhoneHubPairing, getPhoneHubPairingCode,
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
  /* Doğrulama kodu YALNIZ burada yaşar: modele, anlık görüntüye ve dışa
     aktarıma girmez; onay/ret ve sökülme anında silinir. */
  const [pairingCode, setPairingCode] = useState<string | null>(null);

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
    return () => {
      mountedRef.current = false;
      setPairingCode(null);   // kod ekranla birlikte ölür
    };
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

  /**
   * Doğrulama kodunu O AN native'den okur (önbellek YOK).
   *
   * `null` dönerse onay penceresi kapanmıştır (kod kısa ömürlüdür) — o hâlde
   * eski bir kod ekranda BIRAKILMAZ, tanı tazelenir.
   */
  const revealPairingCode = useCallback(async () => {
    setBusy(true);
    try {
      const code = await getPhoneHubPairingCode();
      if (!mountedRef.current) return;
      setPairingCode(code);
      if (code === null) {
        setNotice('KOD YOK — onay penceresi kapanmış veya süresi dolmuş olabilir.');
        await refreshPhoneHubLink();
        if (mountedRef.current) setView(buildPhoneHubLinkView(readPhoneHubLinkSnapshot()));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  /** Onay/ret — sonuç UYDURULMAZ, native'e yeniden sorulur. */
  const decidePairing = useCallback(async (accepted: boolean) => {
    setPairingCode(null);   // karar verildi: kod artık ekranda durmaz
    await runAction(
      () => confirmPhoneHubPairing(accepted),
      accepted
        ? 'Eşleştirme ONAYLANDI — oturum kurulumu native tarafta sürüyor'
        : 'Eşleştirme REDDEDİLDİ — güven kaydı oluşturulmadı',
    );
  }, [runAction]);

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

      {/* ── Eşleştirme onayı (YALNIZ onay beklenirken) ─────────────── */}
      {view.awaitingUserConfirmation && (
        <div
          data-testid="phl-pairing-gate"
          className="rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-3 py-2"
        >
          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] text-[var(--oem-warn)]">
            <KeyRound size={12} />
            EŞLEŞTİRME ONAYI BEKLİYOR — bu adım olmadan oturum KURULMAZ
          </div>
          <div className="mb-2 text-[10px] leading-relaxed text-[var(--oem-ink-2)]">
            Telefondaki kod ile buradaki kod AYNI değilse ONAYLAMAYIN: kod
            karşılaştırması, araya giren bir cihazın (MITM) güven kurmasını
            engelleyen tek kapıdır. Kod hiçbir kayda, dışa aktarıma veya
            anlık görüntüye yazılmaz.
          </div>
          <div className="mb-2 flex items-center gap-2">
            <span
              data-testid="phl-pairing-code"
              className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2.5 py-1 font-mono text-[14px] tracking-[0.3em] text-[var(--oem-ink)]"
            >
              {pairingCode ?? '••••••'}
            </span>
            <ActionButton
              testId="phl-reveal-code" label="Kodu Göster" icon={KeyRound} disabled={busy}
              onClick={() => void revealPairingCode()} />
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              testId="phl-pairing-accept" label="Onayla" icon={Check}
              disabled={busy || pairingCode === null}
              onClick={() => void decidePairing(true)} />
            <ActionButton
              testId="phl-pairing-reject" label="Reddet" icon={X} disabled={busy} danger
              onClick={() => void decidePairing(false)} />
          </div>
          {pairingCode === null && (
            <div className="mt-1.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
              ONAY, kod görülmeden verilemez — &quot;Kodu Göster&quot; zorunludur.
              RET her zaman mümkündür (güvenli taraf).
            </div>
          )}
        </div>
      )}

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
