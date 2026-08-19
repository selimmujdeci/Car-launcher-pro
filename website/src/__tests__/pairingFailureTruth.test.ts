/**
 * pairingFailureTruth.test.ts — #643 KİLİDİ
 * "Cihaz çevrimdışı" ile "sunucu düştü" AYNI CÜMLEYLE anlatılamaz.
 *
 * ── NEDEN VAR (SAHA, 2026-08-19, kullanıcı ekran görüntüsü) ─────────────────
 * Telefon **5G · tam sinyal · VoLTE** ile çevrimiçiyken PWA eşleştirme ekranı
 * *"Çevrimdışısınız. Talebiniz cihazınıza kaydedildi..."* yazıyordu ve arka
 * arkaya üç talep birikmişti (ikisi "süresi doldu").
 *
 * KÖK: `pairVehicle` sunucudan gelen **5xx/429**'u `offline: true` diye
 * işaretliyordu (tekrar denenebilirlik için doğru), ekran ise bu bayrağı
 * "cihaz çevrimdışı" diye OKUYUP kullanıcıyı suçluyordu. Aynı şekilde `fetch`
 * throw ettiğinde (DNS/TLS/captive portal) da "internet bağlantınızı kontrol
 * edin" deniyordu — oysa sebep sunucu tarafında da olabilir. Ölçüm sırasında
 * `www.carospro.com` sertifikasının alan adını KAPSAMADIĞI da görüldü
 * (SEC_E_WRONG_PRINCIPAL) — tam olarak bu sınıf bir hata.
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *   1. Sunucu YANIT VERDİYSE (5xx/429) sebep `SERVER_TRANSIENT`; cihaz
 *      çevrimdışı İLAN EDİLMEZ ve HTTP durumu taşınır.
 *   2. İstek hiç tamamlanmadıysa: tarayıcı "ağ kapalı" diyorsa `DEVICE_OFFLINE`,
 *      demiyorsa `NETWORK_FAILED` (sebep BİLİNMİYOR — uydurulmaz).
 *   3. `offline` bayrağı (tekrar denenebilirlik) her üç durumda da korunur —
 *      kuyruk davranışı DEĞİŞMEZ.
 *   4. Kalıcı red (4xx) `offline` DEĞİLDİR: sonsuza dek kuyrukta dönmez.
 *   5. Ekran cümlesi sebepten türer (kaynak kilidi).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyHttpFailure, classifyRequestFailure, pairFailureNotice,
} from '@/lib/pairing/pairFailureModel';

describe('#643 — eşleştirme hatasının SEBEBİ doğru sınıflandırılır', () => {
  it('🔒 SAHADA ÖLÇÜLEN KUSUR: 5xx cihazı çevrimdışı İLAN EDEMEZ', () => {
    const v = classifyHttpFailure(503);
    expect(v.retryable, 'tekrar denenebilirlik kayboldu — kuyruk davranışı bozulur').toBe(true);
    expect(v.reason, 'sunucu yanıt verdiği hâlde cihaz suçlanıyor').toBe('SERVER_TRANSIENT');
    expect(pairFailureNotice('SERVER_TRANSIENT', 503))
      .toMatch(/Sunucu şu an yanıt veremiyor \(HTTP 503\)/);
    expect(pairFailureNotice('SERVER_TRANSIENT', 503), 'cihaz hâlâ suçlanıyor')
      .not.toMatch(/[Çç]evrimdışı/);
  });

  it('🔒 429 da geçici SUNUCU hatasıdır (cihaz değil)', () => {
    expect(classifyHttpFailure(429)).toEqual({ retryable: true, reason: 'SERVER_TRANSIENT' });
  });

  it('🔒 KALICI RED (4xx) tekrar denenmez — kuyrukta sonsuza dek dönmez', () => {
    for (const s of [400, 401, 404, 409, 410]) {
      expect(classifyHttpFailure(s), `HTTP ${s} kuyruğa yazılıyor`)
        .toEqual({ retryable: false, reason: null });
    }
  });

  it('🔒 İSTEK TAMAMLANMADI + tarayıcı ONLINE → sebep BİLİNMİYOR', () => {
    const v = classifyRequestFailure(true);
    expect(v.retryable).toBe(true);
    expect(v.reason, 'ölçülmemiş "cihaz çevrimdışı" iddiası').toBe('NETWORK_FAILED');
    expect(pairFailureNotice('NETWORK_FAILED')).toMatch(/sertifika/);
  });

  it('🔒 tarayıcı gerçekten ÇEVRİMDIŞI diyorsa DEVICE_OFFLINE', () => {
    expect(classifyRequestFailure(false).reason).toBe('DEVICE_OFFLINE');
    expect(pairFailureNotice('DEVICE_OFFLINE')).toMatch(/Cihazınız çevrimdışı/);
  });

  it('🔒 HER dal "Araç HENÜZ eşleşmedi" der — kuyruk sahiplik ÜRETMEZ (#631/#632)', () => {
    for (const r of ['DEVICE_OFFLINE', 'SERVER_TRANSIENT', 'NETWORK_FAILED'] as const) {
      expect(pairFailureNotice(r), `${r}: eşleşme iması`).toMatch(/HENÜZ eşleşmedi/);
    }
  });

  it('🔒 KAYNAK: servis sınıflandırmayı SAF modelden alır, kendi eşiğini yazmaz', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/pairingService.ts'), 'utf8');
    expect(src, 'eşik servise geri kopyalanmış').not.toMatch(/status\s*>=\s*500/);
    expect(src).toMatch(/classifyHttpFailure/);
    expect(src).toMatch(/classifyRequestFailure/);
  });

  it('🔒 KAYNAK: ekran cümlesi TEK kaynaktan gelir, sabit "Çevrimdışısınız" yok', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/pwa/PairingScreen.tsx'), 'utf8');
    expect(src, 'ekran kendi cümlesini kuruyor').toMatch(/pairFailureNotice\(cause, httpStatus\)/);
    expect(src, 'sunucu hatasında hâlâ cihaz suçlanıyor')
      .not.toMatch(/Çevrimdışısınız\. Talebiniz/);
    expect(src, 'sebep çağrıya taşınmıyor').toMatch(/res\.reason \?\? 'NETWORK_FAILED'/);
  });
});
