/**
 * pushArchitectureSeparationF52.test.ts — İKİ PUSH SİSTEMİ AYRI KALIR.
 *
 * ── TEMEL İLKE ──────────────────────────────────────────────────────────
 *   İNSANA BİLDİRİM  ≠  ARACI UYANDIRMA
 *
 *   consumer-push-notify : Web Push / VAPID → `push_subscriptions`
 *                          → İNSANA görünür bildirim → `/kumanda`
 *   push-notify (website): FCM data-only     → `vehicle_push_tokens`
 *                          → ARACI uyandırır (Push-to-Wake), bildirim YOK
 *
 * ── ÖLÇÜLEN KUSUR (F5.1, 2026-09-18) ───────────────────────────────────
 * İKİSİ de `push-notify` slug'ını paylaşıyordu. Bir slug'a yalnız BİRİ deploy
 * edilebildiği için production'da FCM sürümü canlıydı ve tüketici Web Push
 * yolu TAMAMEN ÖLÜYDÜ. Ölçüm: `GET /functions/v1/push-notify` → HTTP 405
 * "Method Not Allowed" — bu düz-metin yanıt YALNIZ FCM sürümünün ilk
 * satırındaki method kapısından çıkar; Web Push sürümünde öyle bir kapı yok.
 *
 * Buradaki kilitler, iki sistemin yeniden aynı slug'a düşmesine veya
 * backend'lerinin karışmasına izin veren her değişiklikte DÜŞER.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../');
const CONSUMER_DIR = resolve(ROOT, 'supabase/functions/consumer-push-notify');
const VEHICLE_DIR  = resolve(ROOT, 'website/supabase/functions/push-notify');

const read = (p: string) => readFileSync(p, 'utf8');
/**
 * Yorumları söker — bir kuralı AÇIKLAYAN yorum ihlal sanılmasın.
 *
 * `://` KORUNUR: naif bir `//` sökücüsü `https://fcm.googleapis.com/...`
 * URL'ini de yorum sanıp siler ve ölçüm YANLIŞ DÜŞER (bu testi yazarken
 * fiilen yaşandı). Satır yorumu yalnız `:` ile ÖNCELENMEYEN `//`dır.
 */
const codeOf = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

/* ── 1. Slug çakışması geri gelemez ────────────────────────────────────── */

describe('F5.2 · slug çakışması regresyon kilidi', () => {
  it('1. 🔒 iki implementasyon AYRI dizinlerde/slug\'larda durur', () => {
    expect(existsSync(resolve(CONSUMER_DIR, 'index.ts'))).toBe(true);
    expect(existsSync(resolve(VEHICLE_DIR, 'index.ts'))).toBe(true);
  });

  it('2. 🔒 kökte `push-notify` adlı bir fonksiyon ARTIK YOK', () => {
    /* MUTASYON KAPISI: geri eklenirse `supabase functions deploy push-notify`
       hangi dizinden koşulduğuna göre diğerini EZERDİ. */
    expect(existsSync(resolve(ROOT, 'supabase/functions/push-notify'))).toBe(false);
  });

  it('3. 🔒 iki fonksiyon kümesinin slug adları KESİŞMEZ', () => {
    const rootSlugs = readdirSync(resolve(ROOT, 'supabase/functions'));
    const siteSlugs = readdirSync(resolve(ROOT, 'website/supabase/functions'));
    const overlap = rootSlugs.filter((s) => siteSlugs.includes(s));
    expect(overlap).toEqual([]);
  });
});

/* ── 2. Backend'ler karışmaz ───────────────────────────────────────────── */

describe('F5.2 · tarayıcı aboneliği ile araç token\'ı ayrı depolardır', () => {
  const consumer = codeOf(resolve(CONSUMER_DIR, 'index.ts'));
  const vehicle  = codeOf(resolve(VEHICLE_DIR, 'index.ts'));

  it('4. 🔒 tüketici fonksiyonu `vehicle_push_tokens` OKUMAZ', () => {
    expect(consumer).not.toContain('vehicle_push_tokens');
  });

  it('5. 🔒 araç-uyandırma fonksiyonu `push_subscriptions` OKUMAZ', () => {
    expect(vehicle).not.toContain('push_subscriptions');
  });

  it('6. 🔒 her biri KENDİ taşıyıcısını kullanır', () => {
    expect(consumer).toContain('push_subscriptions');
    expect(consumer).toMatch(/web-push|webpush/);
    expect(vehicle).toContain('vehicle_push_tokens');
    expect(vehicle).toMatch(/fcm\.googleapis\.com/i);
  });

  it('7. 🔒 araç-uyandırma GÖRÜNÜR bildirim göndermez (data-only kalır)', () => {
    /* `notification` bloğu FCM payload'ına girerse araç sessiz uyanmaz,
       kullanıcının telefonunda/ekranında bildirim belirir. */
    expect(vehicle).not.toMatch(/message:\s*\{[\s\S]*notification:/);
  });
});

/* ── 3. Tüketici fonksiyonu filo yüzeyine yönlendiremez ────────────────── */

describe('F5.2 · ürün sınırı kaynakta da korunur', () => {
  const consumer = codeOf(resolve(CONSUMER_DIR, 'index.ts'));

  it('8. 🔒 tüketici bildirimi hedefi olarak `/dashboard` ÜRETMEZ', () => {
    /* `sw.js` allowlist'i zaten reddeder; kaynakta da doğru olmalı ki
       "reddedildi" sessiz bir kayıp değil, hiç oluşmayan bir hata olsun. */
    expect(consumer).not.toContain('/dashboard');
  });

  it('9. 🔒 tüketici bildirimi `/kumanda` hedefler', () => {
    expect(consumer).toContain('/kumanda');
  });

  it('10. 🔒 alıcılar KANONİK araç↔kullanıcı otoritesinden çözülür', () => {
    /* `vehicle_users` canlıda mevcut ama kanonik DEĞİL: production RLS
       `is_paired()` → `vehicle_pairings` ve `vehicles.owner_id` kullanır.
       Tüketici eşleştirmesi `vehicle_pairings`e yazar. */
    expect(consumer).toContain('vehicle_pairings');
    expect(consumer).not.toContain("from('vehicle_users')");
  });
});

/* ── 4. Secret tarayıcıya çıkmaz ───────────────────────────────────────── */

describe('F5.2 · secret sınırı', () => {
  it('11. 🔒 VAPID ÖZEL anahtarı yalnız Edge Function tarafında okunur', () => {
    const consumer = read(resolve(CONSUMER_DIR, 'index.ts'));
    expect(consumer).toContain('VAPID_PRIVATE_KEY');
    /* Deno.env = sunucu tarafı. `NEXT_PUBLIC_` öneki client bundle'a girer. */
    expect(consumer).not.toContain('NEXT_PUBLIC_VAPID_PRIVATE');
  });

  it('12. 🔒 istemci push motoru YALNIZ public anahtarı okur', () => {
    const engine = codeOf(resolve(ROOT, 'website/src/lib/pushEngine.ts'));
    expect(engine).toContain('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    expect(engine).not.toContain('VAPID_PRIVATE_KEY');
    expect(engine).not.toContain('SERVICE_ROLE');
  });

  it('13. 🔒 istemci push motoru endpoint/anahtar LOGLAMAZ', () => {
    const engine = codeOf(resolve(ROOT, 'website/src/lib/pushEngine.ts'));
    expect(engine).not.toMatch(/console\.(log|warn|error|info)/);
  });
});
