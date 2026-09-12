/**
 * #672 KİLİTLERİ — E2E komut şifrelemesinin GÖNDEREN ucu.
 *
 * Saha: telefondan gönderilen fiziksel komutların TAMAMI araçta
 * `Decryption Error` ile reddediliyordu. Sebep: araç `ecdh_v1` zarfı şart
 * koşuyordu ama o zarfı üreten uç ürün yolunda HİÇ YAZILMAMIŞTI
 * (`encryptE2EPayload` → sıfır çağıran; `website/src` içinde `ecdh` → sıfır).
 *
 * ARAÇ KOPYASIYLA PARİTE: iki taraf ayrışırsa komutlar sessizce reddedilmeye
 * döner (#660'ın dersi). Bu dosya kritik sabitleri karşılaştırır.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  requiresE2E,
  E2E_REQUIRED_COMMANDS,
  HKDF_INFO_STR,
  carKeyErrorMessage,
} from '@/lib/e2eCommandCrypto';

/* Araç paketi website'in DIŞINDA — parite için oradan okunur. */
const carCrypto = readFileSync(
  resolve(process.cwd(), '..', 'src', 'platform', 'commandCrypto.ts'), 'utf8',
);
const carListener = readFileSync(
  resolve(process.cwd(), '..', 'src', 'platform', 'commandListener.ts'), 'utf8',
);
const sender = readFileSync(resolve(process.cwd(), 'src/lib/e2eCommandCrypto.ts'), 'utf8');
const service = readFileSync(resolve(process.cwd(), 'src/lib/commandService.ts'), 'utf8');

describe('#672 · gönderen uç ARTIK VAR ve ürün yolunda bağlı', () => {
  it('KİLİT: komut servisi E2E şifreleyiciyi GERÇEKTEN çağırır', () => {
    /* Bu kilit olmadan modül yazılıp bağlanmadan kalabilir — depoda beş kez
       yaşanan "motor var, besleyen yok" deseni. */
    expect(service).toContain("from '@/lib/e2eCommandCrypto'");
    expect(service).toContain('requiresE2E(type)');
    expect(service).toContain('encryptE2EPayload(');
    expect(service).toContain('fetchCarPublicKey(vehicleId)');
  });

  it('KİLİT: KALAN TEK gönderme yolu şifreler — ikinci (api_key) yol geri gelmemiş', () => {
    /* KİLİT GÜNCELLENDİ (P0-001A), ZAYIFLATILMADI.
     *
     * #672'de İKİ gönderme yolu vardı (oturumlu + oturumsuz `api_key`) ve
     * ikincisi düz metin gönderiyordu; kilit "her ikisi de şifrelesin" diyordu.
     * P0-001A'da ikinci yol tamamen KALDIRILDI: dayandığı `/api/pwa/command`
     * ucu, `sha256(raw) === api_key_hash` doğrulaması düz metin kolona karşı
     * eşleşemediği için hiç çalışmıyordu ve `getStoredApiKey` zaten null
     * dönüyordu. Yol yoksa "o yol da şifrelesin" kilidi anlamsızdır.
     *
     * Kilit artık iki şeyi birden korur:
     *   ① kalan yol HÂLÂ şifreliyor,
     *   ② kaldırılan yol SESSİZCE geri gelmiyor (ham anahtarı tarayıcıda
     *      taşıyan desen yeniden açılırsa bu kilit düşer). */
    /* YORUMLAR SAYILMAZ: kaldırılan yolun NEDEN kaldırıldığı dosyada yazılıdır
       ve o açıklama kaçınılmaz olarak eski fonksiyon adını anar. Yorumu koda
       saymak doğru kodu düşürürdü. */
    const code = service
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');

    expect(code.match(/requiresE2E\(type\)/g) ?? [], 'kalan yol şifrelemeyi bırakmış')
      .toHaveLength(1);
    expect(code, 'oturumsuz api_key komut yolu geri gelmiş')
      .not.toContain('sendCommandViaApiKey');
    expect(code, 'ham anahtar yeniden Authorization başlığına konmuş')
      .not.toMatch(/Authorization['"]?\s*:\s*`Bearer \$\{apiKey\}`/);
  });

  it('KİLİT: şifreleme başarısızsa komut GÖNDERİLMEZ — sessiz düz metin YOK', () => {
    /* Eski kod `.catch(() => payload)` ile sessizce düz metne düşüyordu;
       araç onu reddediyor, kullanıcı nedenini asla öğrenemiyordu. */
    expect(service).toContain('güvenlik gereği gönderilmedi');
    expect(service).not.toMatch(/encryptE2EPayload\([^)]*\)\.catch\(\(\)\s*=>\s*payload\)/);
  });
});

describe('#672 · araç kopyasıyla PARİTE (ayrışırsa komutlar sessizce ölür)', () => {
  it('KİLİT: HKDF info dizesi iki tarafta AYNI', () => {
    expect(HKDF_INFO_STR).toBe('caros-cmd-v1');
    expect(carCrypto).toContain("HKDF_INFO_STR       = 'caros-cmd-v1'");
  });

  it('KİLİT: anahtar türetme parametreleri AYNI (P-256 · 256 bit · sıfır salt · SHA-256)', () => {
    for (const token of ["namedCurve: 'P-256'", 'new Uint8Array(32)', "hash: 'SHA-256'", "{ name: 'AES-GCM', length: 256 }"]) {
      expect(sender, `gönderen: ${token}`).toContain(token);
      expect(carCrypto, `araç: ${token}`).toContain(token);
    }
  });

  it('KİLİT: zarf biçimi aracın tip koruyucusuyla uyumlu', () => {
    /* Araç `isE2EPayload`: type==='ecdh_v1' && eph_pub && iv && data && ts */
    for (const field of ["type: 'ecdh_v1'", 'eph_pub:', 'iv:', 'data:', 'ts,']) {
      expect(sender, field).toContain(field);
    }
    expect(carCrypto).toContain("p.type    === 'ecdh_v1'");
  });

  it('KİLİT: replay alanları ŞİFRENİN İÇİNE gömülür', () => {
    expect(sender).toContain('_ts: ts, _nonce: nonce');
    expect(carCrypto).toContain('_ts: ts, _nonce: nonce');
  });

  it('KİLİT: E2E şart koşulan komut listesi araç tarafıyla AYNI', () => {
    /* Araç: MCU_COMMANDS + clear_dtc */
    for (const cmd of ['lock', 'unlock', 'horn', 'alarm_on', 'alarm_off', 'lights_on', 'clear_dtc']) {
      expect(requiresE2E(cmd), `${cmd} E2E istemeli`).toBe(true);
      expect(carListener, `araç listesinde ${cmd}`).toContain(`'${cmd}'`);
    }
    expect(E2E_REQUIRED_COMMANDS).toHaveLength(7);
    expect(requiresE2E('engine_start')).toBe(false);
  });
});

describe('#672 · anahtar yoksa gerekçe SÖYLENİR', () => {
  it('KİLİT: her başarısızlık nedeni okunur bir cümle üretir', () => {
    expect(carKeyErrorMessage('NOT_PUBLISHED')).toMatch(/yayınlamadı/i);
    expect(carKeyErrorMessage('UNREADABLE')).toMatch(/okunamadı/i);
    expect(carKeyErrorMessage('NO_CLIENT')).toMatch(/oturum/i);
  });
});
