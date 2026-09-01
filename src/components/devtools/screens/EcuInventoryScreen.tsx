/**
 * EcuInventoryScreen — CAROS LAB · Araç · ECU ENVANTERİ.
 *
 * Keşfedilen her ECU için: adres · adresleme kipi · protokol · ROL ve rolün
 * HANGİ KANITTAN çıktığı · ECU'nun beyan ettiği sistem adı · seri/donanım
 * numarası · kararlı kimlik anahtarı.
 *
 * ── EKRANIN ASIL İDDİASI ──────────────────────────────────────────────────
 * Rol bir TAHMİN DEĞİL, bir KANIT SONUCUDUR. Bu yüzden her satır rolün yanında
 * kanıt sınıfını taşır: `declared` (ECU kendi söyledi) · `standard` (SAE
 * garantisi) · `profile` (doğrulanmış üretici eşlemesi) · `none` (kanıt yok →
 * rol `unknown`). Kanıtsız rol GÖSTERİLMEZ.
 *
 * SALT-OKUNUR: yazma · aktüatör · rutin YOK. Tek aktif işi, kullanıcı TARA
 * derse mevcut keşfi çalıştırıp ISO 14229 kimlik DID'lerini OKUMAKTIR.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Cpu, Play, ShieldCheck } from 'lucide-react';
import {
  buildEcuInventory, getEcuInventory, isEcuIdentityScanRunning,
  type EcuInventory, type EcuIdentity,
} from '../../../platform/obd/ecuIdentityService';
import {
  ECU_ROLE_LABEL, ECU_EVIDENCE_LABEL, type EcuRoleEvidence,
} from '../../../platform/obd/ecuRoleModel';

type Tone = 'ok' | 'warn' | 'muted';

const TONE: Readonly<Record<Tone, string>> = {
  ok:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  warn:  'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  muted: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

/** Kanıt sınıfı → ton. `none` UYARI DEĞİLDİR: bilmediğimizi dürüstçe söyler. */
function evidenceTone(e: EcuRoleEvidence): Tone {
  return e === 'declared' || e === 'standard' ? 'ok' : e === 'profile' ? 'warn' : 'muted';
}

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const EcuCard = memo(function EcuCard({ e }: { e: EcuIdentity }) {
  return (
    <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5"
      data-testid={`ecu-${e.addressKey}`} data-role={e.role} data-evidence={e.evidence}>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
        <Cpu size={12} className="text-[var(--oem-ink-3)]" />
        <span className="text-[11px] font-semibold text-[var(--oem-ink-1)]">
          {ECU_ROLE_LABEL[e.role]}
        </span>
        <Chip tone={evidenceTone(e.evidence)}>{ECU_EVIDENCE_LABEL[e.evidence]}</Chip>
        <span className="text-[var(--oem-ink-2)]">rx {e.rxHeader} · tx {e.txHeader}</span>
        <span className="text-[var(--oem-ink-3)]">{e.addressBits}-bit</span>
        {e.protocol !== null && <span className="text-[var(--oem-ink-3)]">proto {e.protocol}</span>}
      </div>

      <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{e.reason}</p>

      <div className="mt-1 grid grid-cols-1 gap-0.5 font-mono text-[9px] text-[var(--oem-ink-3)] sm:grid-cols-2">
        <span>Beyan edilen ad (F197): {e.declaredName ?? '—'}</span>
        <span>Seri (F18C): {e.serial ?? '—'}</span>
        <span>Donanım (F191): {e.hardware ?? '—'}</span>
        <span>Keşif etiketi: {e.discoveryLabel}</span>
      </div>
      <p className="mt-0.5 break-all font-mono text-[9px] text-[var(--oem-ink-3)]">
        kimlik: {e.identityKey}
      </p>
    </div>
  );
});

export default function EcuInventoryScreen() {
  const mountedRef = useRef(true);
  const [snap, setSnap] = useState(() => getEcuInventory());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    setSnap(getEcuInventory());
  }, []);

  const scan = useCallback(() => {
    if (isEcuIdentityScanRunning()) return;
    setBusy(true);
    void buildEcuInventory()
      .catch(() => { /* servis fail-soft; sonuç ekranda görünür */ })
      .finally(() => {
        if (!mountedRef.current) return;
        setBusy(false);
        setSnap(getEcuInventory());
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const inv: EcuInventory | null = snap.inventory;
  const known = (inv?.ecus ?? []).filter((e) => e.role !== 'unknown').length;
  const unknown = (inv?.ecus ?? []).length - known;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2" data-testid="ecu-inventory">
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            ECU ENVANTERİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT-OKUNUR — yazma/aktüatör YOK
          </span>
          <button type="button" data-testid="ecu-scan" disabled={busy} onClick={scan}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] disabled:opacity-50">
            <Play size={11} /> {busy ? 'TARANIYOR…' : 'TARA'}
          </button>
          <button type="button" data-testid="ecu-refresh" onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)]">
            <RefreshCw size={11} /> YENİLE
          </button>
          {snap.stale && <Chip tone="warn">BAYAT — önceki OBD oturumu</Chip>}
        </div>

        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Rol bir TAHMİN DEĞİL, KANIT SONUCUDUR. Adres tek başına yeterli değildir:
          SAE J1979 yalnız <b>7E8 → motor</b> garantisi verir; <b>7E1'in şanzıman
          olması yaygın bir GELENEKTİR, kural değil</b> ve oradan rol üretmek yanlış
          teşhise yol açar. Bu yüzden her satır rolün yanında kanıt sınıfını taşır ve
          kanıt yoksa rol <b>bilinmiyor</b> KALIR. Üretici-özel eşlemeler ayrı bir veri
          katmanındadır ve yalnız gerçek araçta doğrulanmış satırlar oraya girer.
        </p>

        {inv !== null && (
          <div className="mt-1 font-mono text-[9px] text-[var(--oem-ink-2)]">
          <p>
            {inv.ecus.length} ECU · {known} rolü belirlendi · {unknown} bilinmiyor ·
            {' '}VIN {inv.vin === null ? 'BİLİNMİYOR (profil eşlemesi denenmedi)' : 'var'} ·
            {' '}oturum #{inv.epoch} · tarama {snap.runs}
          </p>
          <p data-testid="ecu-completeness">
            kapsam: {inv.completeness.completenessLabel} · discovered {inv.completeness.discovered} ·
            {' '}probed {inv.completeness.probed} · scanned {inv.completeness.scanned} ·
            {' '}skipped {inv.completeness.skipped} · failed {inv.completeness.failed} ·
            {' '}not_addressable {inv.completeness.notAddressable}
          </p>
          {!inv.completeness.denominatorKnown && <p>
            Payda UNKNOWN: fonksiyonel 0100'a cevap vermeyen/gateway arkasındaki ECU'lar “yok” sayılmaz.
          </p>}
          </div>
        )}
        {inv?.bridgeMissing === true && (
          <p className="mt-1 font-mono text-[9px] text-[var(--oem-warn)]">
            KÖPRÜ YOK — bu APK kimlik DID'lerini okuyamıyor; roller yalnız standart
            adres garantisinden çıkarılabilir.
          </p>
        )}
      </div>

      {(inv?.ecus ?? []).map((e) => <EcuCard key={e.addressKey} e={e} />)}

      {inv === null && (
        <p className="px-2 text-[10px] leading-relaxed text-[var(--oem-ink-3)]">
          Henüz envanter çıkarılmadı. “TARA” mevcut ECU keşfini kullanır (yeni tarama
          sistemi kurulmaz) ve her ECU'ya ISO 14229 kimlik DID'lerini sorar.
        </p>
      )}
      {inv !== null && inv.ecus.length === 0 && (
        <p className="px-2 text-[10px] leading-relaxed text-[var(--oem-ink-3)]">
          Hiçbir ECU yanıt vermedi. Bu <b>“araçta ECU yok”</b> DEĞİL,
          <b> “keşif sonuç vermedi”</b> demektir.
        </p>
      )}
    </div>
  );
}
