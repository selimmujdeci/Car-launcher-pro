import { memo, useEffect, useMemo, useState } from 'react';
import { FlaskConical, Fingerprint } from 'lucide-react';
import { useOBDState } from '../../platform/obdService';
import type { OBDData } from '../../platform/obdTypes';
import { STANDARD_PIDS, EXTENDED_CANDIDATE_PIDS } from '../../platform/obd/StandardPidRegistry';
import type { StandardPidDef } from '../../platform/obd/StandardPidRegistry';
import {
  watchPid, getPidValue, isPidSupported, setDiagnosticBurst,
} from '../../platform/obd/extendedPidService';
import type { ExtendedPidValue } from '../../platform/obd/extendedPidService';
import { watchDid, getSupportedDids, isDidSupported } from '../../platform/obd/manufacturerPidService';
import type { ManufacturerDidValue } from '../../platform/obd/manufacturerPidService';
import type { CompiledDidDef, VehicleDidValue } from '../../platform/obd/vehicleDidProfile';

/**
 * ObdLiveTestPanel — OBD Canlı Test (Tüm Veriler).
 *
 * AMAÇ: sahada "hangi PID doğru geliyor, hangisi gelmiyor" denetimi. Tüm SAE J1979
 * Mode-01 PID'leri + çekirdek (RPM/hız/sıcaklık, obdStore hızlı akışı) + marka DID'leri
 * TEK ekranda canlı akar; her satırda ham hex + yorumlanmış değer + tazelik + durum.
 *
 * SIFIR-MALİYET SÖZLEŞMESİ (Malı-400): abonelikler + native BURST modu YALNIZ panel
 * `active` iken açılır. Kapanınca watchPid bırakılır ve setDiagnosticBurst(false) →
 * native düşük-yük round-robin'e döner (ekstra ECU trafiği yok).
 */

const FRESH_MS = 5_000;
const STALE_MS = 15_000;

/** Çekirdek PID'ler — obdStore ana (hızlı) akışından okunur; ham hex yoktur. */
const CORE_ROWS: readonly { pid: string; get: (o: OBDData) => number }[] = [
  { pid: '0C', get: (o) => o.rpm },
  { pid: '0D', get: (o) => o.speed },
  { pid: '05', get: (o) => o.engineTemp },
  { pid: '0F', get: (o) => o.intakeTemp },
  { pid: '11', get: (o) => o.throttle },
  { pid: '0B', get: (o) => o.boostPressure },
  { pid: '2F', get: (o) => o.fuelLevel },
  { pid: '42', get: (o) => o.batteryVoltage ?? -1 },
];
const CORE_GET = new Map(CORE_ROWS.map((r) => [r.pid, r.get]));

/** Extended = tüm çekirdek-olmayan aday PID'ler, çekirdekte gösterilen 42 (voltaj) hariç. */
const EXT_PIDS: readonly string[] = EXTENDED_CANDIDATE_PIDS.filter((p) => !CORE_GET.has(p));

/** Kategori → Türkçe başlık + gösterim sırası. */
const CAT_ORDER: readonly StandardPidDef['category'][] =
  ['motor', 'sicaklik', 'basinc', 'yakit', 'elektrik', 'emisyon', 'o2', 'tork', 'mesafe'];
const CAT_LABEL: Record<StandardPidDef['category'], string> = {
  motor: 'Motor', sicaklik: 'Sıcaklık', basinc: 'Basınç', yakit: 'Yakıt',
  elektrik: 'Elektrik', emisyon: 'Emisyon', o2: 'O₂ Sensörleri', tork: 'Tork', mesafe: 'Mesafe',
};

type Status = 'fresh' | 'stale' | 'suspect' | 'unsupported' | 'discovering' | 'waiting' | 'nolink';

const STATUS_STYLE: Record<Status, { cls: string; label: string }> = {
  fresh:       { cls: 'text-[color:var(--oem-good)] border-[var(--oem-good)] bg-[var(--oem-good-soft)]',       label: 'TAZE' },
  stale:       { cls: 'text-[color:var(--oem-warn)] border-[var(--oem-warn)] bg-[var(--oem-warn-soft)]',       label: 'BAYAT' },
  suspect:     { cls: 'text-[color:var(--oem-danger)] border-[var(--oem-danger)] bg-[var(--oem-danger-soft)]', label: 'ŞÜPHELİ' },
  unsupported: { cls: 'text-[color:var(--oem-ink-3)] border-[var(--oem-line)] bg-[var(--oem-surface-2)]',      label: 'YOK' },
  discovering: { cls: 'text-[color:var(--oem-info)] border-[var(--oem-info)] bg-[var(--oem-info-soft)]',       label: 'KEŞİF' },
  waiting:     { cls: 'text-[color:var(--oem-ink-3)] border-[var(--oem-line)] bg-[var(--oem-surface-2)]',      label: 'BEKLİYOR' },
  nolink:      { cls: 'text-[color:var(--oem-ink-3)] border-[var(--oem-line)] bg-[var(--oem-surface-2)]',      label: '—' },
};

/** Birime göre ondalık — okunabilirlik. */
function fmtVal(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  const dec = (unit === '°C' || unit === 'V' || unit === 'λ' || unit === 'g/s' || unit === 'L/h' || unit === '°') ? 1 : 0;
  return value.toFixed(dec);
}

const PidRow = memo(function PidRow({
  pid, name, unit, valueText, raw, status,
}: { pid: string; name: string; unit: string; valueText: string; raw: string; status: Status }) {
  const s = STATUS_STYLE[status];
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-3 py-1.5">
      <span className="font-mono text-[10px] font-black text-[color:var(--oem-ink-3)] w-7 shrink-0">{pid}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold text-[color:var(--oem-ink-2)] truncate">{name}</div>
        {raw ? <div className="font-mono text-[9px] text-[color:var(--oem-ink-3)] truncate">{raw}</div> : null}
      </div>
      <div className="text-right shrink-0 min-w-[48px]">
        <span className="font-black tabular-nums text-[color:var(--oem-ink)] text-sm">{valueText}</span>
        {unit ? <span className="text-[10px] font-bold text-[color:var(--oem-ink-2)] ml-0.5">{unit}</span> : null}
      </div>
      <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${s.cls}`}>
        {s.label}
      </span>
    </div>
  );
});

/** Bir PID satırının gösterim durumunu hesaplar (çekirdek → obd, extended → ext snapshot). */
function computeRow(
  def: StandardPidDef, obd: OBDData, ext: Record<string, ExtendedPidValue>, now: number, connected: boolean,
): { valueText: string; raw: string; status: Status } {
  const coreGet = CORE_GET.get(def.pid);
  if (coreGet) {
    if (!connected) return { valueText: '—', raw: '', status: 'nolink' };
    const v = coreGet(obd);
    if (!Number.isFinite(v) || v < 0) return { valueText: '—', raw: '', status: 'unsupported' };
    const stale = obd.lastSeenMs > 0 && now - obd.lastSeenMs > STALE_MS;
    return { valueText: fmtVal(v, def.unit), raw: '', status: stale ? 'stale' : 'fresh' };
  }
  // Extended PID (yalnız geçerli çözülen değerler ext snapshot'ında bulunur)
  const e = ext[def.pid];
  if (e) {
    const age = now - e.updatedAt;
    return { valueText: fmtVal(e.value, def.unit), raw: e.raw, status: age > FRESH_MS ? 'stale' : 'fresh' };
  }
  if (!connected) return { valueText: '—', raw: '', status: 'nolink' };
  const sup = isPidSupported(def.pid);
  if (sup === false) return { valueText: '—', raw: '', status: 'unsupported' };
  if (sup === null)  return { valueText: '—', raw: '', status: 'discovering' };
  return { valueText: '—', raw: '', status: 'waiting' };
}

function didValueText(value: VehicleDidValue, unit: string): string {
  return typeof value === 'string' ? value : fmtVal(value, unit);
}

function ObdLiveTestPanelInner({ active }: { active: boolean }) {
  const obd = useOBDState();
  const [now, setNow] = useState(() => Date.now());
  const [ext, setExt] = useState<Record<string, ExtendedPidValue>>({});
  const [dids, setDids] = useState<CompiledDidDef[]>([]);
  const [didVals, setDidVals] = useState<Record<string, ManufacturerDidValue>>({});

  const connected = obd.connectionState === 'connected' && obd.source === 'real';

  // BURST + tüm extended PID aboneliği — YALNIZ panel görünürken (sıfır-maliyet sözleşmesi).
  useEffect(() => {
    if (!active) return;
    setDiagnosticBurst(true);
    // watchPid native listeye PID ekler (izleme başlatır); değerler tick'te toplu okunur.
    const unsubs = EXT_PIDS.map((pid) => watchPid(pid, () => { /* snapshot tick'te */ }));
    return () => {
      unsubs.forEach((u) => u());
      setDiagnosticBurst(false);
    };
  }, [active]);

  // Marka Verileri (DID) aboneliği — AYRI yaşam döngüsü.
  useEffect(() => {
    if (!active) { setDids([]); return; }
    const list = getSupportedDids();
    setDids(list);
    if (list.length === 0) return;
    const unsubs = list.map((d) => watchDid(d.did, (v) => setDidVals((p) => ({ ...p, [d.did]: v }))));
    return () => { unsubs.forEach((u) => u()); setDidVals({}); };
  }, [active]);

  // 1 sn tick: tazelik saati + extended snapshot toplama (48 PID için tek setState).
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setNow(Date.now());
      const snap: Record<string, ExtendedPidValue> = {};
      for (const pid of EXT_PIDS) {
        const v = getPidValue(pid);
        if (v) snap[pid] = v;
      }
      setExt(snap);
    }, 1000);
    return () => clearInterval(t);
  }, [active]);

  // Kategoriye göre gruplu PID tablosu (çekirdek + extended aynı kayıt tablosundan).
  const grouped = useMemo(() => {
    const byCat = new Map<StandardPidDef['category'], StandardPidDef[]>();
    for (const def of STANDARD_PIDS) {
      const arr = byCat.get(def.category);
      if (arr) arr.push(def); else byCat.set(def.category, [def]);
    }
    return byCat;
  }, []);

  // Özet: kaç PID taze/toplam.
  const summary = useMemo(() => {
    let live = 0, total = 0;
    for (const def of STANDARD_PIDS) {
      total++;
      const r = computeRow(def, obd, ext, now, connected);
      if (r.status === 'fresh' || r.status === 'stale') live++;
    }
    return { live, total };
  }, [obd, ext, now, connected]);

  return (
    <div className="mt-2 flex flex-col gap-3">
      {/* Başlık + canlı özet */}
      <div className="flex items-center justify-between rounded-xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] px-3 py-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-[color:var(--oem-accent)]" />
          <span className="text-[11px] font-black uppercase tracking-widest text-[color:var(--oem-ink-2)]">
            Tüm PID canlı test
          </span>
        </div>
        <span className="text-[10px] font-black tabular-nums text-[color:var(--oem-ink-3)]">
          {connected ? `${summary.live} / ${summary.total} okunuyor` : 'OBD bağlı değil'}
        </span>
      </div>

      {!connected ? (
        <div className="rounded-xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-4 text-center">
          <span className="text-[color:var(--oem-ink-2)] text-xs font-bold uppercase tracking-wider opacity-60">
            OBD bağlantısı yok — veriler bağlantıyla akar
          </span>
        </div>
      ) : (
        CAT_ORDER.map((cat) => {
          const defs = grouped.get(cat);
          if (!defs || defs.length === 0) return null;
          return (
            <div key={cat} className="flex flex-col gap-1.5">
              <div className="text-[10px] font-black uppercase tracking-widest text-[color:var(--oem-ink-3)] px-1">
                {CAT_LABEL[cat]}
              </div>
              {defs.map((def) => {
                const r = computeRow(def, obd, ext, now, connected);
                return (
                  <PidRow
                    key={def.pid}
                    pid={def.pid}
                    name={def.name}
                    unit={def.unit}
                    valueText={r.valueText}
                    raw={r.raw}
                    status={r.status}
                  />
                );
              })}
            </div>
          );
        })
      )}

      {/* Marka Verileri (DID) */}
      {connected && dids.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <Fingerprint className="w-3.5 h-3.5 text-[color:var(--oem-accent)]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-[color:var(--oem-ink-3)]">
              Marka Verileri (DID)
            </span>
          </div>
          {dids.map((d) => {
            const mv = didVals[d.did];
            const status: Status = mv ? 'fresh' : (isDidSupported(d.did) === false ? 'unsupported' : 'waiting');
            return (
              <PidRow
                key={d.did}
                pid={d.did}
                name={d.name}
                unit={mv && typeof mv.value === 'number' ? d.unit : ''}
                valueText={mv ? didValueText(mv.value, d.unit) : '—'}
                raw=""
                status={status}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export const ObdLiveTestPanel = memo(ObdLiveTestPanelInner);
