/**
 * systemBootGenerationRaceF09.test.ts — MRI F-09 · LIFECYCLE NESİL YARIŞI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * RİSK MODELİ
 *
 * SystemBoot dalgaları `await` sınırları içerir (ör. `await import(...)`) ve
 * await'ten SONRA cleanup kaydı yapar:
 *
 *     const { startX, stopX } = await import('../x');   // ← sınır
 *     this._regNamed('X', stopX);                        // ← kayıt (fix ÖNCESİ şekil)
 *
 * Bu sınırda `stop()` çalışıp ARDINDAN yeni bir `start()` gelirse, ESKİ
 * nesle ait devam (continuation) YENİ neslin dünyasına düşer. O anda eski
 * neslin elindeki cleanup handle'ı yeni neslin kayıt listesine girerse:
 *
 *   · eski neslin servisi YENİ neslin ömrü boyunca CANLI kalır (çift
 *     dinleyici/timer/abonelik),
 *   · yeni nesil sahibi olmadığı bir kaynağı sahiplenmiş görünür,
 *   · cleanup sahipliği nesiller arasında karışır.
 *
 * ── ÖLÇÜLEN MEKANİZMA (bu turda HEAD üzerinde okundu) ─────────────────────
 * Bayatlık kararı tek bir yüklemle veriliyor:
 *
 *     private get _aborted() { return this._bootAbort?.signal.aborted ?? false; }
 *
 * `stop()` ise sonunda `this._bootAbort = null` yapıyor. Yani:
 *   · stop SONRASI  → `_bootAbort` null → `_aborted` YENİDEN false,
 *   · yeni start SONRASI → `_bootAbort` TAZE bir controller → `_aborted` false.
 *
 * Her iki pencerede de eski neslin geç devamı kendini "iptal edilmemiş"
 * sanır. Abort sinyali NESİL KİMLİĞİ TAŞIMAZ; yalnız "şu anki koşu iptal mi"
 * sorusunu cevaplar.
 *
 * ── KANIT SEVİYESİ ────────────────────────────────────────────────────────
 * DAVRANIŞSAL: gerçek `systemBoot` tekil örneği, gerçek `stop()` ve gerçek
 * kayıt yolu çalıştırılır. Kaynak metni okunmaz. Nesiller, üretimde de nesil
 * kimliği olarak kullanılan `_diagStarts` sayacıyla kurulur
 * (`bootDeferral.begin(this._diagStarts, …)` — SystemBoot.start).
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const vdl = vi.hoisted(() => ({ startCalls: 0, cleanupCalls: 0 }));
vi.mock('../platform/vehicleDataLayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/vehicleDataLayer')>();
  return {
    ...actual,
    startVehicleDataLayer: () => { vdl.startCalls++; return (): void => { vdl.cleanupCalls++; }; },
  };
});

import { systemBoot } from '../platform/system/SystemBoot';

interface BootInternals {
  _cleanups:      Array<() => void>;
  _namedCleanups: Map<string, () => void>;
  _started:       boolean;
  _diagStarts:    number;
  _diagStops:     number;
  _bootAbort:     AbortController | null;
  /** Async sınırdan SONRA dönen cleanup'ın kayıt kapısı (nesil kimliği ister). */
  _reg:           (gen: number, fn: (() => void) | void | undefined) => void;
}
const boot = (): BootInternals => systemBoot as unknown as BootInternals;

/** Bir neslin başlangıcını üretimdeki gibi kurar (start() alanları). */
function beginGeneration(gen: number): void {
  const b = boot();
  b._started    = true;
  b._diagStarts = gen;
  b._bootAbort  = new AbortController();
}

beforeEach(() => {
  vdl.startCalls = 0; vdl.cleanupCalls = 0;
  const b = boot();
  b._started = false;
  b._cleanups.length = 0;
  b._namedCleanups.clear();
  b._diagStarts = 0;
  b._diagStops  = 0;
  b._bootAbort  = null;
});

afterEach(() => {
  try { systemBoot.stop(); } catch { /* idempotent teardown */ }
  const b = boot();
  b._cleanups.length = 0;
  b._namedCleanups.clear();
  b._started = false;
  b._bootAbort = null;
  vi.useRealTimers();
});

// ── R3/R4 · ESKİ NESİL YENİ NESLE KARIŞAMAZ (F-09 ÇEKİRDEĞİ) ───────────────

describe('F-09 · eski neslin geç devamı yeni nesle karışmaz', () => {
  it('stop → start SONRASI gelen eski nesil cleanup\'ı YENİ nesle KAYDEDİLMEZ', () => {
    /* T0 Gen1 başlar. */
    beginGeneration(1);

    /* T1 Gen1'in bir dalgası `await` sınırında asılı: cleanup HENÜZ kaydedilmedi.
       Bu handle o neslin kendi kaynağını durduran fonksiyondur. */
    const gen1Cleanup = vi.fn();

    /* T2 stop() — Gen1 iptal edilir, LIFO cleanup'lar koşar, liste temizlenir. */
    systemBoot.stop();

    /* T3 Gen2 başlar ve TAZE bir abort controller alır. */
    beginGeneration(2);

    /* T4 Gen2 kendi servisini kaydeder. */
    const gen2Cleanup = vi.fn();
    boot()._cleanups.push(gen2Cleanup);
    const gen2Size = boot()._cleanups.length;

    /* T5 Gen1'in geç devamı NİHAYET tamamlanır ve cleanup'ını teslim etmeye
       çalışır — üretimdeki async-sınır kapısından. */
    boot()._reg(1, gen1Cleanup);   // Gen1 kimliğiyle teslim

    /* T6 BEKLENEN: bayat nesil KENDİ kaynağını hemen durdurur ve yeni neslin
       sahipliğine HİÇBİR ŞEY eklemez. */
    expect(
      boot()._cleanups.length,
      'BAYAT nesil cleanup\'ı YENİ neslin listesine girdi — eski neslin servisi '
      + 'Gen2 boyunca canlı kalır (çift dinleyici/timer) ve sahipliği karışır',
    ).toBe(gen2Size);

    /* Bayat teslim ÇALIŞTIRILMAMALI da: kayıtların çoğu modül düzeyinde global
       `stopX` fonksiyonudur, yani o an YENİ neslin başlattığı aynı tekil
       servisi durdurur. Eski neslin bunu çağırması, "eski nesil yeni nesil
       üzerinde otorite kuramaz" değişmezinin ihlali olurdu. */
    expect(
      gen1Cleanup,
      'bayat teslim çalıştırıldı — eski nesil, YENİ neslin tekil servisini durdurabilir',
    ).not.toHaveBeenCalled();

    /* Yeni neslin kaydı BOZULMAMALI. */
    expect(boot()._cleanups).toContain(gen2Cleanup);
    expect(gen2Cleanup, 'yeni neslin servisi yanlışlıkla durduruldu').not.toHaveBeenCalled();
  });

  it('stop SONRASI (henüz yeni start YOK) gelen eski nesil cleanup\'ı da kaydedilmez', () => {
    /* `_bootAbort` stop() sonunda null'lanıyor; bu pencerede `_aborted`
       yeniden false okunur. Durmuş bir boot'a kayıt yapmak, hiçbir neslin
       sahiplenmediği bir kaynak bırakır. */
    beginGeneration(1);
    systemBoot.stop();

    const lateCleanup = vi.fn();
    boot()._reg(1, lateCleanup);    // Gen1 kimliğiyle teslim

    expect(
      boot()._cleanups.length,
      'DURMUŞ boot\'a cleanup kaydedildi — kimsenin sahiplenmediği kaynak',
    ).toBe(0);
    expect(lateCleanup, 'durdurulmuş boot\'ta gelen kaynak kapatılmadı').toHaveBeenCalledTimes(1);
  });
});

// ── R1/R6/R7/R8 · İDEMPOTENS VE TEKRARLAR ──────────────────────────────────

describe('F-09 · idempotens ve tekrarlanan geçişler', () => {
  it('R1 — ikinci start() no-op\'tur (çift servis üretmez)', async () => {
    const b = boot();
    b._started = true;               // ilk start tamamlanmış varsay
    const startsBefore = b._diagStarts;
    await systemBoot.start();        // ikinci çağrı
    expect(b._diagStarts, 'ikinci start() yeni nesil açtı — çift servis riski')
      .toBe(startsBefore);
  });

  it('R6 — tekrarlanan stop() cleanup\'ları İKİ KEZ çalıştırmaz', () => {
    beginGeneration(1);
    const cleanup = vi.fn();
    boot()._cleanups.push(cleanup);

    systemBoot.stop();
    systemBoot.stop();
    systemBoot.stop();

    expect(cleanup, 'cleanup birden çok kez çalıştı — çift teardown')
      .toHaveBeenCalledTimes(1);
    expect(boot()._cleanups.length).toBe(0);
  });

  it('R8 — hızlı start/stop döngüsü cleanup listesini BÜYÜTMEZ', () => {
    for (let gen = 1; gen <= 5; gen++) {
      beginGeneration(gen);
      boot()._cleanups.push(vi.fn());
      systemBoot.stop();
      expect(boot()._cleanups.length, `nesil ${gen} sonrası liste temizlenmedi`).toBe(0);
    }
  });
});

// ── R5 · BAYAT NESLİN HATASI YENİ NESLİ DÜŞÜRMEZ ───────────────────────────

describe('F-09 · bayat nesil yeni neslin durumunu EZMEZ', () => {
  it('eski nesil geç tamamlansa da yeni neslin `started` durumu korunur', () => {
    beginGeneration(1);
    systemBoot.stop();
    beginGeneration(2);

    const d1 = systemBoot.getLifecycleDiagnostics();
    expect(d1.started).toBe(true);

    /* Bayat devam teslim etmeye çalışır. */
    boot()._reg(1, vi.fn());        // Gen1 kimliğiyle teslim

    const d2 = systemBoot.getLifecycleDiagnostics();
    expect(d2.started, 'bayat nesil yeni neslin started durumunu değiştirdi').toBe(true);
    expect(d2.starts,  'bayat nesil nesil sayacını değiştirdi').toBe(d1.starts);
  });
});
