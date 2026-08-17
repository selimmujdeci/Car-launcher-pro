/**
 * RemoteCommandScreen — CAROS LAB · İletişim · Uzak Komut Zinciri.
 *
 * SALT-OKUNUR. Komut GÖNDERMEZ, dinleyiciyi yeniden BAĞLAMAZ, hız uyarısı
 * ayarını DEĞİŞTİRMEZ, bildirim TETİKLEMEZ, ağa ÇIKMAZ.
 *
 * ZAMANLAYICI YOK: açılışta tek okuma + elle YENİLE (repodaki LAB deseni).
 *
 * GİZLİLİK (kural 6): komut payload'ı, nonce, `api_key`, E2E anahtar malzemesi,
 * komut/araç kimliği (UUID), koordinat ve hedef adres bu ekrana GELMEZ —
 * yalnız sayılar, komut TİPİ, durumlar ve zaman yaşları görünür.
 *
 * NEDEN VAR: telefondan basılan bir düğme çalışmadığında dört sebep
 * ayırt edilemiyordu — dinleyici yok · şifre kapısı · güvenlik kapısı ·
 * tanımsız tip. Bu ekranın tek işi o ayrımı yapmaktır.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Radio, AlertTriangle } from 'lucide-react';
import {
  readRemoteCommandSnapshot, type RemoteCommandRawSnapshot,
} from '../../../platform/devtools/remoteCommandSources';
import {
  buildRemoteCommandView,
  REMOTE_COMMAND_VERDICT_LABEL, type RemoteCommandVerdict,
} from '../../../platform/devtools/remoteCommandModel';
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

const VERDICT_STYLE: Record<RemoteCommandVerdict, string> = {
  NOT_LISTENING:  'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  NEVER_RECEIVED: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  CRYPTO_BLOCKED: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  TYPE_UNKNOWN:   'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  SAFETY_BLOCKED: 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  HEALTHY:        'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  UNKNOWN:        'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

/** Hükmün ne anlama geldiğini tek cümlede söyler — sayı yorumsuz bırakılmaz. */
const VERDICT_HINT: Record<RemoteCommandVerdict, string> = {
  NOT_LISTENING:  'Realtime aboneliği kurulmamış: telefondan gönderilen komut araca ULAŞAMAZ, kuyrukta bekler (5 dk TTL).',
  NEVER_RECEIVED: 'Dinleyici bağlı ama hiç komut gelmemiş. Bu bir arıza DEĞİL, yalnız sessizliktir.',
  CRYPTO_BLOCKED: 'Komutlar geliyor fakat E2E kapısında düşüyor — araç ile telefonun anahtar eşleşmesi bozuk.',
  TYPE_UNKNOWN:   'Komutlar geliyor fakat araç tipi tanımıyor. Telefon/araç sürümleri ayrışmış olabilir.',
  SAFETY_BLOCKED: 'Komutlar sürüş güvenliği kapısında reddediliyor — araç hareket halinde. Bu DOĞRU davranıştır.',
  HEALTHY:        'Komutlar alınıyor ve araçta yürütülüyor.',
  UNKNOWN:        'Kanıt defteri okunamadı ya da tamamlanan komut yok — hüküm verilemez (fail-closed).',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`rc-field-${field.id}`}
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

export const RemoteCommandScreen = memo(function RemoteCommandScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<RemoteCommandRawSnapshot>(() => readRemoteCommandSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readRemoteCommandSnapshot());
  }, []);

  const view = useMemo(() => buildRemoteCommandView(snap, snap.readAt), [snap]);

  const counts = useMemo(() => {
    const c = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
    for (const card of view.cards) for (const f of card.fields) c[f.klass]++;
    return c;
  }, [view]);

  /* ── Kapı körlüğü — İKİ AYRI GERÇEK ──────────────────────────────────────
   * `NEVER`  : kapıya bugüne dek HİÇ ölçüm verilmedi (hız otoritesi hiç akmadı).
   * `STALE`  : ölçüm verildi ama SONUNCUSU bayat → kapı şu an hüküm veremez.
   * İkisi aynı şey değildir: ilki bağlantı/kurulum sorunu, ikincisi veri kaybıdır.
   */
  const gateBlind: 'NEVER' | 'STALE' | null = (() => {
    const g = snap.speedGate;
    if (snap.speedAlert === null || g === null) return null;
    if (g.lastAtMs === null) return snap.speedAlert.gateFed === 0 ? 'NEVER' : null;
    return snap.readAt - g.lastAtMs > g.maxAgeMs ? 'STALE' : null;
  })();

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="remote-command">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Radio size={12} /> UZAK KOMUT ZİNCİRİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — komut göndermez
          </span>
          <button
            type="button"
            data-testid="rc-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {counts.OBSERVED} · TÜRETİLDİ {counts.DERIVED} ·
            KAYNAK YOK {counts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Yalnız mevcut senkron getter okunur: komut GÖNDERİLMEZ, dinleyici yeniden
          BAĞLANMAZ, hız uyarısı ayarı DEĞİŞTİRİLMEZ, bildirim TETİKLENMEZ, ağ
          çağrısı YAPILMAZ. Komut payload'ı, nonce, api_key, komut/araç kimliği ve
          hedef adres bu ekrana TAŞINMAZ — yalnız sayılar ve komut TİPİ.
        </p>
      </div>

      {/* Hüküm — fail-closed */}
      <div
        data-testid="rc-verdict"
        data-verdict={view.verdict}
        title={view.verdict}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[view.verdict]}`}
      >
        UZAK KOMUT GERÇEĞİ: {REMOTE_COMMAND_VERDICT_LABEL[view.verdict]}
        <div className="mt-1 text-[10px] leading-relaxed opacity-80">
          {VERDICT_HINT[view.verdict]}
        </div>
        <div className="mt-1 text-[9px] opacity-50">
          "Komut çalışmadı" tek bir sebep DEĞİLDİR. Bu ekran dört sebebi ayırır:
          dinleyici yok · şifre kapısı · güvenlik kapısı · tanımsız tip.
        </div>
      </div>

      {/* Hız kapısı körlüğü uyarısı — kütük #574'ün izi */}
      {gateBlind !== null && (
        <div
          data-testid="rc-gate-blind"
          data-blind={gateBlind}
          className="shrink-0 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-3 py-2 font-mono text-[10px] text-[var(--oem-warn)]"
        >
          <span className="flex items-center gap-1 font-bold">
            <AlertTriangle size={11} />
            {gateBlind === 'NEVER'
              ? 'SÜRÜŞ GÜVENLİĞİ KAPISI HENÜZ BESLENMEDİ'
              : 'KAPIDAKİ HIZ ÖLÇÜMÜ BAYAT — KAPI ŞU AN HÜKÜM VEREMEZ'}
          </span>
          <div className="mt-1 text-[9px] leading-relaxed opacity-80">
            {gateBlind === 'NEVER' ? (
              <>
                Hız otoritesine bugüne dek hiç ölçüm verilmemiş (kapıya verilen ölçüm = 0).
                Bu durumda "araç hareket halindeyken kilit açma reddi" TETİKLENEMEZ.
                Kapının İKİ besleyicisi vardır: füzyon hız otoritesi (birincil) ve
                doğrudan OBD akışı (yedek). İkisi de akmıyorsa araç hiç hız üretmiyordur.
              </>
            ) : (
              <>
                Kapıya ölçüm verilmiş ama sonuncusu tazelik penceresini geçmiş.
                Bayat hız bilinçli olarak "araç duruyor" sayılmaz — bu durumda tehlikeli
                komut hız kanıtı OLMADAN kabul edilir ve <b>Hız kanıtsız kabul</b>
                {' '}sayacında görünür. Araç park hâlindeyken bu BEKLENEN durumdur.
              </>
            )}
          </div>
        </div>
      )}

      {/* Kartlar */}
      {view.cards.map((card) => (
        <div
          key={card.id}
          data-testid={`rc-card-${card.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {card.title}
            </span>
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KAPSAM SINIRI (dürüstlük): sayaçlar <b>bu oturuma aittir</b> — uygulama
        yeniden başlarsa sıfırlanır, diske yazılmaz. "Tamamlandı" sayacı aracın
        komutu <b>yürüttüğünü</b> gösterir; fiziksel eylemin gerçekten olduğunu
        (kapı kilitlendi mi) KANITLAMAZ — o kanıt MCU/CAN katmanındadır ve burada
        iddia edilmez. Telefon tarafındaki kuyruk bu ekranda GÖRÜNMEZ (araç
        tarafının defteridir). Gerçek araç doğrulaması YAPILMADI — saha kütüğü
        tek otoritedir.
      </p>
    </div>
  );
});

export default RemoteCommandScreen;
