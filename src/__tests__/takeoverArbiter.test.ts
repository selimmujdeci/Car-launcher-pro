/**
 * takeoverArbiter.test.ts — MAVİ ÇEKİRDEĞİ Faz-3 · MAVI3-4a.
 *
 * KİLİTLENEN DAVRANIŞLAR:
 *  - Varsayılan KAPALI + fail-open (hakem asla eski hattı susturmaz).
 *  - Sahiplik dörtlü kimliğe bağlı (generation/session/commandId/actionId) — salt komut adına DEĞİL.
 *  - Bayat kuşak hiçbir koşulda sahiplik kazanamaz.
 *  - Aynı tur + aynı komut → dedup; FARKLI kuşakta aynı komut → yeniden sahiplenebilir.
 *  - Sahiplik TUR-KAPSAMLI: completion/cancel/stale/timeout/supersede ile OTOMATİK serbest kalır
 *    (doğruluk dispose'a bağlı değil).
 *  - Allowlist dışı ve araç (hard-forbidden) eylemler hiçbir config ile Mavi-owned OLAMAZ.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTakeoverPolicy } from '../platform/maviCore/wiring/takeoverPolicy';
import {
  createTakeoverArbiter,
  getTakeoverArbiter,
  _resetTakeoverArbiterForTest,
  type TakeoverArbiter,
  type TakeoverOwnershipKey,
} from '../platform/maviCore/wiring/takeoverArbiter';

/* ── Yardımcılar ─────────────────────────────────────────── */

let _clock = 0;
const now = (): number => _clock;

function makeKey(over: Partial<TakeoverOwnershipKey> = {}): TakeoverOwnershipKey {
  return {
    generationId: 1,
    sessionId: 1,
    commandId: 'cmd-1',
    actionId: 'media.next',
    ...over,
  };
}

const TAKEOVER = createTakeoverPolicy({ mode: 'takeover' });
const SHADOW = createTakeoverPolicy({ mode: 'shadow' });

function makeArbiter(ttlMs = 15_000): TakeoverArbiter {
  return createTakeoverArbiter({ now, turnTtlMs: ttlMs });
}

beforeEach(() => {
  _clock = 0;
  _resetTakeoverArbiterForTest();
});

/* ── 1. Varsayılan kapalı + fail-open ────────────────────── */

describe('takeoverArbiter — varsayılan kapalı / fail-open', () => {
  it('etkinleştirilmemiş hakem hiçbir komutu sahiplenmez (eski hat çalışır)', () => {
    const a = makeArbiter();
    expect(a.active).toBe(false);
    expect(a.isMaviOwned(makeKey())).toBe(false);
    expect(a.claim(makeKey())).toBe('inactive');
  });

  it('SHADOW politikası sahiplik ÜRETMEZ (mevcut davranış birebir korunur)', () => {
    const a = makeArbiter();
    a.activate(SHADOW);
    expect(a.active).toBe(false);
    expect(a.isMaviOwned(makeKey())).toBe(false);
    expect(a.claim(makeKey())).toBe('inactive');
  });

  it('geçersiz anahtar (boş commandId / negatif kuşak / NaN) sahiplik kazanamaz', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    expect(a.isMaviOwned(makeKey({ commandId: '' }))).toBe(false);
    expect(a.isMaviOwned(makeKey({ generationId: -1 }))).toBe(false);
    expect(a.isMaviOwned(makeKey({ sessionId: Number.NaN }))).toBe(false);
    expect(a.claim(makeKey({ commandId: '' }))).toBe('not-eligible');
  });

  it('politika KENDİSİ hata atsa bile karar false döner — eski hat SUSTURULMAZ', () => {
    const a = makeArbiter();
    a.activate({
      mode: 'takeover',
      allowlist: new Set(['media.next']),
      shouldTakeover: () => { throw new Error('politika patladı'); },
      isEligible: () => true,
    });
    expect(a.isMaviOwned(makeKey())).toBe(false);   // fail-open
    expect(a.claim(makeKey())).toBe('inactive');    // fail-open
  });

  it('deactivate sonrası karar tekrar eski hatta döner', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    expect(a.isMaviOwned(makeKey())).toBe(true);
    a.deactivate();
    expect(a.isMaviOwned(makeKey())).toBe(false);
    a.deactivate(); // idempotent
    expect(a.active).toBe(false);
  });
});

/* ── 2. Sıra-bağımsızlık (R1/R2 kilidi) ──────────────────── */

describe('takeoverArbiter — sıra-bağımsız senkron karar', () => {
  it('claim ÖNCE veya SONRA sorulsun, iki hat da AYNI cevabı alır', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    const key = makeKey();

    // Eski hat Mavi claim etmeden ÖNCE sorarsa:
    const beforeClaim = a.isMaviOwned(key);
    a.claim(key);
    // Eski hat claim'den SONRA sorarsa:
    const afterClaim = a.isMaviOwned(key);

    expect(beforeClaim).toBe(true);
    expect(afterClaim).toBe(true); // karar claim'e DEĞİL saf politikaya bağlı
  });
});

/* ── 3. Bayat kuşak reddi ────────────────────────────────── */

describe('takeoverArbiter — stale generation', () => {
  it('daha yeni kuşak görüldükten sonra ESKİ kuşak sahiplik kazanamaz', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    a.observeGeneration(5, 5);

    const oldKey = makeKey({ generationId: 3, sessionId: 3 });
    expect(a.isMaviOwned(oldKey)).toBe(false);
    expect(a.claim(oldKey)).toBe('stale');
    expect(a.stats().staleRejected).toBe(1);
  });

  it('barge-in: yeni kuşak gelince AÇIK tur otomatik stale serbest bırakılır (dispose beklenmez)', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    const key = makeKey({ generationId: 2, sessionId: 2 });
    expect(a.claim(key)).toBe('claimed');
    expect(a.currentOwner()?.key.generationId).toBe(2);

    a.observeGeneration(3, 3); // kullanıcı araya girdi → yeni wake

    expect(a.currentOwner()).toBeNull();       // sahiplik OTOMATİK bırakıldı
    expect(a.release(key, 'completed')).toBe(false); // geç gelen release yeni durumu ezmez
  });

  it('bayat turun geç gelen release çağrısı YENİ turu ezmez', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    const oldKey = makeKey({ generationId: 1, sessionId: 1, commandId: 'c1' });
    const newKey = makeKey({ generationId: 2, sessionId: 2, commandId: 'c2' });

    a.claim(oldKey);
    a.claim(newKey);                                   // supersede
    expect(a.release(oldKey, 'completed')).toBe(false); // eşleşmeyen anahtar → no-op
    expect(a.currentOwner()?.key.commandId).toBe('c2'); // yeni tur AYAKTA
  });
});

/* ── 4. Dedup: aynı kuşak vs farklı kuşak ────────────────── */

describe('takeoverArbiter — dedup kimliği', () => {
  it('AYNI tur + AYNI komut ikinci kez claim edilemez (çifte yürütme yok)', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    const key = makeKey();
    expect(a.claim(key)).toBe('claimed');
    expect(a.claim(key)).toBe('duplicate');
    expect(a.claim({ ...key })).toBe('duplicate'); // nesne kimliği değil, DEĞER eşitliği
    expect(a.stats().claimed).toBe(1);
    expect(a.stats().duplicates).toBe(2);
  });

  it('FARKLI kuşakta AYNI komut yeniden sahiplenilebilir (yanlış dedup YOK)', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    const first = makeKey({ generationId: 1, sessionId: 1, commandId: 'sonraki-sarki' });
    expect(a.claim(first)).toBe('claimed');
    a.release(first, 'completed');

    // Kullanıcı aynı komutu YENİ turda tekrar söyledi:
    const second = makeKey({ generationId: 2, sessionId: 2, commandId: 'sonraki-sarki' });
    expect(a.isMaviOwned(second)).toBe(true);
    expect(a.claim(second)).toBe('claimed');
    expect(a.stats().claimed).toBe(2);
  });

  it('aynı kuşakta FARKLI commandId ayrı turdur (komut zinciri)', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    expect(a.claim(makeKey({ commandId: 'c1' }))).toBe('claimed');
    expect(a.claim(makeKey({ commandId: 'c2' }))).toBe('claimed'); // supersede, duplicate DEĞİL
    expect(a.stats().superseded).toBe(1);
  });
});

/* ── 5. Tur-kapsamlı yaşam döngüsü ───────────────────────── */

describe('takeoverArbiter — sahiplik tur-kapsamlı (kalıcı global sahiplik YOK)', () => {
  it.each([
    ['completed'], ['error'], ['cancelled'], ['timeout'], ['stale'], ['superseded'], ['disposed'],
  ] as const)('release(%s) sahipliği serbest bırakır ve İDEMPOTENTtir', (reason) => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    const key = makeKey();
    a.claim(key);
    expect(a.release(key, reason)).toBe(true);
    expect(a.currentOwner()).toBeNull();
    expect(a.release(key, reason)).toBe(false); // ikinci çağrı zararsız
  });

  it('TTL dolunca sahiplik TIMER OLMADAN tembel düşer (kalıcı kilit yok)', () => {
    const a = makeArbiter(10_000);
    a.activate(TAKEOVER);
    const key = makeKey();
    a.claim(key);
    expect(a.currentOwner()).not.toBeNull();

    _clock = 10_001; // tur asla kapanmadı (çökme/askıda kalma)
    expect(a.currentOwner()).toBeNull();
    expect(a.stats().timedOut).toBe(1);
  });

  it('saat GERİ giderse sahiplik yanlışlıkla düşmez (clock-jump güvenli)', () => {
    const a = makeArbiter(10_000);
    a.activate(TAKEOVER);
    _clock = 5_000;
    a.claim(makeKey());
    _clock = 1_000; // sistem saati geri sıçradı
    expect(a.currentOwner()).not.toBeNull();
  });

  it('activate(yeni politika) açık turu bırakır — sahiplik politikayı aşmaz', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    a.claim(makeKey());
    a.activate(createTakeoverPolicy({ mode: 'takeover' }));
    expect(a.currentOwner()).toBeNull();
  });

  it('deactivate açık turu bırakır (dispose güvenlik ağı — sızıntı yok)', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    a.claim(makeKey());
    a.deactivate();
    expect(a.currentOwner()).toBeNull();
    expect(a.stats().mode).toBe('inactive');
  });
});

/* ── 6. Allowlist + hard-forbidden (savunma derinliği) ───── */

describe('takeoverArbiter — allowlist ve hard-forbidden', () => {
  it('yalnız media.next Mavi-owned olabilir', () => {
    const a = makeArbiter();
    a.activate(TAKEOVER);
    expect(a.isMaviOwned(makeKey({ actionId: 'media.next' }))).toBe(true);
    for (const id of ['media.play', 'media.pause', 'ui.theme.set', 'navigation.open', 'navigation.cancel']) {
      expect(a.isMaviOwned(makeKey({ actionId: id }))).toBe(false);
      expect(a.claim(makeKey({ actionId: id }))).toBe('not-eligible');
    }
  });

  it('config allowlist\'e araç/ECU eylemi koysa bile Mavi-owned OLAMAZ (hard-forbidden)', () => {
    const a = makeArbiter();
    a.activate(createTakeoverPolicy({
      mode: 'takeover',
      allowlist: ['media.next', 'vehicle.health.read', 'ecu.write', 'coding.apply', 'actuator.test', 'dtc.clear'],
    }));
    for (const id of ['vehicle.health.read', 'ecu.write', 'coding.apply', 'actuator.test', 'dtc.clear']) {
      expect(a.isMaviOwned(makeKey({ actionId: id }))).toBe(false);
      expect(a.claim(makeKey({ actionId: id }))).toBe('not-eligible');
    }
    expect(a.isMaviOwned(makeKey({ actionId: 'media.next' }))).toBe(true);
  });
});

/* ── 7. Tekil hakem (iki hattın ortak noktası) ───────────── */

describe('takeoverArbiter — modül tekil örneği', () => {
  it('import yan etkisi YOK: tekil hakem varsayılan PASİF gelir', () => {
    expect(getTakeoverArbiter().active).toBe(false);
    expect(getTakeoverArbiter().isMaviOwned(makeKey())).toBe(false);
  });

  it('aynı örneği döner (eski hat ile wiring ORTAK karar noktasını paylaşır)', () => {
    expect(getTakeoverArbiter()).toBe(getTakeoverArbiter());
  });

  it('_resetTakeoverArbiterForTest hakemi pasifleştirir (test izolasyonu)', () => {
    getTakeoverArbiter().activate(TAKEOVER);
    expect(getTakeoverArbiter().active).toBe(true);
    _resetTakeoverArbiterForTest();
    expect(getTakeoverArbiter().active).toBe(false);
  });
});
