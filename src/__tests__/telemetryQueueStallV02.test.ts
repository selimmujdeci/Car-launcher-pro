/**
 * telemetryQueueStallV02.test.ts — V-02: TELEMETRİ KUYRUĞU SÜRESİZ SUSAMAZ.
 *
 * ── ÖLÇÜLEN KUSUR (gerçek cihaz, Xiaomi 23090RA98I, CDP ağ yakalaması,
 *    2026-09-18) ─────────────────────────────────────────────────────────────
 * Araç eşleşmiş, `fetch_pending_vehicle_commands` 200 dönüyor ve tema komutları
 * çalışıyorken `push_vehicle_event` 38 DAKİKA boyunca HİÇ gitmedi. Uygulama
 * yeniden başlatılınca 17:53 ve 18:00'e ait `update_command_status` kayıtları
 * ve bekleyen heartbeat'ler TOPLU HÂLDE aktı — hepsi HTTP 200 aldı.
 *
 * Yani şema, RPC ve api_key SAĞLAMDI (066 production'da uygulanmış; `fuel`
 * nullable, DEFAULT yok). Tıkanan tek şey `connectivityService` KUYRUĞUYDU.
 * PWA aracı doğru gösteriyordu: `vehicle_telemetry.updated_at` gerçekten
 * bayattı. Yalan yoktu — ÜRETİCİ susmuştu.
 *
 * ── KÖK ──────────────────────────────────────────────────────────────────────
 * Hüküm `ConnectivityAuthority`de ÖNBELLEKLENİR; `recompute()` YALNIZ yeni veya
 * silinen kanıtta çalışır (okumada ve zamanla ÇALIŞMAZ). `isEvidenceStale` ise
 * `continuous` kanıta HİÇ uygulanmaz. `ANDROID_NETWORK_CALLBACK` hem sürekli
 * hem en yüksek güvendedir (100) → o gözlemci bir kez olumsuz deyip SUSARSA
 * hüküm SÜREÇ ÖMRÜ BOYUNCA çivilenir. Doğrudan `fetch` yapan yollar bu kapıya
 * bakmadığı için çalışmaya devam eder: "tema gidiyor ama araç offline".
 *
 * Kusurun ikinci yarısı saf canlılıktı: kapı kapalıyken `_drainQueue` koşulsuz
 * `return` ediyordu (dolayısıyla `finally`ye HİÇ girilmiyor, yeniden deneme
 * timer'ı KURULMUYORDU) ve `enqueue` zinciri yalnız kapı AÇIKKEN başlatıyordu.
 *
 * Buradaki kilitler kusurun her iki yarısını da geri getiren değişiklikte DÜŞER.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { shouldAttemptQueuedDelivery } from '../platform/connectivityService';
import { UNKNOWN_SNAPSHOT } from '../platform/connectivity/connectivityEvidence';

/** Yorumları söker — bir kuralı AÇIKLAYAN yorum ihlal sanılmasın (§18). */
function codeOf(rel: string): string {
  return readFileSync(resolve(__dirname, '../', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

type Snap = Parameters<typeof shouldAttemptQueuedDelivery>[1];

const snap = (over: Partial<Snap> = {}): Snap => ({
  state:         'OFFLINE',
  captivePortal: false,
  evidenceAgeMs: 0,
  ...over,
});

/* ── 1. Bayat olumsuz hüküm kuyruğu kilitleyemez ───────────────────────── */

describe('V-02 · bayat olumsuz hüküm kuyruğu SÜRESİZ kilitleyemez', () => {
  it('1. 🔒 kapı açıksa tartışma yok — daima denenir', () => {
    expect(shouldAttemptQueuedDelivery(true, snap({ state: 'ONLINE' }))).toBe(true);
    /* Kapı açıkken captive bile olsa karar kapının: bu fonksiyon hüküm üretmez. */
    expect(shouldAttemptQueuedDelivery(true, snap({ state: 'CAPTIVE' }))).toBe(true);
  });

  it('2. 🔒 olumsuz + kanıt TAZE → DURULUR (kanıtlanmış çevrimdışı)', () => {
    expect(shouldAttemptQueuedDelivery(false, snap({ state: 'OFFLINE', evidenceAgeMs: 0 }))).toBe(false);
    expect(shouldAttemptQueuedDelivery(false, snap({ state: 'LOCAL_ONLY', evidenceAgeMs: 30_000 }))).toBe(false);
  });

  it('3. 🔒 olumsuz + kanıt BAYAT → BİR DENEME HAKKI (V-02 düzeltmesi)', () => {
    /* MUTASYON KAPISI: eskiden bu da `false` idi ve kuyruk susuyordu. */
    expect(shouldAttemptQueuedDelivery(false, snap({ state: 'OFFLINE',    evidenceAgeMs: 120_000 }))).toBe(true);
    expect(shouldAttemptQueuedDelivery(false, snap({ state: 'LOCAL_ONLY', evidenceAgeMs: 10 * 60_000 }))).toBe(true);
  });

  it('4. 🔒 eşik KESKİN: hemen altı DUR, eşik ve üstü DENE', () => {
    expect(shouldAttemptQueuedDelivery(false, snap({ evidenceAgeMs: 119_999 }))).toBe(false);
    expect(shouldAttemptQueuedDelivery(false, snap({ evidenceAgeMs: 120_000 }))).toBe(true);
  });
});

/* ── 2. CAPTIVE istisnası KORUNUR ──────────────────────────────────────── */

describe('V-02 · CAPTIVE bilinçli istisnadır, yaş onu affetmez', () => {
  it('5. 🔒 CAPTIVE + çok bayat kanıt → yine DURULUR', () => {
    expect(shouldAttemptQueuedDelivery(false, snap({ state: 'CAPTIVE', evidenceAgeMs: 60 * 60_000 }))).toBe(false);
  });

  it('6. 🔒 captivePortal bayrağı tek başına yeter', () => {
    expect(shouldAttemptQueuedDelivery(
      false, snap({ state: 'OFFLINE', captivePortal: true, evidenceAgeMs: 60 * 60_000 }),
    )).toBe(false);
  });

  it('7. 🔒 kanıtsız başlangıç hükmü (UNKNOWN_SNAPSHOT) captive DEĞİLDİR', () => {
    expect(UNKNOWN_SNAPSHOT.captivePortal).not.toBe(true);
  });
});

/* ── 3. Yeniden deneme zinciri KOPMAZ ──────────────────────────────────── */

describe('V-02 · kuyruk kendi canlılığını dışarıdan gelen bir kenara bağlamaz', () => {
  const svc = codeOf('platform/connectivityService.ts');

  it('8. 🔒 enqueue zinciri kapı AÇIKKEN şartına bağlanmaz', () => {
    /* MUTASYON KAPISI: eski hâli `if (this._online && !this._running)` idi →
       kapı kapalıyken eklenen öğe HİÇBİR ZAMAN zincir başlatmıyordu. */
    expect(svc).not.toMatch(/if\s*\(\s*this\._online\s*&&\s*!this\._running\s*\)/);
    expect(svc).toMatch(/if\s*\(\s*!this\._running\s*\)/);
  });

  it('9. 🔒 _drainQueue kapalı kapıda KOŞULSUZ return etmez', () => {
    /* Eski hâl: `if (this._running || !this._online) return;` — `finally`ye hiç
       girilmediği için timer da kurulmuyordu. */
    expect(svc).not.toMatch(/if\s*\(\s*this\._running\s*\|\|\s*!this\._online\s*\)\s*return/);
  });

  it('10. 🔒 kalan öğe varsa timer kurulumu `_online` şartına bağlı değildir', () => {
    expect(svc).not.toMatch(/remaining\.length\s*>\s*0\s*&&\s*this\._online/);
    expect(svc).toMatch(/remaining\.length\s*>\s*0/);
  });

  it('11. 🔒 tek timer otoritesi korunur (çift zamanlayıcı yok)', () => {
    expect(svc).toMatch(/_scheduleDrain\s*\(/);
    /* `_scheduleDrain` içinde önce mevcut timer temizlenir. */
    expect(svc).toMatch(/clearTimeout\(this\._timer\)/);
  });
});
