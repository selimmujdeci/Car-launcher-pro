/**
 * obdFieldFixes2026_07_27.test.ts — 2026-07-27 Dacia Duster saha dökümünden
 * çıkan kusurların KİLİTLERİ.
 *
 * Kaynak kanıt: CAROS LAB tam kopyası (kütük #142). Üçü de gerçek cihazdan
 * gelen ham veriyle yakalandı, tahminle değil.
 */
import { describe, it, expect } from 'vitest';
import { deriveDiagnosticEvidence } from '../platform/aiCore/runtime/diagnosticEvidence';

/* ══════════════════════════════════════════════════════════════════════════
 * 1. connLifecycle: EPOCH zaman damgaları sayaçlara TOPLANMAZ
 *
 * SAHA: kanıt satırı "reset/disconnect/reconnect toplam [redacted]" idi.
 * Maskelemenin gizlediği değer ~5.36e12 idi çünkü `Object.values()` körlemesine
 * toplanıyor ve `lastResetAt/lastDisconnectAt/lastReconnectAt` epoch değerleri
 * de sayaçlara ekleniyordu.
 * ════════════════════════════════════════════════════════════════════════ */

describe('connLifecycle aktivite sayımı — zaman damgası SIZMAZ', () => {
  /** Gerçek cihazdan gelen alan adları (kütük #142 ham snapshot). */
  const REAL_SHAPE = {
    resetRequestedCount: 1,
    resetCompletedCount: 1,
    disconnectCalledCount: 2,
    reconnectRequestedCount: 2,
    lastResetReason: 'user',
    lastResetAt: 1785169103492,
    lastDisconnectAt: 1785169105216,
    lastReconnectAt: 1785169105220,
    connectionState: 'connected',
    lastPacketAgeMs: 1339,
  };

  function lifecycleSummary(connLifecycle: Record<string, unknown>): string | undefined {
    const ev = deriveDiagnosticEvidence({ obdDeep: { connLifecycle } }, 5000);
    return ev.find((e) => e.key === 'recovery.lifecycle')?.summary;
  }

  it('yalnız *Count alanları toplanır — epoch değerler DIŞARIDA', () => {
    const summary = lifecycleSummary(REAL_SHAPE);
    expect(summary, 'lifecycle kanıtı üretilmeli').toBeDefined();
    // 1+1+2+2 = 6. Zaman damgaları sızsaydı ~5.36e12 olurdu.
    expect(summary).toContain('6');
    expect(summary, 'epoch zaman damgası toplama SIZMAMALI')
      .not.toMatch(/\b\d{10,}\b/);
  });

  it('SADECE zaman damgası varsa aktivite kanıtı ÜRETİLMEZ', () => {
    // Hiç sayaç yok → "aktivite var" demek YANLIŞ olurdu.
    const summary = lifecycleSummary({
      lastResetAt: 1785169103492,
      lastDisconnectAt: 1785169105216,
      connectionState: 'connected',
    });
    expect(summary, 'sayaç yokken kanıt uydurulmamalı').toBeUndefined();
  });

  it('`lastPacketAgeMs` gibi ölçüm alanları sayaç SAYILMAZ', () => {
    const summary = lifecycleSummary({ resetRequestedCount: 1, lastPacketAgeMs: 9999 });
    expect(summary).toContain('1');
    expect(summary).not.toContain('9999');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. OBD adresi ORIGIN'den bağımsız kalıcı olmalı
 *
 * SAHA: uygulama şeması https://localhost → http://localhost değişince
 * localStorage (origin-bağımlı) boşaldı ve "Kayıtlı OBD adresi yok — cihaz
 * seçin" hatası çıktı; oysa diğer ayarlar safeStorage (dosya) üzerinden
 * hayatta kalmıştı. Adres artık İKİ katmana yazılır.
 * ════════════════════════════════════════════════════════════════════════ */

describe('OBD adresi kalıcılığı — çift katman', () => {
  it('kaynak: saveObdAddress HEM localStorage HEM safeStorage yazar', async () => {
    const src = await import('../platform/obdStorage?raw');
    const text = String(src.default);
    const save = text.slice(text.indexOf('export function saveObdAddress'));
    const body = save.slice(0, save.indexOf('\n}'));
    expect(body, 'birincil katman (localStorage) korunmalı').toContain('localStorage.setItem');
    expect(body, 'yedek katman (safeStorage) yazılmalı').toContain('safeSetRaw');
  });

  it('kaynak: loadObdAddress localStorage boşsa YEDEĞE düşer', async () => {
    const src = await import('../platform/obdStorage?raw');
    const text = String(src.default);
    const load = text.slice(text.indexOf('export function loadObdAddress'));
    const body = load.slice(0, load.indexOf('\n}\n'));
    expect(body).toContain('localStorage.getItem');
    expect(body, 'yedek katmandan okuma olmalı').toContain('safeGetRaw');
  });

  it('kaynak: clearObdAddress İKİ katmanı da temizler (yedek diriltmemeli)', async () => {
    const src = await import('../platform/obdStorage?raw');
    const text = String(src.default);
    const clear = text.slice(text.indexOf('export function clearObdAddress'));
    const body = clear.slice(0, clear.indexOf('\n}'));
    expect(body).toContain('localStorage.removeItem');
    // DENETİM 2026-07-28: boş string mezar taşı YETMEZ — native'de _fsWriteAtomic
    // boş içeriği reddeder (stat.size === 0) → eski adres dosyada kalır ve dirilir.
    // Kilit güncellendi: GERÇEK silme (safeRemoveRaw) zorunlu.
    expect(body, 'yedek katman GERÇEKTEN silinmeli').toContain('safeRemoveRaw');
    expect(body, 'boş string mezar taşı geri gelmemeli').not.toContain("safeSetRaw(OBD_ADDRESS_KEY, '')");
  });

  it('kaynak: yedek katman yazımı ERTELENMEZ (immediate)', async () => {
    const src = await import('../platform/obdStorage?raw');
    const text = String(src.default);
    const save = text.slice(text.indexOf('export function saveObdAddress'));
    const body = save.slice(0, save.indexOf('\n}'));
    // 5 sn debounce penceresinde kontak kesilirse yedek HİÇ oluşmazdı.
    expect(body, 'safeSetRaw immediate bayrağıyla çağrılmalı').toMatch(/safeSetRaw\([^)]*true\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Üretici DID: ECU hat-hatası DEVRE KESİCİ (oturum kapsamlı)
 *
 * SAHA: Duster'da (ICE) Zoe EV profili yüklüyken her DID denemesi `CAN ERROR`
 * döndü. `CAN ERROR` araç hakkında KANIT DEĞİLDİR (capabilityOutcome sözleşmesi)
 * → kalıcı kara listeye yazılamaz → SONSUZ tekrar. Ham trafikte ölçülen bedel:
 * deneme başına 9-10 AT komutu + ~700 ms.
 * ════════════════════════════════════════════════════════════════════════ */

describe('Üretici DID — ECU devre kesici', () => {
  it('kaynak: oturum kapsamlı susturma var ve KALICI kara liste DEĞİL', async () => {
    const src = await import('../platform/obd/manufacturerPidService?raw');
    const text = String(src.default);
    expect(text, 'ECU susturma kümesi olmalı').toContain('_ecuMuted');
    expect(text, 'ardışık hata sayacı olmalı').toContain('_ecuFailStreak');
    expect(text, 'eşik sabiti olmalı').toContain('ECU_COMM_FAIL_LIMIT');
    // Zero-trust: susturma KALICI `_unsupported` kümesine YAZILMAMALI.
    const commErr = text.slice(text.indexOf("_recordM22(def, 'COMM_ERROR'"));
    const block = commErr.slice(0, 900);
    expect(block, 'hat hatası kalıcı desteklenmiyor sayılamaz')
      .not.toContain('_unsupported.add');
  });

  it('kaynak: susturulan ECU sorgulanmaz ve BAŞARIDA açılır', async () => {
    const src = await import('../platform/obd/manufacturerPidService?raw');
    const text = String(src.default);
    const watched = text.slice(text.indexOf('function _watchedDids'));
    expect(watched.slice(0, 700), 'susturulmuş ECU atlanmalı').toContain('_ecuMuted.get');
    // DENETİM 2026-07-28: susturma SÜRELİ olmalı — süresiz kesme, "başarılı yanıt"ı
    // imkânsız kıldığı için geçici kopmayı kalıcı sessizliğe çevirirdi.
    expect(watched.slice(0, 700), 'yarı-açık pencere olmalı').toContain('ECU_MUTE_RETRY_MS');
    // Tek bir başarılı yanıt → sayaç ve susturma sıfırlanır (kalıcı ceza yok).
    const ok = text.slice(text.indexOf("_recordM22(def, 'SUPPORTED'") - 400);
    expect(ok.slice(0, 500)).toContain('_ecuMuted.delete');
  });

  it('kaynak: profil yeniden yüklenince devre kesici SIFIRLANIR', async () => {
    const src = await import('../platform/obd/manufacturerPidService?raw');
    const text = String(src.default);
    const load = text.slice(text.indexOf('export function loadProfile'));
    expect(load.slice(0, 700)).toContain('_ecuMuted.clear');
  });
});
