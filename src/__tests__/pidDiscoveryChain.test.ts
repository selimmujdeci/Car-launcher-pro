/**
 * pidDiscoveryChain.test.ts — P0-OBD-CORE-06 · "94 izleniyor ama 8 değer üretiyor"
 * zincirinin UÇTAN UCA kilidi.
 *
 * ── SAHA (2026-08-25) ───────────────────────────────────────────────────────
 *   supportedCount = 15 · nativeListCount = 8 · watchedCount = 94 · valued = 8
 *   gatedCount = 86 · avgAge ~79 s · maxAge ~130 s
 *
 * Bu testler ÜÇ soruyu ayırır ve her birinin cevabını KİLİTLER:
 *
 *  A) `supportedCount` bir TAVAN mı, ALT SINIR mı?
 *     Cevap `continuation` bitine bağlıdır: CLEAR ise araç gerçekten o kadar
 *     PID destekler; zincir kırıldıysa (`incomplete`) sayı yalnız OKUNABİLEN
 *     blokların toplamıdır ve "araç desteklemiyor" ÇIKARIMI YASAKTIR.
 *
 *  B) Daralmayı yapan bir TAVAN mı?  HAYIR — `_buildNativeList` tavanı
 *     `STANDARD_PID_MAP.size` (100+), native tavanı 128. 30+ destekli PID
 *     kanıtlanınca native listesi 8'de KALMAZ.
 *
 *  C) `watched` ile `configured` AYNI ŞEY DEĞİLDİR: 94 izleyici Canlı Test
 *     ekranının kataloğu tarama isteğidir; tele giden liste yalnız KANITLI
 *     destekli olanlardır. "94 PID okuyoruz" iddiası bu ayrımla çürür.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildHandshakeResult, buildDiscoveryEvidence, type RawHandshake,
} from '../core/val/OBDHandshake';
import {
  _internals as extInternals, seedSupportedPids, watchPid,
  getExtendedGateState, ELM_WATCH_CAP,
} from '../platform/obd/extendedPidService';
import { STANDARD_PID_MAP } from '../platform/obd/StandardPidRegistry';
import { _obdInternals } from '../platform/obdService';

/* ── Bitmap kurguları ────────────────────────────────────────────────────────
 * Blok 00 yanıtı: `41 00 A B C D`. D baytının bit0'ı SÜREKLİLİK bitidir
 * (PID 0x20 destekleniyor mu = "bir sonraki blok var mı").
 *   BE 1F B8 10 → bit0 = 0 → CLEAR (zincir KESİN biter, 16 PID gerçek kapsam)
 *   BE 1F B8 11 → bit0 = 1 → SET   (0120 SORULMALI)
 */
const BLOCK00_CLEAR = '41 00 BE 1F B8 10';
const BLOCK00_SET   = '41 00 BE 1F B8 11';
/** Blok 20 yanıtı: yalnız PID 0x21 destekli, süreklilik CLEAR. */
const BLOCK20_OK    = '41 20 80 00 00 00';

function raw(over: Partial<RawHandshake>): RawHandshake {
  return { raw09: '', raw0100: '', ...over };
}

describe('P0-OBD-CORE-06 · A — continuation biti ham yanıttan doğrulanır', () => {
  it('continuation CLEAR → keşif TAM; 16 PID GERÇEK kapsamdır', () => {
    const r = buildHandshakeResult(raw({
      raw0100: BLOCK00_CLEAR, blockAttempts: [1, 0, 0, 0, 0, 0], failedBlockIndex: -1,
    }));
    expect(r.completeness).toBe('complete');
    expect(r.failedBlock).toBeNull();
    expect(r.readBlocks.has(0x00)).toBe(true);
    expect(r.readBlocks.has(0x20)).toBe(false);   // hiç sorulmadı — çünkü GEREKMEDİ
    expect(r.supportedPids.has(0x20)).toBe(false);
    expect(r.supportedPids.size).toBe(16);

    const ev = buildDiscoveryEvidence(raw({ raw0100: BLOCK00_CLEAR }));
    expect(ev.blocks[0]!.continuation).toBe('CLEAR');
    expect(ev.blocks[0]!.stopReason).toBe('CONTINUATION_CLEAR');
    expect(ev.evidenceComplete).toBe(true);
    // 0120 HİÇ sorulmadı — "cevap gelmedi" ile karıştırılmamalı.
    expect(ev.blocks[1]!.attempted).toBe(false);
    expect(ev.blocks[1]!.outcome).toBe('NOT_ATTEMPTED');
  });

  it('continuation SET + 0120 OK → blok 20 PID’leri destek setine GİRER', () => {
    const r = buildHandshakeResult(raw({
      raw0100: BLOCK00_SET, raw0120: BLOCK20_OK,
      blockAttempts: [1, 1, 0, 0, 0, 0], failedBlockIndex: -1,
    }));
    expect(r.completeness).toBe('complete');
    expect(r.readBlocks.has(0x20)).toBe(true);
    expect(r.supportedPids.has(0x21)).toBe(true);   // 0120 SONUCU yansıdı
    expect(r.supportedPids.size).toBe(18);          // 16 (+0x20 bayrağı) + 0x21

    const ev = buildDiscoveryEvidence(raw({ raw0100: BLOCK00_SET, raw0120: BLOCK20_OK }));
    expect(ev.blocks[0]!.continuation).toBe('SET');
    expect(ev.blocks[0]!.nextBlockAttempted).toBe(true);
    expect(ev.blocks[1]!.outcome).toBe('OK');
    expect(ev.finalStopReason).toBe('CONTINUATION_CLEAR');
  });

  it('continuation SET + blok YENİDEN DENENİP başarılı → keşif yine TAM', () => {
    // İlk deneme cevapsız, ikinci deneme OK → native `attempts[1] = 2` taşır.
    const r = buildHandshakeResult(raw({
      raw0100: BLOCK00_SET, raw0120: BLOCK20_OK,
      blockAttempts: [1, 2, 0, 0, 0, 0], failedBlockIndex: -1,
    }));
    expect(r.completeness).toBe('complete');
    expect(r.attemptedBlocks.has(0x20)).toBe(true);
    expect(r.supportedPids.has(0x21)).toBe(true);
  });

  it('continuation SET ama 0120 CEVAPSIZ → keşif EKSİK; 15/16 TAVAN SAYILAMAZ', () => {
    const r = buildHandshakeResult(raw({
      raw0100: BLOCK00_SET, raw0120: '',
      blockAttempts: [1, 2, 0, 0, 0, 0], failedBlockIndex: 1,
    }));
    expect(r.completeness).toBe('incomplete');
    expect(r.failedBlock).toBe('20');
    // DENENDİ ama OKUNAMADI — iki küme AYRI olmalı, yoksa "hiç sorulmadı" ile karışır.
    expect(r.attemptedBlocks.has(0x20)).toBe(true);
    expect(r.readBlocks.has(0x20)).toBe(false);
    // ÖNCEKİ BLOĞUN KAZANIMI KAYBOLMAZ (yarım zincir sıfırlanmaz).
    expect(r.supportedPids.has(0x01)).toBe(true);
    expect(r.supportedPids.size).toBeGreaterThan(0);
  });

  it('hiç blok okunmadı → not_run (bu bir "araç 0 PID destekliyor" İDDİASI DEĞİLDİR)', () => {
    const r = buildHandshakeResult(raw({ raw0100: '', blockAttempts: [0, 0, 0, 0, 0, 0], failedBlockIndex: -1 }));
    expect(r.completeness).toBe('not_run');
    expect(r.supportedPids.size).toBe(0);
  });
});

describe('P0-OBD-CORE-06 · B/C — kapı: watched ≠ configured, tavan daraltmıyor', () => {
  beforeEach(() => {
    _obdInternals.clearExtraPidWatches();
    extInternals.reset();
  });
  afterEach(() => {
    _obdInternals.clearExtraPidWatches();
    extInternals.reset();
  });

  /** Kayıtta çözülebilen, core OLMAYAN PID'ler (native listeye girebilecek olanlar). */
  const NON_CORE = [...STANDARD_PID_MAP.values()].filter((d) => !d.core).map((d) => d.pid);

  it('tavan daralmanın nedeni DEĞİL: 30+ destekli PID → native liste 8’i AŞAR', () => {
    const first30 = NON_CORE.slice(0, 30);
    for (const pid of first30) watchPid(pid, () => { /* izleyici */ });
    seedSupportedPids(first30.map((p) => parseInt(p, 16)), 'complete');

    const list = extInternals.buildNativeList();
    /* Liste = keşif kuyruğu + izlenenler. Sahadaki `nativeListCount = 8`
       de bu toplamdır — kuyruk payı ayrılmadan "8 PID okuyoruz" denemez. */
    const pending = getExtendedGateState().discoveryPending;
    expect(list.length - pending).toBe(30);
    expect(list.length - pending).toBeGreaterThan(8);
    // Tavan gerçekten kayıt boyutudur — 16'lık eski tavana GERİ DÖNÜLMEDİ.
    expect(ELM_WATCH_CAP).toBeGreaterThanOrEqual(30);
  });

  it('watched > configured: 94 izleyici "94 PID okuyoruz" DEMEK DEĞİLDİR', () => {
    for (const pid of NON_CORE) watchPid(pid, () => { /* Canlı Test deseni */ });
    // Araç yalnız 8 non-core PID destekliyor (sahadaki gerçek oran).
    const supported = NON_CORE.slice(0, 8).map((p) => parseInt(p, 16));
    seedSupportedPids(supported, 'complete');

    const g = getExtendedGateState();
    expect(g.watchedCount).toBe(NON_CORE.length);
    expect(g.nativeListCount - g.discoveryPending).toBe(8);
    expect(g.gatedCount).toBe(NON_CORE.length - 8);
    expect(g.supportedKnown).toBe(true);
    // Kanıt TAM olduğu için "araç desteklemiyor" hükmü BU DURUMDA meşrudur.
    expect(g.supportedEvidenceComplete).toBe(true);
  });

  it('keşif EKSİKken kapı "desteklemiyor" DEMEZ — bütünlük ayrı taşınır', () => {
    for (const pid of NON_CORE.slice(0, 20)) watchPid(pid, () => {});
    seedSupportedPids(NON_CORE.slice(0, 5).map((p) => parseInt(p, 16)), 'incomplete');

    const g = getExtendedGateState();
    expect(g.supportedKnown).toBe(true);          // kanıt VAR
    expect(g.supportedEvidenceComplete).toBe(false); // ama TAM DEĞİL
    expect(g.discoveryCompleteness).toBe('incomplete');
    expect(g.gatedCount).toBe(15);                // 15 PID'in durumu BİLİNMİYOR
  });

  it('bütünlük YALNIZ yukarı gider: TAM kanıt sonradan EKSİĞE düşürülemez', () => {
    seedSupportedPids([0x04], 'complete');
    seedSupportedPids([0x10], 'incomplete');
    expect(getExtendedGateState().discoveryCompleteness).toBe('complete');
  });

  it('configured PID zaman içinde callback ÜRETİR (zincirin son halkası)', () => {
    const seen: number[] = [];
    watchPid('04', (v) => seen.push(v.value));          // motor yükü
    seedSupportedPids([0x04], 'complete');

    expect(extInternals.buildNativeList()).toContain('04');
    // Native'den iki ayrı tur değeri gelir (0x00 → %0, 0xFF → %100).
    extInternals.onExtendedData({ pid: '04', data: '00' });
    extInternals.onExtendedData({ pid: '04', data: 'FF' });

    expect(seen.length).toBe(2);
    expect(seen[0]).toBeCloseTo(0, 5);
    expect(seen[1]).toBeCloseTo(100, 1);
  });

  it('kanıt YOKKEN kapı FAIL-CLOSED kalır (regresyon kilidi #503)', () => {
    for (const pid of NON_CORE.slice(0, 12)) watchPid(pid, () => {});
    const g = getExtendedGateState();
    expect(g.supportedKnown).toBe(false);
    expect(g.discoveryCompleteness).toBe('not_run');
    // Keşif kuyruğu dışında tek PID bile tele gitmez.
    expect(extInternals.buildNativeList()).toEqual(extInternals.getDiscoveryQueue());
  });
});
