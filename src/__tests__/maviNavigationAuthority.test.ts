/**
 * maviNavigationAuthority.test.ts — serbest adres navigasyonunda TEK YÜRÜTME OTORİTESİ.
 *
 * ── REPO GERÇEĞİ (bu testler kanıtlar, iddia etmez) ─────────────────────────
 * `navigate_address` / `navigate_place` için:
 *  · `defaultPilotCommandMap` ZATEN `navigation.open` üretiyor (maviVoiceBridge.ts).
 *  · Eski hattaki serbest-adres bloğu, Mavi sahiplendiğinde ZATEN ulaşılamaz
 *    (`useVoiceCommandHandler.ts` — `isCommandOwnedByMavi` erken return, blok ondan SONRA).
 *  · Bugün `navigation.open` takeover-eligible DEĞİL (`TAKEOVER_ELIGIBLE = {media.next}`)
 *    → Mavi bu komutu sahiplenmez, eski hat çalışır ve TEK yürütme olur.
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  1. Mavi sahiplendiğinde eski hat resolveAndNavigate ÇAĞIRMAZ.
 *  2. Aynı komut köprüde `navigation.open` + gerçek destination'a çözülür.
 *  3. Hedef boş/boşlukken navigasyon HİÇ başlamaz (fail-closed — bu turda eklendi).
 *  4. Mavi'nin sahiplenmediği diğer navigasyon komutları BOZULMAZ.
 *  5. Tek girdi → TEK navigation execution (çifte yürütme yok).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultPilotCommandMap, type ParsedCommandLike,
} from '../platform/maviCore/wiring/maviVoiceBridge';
import {
  isCommandOwnedByMavi, setMaviOwnershipResolver, _resetMaviOwnershipForTest,
} from '../platform/maviCore/wiring/maviOwnership';
import { createTakeoverArbiter } from '../platform/maviCore/wiring/takeoverArbiter';
import { createTakeoverPolicy, TAKEOVER_ELIGIBLE } from '../platform/maviCore/wiring/takeoverPolicy';

const ADDR: ParsedCommandLike = {
  type: 'navigate_address', raw: 'Atatürk Caddesi 5\'e git',
  extra: { destination: 'Atatürk Caddesi 5' },
};
const PLACE: ParsedCommandLike = {
  type: 'navigate_place', raw: 'Mersin Şehir Hastanesi\'ne git',
  extra: { destination: 'Mersin Şehir Hastanesi' },
};

beforeEach(() => { _resetMaviOwnershipForTest(); });

/* ── 2. Köprü eşlemesi ──────────────────────────────────────── */

describe('defaultPilotCommandMap — serbest adres → navigation.open', () => {
  it('navigate_address / navigate_place gerçek destination ile navigation.open olur', () => {
    expect(defaultPilotCommandMap(ADDR)).toEqual({
      actionId: 'navigation.open', payload: { destination: 'Atatürk Caddesi 5' },
    });
    expect(defaultPilotCommandMap(PLACE)).toEqual({
      actionId: 'navigation.open', payload: { destination: 'Mersin Şehir Hastanesi' },
    });
  });

  it('destination yoksa ham metne düşer (gerçek payload biçimi)', () => {
    const noExtra: ParsedCommandLike = { type: 'navigate_address', raw: 'Konya\'ya git' };
    expect(defaultPilotCommandMap(noExtra)).toEqual({
      actionId: 'navigation.open', payload: { destination: 'Konya\'ya git' },
    });
  });

  /* 3 — hedef HİÇ yoksa köprü eşleme ÜRETMEZ → Mavi bu komutu sahiplenemez. */
  it('hedef tamamen boşsa eşleme null (fail-closed — Mavi sahiplenemez)', () => {
    expect(defaultPilotCommandMap({ type: 'navigate_address', raw: '' })).toBeNull();
    expect(defaultPilotCommandMap({ type: 'navigate_place', extra: { destination: '' } })).toBeNull();
  });
});

/* ── 1 + 5. Sahiplik → eski hat susar, tek yürütme ──────────── */

describe('sahiplik guard\'ı — tek yürütme otoritesi', () => {
  /** Eski hattın karar noktasının BİREBİR aynısı (useVoiceCommandHandler.ts:267). */
  function legacyLine(cmd: ParsedCommandLike, navigate: () => void): void {
    if (isCommandOwnedByMavi(cmd)) return;
    if (cmd.type === 'navigate_address' || cmd.type === 'navigate_place') navigate();
  }

  function wireOwnership(allowlist: readonly string[], mode: 'shadow' | 'takeover') {
    const arbiter = createTakeoverArbiter();
    const policy = createTakeoverPolicy({ mode, allowlist });
    arbiter.activate(policy);
    setMaviOwnershipResolver({
      mapCommand: defaultPilotCommandMap,
      identity: () => ({ generationId: 1, sessionId: 1 }),
      arbiter,
    });
    return arbiter;
  }

  it('Mavi sahiplendiğinde eski hat resolveAndNavigate ÇAĞIRMAZ (tek yürütme)', () => {
    // navigation.open bugün eligible DEĞİL → sahipliği doğrudan hakemden zorlarız
    // (politikadan bağımsız olarak guard sözleşmesinin kendisini kilitler).
    const arbiter = wireOwnership(['media.next'], 'takeover');
    const owned = vi.spyOn(arbiter, 'isMaviOwned').mockReturnValue(true);

    const navigate = vi.fn();
    legacyLine(ADDR, navigate);

    expect(owned).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();   // ← eski hat SUSTU
    owned.mockRestore();
  });

  it('Mavi sahiplenmediğinde eski hat TAM 1 kez çalışır (fail-open, çifte yürütme YOK)', () => {
    wireOwnership(['media.next'], 'shadow');
    const navigate = vi.fn();
    legacyLine(ADDR, navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('wiring hiç yokken eski hat bugünkü gibi çalışır (fail-open)', () => {
    _resetMaviOwnershipForTest();
    const navigate = vi.fn();
    legacyLine(PLACE, navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(isCommandOwnedByMavi(ADDR)).toBe(false);
  });

  /* 4 — Mavi'nin sahiplenmediği DİĞER navigasyon komutları bozulmaz. */
  it('open_maps / find_nearby_* Mavi tarafından sahiplenilmez — eski hat akar', () => {
    wireOwnership(['media.next'], 'takeover');
    for (const type of ['open_maps', 'find_nearby_gas', 'find_nearby_hospital', 'find_nearby_parking']) {
      expect(isCommandOwnedByMavi({ type }), `${type} sahiplenilmemeli`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KAYNAK SÖZLEŞMESİ — sıra ve fail-closed hedef koruması
 * ════════════════════════════════════════════════════════════════════════ */

describe('KİLİT — eski hat kaynağı', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'hooks', 'useVoiceCommandHandler.ts'), 'utf-8');

  it('sahiplik guard\'ı serbest-adres bloğundan ÖNCE gelir (blok ulaşılamaz olur)', () => {
    const guardAt = src.indexOf('isCommandOwnedByMavi(cmd)');
    const navAt = src.indexOf("cmd.type === 'navigate_address'");
    expect(guardAt).toBeGreaterThan(0);
    expect(navAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(navAt);
  });

  it('boş hedefte resolveAndNavigate ÇAĞRILMAZ (fail-closed guard kaynakta)', () => {
    expect(src).toContain('empty_destination');
    // Guard, resolveAndNavigate çağrısından ÖNCE olmalı.
    // (satır sonu CRLF olabilir → boşluğa duyarsız arama)
    const guard = src.indexOf('empty_destination');
    const call = src.search(/resolveAndNavigate\(\s*dest,/);
    expect(guard).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(guard);
  });

  /* Bu turda TAKEOVER_ELIGIBLE GENİŞLETİLMEDİ — gerekçe testte kayıtlı:
     `navigation.open` action'ı `open_maps` ile PAYLAŞILIYOR ve o komutun eski hattı
     harici navigasyon uygulamasını açıyor (intentEngine OPEN_NAVIGATION → ctx.launch).
     Eligible kümesine eklemek `open_maps` davranışını da sessizce değiştirirdi. */
  it('TAKEOVER_ELIGIBLE bu turda GENİŞLETİLMEDİ (open_maps davranışı korunur)', () => {
    expect([...TAKEOVER_ELIGIBLE]).toEqual(['media.next']);
    // Aynı actionId iki farklı komut tipinden üretiliyor → action-bazlı allowlist
    // ikisini AYIRAMAZ; bu kısıt bilinçlidir ve kütükte açık borç olarak yazılıdır.
    expect(defaultPilotCommandMap({ type: 'open_maps' })?.actionId).toBe('navigation.open');
    expect(defaultPilotCommandMap(ADDR)?.actionId).toBe('navigation.open');
  });
});
