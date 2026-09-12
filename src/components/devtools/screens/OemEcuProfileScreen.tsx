/**
 * OemEcuProfileScreen — CAROS LAB · Araç · OEM ECU PROFİLLERİ.
 *
 * SALT-OKUNUR: tarama BAŞLATMAZ · OBD komutu GÖNDERMEZ · oturum DEĞİŞTİRMEZ ·
 * timer KURMAZ. Açılışta TEK okuma, sonrası elle YENİLE.
 *
 * ── EKRANIN ASIL İDDİASI ──────────────────────────────────────────────────
 * "Profil dosyada duruyor" ile "profil araca adres veriyor" AYNI ŞEY DEĞİLDİR.
 * Bu yüzden her ECU satırı iki ayrı şeyi yan yana gösterir: profilin İDDİASI
 * (adres · oturum · servis kapsamı) ve o iddianın KANITI (verifiedOn/evidence
 * damgası + envanterde şu an gözlenen durum). Damgasız kayıt ürün yoluna
 * GİRMEZ ve satırında bu açıkça yazar.
 *
 * GİZLİLİK: ham VIN GÖSTERİLMEZ (yalnız WMI öneki); ham komut/yanıt taşınmaz.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Layers, ShieldCheck, ShieldAlert, HelpCircle } from 'lucide-react';
import { readOemProfileSources } from '../../../platform/devtools/oemEcuProfileSources';
import {
  buildOemProfileLabModel, INVENTORY_STATE_LABEL,
  type OemEcuRow, type OemProfileRow,
} from '../../../platform/devtools/oemEcuProfileLabModel';
import {
  OBSERVABILITY_LABEL, type InspectorField,
} from '../../../platform/devtools/sessionInspectorModel';

const KLASS_TONE: Readonly<Record<string, string>> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-accent)] bg-[var(--oem-surface-2)] text-[var(--oem-accent)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const STATE_TONE: Readonly<Record<OemEcuRow['inventoryState'], string>> = {
  discovered:       'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  probed:           'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  probed_silent:    'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  not_attempted:    'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  not_in_inventory: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const FieldRow = memo(function FieldRow({ f }: { f: InspectorField }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-[var(--oem-line)] py-1 last:border-b-0"
      data-testid={`oem-field-${f.id}`} data-class={f.klass}>
      <span className="min-w-[9rem] text-[10px] text-[var(--oem-ink-3)]">{f.label}</span>
      <span className="font-mono text-[11px] font-semibold text-[var(--oem-ink-1)]">{f.value}</span>
      <span className={`inline-flex items-center rounded border px-1 py-0.5 text-[9px] ${KLASS_TONE[f.klass]}`}>
        {OBSERVABILITY_LABEL[f.klass]}
      </span>
      <p className="w-full text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{f.note}</p>
    </div>
  );
});

const EcuRow = memo(function EcuRow({ e }: { e: OemEcuRow }) {
  return (
    <div className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-2 py-1.5"
      data-testid={`oem-ecu-${e.profileId}-${e.ecuId}`}
      data-verified={e.verified ? 'true' : 'false'}
      data-state={e.inventoryState}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-[var(--oem-ink-1)]">{e.name}</span>
        <span className="text-[10px] text-[var(--oem-ink-2)]">{e.roleLabel}</span>
        {e.verified
          ? (
            <span className="inline-flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1 py-0.5 text-[9px] text-[var(--oem-good)]">
              <ShieldCheck size={10} /> DOĞRULANDI {e.verifiedOn}
            </span>
          )
          : (
            <span className="inline-flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1 py-0.5 text-[9px] text-[var(--oem-warn)]">
              <ShieldAlert size={10} /> DOĞRULANMADI — ürün yoluna alınmaz
            </span>
          )}
        <span className={`inline-flex items-center rounded border px-1 py-0.5 text-[9px] ${STATE_TONE[e.inventoryState]}`}>
          {INVENTORY_STATE_LABEL[e.inventoryState]}
        </span>
      </div>

      <div className="mt-1 grid grid-cols-1 gap-0.5 font-mono text-[9px] text-[var(--oem-ink-3)] sm:grid-cols-2">
        <span>Adres: {e.address}</span>
        <span>KWP hedefi: {e.kwpTarget}</span>
        <span>Oturum: {e.session}</span>
        <span>Salt-okuma servisleri: {e.readServices}</span>
        <span>DID/LID: {e.didCount} tanımlı · {e.didVerifiedCount} doğrulanmış</span>
        <span>Lisans: {e.license}</span>
      </div>
      <p className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">Kaynak: {e.provenance}</p>
      {e.evidence !== null && (
        <p className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-2)]">Kanıt: {e.evidence}</p>
      )}
    </div>
  );
});

const ProfileCard = memo(function ProfileCard({ p }: { p: OemProfileRow }) {
  return (
    <section className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] p-2"
      data-testid={`oem-profile-${p.id}`} data-matched={p.matchedNow ? 'true' : 'false'}>
      <header className="flex flex-wrap items-center gap-2">
        <Layers size={12} className="text-[var(--oem-ink-3)]" />
        <span className="text-[11px] font-semibold text-[var(--oem-ink-1)]">{p.manufacturer}</span>
        <span className="text-[10px] text-[var(--oem-ink-2)]">{p.modelFamily}</span>
        <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">{p.id}</span>
        {p.matchedNow && (
          <span className="rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1 py-0.5 text-[9px] text-[var(--oem-good)]">
            ŞU ANKİ ARAÇLA EŞLEŞTİ
          </span>
        )}
        <span className="ml-auto font-mono text-[9px] text-[var(--oem-ink-3)]">
          {p.verifiedEcuCount}/{p.totalEcuCount} ECU doğrulanmış
        </span>
      </header>

      <div className="mt-1 grid grid-cols-1 gap-0.5 font-mono text-[9px] text-[var(--oem-ink-3)] sm:grid-cols-2">
        <span>WMI: {p.wmi}</span>
        <span>Model deseni: {p.modelPattern}</span>
        <span>Protokoller: {p.protocols}</span>
        <span>Lisans: {p.license}</span>
      </div>
      <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{p.note}</p>
      <p className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">Kaynak: {p.provenance}</p>

      <div className="mt-2 space-y-1">
        {p.ecus.map((e) => <EcuRow key={`${p.id}-${e.ecuId}`} e={e} />)}
      </div>
    </section>
  );
});

export default function OemEcuProfileScreen() {
  const mountedRef = useRef(true);
  const [model, setModel] = useState(() => buildOemProfileLabModel(readOemProfileSources(), Date.now()));

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    setModel(buildOemProfileLabModel(readOemProfileSources(), Date.now()));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();                       // açılışta TEK okuma — timer YOK
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return (
    <div className="space-y-2 p-2" data-testid="oem-ecu-profile-screen">
      <header className="flex items-center gap-2">
        <h2 className="text-[12px] font-semibold text-[var(--oem-ink-1)]">OEM ECU Profilleri</h2>
        <button type="button" onClick={refresh}
          className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-2 py-1 text-[10px] text-[var(--oem-ink-2)]"
          data-testid="oem-refresh">
          <RefreshCw size={11} /> YENİLE
        </button>
      </header>

      <p className="text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        Bu ekran hiçbir komut göndermez. Profil, fonksiyonel <span className="font-mono">0100</span> keşfine
        yanıt vermeyen ECU'ları adreslemek içindir; ama bir profil kaydı ancak
        <span className="font-mono"> verifiedOn</span> + <span className="font-mono">evidence</span> damgası
        taşırsa ürün yoluna girer. Damgasız kayıt burada görünür, araca sorulmaz.
      </p>

      {model.registryErrors.length > 0 && (
        <section className="rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] p-2" data-testid="oem-registry-errors">
          <h3 className="text-[11px] font-semibold text-[var(--oem-danger)]">Defter tutarsız</h3>
          <ul className="mt-1 space-y-0.5 font-mono text-[9px] text-[var(--oem-danger)]">
            {model.registryErrors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </section>
      )}

      <section className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] p-2">
        <h3 className="text-[11px] font-semibold text-[var(--oem-ink-1)]">1 · Eşleşme</h3>
        <div className="mt-1">{model.match.map((f) => <FieldRow key={f.id} f={f} />)}</div>
      </section>

      <section className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] p-2">
        <h3 className="text-[11px] font-semibold text-[var(--oem-ink-1)]">2 · Kapsam</h3>
        <div className="mt-1">{model.coverage.map((f) => <FieldRow key={f.id} f={f} />)}</div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold text-[var(--oem-ink-1)]">3 · Defter</h3>
        {model.profiles.length === 0
          ? <p className="text-[10px] text-[var(--oem-ink-3)]">Kayıtlı profil yok.</p>
          : model.profiles.map((p) => <ProfileCard key={p.id} p={p} />)}
      </section>

      <section className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] p-2"
        data-testid="oem-unknowns">
        <h3 className="flex items-center gap-1 text-[11px] font-semibold text-[var(--oem-ink-1)]">
          <HelpCircle size={11} /> 4 · Hâlâ UNKNOWN olan alanlar ({model.unknowns.length})
        </h3>
        {model.unknowns.length === 0
          ? <p className="mt-1 text-[10px] text-[var(--oem-ink-3)]">Bilinmeyen alan yok.</p>
          : (
            <ul className="mt-1 space-y-1">
              {model.unknowns.map((u, i) => (
                <li key={`${u.where}-${u.what}-${i}`} className="text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
                  <span className="font-mono text-[var(--oem-ink-2)]">{u.where}</span> — <strong>{u.what}</strong>: {u.why}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
