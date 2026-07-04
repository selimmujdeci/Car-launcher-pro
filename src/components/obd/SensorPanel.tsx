import { memo, useEffect, useState } from 'react';
import { Activity, Gauge, Wifi, Fingerprint } from 'lucide-react';
import { watchPid, isPidSupported } from '../../platform/obd/extendedPidService';
import type { ExtendedPidValue } from '../../platform/obd/extendedPidService';
import { getObdHealth } from '../../platform/obd/ObdHealthMonitor';
import type { ObdHealthSnapshot } from '../../platform/obd/ObdHealthMonitor';
import { useOBDState } from '../../platform/obdService';
import {
  watchDid, isDidSupported, getSupportedDids, verifyVinAgainstMode09,
} from '../../platform/obd/manufacturerPidService';
import type { ManufacturerDidValue, VinCrossCheckResult } from '../../platform/obd/manufacturerPidService';
import type { CompiledDidDef, VehicleDidValue } from '../../platform/obd/vehicleDidProfile';

/**
 * SensorPanel — Patch 9A: canlı genişletilmiş sensör bölümü (Arıza Teşhisi drawer'ı içinde).
 *
 * SIFIR-MALİYET SÖZLEŞMESİ: abonelikler `active` prop'una bağlı — drawer kapaliyken
 * watchPid abonelikleri KALDIRILIR → extendedPidService native listeyi boşaltır →
 * poll turu ek komut çalıştırmaz (DrawerShell çocukları unmount ETMEZ, Freeze'e
 * güvenilmez; görünürlük buradan yönetilir).
 *
 * PID seçimi: extendedPidService zaten araç desteklemeyeni native'e göndermez;
 * burada isPidSupported false olan satır listeden düşer (keşif tamamlanınca).
 */

/** İzlenen genişletilmiş PID'ler — rotasyon gecikmesi makul kalsın diye 12 ile sınırlı. */
const WATCH_PIDS: readonly string[] = [
  '5C', // motor yağı sıcaklığı
  '04', // hesaplanan motor yükü
  '42', // kontrol ünitesi voltajı
  '46', // ortam hava sıcaklığı
  '5E', // yakıt tüketim hızı
  '10', // MAF
  '06', // kısa dönem yakıt trim B1
  '07', // uzun dönem yakıt trim B1
  '0E', // ateşleme avansı
  '33', // barometrik basınç
  '3C', // katalizör sıcaklığı B1S1
  '2C', // komutlanan EGR
];

/** Birime göre ondalık hane — gösterge okunabilirliği. */
function fmt(value: number, unit: string): string {
  const decimals = unit === '°C' || unit === 'V' || unit === 'λ' || unit === 'g/s' || unit === 'L/h' ? 1
    : unit === '%' || unit === '°' ? 0
    : 0;
  return value.toFixed(decimals);
}

/** connectionQuality → OEM token sınıfları. TAM LİTERAL string — Tailwind tarayıcısı
 *  şablon-enterpolasyonlu sınıf adlarını üretmez (bilinen tuzak). */
const QUALITY_STYLES = {
  good:   'bg-[var(--oem-good-soft)] border-[var(--oem-good)] text-[color:var(--oem-good)]',
  warn:   'bg-[var(--oem-warn-soft)] border-[var(--oem-warn)] text-[color:var(--oem-warn)]',
  danger: 'bg-[var(--oem-danger-soft)] border-[var(--oem-danger)] text-[color:var(--oem-danger)]',
} as const;

function qualityToken(q: number): { cls: string; label: string } {
  if (q >= 80) return { cls: QUALITY_STYLES.good,   label: 'İYİ' };
  if (q >= 50) return { cls: QUALITY_STYLES.warn,   label: 'ORTA' };
  return        { cls: QUALITY_STYLES.danger, label: 'ZAYIF' };
}

const SensorTile = memo(function SensorTile({ v }: { v: ExtendedPidValue }) {
  return (
    <div className="rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-3 flex flex-col gap-1 min-w-0">
      <div className="text-[color:var(--oem-ink-3)] text-[10px] font-bold uppercase tracking-wider truncate">
        {v.def.name}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[color:var(--oem-ink)] font-black text-xl tabular-nums">
          {fmt(v.value, v.def.unit)}
        </span>
        <span className="text-[color:var(--oem-ink-2)] text-[11px] font-bold">{v.def.unit}</span>
      </div>
    </div>
  );
});

/** Patch 12D: Marka Verileri satırı — DID değeri sayısal (fiziksel ölçüm) VEYA
 *  metin (VIN/parça no/versiyon gibi kimlik DID'i, ascii decode) olabilir. */
const ManufacturerDidTile = memo(function ManufacturerDidTile({
  def, value,
}: { def: CompiledDidDef; value: VehicleDidValue }) {
  return (
    <div className="rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-3 flex flex-col gap-1 min-w-0">
      <div className="text-[color:var(--oem-ink-3)] text-[10px] font-bold uppercase tracking-wider truncate">
        {def.name}
      </div>
      {typeof value === 'string' ? (
        <span className="text-[color:var(--oem-ink)] font-black text-sm tracking-wide break-all">
          {value}
        </span>
      ) : (
        <div className="flex items-baseline gap-1">
          <span className="text-[color:var(--oem-ink)] font-black text-xl tabular-nums">
            {fmt(value, def.unit)}
          </span>
          <span className="text-[color:var(--oem-ink-2)] text-[11px] font-bold">{def.unit}</span>
        </div>
      )}
    </div>
  );
});

function SensorPanelInner({ active }: { active: boolean }) {
  const [values, setValues] = useState<Record<string, ExtendedPidValue>>({});
  const [health, setHealth] = useState<ObdHealthSnapshot | null>(null);
  const obd = useOBDState();

  // Patch 12D: Marka Verileri — profil yüklüyse (manufacturerPidService) DID listesi.
  // Profilsizken getSupportedDids() [] döner → bölüm hiç render edilmez (dürüst: veri yok
  // iddiası yapılmaz). Liste `active` olduğunda bir kez okunur — profil oturum ortasında
  // değişmez varsayımı SensorPanel'in mevcut WATCH_PIDS deseniyle tutarlı.
  const [didDefs, setDidDefs] = useState<CompiledDidDef[]>([]);
  const [didValues, setDidValues] = useState<Record<string, ManufacturerDidValue>>({});
  const [vinCheck, setVinCheck] = useState<VinCrossCheckResult | null>(null);

  // Abonelik yaşam döngüsü — yalnız panel GÖRÜNÜRKEN (Zero-Leak: tam temizlik).
  useEffect(() => {
    if (!active) return;
    const unsubs = WATCH_PIDS.map((pid) =>
      watchPid(pid, (v) => setValues((prev) => ({ ...prev, [pid]: v }))),
    );
    setHealth(getObdHealth());
    const healthTimer = setInterval(() => setHealth(getObdHealth()), 5_000);
    return () => {
      unsubs.forEach((u) => u());
      clearInterval(healthTimer);
    };
  }, [active]);

  // Marka Verileri aboneliği — AYRI effect (extendedPidService'ten bağımsız yaşam döngüsü);
  // drawer kapanınca watchDid bırakılır → manufacturerPidService round-robin zamanlayıcısı durur.
  useEffect(() => {
    if (!active) { setDidDefs([]); return; }
    const dids = getSupportedDids();
    setDidDefs(dids);
    if (dids.length === 0) return;
    const unsubs = dids.map((def) =>
      watchDid(def.did, (v) => setDidValues((prev) => ({ ...prev, [def.did]: v }))),
    );
    return () => {
      unsubs.forEach((u) => u());
      setDidValues({});
    };
  }, [active]);

  // VIN çapraz doğrulama — YALNIZ F190 değeri gerçekten değiştiğinde tekrar hesaplanır
  // (verifyVinAgainstMode09 her çağrıda obdDiagnosticRecorder'a event yazar; her tur/render'da
  // çağırmak teşhis zaman çizelgesini gereksiz doldururdu — edge-triggered tutuldu).
  const f190Value = didValues['F190']?.value;
  useEffect(() => {
    if (typeof f190Value !== 'string' || f190Value.length === 0) return;
    setVinCheck(verifyVinAgainstMode09());
  }, [f190Value]);

  const connected = obd.connectionState === 'connected' && obd.source === 'real';
  const rows = WATCH_PIDS
    .filter((pid) => isPidSupported(pid) !== false) // keşif "desteklenmiyor" dediyse gizle
    .map((pid) => values[pid])
    .filter((v): v is ExtendedPidValue => v !== undefined);

  const didRows = didDefs
    .filter((def) => isDidSupported(def.did) !== false) // 7F-31/33 → kalıcı desteklenmiyor, gizle
    .map((def) => didValues[def.did])
    .filter((v): v is ManufacturerDidValue => v !== undefined);

  const q = health && health.connectionQuality >= 0 ? qualityToken(health.connectionQuality) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Bölüm başlığı + bağlantı kalitesi rozeti (ObdHealthMonitor) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--oem-info-soft)] border border-[var(--oem-info)] flex items-center justify-center">
            <Activity className="w-4 h-4 text-[color:var(--oem-info)]" />
          </div>
          <span className="text-[color:var(--oem-ink)] font-black text-sm uppercase tracking-widest">
            Canlı Sensörler
          </span>
        </div>
        {q && (
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-[10px] font-black uppercase tracking-wider ${q.cls}`}>
            <Wifi className="w-3 h-3" />
            Bağlantı {health!.connectionQuality} · {q.label}
          </div>
        )}
      </div>

      {!connected ? (
        <div className="rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-4 flex items-center gap-3">
          <Gauge className="w-5 h-5 text-[color:var(--oem-ink-2)] opacity-50" />
          <span className="text-[color:var(--oem-ink-2)] text-xs font-bold uppercase tracking-wider opacity-60">
            OBD bağlantısı yok — sensörler bağlantıyla birlikte akar
          </span>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-4">
          <span className="text-[color:var(--oem-ink-2)] text-xs font-bold uppercase tracking-wider opacity-60">
            Sensörler okunuyor… (araç desteği keşfediliyor)
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {rows.map((v) => <SensorTile key={v.def.pid} v={v} />)}
        </div>
      )}

      {/* ── Marka Verileri (Patch 12D) ──────────────────────────────────── */}
      {/* Yalnız profil yüklüyse görünür (getSupportedDids [] → didDefs.length===0 → gizli). */}
      {didDefs.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--oem-accent-soft)] border border-[var(--oem-accent)] flex items-center justify-center">
                <Fingerprint className="w-4 h-4 text-[color:var(--oem-accent)]" />
              </div>
              <span className="text-[color:var(--oem-ink)] font-black text-sm uppercase tracking-widest">
                Marka Verileri
              </span>
            </div>
            {/* Dürüstlük: matched:null (henüz karşılaştırılamadı) rozet GÖSTERİLMEZ. */}
            {vinCheck && vinCheck.matched !== null && (
              <div
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-[10px] font-black uppercase tracking-wider ${
                  vinCheck.matched ? QUALITY_STYLES.good : QUALITY_STYLES.danger
                }`}
              >
                {vinCheck.matched ? 'VIN DOĞRULANDI' : 'VIN UYUŞMUYOR'}
              </div>
            )}
          </div>

          {!connected ? (
            <div className="rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-4 flex items-center gap-3">
              <Fingerprint className="w-5 h-5 text-[color:var(--oem-ink-2)] opacity-50" />
              <span className="text-[color:var(--oem-ink-2)] text-xs font-bold uppercase tracking-wider opacity-60">
                OBD bağlantısı yok — marka verileri bağlantıyla birlikte akar
              </span>
            </div>
          ) : didRows.length === 0 ? (
            <div className="rounded-2xl border border-[var(--oem-line)] bg-[var(--oem-surface-2)] p-4">
              <span className="text-[color:var(--oem-ink-2)] text-xs font-bold uppercase tracking-wider opacity-60">
                Marka verileri okunuyor… (araç desteği keşfediliyor)
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {didRows.map((v) => <ManufacturerDidTile key={v.def.did} def={v.def} value={v.value} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const SensorPanel = memo(SensorPanelInner);
