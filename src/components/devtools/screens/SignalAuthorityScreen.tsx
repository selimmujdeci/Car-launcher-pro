/**
 * SignalAuthorityScreen — CAROS LAB · Araç · Sinyal Otoritesi (V-04/3).
 *
 * NEDEN VAR: `signalHub` "tek otoriter sinyal okuma yüzeyi" olarak yazılmıştı ama
 * üretim yolunda **hiç tüketicisi yoktu** — yani sözleşme vardı, çalıştığının kanıtı
 * yoktu. Bu ekran onu gerçek bir okuyucuya bağlar ve zarfın (değer + durum + tazelik +
 * güven + kaynak) doğru üretildiğini CİHAZDA gözlemlenebilir kılar.
 *
 * SALT-OKUNUR. YAPMADIKLARI (pazarlıksız): OBD/AT komutu gönderme · PID sorgusu ·
 * keşif tetikleme · bağlantı açma/kapama · poll cadence değiştirme · yeni timer /
 * abonelik / polling / global store.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni (Session Inspector · Adaptör Tanılama ·
 * KWP İzleyici) periyodik yenileme kullanmaz — açılışta TEK okuma + elle YENİLE.
 * `readSignal` PULL tabanlıdır: boşta sıfır maliyet, yeni ECU trafiği DOĞMAZ.
 *
 * GİZLİLİK: VIN/konum/kullanıcı verisi bu ekrana GELMEZ — yalnız sayısal sinyal zarfları.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Radio, Scissors } from 'lucide-react';
import {
  readSignalAuthoritySnapshot,
  PID_ROW_CAP,
  type SignalAuthoritySnapshot,
} from '../../../platform/devtools/signalAuthoritySources';
import {
  buildSignalFields, countBySignalClass, deriveSignalVerdict,
  SIGNAL_STATE_LABEL, SIGNAL_VERDICT_LABEL,
  type SignalAuthorityVerdict, type SignalFieldRow,
} from '../../../platform/devtools/signalAuthorityModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const VERDICT_STYLE: Record<SignalAuthorityVerdict, string> = {
  LIVE:        'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  STALE_ONLY:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  MOCK_SOURCE: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NO_DATA:     'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  READ_FAILED: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const SignalRowView = memo(function SignalRowView(
  { field, nowMs }: { field: SignalFieldRow; nowMs: number },
) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`sig-row-${field.id}`}
      data-class={field.klass}
      data-state={field.state}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[12px] font-bold text-[var(--oem-ink)]">
            {field.value}
          </span>
          <span
            title={field.state}
            className="rounded border border-[var(--oem-line-strong)] px-1 py-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]"
          >
            {SIGNAL_STATE_LABEL[field.state]}
          </span>
          <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
            güven %{field.confidence}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
        <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
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

export const SignalAuthorityScreen = memo(function SignalAuthorityScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<SignalAuthoritySnapshot>(() => readSignalAuthoritySnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readSignalAuthoritySnapshot());
  }, []);

  const fields  = useMemo(() => buildSignalFields(snap), [snap]);
  const counts  = useMemo(() => countBySignalClass(fields), [fields]);
  const verdict = useMemo(() => deriveSignalVerdict(snap, fields), [snap, fields]);

  const coreFields = useMemo(() => fields.filter((f) => f.kind === 'core'), [fields]);
  const pidFields  = useMemo(() => fields.filter((f) => f.kind === 'pid'), [fields]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="signal-authority">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Radio size={12} /> SİNYAL OTORİTESİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — sorgu göndermez
          </span>
          <button
            type="button"
            data-testid="sig-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {counts.OBSERVED} · BAYAT {counts.STALE} · KAYNAK YOK {counts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          `signalHub.readSignal()` PULL tabanlıdır: bu ekran mevcut depolardan okur, YENİ
          ECU trafiği doğurmaz. Değer yoksa "0" değil "—" yazılır — sıfır bir ÖLÇÜMDÜR,
          veri yokluğu değil. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Yüzey hükmü */}
      <div
        data-testid="sig-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        OKUMA YÜZEYİ: {SIGNAL_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Bu hüküm ARAÇ hakkında değil, OKUMA YÜZEYİ hakkındadır: hub'dan kanıtlı sinyal
          gelip gelmediğini söyler. Mock kaynak "CANLI" SAYILMAZ.
        </div>
      </div>

      {/* Core sinyaller */}
      <div
        data-testid="sig-section-core"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          ÇEKİRDEK SİNYALLER ({coreFields.length})
        </div>
        <div>
          {coreFields.length === 0
            ? <div className="px-2 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">Hub çekirdek sinyal döndürmedi.</div>
            : coreFields.map((f) => <SignalRowView key={f.id} field={f} nowMs={snap.readAt} />)}
        </div>
      </div>

      {/* Extended PID'ler */}
      <div
        data-testid="sig-section-pid"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            DESTEĞİ KANITLI PID'LER ({pidFields.length})
          </span>
          {snap.trimmedPidCount > 0 && (
            <span
              data-testid="sig-trim"
              className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]"
            >
              <Scissors size={10} /> {snap.trimmedPidCount} PID KIRPILDI (tavan {PID_ROW_CAP})
            </span>
          )}
        </div>
        <div>
          {pidFields.length === 0
            ? (
              <div className="px-2 py-2 font-mono text-[10px] text-[var(--oem-ink-3)]">
                Desteği KANITLANMIŞ extended PID yok. Bu "PID yok" demek DEĞİLDİR: bitmask
                keşfi henüz yapılmamış olabilir — sorulmamış ile yok ayrı şeylerdir.
              </div>
            )
            : pidFields.map((f) => <SignalRowView key={f.id} field={f} nowMs={snap.readAt} />)}
        </div>
      </div>

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        Sınıflandırma `sessionInspectorModel` sözleşmesini kullanır (ÖLÇÜLDÜ · TÜRETİLDİ ·
        KAYNAK YOK · BAYAT) — paralel bir otorite kurulmaz. Ham `SignalState` ayrıca
        gösterilir çünkü eşleme bilgi kaybeder: ŞÜPHELİ bir ölçüm gerçekten GELMİŞTİR
        (kaynak yok değildir) ama fiziksel sınır dışında olduğu için karar için kullanılmaz.
        Üretici DID'leri bu ekranda listelenmez — hub onları `did:` adresiyle verir ama
        araç profili yoksa hepsi "veri yok" satırı olurdu.
      </p>
    </div>
  );
});
