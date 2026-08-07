/**
 * bootReceiverSurfaceGuard.test.ts — dışa açık BOOT yüzeyinin MANİFEST kilidi.
 *
 * KÖK (APK içi manifest denetimi, kütük #144): `BootReceiver` `exported="true"` ve
 * permission'sız. `BOOT_COMPLETED` / `LOCKED_BOOT_COMPLETED` AOSP'de **protected
 * broadcast**'tir (yalnız sistem yollayabilir, açık component'e bile). Ama
 * `QUICKBOOT_POWERON` korumalı listede DEĞİLDİR → üçüncü taraf bir uygulama sahte
 * yollayıp GPS foreground servisini ve kalıcı bildirimi başlatabiliyordu.
 *
 * KİLİTLENEN SÖZLEŞME (davranış, metin değil):
 *  1. BootReceiver manifest'te DURUR ve meşru açılış action'larını dinler
 *     (otomatik başlatma ürün invaryantı — "launcher asla kapalı kalmamalı").
 *  2. `exported` true KALIR — false yapmak sistem açılış yayınlarını KESER.
 *  3. Manifest'te `QUICKBOOT_POWERON` varsa, Java tarafında zaman kapısı ZORUNLUDUR.
 *     (Kapıyı silip action'ı bırakmak = sertleştirmenin sessizce geri alınması.)
 *  4. Kabul kararı bilinmeyen action'da fail-closed olmalı (`return false`).
 *
 * Java davranış testleri ayrıca `android/app/src/test/.../BootReceiverActionGateTest.java`
 * içinde (JVM, cihazsız) koşar — bu dosya yalnız MANİFEST↔KOD tutarlılığını kilitler.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MANIFEST = readFileSync(
  join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8',
);
const RECEIVER = readFileSync(
  join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'cockpitos', 'pro', 'BootReceiver.java'),
  'utf8',
);

/** Manifest'teki <receiver …BootReceiver …> … </receiver> bloğu. */
function bootReceiverBlock(): string {
  const start = MANIFEST.indexOf('.BootReceiver');
  expect(start, 'BootReceiver manifest\'ten KALDIRILMAMALI (otomatik başlatma kırılır)')
    .toBeGreaterThan(-1);
  const end = MANIFEST.indexOf('</receiver>', start);
  expect(end).toBeGreaterThan(start);
  return MANIFEST.slice(start, end);
}

describe('BOOT yüzeyi — manifest kilidi', () => {
  it('BootReceiver kayıtlı ve meşru açılış action\'larını dinliyor', () => {
    const block = bootReceiverBlock();
    expect(block, 'BOOT_COMPLETED şart').toContain('android.intent.action.BOOT_COMPLETED');
    expect(block, 'Direct Boot (LOCKED_BOOT_COMPLETED) şart')
      .toContain('android.intent.action.LOCKED_BOOT_COMPLETED');
  });

  it('exported=true KALIR — false yapmak sistem açılış yayınını keser', () => {
    expect(bootReceiverBlock()).toMatch(/android:exported\s*=\s*"true"/);
  });

  it('KORUMASIZ QUICKBOOT_POWERON manifest\'te ise zaman kapısı ZORUNLU', () => {
    const declared = bootReceiverBlock().includes('android.intent.action.QUICKBOOT_POWERON');
    if (!declared) return; // action kaldırıldıysa dış yüzey zaten yok — kapı gerekmez
    expect(RECEIVER, 'kapı sabiti silinmiş — sahte broadcast yüzeyi geri açılır')
      .toContain('QUICKBOOT_MAX_UPTIME_MS');
    expect(RECEIVER, 'kapı gerçek açılış süresinden okumalı (SystemClock.elapsedRealtime)')
      .toContain('SystemClock.elapsedRealtime()');
    // Kapı, QUICKBOOT dalında GERÇEKTEN uygulanmalı: pencere karşılaştırması olmadan
    // action'ı kabul etmek sertleştirmeyi sessizce geri alır.
    const gate = RECEIVER.slice(RECEIVER.indexOf('static boolean isAcceptedBootAction'));
    const body = gate.slice(0, gate.indexOf('\n    }'));
    expect(body).toMatch(/ACTION_QUICKBOOT\.equals\(action\)[\s\S]*QUICKBOOT_MAX_UPTIME_MS/);
  });

  it('karar fail-closed: bilinmeyen action hiçbir şey başlatmaz', () => {
    const gate = RECEIVER.slice(RECEIVER.indexOf('static boolean isAcceptedBootAction'));
    const body = gate.slice(0, gate.indexOf('\n    }'));
    expect(body.trimEnd(), 'varsayılan dal false OLMALI').toMatch(/return false;\s*(\/\/[^\n]*)?$/);
    expect(RECEIVER, 'onReceive kapıyı ATLAYAMAZ')
      .toContain('if (!isAcceptedBootAction(action, SystemClock.elapsedRealtime()))');
  });

  it('komut yüzeyleri dışa açık DEĞİL (bu turda da bozulmadı)', () => {
    for (const name of ['.CommandService', '.CommandBroadcastReceiver']) {
      const i = MANIFEST.indexOf(name);
      expect(i, `${name} manifest'te bulunmalı`).toBeGreaterThan(-1);
      const seg = MANIFEST.slice(i, i + 400);
      expect(seg, `${name} exported OLMAMALI`).toMatch(/android:exported\s*=\s*"false"/);
    }
  });
});
