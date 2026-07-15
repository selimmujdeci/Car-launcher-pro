/**
 * OBD-OS-F0-4 — Protokol-Sınıfı Timeout Profili.
 *
 * En kritik kilit: CAN ve BİLİNMEYEN protokolde değerler mevcut `obdRetryPolicy`
 * sabitleriyle BİREBİR aynı kalmalı (çalışan CAN davranışı bu PR'da DEĞİŞMEZ).
 * Yalnız yavaş seri protokoller (KWP/ISO9141) daha geniş pencere alır.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyProtocol,
  getProtocolProfile,
  isSlowSerialProtocol,
} from '../platform/obd/protocolProfile';
import {
  CONNECT_TIMEOUT_MS,
  DATA_GATE_TIMEOUT_MS,
  STALE_THRESHOLD_MS,
} from '../platform/obdRetryPolicy';

describe('OBD-OS-F0-4 · classifyProtocol (ELM327 ATSP → sınıf)', () => {
  it('CAN ailesi (6/7/8/9) doğru sınıflanır', () => {
    for (const p of ['6', '7', '8', '9']) expect(classifyProtocol(p)).toBe('can');
  });

  it('KWP2000 = 4 (5-baud) ve 5 (fast init)', () => {
    expect(classifyProtocol('4')).toBe('kwp');
    expect(classifyProtocol('5')).toBe('kwp');
  });

  it('ISO 9141-2 = 3 · J1850 = 1/2', () => {
    expect(classifyProtocol('3')).toBe('iso9141');
    expect(classifyProtocol('1')).toBe('j1850');
    expect(classifyProtocol('2')).toBe('j1850');
  });

  it('ATSP0 / null / boş / çöp → unknown (uydurma sınıf YOK)', () => {
    expect(classifyProtocol('0')).toBe('unknown');
    expect(classifyProtocol(null)).toBe('unknown');
    expect(classifyProtocol(undefined)).toBe('unknown');
    expect(classifyProtocol('')).toBe('unknown');
    expect(classifyProtocol('Z')).toBe('unknown');
  });
});

describe('OBD-OS-F0-4 · getProtocolProfile', () => {
  it('🔒 KİLİT: CAN profili mevcut sabitlerle BİREBİR aynı (çalışan davranış değişmez)', () => {
    const can = getProtocolProfile('6');
    expect(can.connectTimeoutMs).toBe(CONNECT_TIMEOUT_MS);
    expect(can.dataGateTimeoutMs).toBe(DATA_GATE_TIMEOUT_MS);
    expect(can.staleThresholdMs).toBe(STALE_THRESHOLD_MS);
  });

  it('🔒 KİLİT: BİLİNMEYEN protokol de CAN (mevcut) değerlerini alır — pencere UZATILMAZ', () => {
    // Neden: bilinmeyen protokolde connect penceresini uzatmak, yanlış transport'ta
    // BLE↔classic fallback'ini geciktirirdi (kullanıcı boşuna bekler).
    const unknown = getProtocolProfile(null);
    expect(unknown.connectTimeoutMs).toBe(CONNECT_TIMEOUT_MS);
    expect(unknown.dataGateTimeoutMs).toBe(DATA_GATE_TIMEOUT_MS);
    expect(unknown.staleThresholdMs).toBe(STALE_THRESHOLD_MS);
  });

  it('KWP ve ISO9141 pencereleri CAN\'den GENİŞ (10.4 kbit/s seri hat + 5-baud init)', () => {
    const kwp = getProtocolProfile('5');
    const iso = getProtocolProfile('3');
    for (const slow of [kwp, iso]) {
      expect(slow.connectTimeoutMs).toBeGreaterThan(CONNECT_TIMEOUT_MS);
      expect(slow.dataGateTimeoutMs).toBeGreaterThan(DATA_GATE_TIMEOUT_MS);
      expect(slow.staleThresholdMs).toBeGreaterThan(STALE_THRESHOLD_MS);
    }
    // ISO9141 yalnız 5-baud init destekler → KWP'den de yavaş.
    expect(iso.connectTimeoutMs).toBeGreaterThanOrEqual(kwp.connectTimeoutMs);
  });

  it('data-gate penceresi connect penceresini AŞMAZ (gate connect sonrası başlar)', () => {
    for (const p of ['3', '4', '5', '6', '1', null]) {
      const prof = getProtocolProfile(p);
      expect(prof.dataGateTimeoutMs).toBeLessThanOrEqual(prof.connectTimeoutMs);
    }
  });
});

describe('OBD-OS-F0-4 · isSlowSerialProtocol (native ATST/ATSW kapısı)', () => {
  it('yalnız KWP + ISO9141 true — CAN/J1850/bilinmeyen ASLA', () => {
    expect(isSlowSerialProtocol('3')).toBe(true);
    expect(isSlowSerialProtocol('4')).toBe(true);
    expect(isSlowSerialProtocol('5')).toBe(true);
    for (const p of ['6', '7', '1', '2', '0', null, undefined]) {
      expect(isSlowSerialProtocol(p)).toBe(false);
    }
  });
});
