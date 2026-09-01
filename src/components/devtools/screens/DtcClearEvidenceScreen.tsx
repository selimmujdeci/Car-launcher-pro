/**
 * DtcClearEvidenceScreen — CAROS LAB · Vehicle · DTC SİLME KANITI (P0-OBD-10).
 *
 * SALT-OKUNUR. Hiçbir OBD komutu GÖNDERMEZ, silme BAŞLATMAZ, timer KURMAZ.
 * Yalnız `dtcClearEvidence` defterini okur (açılışta bir kez + elle YENİLE).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Gerçek araçta "HAFIZAYI TEMİZLE" çalışmıyordu ve ürün TEK BİR KANIT
 * üretemiyordu: hangi komut gitti mi, ECU ne cevapladı, silme sonrası 03/07/0A
 * ne döndü — hiçbiri hiçbir yerde durmuyordu (`clearDTC()` sözleşmesi
 * `Promise<void>` idi; ham TX/RX plugin sınırında ATILIYORDU).
 *
 * Bu ekran o kör noktayı kapatır: TX · RX · protokol · hedef kapsam · sonuç
 * sınıfı · süre · silme sonrası yeniden okuma YAN YANA durur.
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────────
 *  · "ECU onayı (44)" ile "DOĞRULANMIŞ silme" AYRI sayılır — bu turun tüm
 *    meselesi ikisinin AYNI ŞEY OLMAMASIDIR.
 *  · Ham yanıt taşınmıyorsa `UNAVAILABLE` yazılır (boş string YASAK).
 *  · KALICI (Mode 0A) kodun durması kırmızı gösterilmez — Mode 04 onu silemez.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Yalnız OBD protokol verisi gösterilir (komut · ham hex · DTC kodu · protokol
 * numarası · süre). VIN, konum ve kullanıcı verisi bu ekrana GİRMEZ.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Eraser, ArrowRightLeft } from 'lucide-react';
import {
  readDtcClearSnapshot, type DtcClearSnapshot,
} from '../../../platform/devtools/dtcClearSources';
import {
  buildClearAttemptRow, buildClearHeaderStats, UNAVAILABLE,
  type ClearAttemptRow, type ClearTone,
} from '../../../platform/devtools/dtcClearViewModel';

const TONE: Readonly<Record<ClearTone, string>> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  bad:   'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

function Chip({ tone, children }: { tone: ClearTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function Field({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="break-all">
      <span className="text-[var(--oem-ink-3)]">{label}: </span>
      <span className={dim === true ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-ink-1)]'}>{value}</span>
    </div>
  );
}

const Attempt = memo(function Attempt({ row }: { row: ClearAttemptRow }) {
  return (
    <div
      className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5"
      data-testid={`dtc-clear-${row.id}`}
    >
      {/* Hüküm — en üstte, çünkü kullanıcının sorusu "silindi mi?" */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={row.verdictTone}>{row.verdictLabel}</Chip>
        <span className="font-mono text-[10px] text-[var(--oem-ink-3)]">
          oturum {row.sessionEpoch < 0 ? UNAVAILABLE : `#${row.sessionEpoch}`}
        </span>
        <span className="font-mono text-[10px] text-[var(--oem-ink-3)]">{row.elapsedText}</span>
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-[var(--oem-ink-2)]">{row.verdictMessage}</div>

      {/* TX / RX — ham kanıt */}
      <div className="mt-1.5 grid gap-0.5 font-mono text-[10px]">
        <div className="flex items-center gap-1 text-[var(--oem-ink-3)]">
          <ArrowRightLeft size={11} /> KOMUT
        </div>
        <Field label="TX" value={row.txText} dim={row.txText === UNAVAILABLE} />
        <Field label="RX (ham)" value={row.rawText} dim={row.rawText === UNAVAILABLE} />
        <Field label="kapsam" value={row.scopeText} dim={row.scopeText === UNAVAILABLE} />
        <Field label="protokol" value={row.protocolText} dim={row.protocolText === UNAVAILABLE} />
        <div className="flex items-center gap-2">
          <span className="text-[var(--oem-ink-3)]">ECU cevabı: </span>
          <Chip tone={row.commandTone}>{row.commandLabel}</Chip>
        </div>
        {row.nrcText !== null && (
          <div className="text-[var(--oem-danger)]">negatif yanıt: {row.nrcText}</div>
        )}
        <Field label="yazma kapısı" value={row.gateText} />
      </div>

      {/* Silme öncesi / sonrası ölçüm */}
      <div className="mt-1.5 grid gap-0.5 font-mono text-[10px]">
        <div className="text-[var(--oem-ink-3)]">ÖLÇÜM</div>
        <Field label="silme öncesi" value={row.beforeText} />
        <Field label="silinen" value={row.removedText} />
        <Field label="duran" value={row.remainingText} />
        <Field label="geri gelen" value={row.returnedText} />
        <Field label="kalıcı (Mode 04 silemez)" value={row.permanentText} />
      </div>

      {/* Silme sonrası yeniden okuma — sınıf sınıf */}
      <div className="mt-1.5 grid gap-1">
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">SİLME SONRASI YENİDEN OKUMA</div>
        {row.rereadRows.length === 0 ? (
          <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            Yeniden okuma YAPILMADI — bu hükmün DOĞRULANMADIĞI anlamına gelir.
          </div>
        ) : row.rereadRows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
            <span className="text-[var(--oem-ink-1)]">{r.title}</span>
            <Chip tone={r.tone}>{r.outcomeLabel}</Chip>
            <span className={r.codesText === UNAVAILABLE ? 'text-[var(--oem-ink-3)]' : 'text-[var(--oem-ink-1)]'}>
              {r.codesText}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

export default function DtcClearEvidenceScreen() {
  const [snap, setSnap] = useState<DtcClearSnapshot | null>(null);
  /** Zero-leak: sökülmüş bileşene setState YAPILMAZ. */
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    const s = readDtcClearSnapshot();
    if (mountedRef.current) setSnap(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — abonelik/timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const stats = snap === null
    ? []
    : buildClearHeaderStats(snap.summary, snap.sessionEpoch, snap.detailedBridgeAvailable);
  // En yeni deneme en üstte — saha teşhisinde son deneme aranır.
  const rows = snap === null
    ? []
    : snap.attempts.map((a, i) => buildClearAttemptRow(a, i)).slice().reverse();

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="dtc-clear-screen">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Eraser size={14} className="text-[var(--oem-ink-3)]" />
          <span className="text-[12px] font-semibold text-[var(--oem-ink-1)]">DTC Silme Kanıtı</span>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)]"
        >
          <RefreshCw size={11} /> YENİLE
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`rounded border px-2 py-1.5 ${TONE[s.tone]}`}
            data-testid={`dtc-clear-stat-${s.label}`}
          >
            <div className="text-[10px] opacity-90">{s.label}</div>
            <div className="font-mono text-[11px] font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {snap?.summary.mixedEpochs === true && (
        <div className="rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-2 py-1.5 text-[10px] text-[var(--oem-warn)]">
          Defter BİRDEN FAZLA oturum taşıyor — oturum sıfırlaması kaçırılmış olabilir.
        </div>
      )}

      {snap === null ? (
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">okunuyor…</div>
      ) : rows.length === 0 ? (
        <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
          Bu oturumda silme DENEMESİ yapılmadı — bu &quot;silme çalışıyor&quot; DEMEK DEĞİLDİR.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => <Attempt key={r.id} row={r} />)}
        </div>
      )}
    </div>
  );
}
