/**
 * vehicleDataLayerHasAnyField.test.ts — K24 perf düzeltmesi (Fix 4) regresyon testi.
 *
 * KAPSAM: `_hasAnyField` — vehicleDataLayer/index.ts'in CAN "signal" recordEvent
 * çağrısında `accepted` bayrağını üretmek için kullanılan allocation-free kontrol.
 *
 * NEDEN: Eski kod `d !== raw || Object.keys(d).length > 0` kullanıyordu.
 *   1) Object.keys(d) her CAN frame'de yeni bir dizi allocate ediyordu (hot-path).
 *   2) `d !== raw ||` kısa devresi ifadeyi PRATİKTE her zaman true'ya düşürüyordu
 *      (Safe Mode'da applyProfileGate her zaman YENİ bir obje döndürür — o obje
 *      tamamen boş olsa bile `d !== raw` true olduğu için OR true olurdu).
 *   _hasAnyField bu allocation'ı kaldırır VE "en az bir alan var mı" semantiğini
 *   doğru şekilde uygular (yalnızca gerçekten boş sonuçta false döner).
 */

import { describe, it, expect } from 'vitest';
import { _hasAnyField } from '../platform/vehicleDataLayer';

describe('_hasAnyField (K24 perf düzeltmesi — Fix 4)', () => {

  it('normal CAN frame (birden çok alan dolu) → true', () => {
    expect(_hasAnyField({ speed: 42, rpm: 1500, reverse: false })).toBe(true);
  });

  it('tek alanlı obje (spike sonrası bir alan silinmiş, diğerleri kalmış) → true', () => {
    expect(_hasAnyField({ speed: 42 })).toBe(true);
  });

  it('yalnızca undefined değerli alan da "key var" sayılır (own-enumerable key yeterli) → true', () => {
    // Object.keys(d).length > 0 ile birebir aynı semantik: değer undefined olsa
    // bile anahtar objede varsa true döner (CanAdapter'ın template-literal alanları gibi).
    expect(_hasAnyField({ speed: undefined })).toBe(true);
  });

  it('tamamen boş obje (Safe Mode + tüm OBD-safe alanlar undefined köşe durumu) → false', () => {
    // Bu, eski `d !== raw || ...` kodunun YANLIŞLIKLA true döndürdüğü köşe
    // durumudur — _hasAnyField burada DOĞRU şekilde false döner (bug fix).
    expect(_hasAnyField({})).toBe(false);
  });

});
