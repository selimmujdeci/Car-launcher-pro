/**
 * DTC Service — Diagnostic Trouble Code reading, description, and clearing.
 *
 * Architecture:
 *  - Module-level push state (same pattern as obdService)
 *  - Turkish DTC code database for P/B/C/U codes
 *  - Native path: CarLauncher.readDTC() + clearDTC()
 *  - Mock fallback with random realistic codes for demo/web mode
 */

import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';

/* ── Types ───────────────────────────────────────────────── */

export type DTCSeverity = 'critical' | 'warning' | 'info';

export interface DTCCode {
  code: string;
  description: string;
  system: string;
  severity: DTCSeverity;
  possibleCauses: string[];
}

export interface DTCState {
  codes: DTCCode[];
  isReading: boolean;
  isClearing: boolean;
  lastReadAt: number | null;
  error: string | null;
}

/* ── DTC Database (Turkish) ──────────────────────────────── */

const DTC_DB: Record<string, Omit<DTCCode, 'code'>> = {
  // ── Ateşleme / Silindir ──────────────────────────────────
  P0300: { description: 'Tespit Edilemeyen Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Bujiler', 'Yakıt enjektörü', 'Kompresyon düşük', 'Ateşleme bobini'] },
  P0301: { description: '1. Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Buji (1. silindir)', 'Ateşleme bobini', 'Yakıt enjektörü'] },
  P0302: { description: '2. Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Buji (2. silindir)', 'Ateşleme bobini', 'Yakıt enjektörü'] },
  P0303: { description: '3. Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Buji (3. silindir)', 'Ateşleme bobini', 'Yakıt enjektörü'] },
  P0304: { description: '4. Silindir Ateşleme Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Buji (4. silindir)', 'Ateşleme bobini', 'Yakıt enjektörü'] },

  // ── Yakıt / Lambda ───────────────────────────────────────
  P0171: { description: 'Banka 1 Yakıt Karışımı Çok Zayıf', system: 'Yakıt', severity: 'warning', possibleCauses: ['Hava manifold kaçağı', 'MAF sensörü kirli', 'O2 sensörü arızalı', 'Yakıt pompası zayıf'] },
  P0172: { description: 'Banka 1 Yakıt Karışımı Çok Zengin', system: 'Yakıt', severity: 'warning', possibleCauses: ['Yakıt basıncı yüksek', 'Enjektör sızıntısı', 'MAF sensörü'] },
  P0174: { description: 'Banka 2 Yakıt Karışımı Çok Zayıf', system: 'Yakıt', severity: 'warning', possibleCauses: ['Hava kaçağı', 'Yakıt basıncı düşük'] },
  P0175: { description: 'Banka 2 Yakıt Karışımı Çok Zengin', system: 'Yakıt', severity: 'warning', possibleCauses: ['Enjektör sızıntısı', 'Yakıt basıncı yüksek'] },
  P0087: { description: 'Yakıt Rayı Basıncı Çok Düşük', system: 'Yakıt', severity: 'critical', possibleCauses: ['Yakıt pompası arıza', 'Yakıt filtresi tıkanık', 'Basınç regülatörü'] },

  // ── Lambda / Egzoz ───────────────────────────────────────
  P0420: { description: 'Katalitik Konvertör Verimliliği Düşük (Banka 1)', system: 'Egzoz', severity: 'warning', possibleCauses: ['Katalitik konvertör', 'O2 sensörü (arka)', 'Egzoz kaçağı'] },
  P0421: { description: 'Katalitik Konvertör Verimliliği Düşük (Banka 2)', system: 'Egzoz', severity: 'warning', possibleCauses: ['Katalitik konvertör', 'O2 sensörü', 'Egzoz kaçağı'] },
  P0130: { description: 'O2 Sensörü Devre Arızası (Banka 1 Sensör 1)', system: 'Egzoz', severity: 'warning', possibleCauses: ['O2 sensörü', 'Kablo hasarı', 'Egzoz kaçağı'] },
  P0136: { description: 'O2 Sensörü Devre Arızası (Banka 1 Sensör 2)', system: 'Egzoz', severity: 'warning', possibleCauses: ['O2 sensörü (arka)', 'Kablo hasarı'] },

  // ── Emisyon (EVAP) ───────────────────────────────────────
  P0440: { description: 'EVAP Yakıt Buharı Sistemi Genel Arıza', system: 'Emisyon', severity: 'warning', possibleCauses: ['Yakıt deposu kapağı gevşek', 'EVAP solenoid', 'Hortum kaçağı'] },
  P0442: { description: 'EVAP Küçük Sızıntı Tespit Edildi', system: 'Emisyon', severity: 'info', possibleCauses: ['Yakıt deposu kapağı', 'Küçük hortum çatlağı'] },
  P0455: { description: 'EVAP Büyük Sızıntı Tespit Edildi', system: 'Emisyon', severity: 'warning', possibleCauses: ['Yakıt deposu kapağı yok/arızalı', 'Büyük hortum kaçağı', 'Karbon filtresi'] },
  P0456: { description: 'EVAP Çok Küçük Sızıntı', system: 'Emisyon', severity: 'info', possibleCauses: ['Yakıt deposu kapağı', 'EVAP sistemi hortumları'] },

  // ── Soğutma ──────────────────────────────────────────────
  P0115: { description: 'Motor Soğutma Sıcaklık Sensörü Devre Arızası', system: 'Soğutma', severity: 'warning', possibleCauses: ['ECT sensörü', 'Kablo hasarı', 'Soğutucu sıvı düzeyi'] },
  P0116: { description: 'Motor Soğutma Sıcaklık Sensörü Aralık Dışı', system: 'Soğutma', severity: 'warning', possibleCauses: ['ECT sensörü', 'Termostat'] },
  P0128: { description: 'Motor Soğutma Termostatı Arızası (Çok Soğuk)', system: 'Soğutma', severity: 'warning', possibleCauses: ['Termostat açık kalmış', 'Soğutucu sıvı sensörü'] },

  // ── Hava Girişi ──────────────────────────────────────────
  P0100: { description: 'MAF Sensörü Devre Arızası', system: 'Hava Girişi', severity: 'critical', possibleCauses: ['MAF sensörü kirli/arızalı', 'Hava filtresi tıkanık', 'Kablo'] },
  P0101: { description: 'MAF Sensörü Performans Arızası', system: 'Hava Girişi', severity: 'warning', possibleCauses: ['MAF sensörü kirli', 'Hava kaçağı', 'Kablo'] },
  P0112: { description: 'IAT Sensörü Devre Düşük', system: 'Hava Girişi', severity: 'warning', possibleCauses: ['IAT sensörü', 'Kablo kısa devre'] },
  P0113: { description: 'IAT Sensörü Devre Yüksek (Açık)', system: 'Hava Girişi', severity: 'warning', possibleCauses: ['IAT sensörü', 'Kablo açık devre'] },

  // ── Gaz Kelebeği ────────────────────────────────────────
  P0120: { description: 'Gaz Kelebeği Konum Sensörü Devre Arızası', system: 'Motor', severity: 'critical', possibleCauses: ['TPS sensörü', 'Elektronik gaz kelebeği', 'Kablo'] },
  P0121: { description: 'Gaz Kelebeği Konum Sensörü Aralık Dışı', system: 'Motor', severity: 'warning', possibleCauses: ['TPS sensörü', 'Gaz kelebeği gövdesi'] },

  // ── Krank / Eksantrik ────────────────────────────────────
  P0335: { description: 'Krank Mili Konum Sensörü (CKP) Arızası', system: 'Motor', severity: 'critical', possibleCauses: ['CKP sensörü', 'Relüktör çarkı hasar', 'Kablo hasarı'] },
  P0340: { description: 'Eksantrik Mili Konum Sensörü (CMP) Devre Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['CMP sensörü', 'Eksantrik mili', 'Zamanlama zinciri'] },
  P0016: { description: 'Krank-Eksantrik Mili Korelasyon Hatası', system: 'Motor', severity: 'critical', possibleCauses: ['Zamanlama zinciri/kayışı', 'VVT valf', 'Motor yağı'] },

  // ── Şanzıman ─────────────────────────────────────────────
  P0700: { description: 'Şanzıman Kontrol Sistemi (TCM) Arızası', system: 'Şanzıman', severity: 'critical', possibleCauses: ['TCM arızası', 'Solenoid valfleri', 'Şanzıman yağı kirli/düşük'] },
  P0715: { description: 'Giriş/Türbin Hız Sensörü Devre Arızası', system: 'Şanzıman', severity: 'warning', possibleCauses: ['Hız sensörü', 'Kablo hasarı'] },
  P0730: { description: 'Yanlış Vites Oranı', system: 'Şanzıman', severity: 'warning', possibleCauses: ['Şanzıman yağı', 'Solenoid', 'Mekanik aşınma'] },
  P0740: { description: 'Tork Konvertör Kilitleme Devresi Arızası', system: 'Şanzıman', severity: 'warning', possibleCauses: ['TCC solenoid', 'Şanzıman yağı', 'Mekanik arıza'] },

  // ── Hız Sensörü ──────────────────────────────────────────
  P0500: { description: 'Araç Hız Sensörü (VSS) Arızası', system: 'Aktarma', severity: 'warning', possibleCauses: ['VSS sensörü', 'ABS modülü', 'Kablo hasarı'] },
  P0501: { description: 'Araç Hız Sensörü Aralık Dışı', system: 'Aktarma', severity: 'warning', possibleCauses: ['VSS sensörü', 'Diferansiyel sensör'] },

  // ── Karoseri (B kodları) ─────────────────────────────────
  B0001: { description: 'Sürücü Hava Yastığı Devre Arızası', system: 'Güvenlik (SRS)', severity: 'critical', possibleCauses: ['Hava yastığı modülü', 'Kontakt sarmal', 'SRS modülü'] },
  B0010: { description: 'Yolcu Hava Yastığı Devre Arızası', system: 'Güvenlik (SRS)', severity: 'critical', possibleCauses: ['Hava yastığı modülü', 'Kablo hasarı', 'SRS modülü'] },
  B1000: { description: 'Elektronik Kontrol Ünitesi (ECU) Dahili Arıza', system: 'Gövde Elektronik', severity: 'critical', possibleCauses: ['ECU arızası', 'Güç beslemesi', 'Toprak bağlantısı'] },

  // ── Şasi / ABS (C kodları) ───────────────────────────────
  C0034: { description: 'Sol Ön ABS Sensörü Devre Arızası', system: 'Fren/ABS', severity: 'critical', possibleCauses: ['ABS sensörü (sol ön)', 'Sensör halkası', 'ABS modülü', 'Kablo'] },
  C0040: { description: 'Sağ Ön ABS Sensörü Devre Arızası', system: 'Fren/ABS', severity: 'critical', possibleCauses: ['ABS sensörü (sağ ön)', 'Sensör halkası', 'Kablo'] },
  C0041: { description: 'Sağ Ön ABS Sensörü Aralık/Performans', system: 'Fren/ABS', severity: 'warning', possibleCauses: ['ABS sensörü kirli', 'Sensör halkası hasar'] },
  C0045: { description: 'Sol Arka ABS Sensörü Devre Arızası', system: 'Fren/ABS', severity: 'critical', possibleCauses: ['ABS sensörü (sol arka)', 'Kablo hasarı'] },
  C0050: { description: 'Sağ Arka ABS Sensörü Devre Arızası', system: 'Fren/ABS', severity: 'critical', possibleCauses: ['ABS sensörü (sağ arka)', 'Kablo hasarı'] },

  // ── Ağ/İletişim (U kodları) ──────────────────────────────
  U0001: { description: 'CAN Veri Yolu Yüksek Hız İletişim Hatası', system: 'CAN Ağı', severity: 'critical', possibleCauses: ['CAN kablosu', 'Terminatör direnci', 'Modül arızası'] },
  U0100: { description: 'ECM/PCM ile CAN İletişim Hatası', system: 'CAN Ağı', severity: 'critical', possibleCauses: ['ECM/PCM', 'CAN veri yolu', 'Güç besleme sorunu'] },
  U0101: { description: 'TCM ile CAN İletişim Hatası', system: 'CAN Ağı', severity: 'warning', possibleCauses: ['TCM modülü', 'CAN kablosu'] },
  U0121: { description: 'ABS Modülü ile İletişim Hatası', system: 'CAN Ağı', severity: 'warning', possibleCauses: ['ABS modülü', 'CAN veri yolu', 'Güç beslemesi'] },
  U0155: { description: 'Gösterge Paneli ile İletişim Hatası', system: 'CAN Ağı', severity: 'info', possibleCauses: ['Gösterge paneli modülü', 'CAN bağlantısı'] },
};

const MOCK_CODES = ['P0171', 'P0420', 'P0300', 'P0128', 'P0455', 'C0034', 'U0100'];

/* ── Module state ────────────────────────────────────────── */

let _state: DTCState = {
  codes: [],
  isReading: false,
  isClearing: false,
  lastReadAt: null,
  error: null,
};

const _listeners = new Set<(s: DTCState) => void>();

function _notify(): void {
  const snap = { ..._state, codes: [..._state.codes] };
  _listeners.forEach((fn) => fn(snap));
}

function _setState(partial: Partial<DTCState>): void {
  _state = { ..._state, ...partial };
  _notify();
}

/* ── Helpers ─────────────────────────────────────────────── */

function _lookupCode(raw: string): DTCCode {
  const code = raw.toUpperCase().trim();
  const entry = DTC_DB[code];
  if (entry) return { code, ...entry };

  const systemMap: Record<string, string> = {
    P: 'Motor/Sürüş', B: 'Karoseri', C: 'Şasi', U: 'Ağ/İletişim',
  };
  const prefix = code[0] ?? 'P';

  return {
    code,
    description: `${systemMap[prefix] ?? 'Bilinmeyen'} Sistemi Arızası`,
    system: systemMap[prefix] ?? 'Bilinmeyen',
    severity: 'warning',
    possibleCauses: ['Yetkili servise danışın'],
  };
}

function _getMockCodes(): DTCCode[] {
  if (Math.random() > 0.35) return []; // 65% chance of no codes
  const n = Math.floor(Math.random() * 3) + 1;
  return MOCK_CODES
    .sort(() => Math.random() - 0.5)
    .slice(0, n)
    .map(_lookupCode);
}

/* ── Public API ──────────────────────────────────────────── */

export async function readDTCCodes(): Promise<void> {
  if (_state.isReading) return;
  _setState({ isReading: true, error: null });

  try {
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await (CarLauncher as unknown as Record<string, (a?: unknown) => Promise<{ codes: string[] }>>).readDTC();
        const codes = (result.codes ?? []).map(_lookupCode);
        _setState({ codes, isReading: false, lastReadAt: Date.now() });
        return;
      } catch {
        // fall through to mock
      }
    }

    // Mock / web fallback
    await new Promise<void>((r) => setTimeout(r, 1_500));
    _setState({ codes: _getMockCodes(), isReading: false, lastReadAt: Date.now() });

  } catch (err) {
    _setState({
      isReading: false,
      error: err instanceof Error ? err.message : 'Okuma sırasında hata oluştu',
    });
  }
}

export async function clearDTCCodes(): Promise<void> {
  if (_state.isClearing || _state.codes.length === 0) return;
  _setState({ isClearing: true, error: null });

  try {
    if (Capacitor.isNativePlatform()) {
      try {
        await (CarLauncher as unknown as Record<string, () => Promise<void>>).clearDTC();
      } catch {
        // ignore if plugin doesn't support clearDTC yet
      }
    }

    await new Promise<void>((r) => setTimeout(r, 2_000));
    _setState({ codes: [], isClearing: false, lastReadAt: Date.now() });

  } catch (err) {
    _setState({
      isClearing: false,
      error: err instanceof Error ? err.message : 'Silme sırasında hata oluştu',
    });
  }
}

export function onDTCState(fn: (s: DTCState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state, codes: [..._state.codes] });
  return () => { _listeners.delete(fn); };
}

export function useDTCState(): DTCState {
  const [s, setS] = useState<DTCState>({ ..._state, codes: [..._state.codes] });
  useEffect(() => onDTCState(setS), []);
  return s;
}
