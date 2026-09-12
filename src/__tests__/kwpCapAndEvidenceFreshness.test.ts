/**
 * kwpCapAndEvidenceFreshness.test.ts — #642 KİLİDİ
 * KWP kurtarma tavanı DOĞRU sayaçtan okunur + AI kanıtı sahte tazelik üretmez.
 *
 * ── NEDEN VAR (SAHA KOPYASI, 2026-08-19, gerçek araç, motor çalışır) ────────
 * Kullanıcının gönderdiği CAROS LAB TAM KOPYASINDA iki kusur yan yana duruyordu:
 *
 * (A) `recoveryCount: 4` ve `maxPerSession: 3` alanları yan yana yazılıyordu ve
 *     hem LAB hem `kwpAtLimit` bunları KARŞILAŞTIRIYORDU → "oturum tavanına
 *     ulaşıldı: EVET". Oysa native tarafta tavan kararı YALNIZ
 *     `consecutiveFailedRecoveries`e bakar (KwpRecoveryEvidence.java:181) ve
 *     BAŞARILI kurtarma o seriyi SIFIRLAR — semantik 2026-07-23 P0 saha
 *     düzeltmesinde DEĞİŞMİŞ, gözlem yüzeyi güncellenmemişti. Gerçek sayaç 0'dı;
 *     LAB yalan söylüyordu. Üstelik karar sayacı native'den HİÇ dışa
 *     aktarılmıyordu → doğru cevabı üretmek imkânsızdı.
 *
 * (B) AI kanıtı `recovery.kwp` aynı anda "NOT_ATTEMPTED (ATPC 0×)" diyordu;
 *     canlı otorite ise `RECOVERED · recoveryCount 4 · son kurtarma 3,5 dk önce`.
 *     Sebep: kanıt `getKwpRecoveryEvidence()` ÖNBELLEĞİNDEN okunur, o önbelleği
 *     yalnız rapor üretimi / LAB ekranı açılışı doldurur (periyodik tazeleyici
 *     YOK) — ama damga `observedAt: now` atılıyordu. Yani BAYAT gerçek TAZE
 *     kanıt gibi sunuluyor, AI Mechanic onunla akıl yürütüyordu.
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *   1. `kwpAtLimit` yalnız ardışık BAŞARISIZ sayaçtan türetilir.
 *   2. Sayaç yoksa (eski APK) sonuç `null` = BİLİNMİYOR — oturum toplamından
 *      TÜRETİLMEZ.
 *   3. AI kanıtının damgası snapshot'ın KENDİ zamanıdır; bayatsa güven düşer ve
 *      yaş özete YAZILIR.
 *   4. Damga yoksa "yaş BİLİNMİYOR" denir — sahte tazelik üretilmez.
 *   5. Native snapshot karar sayacını dışa AKTARIR (kaynak kilidi).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveDiagnosticEvidence } from '../platform/aiCore/runtime/diagnosticEvidence';

const NOW = 1_787_115_718_868;

function kwpEvidence(kwp: Record<string, unknown>) {
  const out = deriveDiagnosticEvidence(
    { obdDeep: { kwpRecoveryEvidence: kwp } as never }, NOW,
  );
  return out.find((e) => e.key === 'recovery.kwp') ?? null;
}

describe('#642-A — tavan kararı doğru sayaçtan okunur', () => {
  it('🔒 KAYNAK: hiçbir yüzeyde tavan oturum toplamıyla karşılaştırılmaz', () => {
    /* Sahada bu hesap ÜÇ ayrı yerde vardı ve biri (scheduling `atLimit`) yalnız
       etiketi değil KANAL DURUMUNU (`BLOCKED`) belirliyordu. Bu yüzden kilit tek
       satır değil, DOSYA GENELİ tarar. */
    for (const f of ['runtimeSchedulingBuild.ts', 'sessionInspectorBuild.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/platform/devtools', f), 'utf8');
      expect(src, `${f}: tavan HÂLÂ oturum toplamıyla karşılaştırılıyor`)
        .not.toMatch(/recoveryCount\s*>=\s*\w*\.?maxPerSession/);
      expect(src, `${f}: karar sayacı kullanılmıyor`).toMatch(/consecutiveFailedRecoveries/);
    }
  });

  it('🔒 KAYNAK: native karar sayacını dışa aktarıyor (aktarmazsa doğru cevap İMKÂNSIZ)', () => {
    const plugin = readFileSync(
      join(process.cwd(), 'android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java'), 'utf8');
    expect(plugin, 'plugin consecutiveFailedRecoveries alanını vermiyor')
      .toMatch(/ret\.put\("consecutiveFailedRecoveries"/);
    const ev = readFileSync(
      join(process.cwd(), 'android/app/src/main/java/com/cockpitos/pro/obd/KwpRecoveryEvidence.java'), 'utf8');
    expect(ev, 'Snapshot karar sayacını taşımıyor')
      .toMatch(/public final int consecutiveFailedRecoveries/);
  });

  it('🔒 KAYNAK: sayaç yoksa (eski APK) tavan BİLİNMİYOR kalır', () => {
    const src = readFileSync(join(process.cwd(), 'src/platform/obd/kwpRecoveryEvidence.ts'), 'utf8');
    expect(src, 'eksik alan 0 ile doldurulmuş — sahte kesinlik')
      .toMatch(/consecutiveFailedRecoveries:[\s\S]{0,120}: null/);
  });
});

describe('#642-B — AI kanıtı sahte tazelik üretmez', () => {
  it('🔒 SAHADA ÖLÇÜLEN KUSUR: bayat önbellek "şu an" damgası ALAMAZ', () => {
    const stale = NOW - 210_000;                       // 3,5 dk önce (sahadaki gerçek fark)
    const ev = kwpEvidence({ status: 'NOT_ATTEMPTED', recoveryCount: 0,
      maxCoreNoDataStreak: 0, refreshedAt: stale });
    expect(ev, 'kanıt hiç üretilmedi').not.toBeNull();
    expect(ev!.observedAt, 'damga hâlâ "şu an" — bayat gerçek taze sunuluyor').toBe(stale);
    expect(ev!.summary, 'yaş özete yazılmamış').toMatch(/210sn önce/);
    expect(ev!.confidence, 'bayat kanıt taze kanıtla aynı güvende').toBeLessThan(0.7);
  });

  it('🔒 TAZE önbellek tam güvende ve yaş etiketi TAKILMAZ', () => {
    const ev = kwpEvidence({ status: 'RECOVERED', recoveryCount: 4,
      maxCoreNoDataStreak: 4, consecutiveFailedRecoveries: 0, refreshedAt: NOW - 1_000 });
    expect(ev!.confidence).toBe(0.7);
    expect(ev!.summary).not.toMatch(/sn önce/);
    expect(ev!.summary, 'tavan sayacı özete girmiyor').toMatch(/ardışık 0/);
  });

  it('🔒 DAMGA YOKSA yaş "BİLİNMİYOR" denir (sahte tazelik yasak)', () => {
    const ev = kwpEvidence({ status: 'RECOVERED', recoveryCount: 4, maxCoreNoDataStreak: 4 });
    expect(ev!.summary, 'damgasız önbellek taze gibi sunuluyor').toMatch(/yaş \?/);
    expect(ev!.summary, 'tavan sayacı yokken sessiz kalınmış').toMatch(/ardışık \?/);
  });
  it('🔒 ÖZET TAVANI: tazelik etiketi kesilmemeli (96 karakter sınırı)', () => {
    const ev = kwpEvidence({ status: 'NOT_ATTEMPTED', recoveryCount: 0,
      maxCoreNoDataStreak: 0, refreshedAt: NOW - 210_000 });
    expect(ev!.summary.length, 'özet tavana dayanmış — etiket kesilme riski')
      .toBeLessThanOrEqual(96);
    expect(ev!.summary, 'tazelik etiketi kesilmiş').toMatch(/210sn önce/);
  });
});
