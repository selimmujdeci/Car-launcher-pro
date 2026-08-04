import { memo, useCallback, useEffect, useState } from 'react';
import { Fuel, RotateCcw, RefreshCw } from 'lucide-react';
import {
  useOBDField, getFuelCalibrationState, calibrateFuelLevel, clearFuelCalibration,
  type FuelCalibrationResult,
} from '../../platform/obdService';

/**
 * FuelCalibrationPanel — PID 0x2F şamandıra eğrisi kalibrasyonu (Ayarlar → Araç).
 *
 * SAHA KÖKÜ (2026-08-04, adaptör 10:21:3E:4D:71:D2): depo AĞZINA KADAR doluyken ECU
 * `41 2F 99` döndü → 0x99 = 153 → SAE J1979 formülü (A×100/255) ile %60. Uygulamanın
 * matematiği DOĞRU; aracın şamandıra eğrisi 0–255 aralığının tamamını kullanmıyor.
 * obdService'te ölçek mekanizması (loadObdFuelCalib/_fuelCalibScale) ZATEN vardı ama
 * `saveObdFuelCalib`'in ÜRÜNDE TEK BİR ÇAĞIRANI YOKTU → ölçek sonsuza dek 1 kalıyordu
 * (ölü özellik). Bu panel o yazma ucudur.
 *
 * ZERO-TRUST: katsayı TAHMİN EDİLMEZ. "Şu an gerçek seviye %X" beyanını YALNIZ kullanıcı
 * verir; ölçek ham okumadan türetilir (scale = X / ham2F). Ham okuma yoksa/bayatsa
 * eylem REDDEDİLİR — sahte bir "kalibre edildi" onayı gösterilmez.
 *
 * ZERO-LEAK: timer/abonelik YOK. Tek dar abonelik (`useOBDField('fuelLevel')`) zaten
 * mevcut store'a aittir; ham okuma her render'da senkron okunur, `Yenile` elle tetikler.
 */

const REASON_TEXT: Record<Exclude<FuelCalibrationResult, { ok: true }>['reason'], string> = {
  'no-reading':   'ECU henüz yakıt (PID 2F) değeri vermedi — araç bağlıyken tekrar deneyin.',
  'stale-reading':'Son yakıt okuması 2 dakikadan eski (bayat) — bağlantı canlıyken tekrar deneyin.',
  'zero-reading': 'Ham okuma 0 — bu değerden ölçek türetilemez.',
  'bad-input':    'Geçersiz seviye. 1–100 arası bir yüzde girin.',
  'out-of-range': 'Türetilen katsayı makul aralığın (0.2–5) dışında — okuma veya beyan hatalı görünüyor.',
  'no-key':       'Ne VIN ne de adaptör adresi biliniyor — kalibrasyon kalıcı olarak saklanamaz.',
};

export const FuelCalibrationPanel = memo(function FuelCalibrationPanel() {
  // Dar abonelik: gösterim yüzdesi değişince (bu araçta ~8 sn'de bir) anlık görüntüyü tazele.
  // Timer YOK — okuma yalnız veri değişiminde ve elle "Yenile"de yapılır (LAB deseni).
  const displayFuel = useOBDField('fuelLevel');
  const [st, setSt]         = useState(getFuelCalibrationState);
  const [custom, setCustom] = useState('100');
  const [msg, setMsg]       = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { setSt(getFuelCalibrationState()); }, [displayFuel]);
  const refresh = useCallback(() => { setSt(getFuelCalibrationState()); }, []);

  const apply = useCallback((pct: number) => {
    const r = calibrateFuelLevel(pct);
    if (r.ok) {
      setMsg({
        kind: 'ok',
        text: `Kalibre edildi: ham %${r.rawPct} → %${r.actualPct} (katsayı ${r.scale.toFixed(3)}).`,
      });
    } else {
      setMsg({ kind: 'err', text: REASON_TEXT[r.reason] });
    }
    setSt(getFuelCalibrationState());
  }, []);

  const reset = useCallback(() => {
    clearFuelCalibration();
    setMsg({ kind: 'ok', text: 'Kalibrasyon temizlendi — gösterge ham PID 2F değerine döndü.' });
    setSt(getFuelCalibrationState());
  }, []);

  const ageText = st.rawAgeMs == null ? 'UNAVAILABLE' : `${Math.round(st.rawAgeMs / 1000)} sn önce`;
  const keyText = st.keyKind === 'vin' ? 'VIN (araca bağlı)'
    : st.keyKind === 'adapter' ? 'Adaptör MAC (VIN okunamadı)'
    : 'YOK — saklanamaz';

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--oem-ink-2, rgba(255,255,255,0.45))' }}>
        PID 0x2F formülü standarttır (A×100/255) ama şamandıra eğrisi <b>araca</b> aittir: birçok
        araçta depo tam doluyken ECU 255 değil daha düşük bir değer döner. Depo <b>dolu</b> (veya
        seviyeyi kesin bildiğiniz) anda kalibre edin — ECU'ya hiçbir şey yazılmaz, yalnız gösterim
        ölçeklenir.
      </p>

      {/* ── Salt-okunur ölçüm ── */}
      <div className="grid grid-cols-3 gap-2">
        <Metric label="HAM 2F"   value={st.rawPct     == null ? 'UNAVAILABLE' : `%${st.rawPct}`} />
        <Metric label="GÖSTERİM" value={st.displayPct == null ? 'UNAVAILABLE' : `%${st.displayPct}`} />
        <Metric label="KATSAYI"  value={st.scale === 1 ? '1.000 (yok)' : st.scale.toFixed(3)} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px]" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.35))' }}>
        <span>ham okuma: {ageText}</span>
        <span>kayıt anahtarı: {keyText}</span>
        <span>durum: {st.rawUsable ? 'KALİBRE EDİLEBİLİR' : 'HAZIR DEĞİL'}</span>
      </div>

      {/* ── Eylemler ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => apply(100)}
          disabled={!st.rawUsable}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40"
          style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24' }}
        >
          <Fuel className="w-4 h-4" />
          Depo dolu (%100) — kalibre et
        </button>

        <div className="flex items-center gap-1.5">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            inputMode="numeric"
            aria-label="Gerçek yakıt seviyesi yüzdesi"
            className="w-16 bg-transparent text-center font-mono text-sm font-bold rounded-lg px-2 py-2 outline-none"
            style={{ border: '1px solid var(--oem-line, rgba(255,255,255,0.12))', color: 'var(--oem-ink, #fff)', caretColor: '#fbbf24' }}
          />
          <button
            onClick={() => apply(Number(custom))}
            disabled={!st.rawUsable}
            className="px-3 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all active:scale-95 disabled:opacity-40"
            style={{ borderColor: 'var(--oem-line, rgba(255,255,255,0.12))', color: 'var(--oem-ink-2, rgba(255,255,255,0.55))' }}
          >
            % olarak kalibre et
          </button>
        </div>

        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all active:scale-95"
          style={{ borderColor: 'var(--oem-line, rgba(255,255,255,0.12))', color: 'var(--oem-ink-2, rgba(255,255,255,0.55))' }}
        >
          <RefreshCw className="w-3.5 h-3.5" /> Yenile
        </button>

        {st.scale !== 1 && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider border border-red-500/25 text-red-400/70 hover:text-red-400 hover:border-red-500/50 transition-all active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Temizle
          </button>
        )}
      </div>

      {msg && (
        <div
          className="rounded-lg px-3 py-2 text-[11px] font-semibold leading-relaxed"
          style={msg.kind === 'ok'
            ? { background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.30)', color: '#34d399' }
            : { background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#f87171' }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
});

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--oem-line, rgba(255,255,255,0.08))' }}
    >
      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--oem-ink-3, rgba(255,255,255,0.35))' }}>{label}</div>
      <div className="font-mono text-sm font-black tabular-nums truncate" style={{ color: 'var(--oem-ink, #fff)' }}>{value}</div>
    </div>
  );
}
