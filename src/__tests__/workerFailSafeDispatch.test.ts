/**
 * workerFailSafeDispatch.test.ts — VCOMP-01 + VCOMP-02 kilitleri.
 *
 * ── NEDEN YAPISAL (`?raw`) KİLİT ────────────────────────────────────────────
 * `VehicleCompute.worker.ts` bir Web Worker modülüdür ve jsdom'da ÇALIŞTIRILAMAZ
 * (`workerSourceHealthTransport.test.ts` aynı gerekçeyi kaydeder ve aynı deseni
 * kullanır). Bu yüzden worker tarafı kaynak-metin kilitleriyle, DAVRANIŞSAL kısım
 * (dispatcher'ın fail-safe semantiği) izole bir ÖRNEKLE doğrulanır.
 *
 * ⚠️ DENETİM TEST PLANI DÜZELTİLDİ: "circular reference payload gönder" fiziksel
 * olarak bu yolu test EDEMEZ — dairesel referans `postMessage` çağrısında
 * GÖNDEREN tarafta `DataCloneError` fırlatır, mesaj `onmessage`'a HİÇ ULAŞMAZ.
 * Gerçek risk handler GÖVDESİNDE fırlayan exception'dır; kilitler onu hedefler.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import workerSrc from '../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw';

/** Dispatcher bölgesi — kilitler yalnız burada arasın. */
const DISPATCH_BLOCK = workerSrc.slice(workerSrc.indexOf('self.onmessage'));
/** `_handleVehicleData` gövdesi. */
const VEHICLE_DATA_BLOCK = workerSrc.slice(
  workerSrc.indexOf('function _handleVehicleData'),
  workerSrc.indexOf('function _handleCanData'),
);

afterEach(() => { vi.restoreAllMocks(); });

/* ══════════════════════════════════════════════════════════════════════════
 * VCOMP-01 — global fail-safe kapısı
 * ════════════════════════════════════════════════════════════════════════ */

describe('VCOMP-01 — dispatcher exception\'da worker\'ı ÖLDÜRMEZ', () => {
  it('onmessage gövdesi try/catch ile SARILI ve msg okuması içeride', () => {
    expect(DISPATCH_BLOCK).toMatch(/self\.onmessage\s*=\s*\([\s\S]*?\)\s*:\s*void\s*=>\s*\{\s*try\s*\{/);
    // `const msg = e.data` KORUMANIN İÇİNDE olmalı (bozuk erişim de yakalansın).
    const tryAt = DISPATCH_BLOCK.indexOf('try {');
    const msgAt = DISPATCH_BLOCK.indexOf('const msg = e.data');
    const switchAt = DISPATCH_BLOCK.indexOf('switch (msg.type)');
    expect(tryAt).toBeGreaterThan(-1);
    expect(msgAt).toBeGreaterThan(tryAt);
    expect(switchAt).toBeGreaterThan(msgAt);
  });

  it('catch bloğu hatayı YUTMAZ — console.error ile basar', () => {
    expect(DISPATCH_BLOCK).toContain("console.error('[VehicleCompute] Unhandled worker exception:', err)");
    // Sessiz yutma yasağı: boş catch OLMAMALI.
    expect(DISPATCH_BLOCK).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/);
  });

  it('switch YAPISI ve 11 delegasyonun HİÇBİRİ değişmedi (sıfır regresyon)', () => {
    for (const [type, handler] of [
      ['INIT', '_handleInit(msg)'], ['INIT_FALLBACK', '_handleInitFallback(msg)'],
      ['VEHICLE_DATA', '_handleVehicleData(msg)'], ['CAN_DATA', '_handleCanData(msg)'],
      ['OBD_DATA', '_handleObdData(msg)'], ['GPS_DATA', '_handleGpsData(msg)'],
      ['UPDATE_GEOFENCE', '_handleUpdateGeofence(msg)'], ['RESTORE_ODO', '_handleRestoreOdo(msg)'],
      ['VISIBILITY', '_handleVisibility(msg)'], ['STOP', '_handleStop()'],
    ]) {
      expect(DISPATCH_BLOCK, `${type} delegasyonu korunmalı`).toContain(`case '${type}':`);
      expect(DISPATCH_BLOCK, `${type} handler'ı korunmalı`).toContain(handler);
    }
    // CHAOS yalnız DEV kapısında kalmalı.
    expect(DISPATCH_BLOCK).toContain("case 'CHAOS_BITFLIP':   if (import.meta.env.DEV)");
  });

  it('yeni hata sınıfı / custom throw EKLENMEDİ', () => {
    expect(DISPATCH_BLOCK).not.toMatch(/\bthrow\b/);
    expect(DISPATCH_BLOCK).not.toMatch(/new\s+\w*Error\s*\(/);
  });

  /* DAVRANIŞSAL: fail-safe dispatcher semantiği — worker jsdom'da koşamadığı için
     AYNI yapı izole bir örnekle doğrulanır (paralel üretim kodu DEĞİL, sözleşme testi). */
  it('DAVRANIŞ: handler patlasa bile SONRAKİ geçerli mesaj işlenir', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    const boom = (): never => { throw new TypeError('bozuk sinyal şekli'); };
    const ok = (t: string): void => { seen.push(t); };

    // Kaynaktaki desenin birebir karşılığı.
    const onmessage = (e: { data: { type: string } }): void => {
      try {
        const msg = e.data;
        switch (msg.type) {
          case 'BOOM': boom(); break;
          case 'GOOD': ok(msg.type); break;
        }
      } catch (err) {
        console.error('[VehicleCompute] Unhandled worker exception:', err);
      }
    };

    expect(() => onmessage({ data: { type: 'BOOM' } })).not.toThrow();  // worker ÖLMEZ
    onmessage({ data: { type: 'GOOD' } });                              // sonraki mesaj işlenir
    expect(seen).toEqual(['GOOD']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('[VehicleCompute] Unhandled worker exception');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * VCOMP-02 — bilinmeyen kaynak fail-loud
 * ════════════════════════════════════════════════════════════════════════ */

describe('VCOMP-02 — bilinmeyen sinyal kaynağı SESSİZCE yutulmaz', () => {
  /* KİLİT GÜNCELLENDİ (VCOMP-03): uyarı artık zincirin SONUNDA değil, fonksiyon
     GİRİŞİNDEKİ kapıda — state yazımından ÖNCE. Kilit KALDIRILMADI, garanti
     GÜÇLENDİ: eskiden "yaz + uyar", şimdi "uyar + DÜŞÜR (yazma)". */
  it('bilinmeyen kaynak uyarısı KORUNDU (artık giriş kapısında)', () => {
    expect(VEHICLE_DATA_BLOCK).toContain("console.warn('[VehicleCompute] Unknown signal source:', source)");
    // Uyarı, GPS dalından ÖNCE (fonksiyon girişinde) olmalı.
    const warnAt = VEHICLE_DATA_BLOCK.indexOf('Unknown signal source');
    const gpsAt = VEHICLE_DATA_BLOCK.indexOf("else if (source === 'GPS')");
    expect(warnAt).toBeGreaterThan(-1);
    expect(gpsAt).toBeGreaterThan(warnAt);
  });

  it('dört mevcut kaynağın mantığı DEĞİŞMEDİ', () => {
    expect(VEHICLE_DATA_BLOCK).toContain("if (source === 'CAN')");
    expect(VEHICLE_DATA_BLOCK).toContain("} else if (source === 'OBD')");
    expect(VEHICLE_DATA_BLOCK).toContain("} else if (source === 'HAL')");
    expect(VEHICLE_DATA_BLOCK).toContain("} else if (source === 'GPS')");
    // Kaynak-özel çağrılar korunmalı.
    for (const call of [
      '_handleCanReverse(signals.reverse.value)', '_handleObdReverse(signals.reverse.value)',
      '_syncObdOdometer(signals.totalDistance.value)', '_updateOdometerGps(dtMs)',
      '_checkGeofences(_gpsLocBuf.lat, _gpsLocBuf.lng)', '_postPatch(_patchGps)',
    ]) {
      expect(VEHICLE_DATA_BLOCK, `'${call}' korunmalı`).toContain(call);
    }
  });

  it('mesaj arabirimi / SignalSource tipi DEĞİŞTİRİLMEDİ', () => {
    /* KİLİT GÜNCELLENDİ (VCOMP-03): `as` cast'i KALDIRILDI — daraltma artık
       giriş kapısından geliyor. İzinli küme AYNI dört kaynak; yalnız kaynağı
       tampon anahtarlarından TÜRETİLİYOR (elle ikinci liste yok). */
    expect(VEHICLE_DATA_BLOCK).toContain('_valSignals[source] = signals');
    expect(workerSrc).toContain("type ValBufferSource = 'HAL' | 'CAN' | 'OBD' | 'GPS'");
    // Yorumlar sıyrılır: kural KODU bağlar (açıklamada örnek kaynak adı geçebilir).
    const code = workerSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain('BLUETOOTH_EXT');
  });

  /* DAVRANIŞSAL: zincir semantiği — bilinmeyen kaynak uyarı üretir, bilinenler ÜRETMEZ. */
  it('DAVRANIŞ: bilinmeyen kaynak uyarır, bilinen dört kaynak uyarmaz', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const route = (source: string): void => {
      if (source === 'CAN') { /* … */ }
      else if (source === 'OBD') { /* … */ }
      else if (source === 'HAL') { /* … */ }
      else if (source === 'GPS') { /* … */ }
      else console.warn('[VehicleCompute] Unknown signal source:', source);
    };

    for (const s of ['CAN', 'OBD', 'HAL', 'GPS']) route(s);
    expect(spy).not.toHaveBeenCalled();

    route('BLUETOOTH_EXT');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe('BLUETOOTH_EXT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Kabul kriteri — sıcak yol bütçesi ve zamanlama sapmaması
 * ════════════════════════════════════════════════════════════════════════ */

describe('kabul — sıcak yol ve zamanlama korunur', () => {
  it('dispatcher\'a timer/async/allocation EKLENMEDİ', () => {
    for (const forbidden of ['setTimeout', 'setInterval', 'await ', 'async ', 'JSON.parse', 'JSON.stringify']) {
      expect(DISPATCH_BLOCK, `dispatcher '${forbidden}' içermemeli`).not.toContain(forbidden);
    }
  });

  it('mevcut zamanlama sabitleri DEĞİŞMEDİ (300 ms hız aralığı)', () => {
    // Kabul kriteri: worker mesaj işleme hızı sapmaya uğramamalı.
    expect(workerSrc).toMatch(/SPEED_INTERVAL[^\n]*=\s*300/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * VCOMP-03 — bilinmeyen kaynak _valSignals'a YAZILAMAZ (fail-closed)
 *
 * KÖK (kanıtlandı): `SignalSource` sözleşmesi `'HAL'|'CAN'|'OBD'|'GPS'|'FUSED'`;
 * `_valSignals` ise YALNIZ ilk dördünü tutar. Yani TİP-GEÇERLİ bir mesaj bile
 * (`source: 'FUSED'`) tampona ait olmayan bir kaynak taşıyabiliyordu ve eski
 * `_valSignals[source as …]` cast'i doğrulamayı bastırıp yazıyordu.
 * ════════════════════════════════════════════════════════════════════════ */

describe('VCOMP-03 — kaynak kapısı state yazımından ÖNCE', () => {
  it('kapı `return` ile DÜŞÜRÜR ve bu, _valSignals yazımından ÖNCE gelir', () => {
    const guardAt = VEHICLE_DATA_BLOCK.indexOf('if (!_isValBufferSource(source))');
    const returnAt = VEHICLE_DATA_BLOCK.indexOf('return;', guardAt);
    const writeAt = VEHICLE_DATA_BLOCK.indexOf('_valSignals[source] = signals');

    expect(guardAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(guardAt);
    expect(writeAt).toBeGreaterThan(returnAt);   // ← YAZIM KAPININ ARDINDA
  });

  it('doğrulamayı bastıran `as` cast\'i KALDIRILDI', () => {
    // Yorumlar sıyrılır: kök-neden açıklaması eski cast'ten söz edebilir.
    const code = VEHICLE_DATA_BLOCK
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain('_valSignals[source as');
    expect(code).toContain('_valSignals[source] = signals');
  });

  it('izinli kaynak listesi TAMPON ANAHTARLARINDAN türetilir (elle ikinci liste YOK)', () => {
    expect(workerSrc).toContain('const VAL_BUFFER_SOURCES: ReadonlySet<string> = new Set(Object.keys(_valSignals))');
    // FUSED bir SignalSource'tur AMA tampon anahtarı DEĞİLDİR → listeye giremez.
    expect(workerSrc).toContain("const _valSignals: Record<ValBufferSource, NormalizedVehicleData | null>");
  });

  it('SignalSource tipi GENİŞLETİLMEDİ; throw/yeni hata sınıfı EKLENMEDİ', () => {
    expect(VEHICLE_DATA_BLOCK).not.toMatch(/\bthrow\b/);
    expect(VEHICLE_DATA_BLOCK).not.toMatch(/new\s+\w*Error\s*\(/);
    // Bilinmeyen kaynak başka bir kaynağa EŞLENMEZ (sessiz remap yasağı).
    expect(VEHICLE_DATA_BLOCK).not.toMatch(/source\s*=\s*['"](HAL|CAN|OBD|GPS)['"]/);
  });

  /* DAVRANIŞSAL: kapı semantiği — worker jsdom'da koşamadığı için AYNI yapı
     izole bir örnekle doğrulanır (paralel üretim kodu DEĞİL, sözleşme testi). */
  it('DAVRANIŞ: FUSED dâhil bilinmeyen kaynak tampona YAZILMAZ, handler TETİKLEMEZ', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const buf: Record<string, unknown> = { HAL: null, CAN: null, OBD: null, GPS: null };
    const allowed: ReadonlySet<string> = new Set(Object.keys(buf));
    const sideEffects: string[] = [];

    const handle = (source: unknown, signals: unknown): void => {
      if (!(typeof source === 'string' && allowed.has(source))) {
        console.warn('[VehicleCompute] Unknown signal source:', source);
        return;
      }
      buf[source] = signals;
      sideEffects.push(source);
    };

    // Tip-geçerli AMA tampona ait OLMAYAN kaynak + tamamen bilinmeyen + bozuk tipler.
    for (const bad of ['FUSED', 'BLUETOOTH_EXT', '', null, undefined, 42, {}]) {
      handle(bad, { speed: { value: 999 } });
    }
    expect(Object.keys(buf).sort()).toEqual(['CAN', 'GPS', 'HAL', 'OBD']); // yeni anahtar YOK
    expect(Object.values(buf).every((v) => v === null)).toBe(true);        // hiçbiri yazılmadı
    expect(sideEffects).toEqual([]);                                       // handler tetiklenmedi
    expect(spy).toHaveBeenCalledTimes(7);

    // Dört geçerli kaynak eskisi gibi YAZILIR.
    spy.mockClear();
    for (const ok of ['HAL', 'CAN', 'OBD', 'GPS']) handle(ok, { speed: { value: 50 } });
    expect(Object.values(buf).every((v) => v !== null)).toBe(true);
    expect(sideEffects).toEqual(['HAL', 'CAN', 'OBD', 'GPS']);             // sıra korunur
    expect(spy).not.toHaveBeenCalled();
  });
});
