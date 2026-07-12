/**
 * scan-secrets.test.ts — Release bundle secret-tarama kapısının doğruluk kilidi.
 *
 * findSecrets() GERÇEK anahtar-şekilli literal'i yakalamalı AMA bundle'da meşru
 * olarak bulunan şeyleri (BYOK doğrulama regex kaynakları, placeholder metinleri,
 * Firebase public anahtarı, test-fixture'lar) YANLIŞ-POZİTİF üretmemeli.
 * Bu denge bozulursa CI ya gerçek sızıntıyı kaçırır ya da release'i haksız bloklar.
 */
import { describe, it, expect } from 'vitest';
import { findSecrets } from '../../scripts/scan-secrets.mjs';

// Gerçek-ŞEKİLLİ ama tamamen SAHTE anahtarlar (tekrarlı blok → uzun alfabe koşusu
// yok, fixture işaretine takılmaz). Gerçek gizli değer TESTTE bile kullanılmaz.
const BLK = 'a1B2c3D4';
const FAKE = {
  claude: `sk-ant-api03-${BLK.repeat(6)}`,           // 13 + 48 = şekil geçerli
  groq: `gsk_${BLK.repeat(6)}`,                        // gsk_ + 48 alnum
  google: `AIza${BLK.repeat(4)}a1B`,                   // AIza + 35 = 39 toplam
  xai: `xai-${BLK.repeat(5)}`,                         // xai- + 40 alnum
};

describe('scan-secrets · findSecrets', () => {
  it('gerçek-şekilli Claude anahtarını yakalar', () => {
    const hits = findSecrets(`const k="${FAKE.claude}";`);
    expect(hits.map((h) => h.provider)).toContain('anthropic-claude');
  });

  it('gerçek-şekilli Groq / Google / xAI anahtarlarını yakalar', () => {
    expect(findSecrets(FAKE.groq).length).toBeGreaterThan(0);
    expect(findSecrets(FAKE.google).length).toBeGreaterThan(0);
    expect(findSecrets(FAKE.xai).length).toBeGreaterThan(0);
  });

  it('gizli değeri ASLA açığa çıkarmaz — yalnız REDACTED önek raporlar', () => {
    const [hit] = findSecrets(FAKE.claude);
    expect(hit.redacted).toContain('REDACTED');
    expect(hit.redacted).not.toContain(BLK.repeat(2)); // ham gövde sızmaz
  });

  it('BYOK doğrulama REGEX kaynaklarını yanlış-pozitif SAYMAZ', () => {
    // SettingsPage bundle'ında birebir bulunan doğrulama desenleri:
    const regexSources = [
      'sk-ant-[A-Za-z0-9_-]{20,}',
      'gsk_[A-Za-z0-9]{20,}',
      'AIza[0-9A-Za-z_-]{35}',
    ].join(' | ');
    expect(findSecrets(regexSources)).toHaveLength(0);
  });

  it('placeholder metinlerini (sk-ant-... / gsk_...) saymaz', () => {
    expect(findSecrets('gsk_... (manuel giriş) · sk-ant-... (manuel giriş)')).toHaveLength(0);
  });

  it('Firebase public anahtarı (allowlist) saymaz', () => {
    expect(findSecrets('"current_key":"AIzaSyBo_ZhAlSv0jVaOuI4hzeO_GZqmtx172bA"')).toHaveLength(0);
  });

  it('test-fixture anahtarlarını (ABCDEF… zinciri) saymaz', () => {
    expect(findSecrets('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234567')).toHaveLength(0);
  });

  it('temiz metinde bulgu üretmez', () => {
    expect(findSecrets('function foo(){return import.meta.env.VITE_X;}')).toHaveLength(0);
  });
});
