/**
 * pidDiscoveryIntegrity.test.ts — P0-OBD-CORE-01B · SUPPORTED PID DISCOVERY BÜTÜNLÜĞÜ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN ŞÜPHE: sahada `supportedCount ≈ 15`. Bu sayı İKİ TAMAMEN FARKLI
 * gerçeğin AYNI görünümüydü:
 *
 *   (a) ECU gerçekten yalnız ilk bloğu destekliyor   → `0100` continuation = 0
 *   (b) CarOS keşfi ilk blokta KIRILDI               → `0120` timeout / NO DATA
 *
 * KÖK: `ElmProtocol.performHandshakeRaw` içinde
 *        raws[i] = runner.run(() -> handshakeBitmapRaw(block));
 *        if (!handshakeHasContinuation(raws[i], block)) break;
 *      `handshakeBitmapRaw` → `safeSend` İSTİSNAYI YUTUP `""` döner;
 *      `hasContinuationBit("")` FAIL-CLOSED **false** → zincir SESSİZCE biter.
 *      Yani `0100`ün continuation biti 1 OLSA BİLE tek timeout keşfi bitiriyordu
 *      ve ürün "araç 15 PID destekliyor" diye KANITSIZ bir iddia üretiyordu.
 *
 * BU DOSYA (a) ile (b)'nin bir daha karışmamasını KİLİTLER.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';

import {
  buildHandshakeResult, buildDiscoveryEvidence, classifyHandshakeResponse,
  type RawHandshake,
} from '../core/val/OBDHandshake';

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

/** `41 <blk> A B C D` — son bayt bit0 = continuation. */
function blk(pid: string, a: number, b: number, c: number, d: number): string {
  const h = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  return `41 ${pid} ${h(a)} ${h(b)} ${h(c)} ${h(d)}`;
}
const VIN = '49 02 01 00 00 00 00';

function raw(over: Partial<RawHandshake>): RawHandshake {
  return { raw09: VIN, raw0100: '', ...over };
}

/* ═══════════════════════════════════════════════════════════════════════════
   A) CONTINUATION KARARI — "bitti" ile "kırıldı" AYRI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-CORE-01B · A) continuation', () => {
  it('🔒 A1 — 0100 continuation = 0 → zincir NORMAL biter, keşif TAM', () => {
    const r = raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x10),   // bit0 = 0
      blockAttempts: [1, 0, 0, 0, 0, 0], failedBlockIndex: -1,
    });
    const res = buildHandshakeResult(r);
    expect(res.completeness).toBe('complete');
    expect(res.failedBlock).toBeNull();
    expect(res.readBlocks.has(0x00)).toBe(true);
    expect(res.readBlocks.has(0x20)).toBe(false);
    // Bu durumda "araç yalnız ilk bloğu destekliyor" demek GÜVENLİDİR.
    expect(buildDiscoveryEvidence(r).finalStopReason).toBe('CONTINUATION_CLEAR');
  });

  it('🔒 A2 — 0100 continuation = 1 + 0120 OK → iki blok da okunur', () => {
    const r = raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x11),   // bit0 = 1
      raw0120: blk('20', 0x80, 0x00, 0x00, 0x00),   // bit0 = 0 → normal bitiş
      blockAttempts: [1, 1, 0, 0, 0, 0], failedBlockIndex: -1,
    });
    const res = buildHandshakeResult(r);
    expect(res.completeness).toBe('complete');
    expect(res.readBlocks.has(0x00)).toBe(true);
    expect(res.readBlocks.has(0x20)).toBe(true);
    expect(res.supportedPids.size).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) KIRILMA — cevapsızlık "destek yok" SAYILMAZ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-CORE-01B · B) kırılma', () => {
  it('🔒 B1 — ANA KİLİT: 0120 SÜREKLİ timeout → keşif EKSİK, "15 PID" İDDİA EDİLEMEZ', () => {
    /* Sahadaki tam senaryo: 0100 continuation=1 ama 0120 boş dönüyor.
       ESKİ davranış: sessizce bit, supportedCount = 15, "tam" görün.
       YENİ: completeness 'incomplete' + failedBlock '20'. */
    const r = raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x11),   // continuation SET
      raw0120: '',                                   // timeout — denendi ama boş
      blockAttempts: [1, 2, 0, 0, 0, 0],             // 0120 İKİ KEZ denendi
      failedBlockIndex: 1,
    });
    const res = buildHandshakeResult(r);

    expect(res.completeness).toBe('incomplete');
    expect(res.failedBlock).toBe('20');
    // ÖNCEKİ BLOĞUN DESTEĞİ KAYBOLMADI:
    expect(res.readBlocks.has(0x00)).toBe(true);
    expect(res.supportedPids.size).toBeGreaterThan(0);
    // 0120 DENENDİ ama OKUNAMADI — iki küme AYRI:
    expect(res.attemptedBlocks.has(0x20)).toBe(true);
    expect(res.readBlocks.has(0x20)).toBe(false);
    // Kanıt da "kesin durma" DEMEZ:
    expect(buildDiscoveryEvidence(r).evidenceComplete).toBe(false);
  });

  it('🔒 B2 — KİLİT: 0120 İLK denemede timeout, RETRY’de OK → keşif TAM', () => {
    /* Native retry başarılı olduğunda ham alan DOLU gelir ve zincir devam eder.
       `blockAttempts[1] === 2` retry’nin gerçekten koştuğunun kanıtıdır. */
    const r = raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x11),
      raw0120: blk('20', 0xA0, 0x07, 0xB1, 0x10),   // retry’de geldi, bit0 = 0
      blockAttempts: [1, 2, 0, 0, 0, 0], failedBlockIndex: -1,
    });
    const res = buildHandshakeResult(r);
    expect(res.completeness).toBe('complete');
    expect(res.failedBlock).toBeNull();
    expect(res.readBlocks.has(0x20)).toBe(true);
    expect(r.blockAttempts?.[1]).toBe(2);   // retry ÖLÇÜLDÜ
  });

  it('🔒 B3 — KİLİT: NO DATA → "desteklenmiyor" DEĞİL, EKSİK', () => {
    const r = raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x11),
      raw0120: 'NO DATA',
      blockAttempts: [1, 2, 0, 0, 0, 0], failedBlockIndex: 1,
    });
    const res = buildHandshakeResult(r);
    expect(res.completeness).toBe('incomplete');
    expect(classifyHandshakeResponse('NO DATA', '41', '20')).toBe('no_data');
    // NO DATA açık negatif yanıt DEĞİLDİR:
    expect(classifyHandshakeResponse('NO DATA', '41', '20')).not.toBe('unsupported');
    expect(buildDiscoveryEvidence(r).blocks[1]!.outcome).toBe('NO_DATA');
  });

  it('🔒 B4 — KİLİT: MALFORMED bitmap (başlık var, 4 bayt yok) → EKSİK, kod UYDURULMAZ', () => {
    const r = raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x11),
      raw0120: '41 20 A0 07',                       // yalnız 2 bayt
      blockAttempts: [1, 2, 0, 0, 0, 0], failedBlockIndex: 1,
    });
    const res = buildHandshakeResult(r);
    expect(res.completeness).toBe('incomplete');
    expect(res.readBlocks.has(0x20)).toBe(false);
    const ev = buildDiscoveryEvidence(r);
    expect(ev.blocks[1]!.outcome).toBe('PARSE_ERROR');
    expect(ev.blocks[1]!.bitmapBytes).toBeNull();
    expect(ev.evidenceComplete).toBe(false);
  });

  it('🔒 B5 — KİLİT: PARTIAL yanıt (yarım bayt akışı) TIMEOUT_PARTIAL olarak ayrılır', () => {
    const r = raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x11),
      raw0120: '41',                                 // yarım
      blockAttempts: [1, 2, 0, 0, 0, 0], failedBlockIndex: 1,
    });
    const ev = buildDiscoveryEvidence(r);
    expect(ev.blocks[1]!.outcome).toBe('TIMEOUT_PARTIAL');
    expect(ev.blocks[1]!.outcome).not.toBe('NO_DATA');
    expect(buildHandshakeResult(r).completeness).toBe('incomplete');
  });

  it('🔒 B6 — KİLİT: NEGATİF yanıt (7F 01) → araç bu bloğu BİLMİYOR, ayrı sınıf', () => {
    expect(classifyHandshakeResponse('7F 01 12', '41', '20')).toBe('unsupported');
    expect(classifyHandshakeResponse('7F 01 12', '41', '20')).not.toBe('no_data');
    expect(classifyHandshakeResponse('7F 01 12', '41', '20')).not.toBe('timeout');
  });

  it('🔒 B7 — KİLİT: dört sınıf BİRBİRİNE eşit DEĞİL', () => {
    const seen = new Set([
      classifyHandshakeResponse('',          '41', '20'),   // timeout
      classifyHandshakeResponse('NO DATA',   '41', '20'),   // no_data
      classifyHandshakeResponse('7F 01 12',  '41', '20'),   // unsupported
      classifyHandshakeResponse('CAN ERROR', '41', '20'),   // error
    ]);
    expect(seen.size).toBe(4);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) DÜRÜSTLÜK — hiç çalışmama / eski oturum / reconnect
   ═══════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-CORE-01B · C) dürüstlük', () => {
  it('🔒 C1 — KİLİT: hiç blok okunmadı → not_run (0 PID "temiz" DEMEK DEĞİL)', () => {
    const r = raw({ raw0100: '', blockAttempts: [0, 0, 0, 0, 0, 0], failedBlockIndex: -1 });
    const res = buildHandshakeResult(r);
    expect(res.completeness).toBe('not_run');
    expect(res.supportedPids.size).toBe(0);
    expect(res.readBlocks.size).toBe(0);
  });

  it('🔒 C2 — KİLİT: 0100 denendi ama boş → not_run DEĞİL, EKSİK', () => {
    const r = raw({ raw0100: '', blockAttempts: [2, 0, 0, 0, 0, 0], failedBlockIndex: 0 });
    const res = buildHandshakeResult(r);
    expect(res.completeness).toBe('incomplete');
    expect(res.failedBlock).toBe('00');
    expect(res.attemptedBlocks.has(0x00)).toBe(true);
  });

  it('🔒 C3 — KİLİT: ESKİ PLUGIN (alan yok) → kanıttan türetilir, "tam" UYDURULMAZ', () => {
    /* Geri-uyumluluk: `blockAttempts`/`failedBlockIndex` taşınmıyor. Bu durumda
       fail-closed davranmalı — continuation SET olup sonraki blok yoksa EKSİK. */
    const rBroken: RawHandshake = {
      raw09: VIN,
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x11),   // continuation SET
      raw0120: '',                                   // ama yanıt yok
    };
    expect(buildHandshakeResult(rBroken).completeness).toBe('incomplete');

    const rClean: RawHandshake = {
      raw09: VIN,
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x10),   // continuation CLEAR
    };
    expect(buildHandshakeResult(rClean).completeness).toBe('complete');
  });

  it('🔒 C4 — KİLİT: RECONNECT sonrası keşif SIFIRDAN kurulur (taşıma yok)', () => {
    /* Her `buildHandshakeResult` yalnız KENDİ girdisinden üretilir; modül durumu
       YOKTUR → önceki oturumun sonucu yeni sonuca SIZAMAZ. */
    const first = buildHandshakeResult(raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x11),
      raw0120: blk('20', 0xA0, 0x07, 0xB1, 0x10),
      blockAttempts: [1, 1, 0, 0, 0, 0], failedBlockIndex: -1,
    }));
    expect(first.readBlocks.size).toBe(2);

    const second = buildHandshakeResult(raw({
      raw0100: '', blockAttempts: [2, 0, 0, 0, 0, 0], failedBlockIndex: 0,
    }));
    expect(second.readBlocks.size).toBe(0);
    expect(second.supportedPids.size).toBe(0);
    expect(second.completeness).toBe('incomplete');
    // İlk sonuç DEĞİŞMEDİ (paylaşılan durum yok).
    expect(first.readBlocks.size).toBe(2);
  });

  it('🔒 C5 — ANA KİLİT: "15 PID" iki farklı completeness ile ÇIKABİLİR', () => {
    /* Bu testin varlık sebebi: AYNI supportedCount, TAMAMEN FARKLI anlam.
       Sayıya bakıp hüküm vermek YASAK; completeness ZORUNLU. */
    const ecuGercektenDar = raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x10),   // continuation CLEAR
      blockAttempts: [1, 0, 0, 0, 0, 0], failedBlockIndex: -1,
    });
    const carosKirildi = raw({
      raw0100: blk('00', 0xBE, 0x3F, 0xA8, 0x11),   // continuation SET
      raw0120: '',
      blockAttempts: [1, 2, 0, 0, 0, 0], failedBlockIndex: 1,
    });

    const a = buildHandshakeResult(ecuGercektenDar);
    const b = buildHandshakeResult(carosKirildi);

    /* Sayılar neredeyse AYNI (fark yalnız continuation biti = PID 0x20'nin
       kendisi). Yani ekranda "16 PID" ile "17 PID" görülür — kullanıcı ikisini
       ayırt EDEMEZ. Ayrımı yapan tek şey `completeness`tir. */
    expect(b.supportedPids.size).toBe(a.supportedPids.size + 1);
    /* KIRIK durumda ECU 0x20'yi DESTEKLİ BİLDİRDİ ama o blok HİÇ okunamadı →
       0x21-0x40 aralığı BİLİNMİYOR. "Araç desteklemiyor" demek yalan olurdu. */
    expect(b.supportedPids.has(0x20)).toBe(true);
    expect(b.readBlocks.has(0x20)).toBe(false);
    // Hüküm ZITTIR.
    expect(a.completeness).toBe('complete');
    expect(b.completeness).toBe('incomplete');
    expect(a.failedBlock).toBeNull();
    expect(b.failedBlock).toBe('20');
  });
});
