/**
 * TestProtocolPanel — Patch 5
 *
 * Fiziksel araç testi için marker ekleme paneli.
 * Her butona basılmadan önce ilgili fiziksel aksiyon yapılır.
 *
 * Akış:
 *   1. Butona bas → canDiag kanalına "[MARKER] …" yazılır
 *   2. Fiziksel aksiyonu yap (geri vites tak, kapı aç vb.)
 *   3. Bakım ekranındaki log'u oku — marker sonrası satırlar o olaya ait
 *
 * Read-only: CAN/MCU write yok.
 */

import { useState, useCallback } from 'react';
import { CarLauncher } from '../../platform/nativePlugin';
import { insertMarker } from '../../platform/canBus/EventRecorder';
import { isNative } from '../../platform/bridge';
import { Wifi, WifiOff } from 'lucide-react';

interface TestButton {
  marker: string;
  label: string;
  sub: string;
  color: string;
}

const TEST_BUTTONS: TestButton[] = [
  { marker: 'TEST_ACC_ON',      label: 'Kontak AÇ',       sub: 'Kontağı çevirmeden önce bas',    color: '#22c55e' },
  { marker: 'TEST_ACC_OFF',     label: 'Kontak KAPAT',    sub: 'Kontağı kapatmadan önce bas',    color: '#ef4444' },
  { marker: 'TEST_REVERSE_ON',  label: 'Geri Vitese TAK', sub: 'Geri vites takmadan önce bas',   color: '#f97316' },
  { marker: 'TEST_REVERSE_OFF', label: 'Geri Vitesten ÇIK', sub: 'Vitesten çıkmadan önce bas',  color: '#fb923c' },
  { marker: 'TEST_DOOR_OPEN',   label: 'Kapı AÇ',         sub: 'Kapıyı açmadan önce bas',       color: '#3b82f6' },
  { marker: 'TEST_DOOR_CLOSE',  label: 'Kapı KAPAT',      sub: 'Kapıyı kapatmadan önce bas',    color: '#60a5fa' },
  { marker: 'TEST_LIGHTS_ON',   label: 'Far AÇ',          sub: 'Farı açmadan önce bas',         color: '#facc15' },
  { marker: 'TEST_LIGHTS_OFF',  label: 'Far KAPAT',       sub: 'Farı kapatmadan önce bas',      color: '#fde68a' },
  { marker: 'TEST_STEER_KEY',   label: 'Direksiyon Tuşu', sub: 'Tuşa basmadan önce bas',        color: '#a855f7' },
  { marker: 'TEST_SPEED_CHANGE',label: 'Hız Değişimi',    sub: 'Hareket etmeden önce bas',      color: '#06b6d4' },
];

async function _sendMarker(marker: string): Promise<void> {
  // TypeScript ring buffer'a kaydet
  insertMarker(marker);

  // Native canDiag kanalına da gönder (CanDiagPanel'de görünsün)
  if (isNative && CarLauncher.insertTestMarker) {
    await CarLauncher.insertTestMarker({ marker });
  }
}

export function TestProtocolPanel() {
  const [lastMarker, setLastMarker] = useState<string | null>(null);
  const [busy, setBusy]             = useState(false);
  const [rawCanOn, setRawCanOn]     = useState(false);
  const [rawCanErr, setRawCanErr]   = useState<string | null>(null);

  const handlePress = useCallback(async (btn: TestButton) => {
    if (busy) return;
    setBusy(true);
    try {
      await _sendMarker(btn.marker);
      setLastMarker(btn.marker);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }, [busy]);

  const toggleRawCan = useCallback(async () => {
    setRawCanErr(null);
    if (!rawCanOn) {
      try {
        await CarLauncher.startRawCanScan?.();
        insertMarker('RAW_CAN_START');
        setRawCanOn(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setRawCanErr(msg);
      }
    } else {
      await CarLauncher.stopRawCanScan?.().catch(() => {});
      insertMarker('RAW_CAN_STOP');
      setRawCanOn(false);
    }
  }, [rawCanOn]);

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.1em',
        color: '#64748b',
        textTransform: 'uppercase',
        marginBottom: 10,
      }}>
        Test Protokolü
      </div>

      {/* Açıklama */}
      <div style={{
        fontSize: 11,
        color: '#94a3b8',
        marginBottom: 12,
        lineHeight: 1.5,
        borderLeft: '2px solid #334155',
        paddingLeft: 8,
      }}>
        Fiziksel aksiyondan <strong style={{ color: '#f59e0b' }}>ÖNCE</strong> ilgili butona bas.
        Log'da marker satırından sonra gelen kayıtlar o olaya ait.
      </div>

      {/* Raw CAN Scan butonu */}
      {isNative && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => void toggleRawCan()}
            style={{
              width: '100%',
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: rawCanOn ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${rawCanOn ? '#22c55e' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 8,
              cursor: 'pointer',
              color: rawCanOn ? '#22c55e' : '#94a3b8',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {rawCanOn
              ? <><WifiOff size={14} /> iCar ATMA DURDUR</>
              : <><Wifi size={14} /> iCar ATMA BAŞLAT (Raw CAN)</>
            }
          </button>
          {rawCanOn && (
            <div style={{ fontSize: 10, color: '#22c55e', marginTop: 4, textAlign: 'center' }}>
              Değişen CAN frame'leri log'a akıyor — fiziksel aksiyonları başlatabilirsin
            </div>
          )}
          {rawCanErr && (
            <div style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>
              Hata: {rawCanErr} — önce iCar'ı Bluetooth ile bağla
            </div>
          )}
        </div>
      )}

      {/* Butonlar — 2 kolon */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {TEST_BUTTONS.map(btn => (
          <button
            key={btn.marker}
            onClick={() => void handlePress(btn)}
            disabled={busy}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              padding: '8px 10px',
              background: lastMarker === btn.marker ? `${btn.color}22` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${lastMarker === btn.marker ? btn.color : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 6,
              cursor: busy ? 'wait' : 'pointer',
              textAlign: 'left',
              transition: 'all 120ms',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: btn.color }}>{btn.label}</span>
            <span style={{ fontSize: 10, color: '#64748b' }}>{btn.sub}</span>
          </button>
        ))}
      </div>

      {/* Son marker */}
      {lastMarker && (
        <div style={{
          marginTop: 10,
          padding: '6px 10px',
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 6,
          fontSize: 11,
          color: '#22c55e',
          fontFamily: 'monospace',
        }}>
          ✓ {lastMarker} → Log'a yazıldı
        </div>
      )}
    </div>
  );
}
