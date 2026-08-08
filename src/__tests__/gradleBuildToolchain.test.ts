/**
 * gradleBuildToolchain.test.ts — APK köprüsünün JDK sürüm çözümü kilitleri.
 *
 * NEDEN VAR (saha 2026-08-08): `npm run apk:safe` gradle aşamasında düşüyordu —
 * `Cannot find a Java installation matching {languageVersion=21}`. Capacitor plugin
 * modülleri JDK 21 toolchain ister, makinedeki `JAVA_HOME` ise JDK 17'yi gösteriyordu.
 * Sürüm ölçümü yanlış olursa köprü ya yanlış JDK seçer ya da çalışan kurulumu
 * "yetersiz" sayıp gereksiz yere devreye girer — bu yüzden ayrıştırıcı kilitlenir.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJavaMajor, REQUIRED_JAVA_MAJOR } from '../../scripts/gradle-build.mjs';

const SRC = readFileSync(join(process.cwd(), 'scripts', 'gradle-build.mjs'), 'utf8');

describe('java sürüm ayrıştırıcısı', () => {
  it('yeni şema (9+) ana sürümü doğru okur', () => {
    expect(parseJavaMajor('openjdk version "21.0.10" 2026-01-20')).toBe(21);
    expect(parseJavaMajor('openjdk version "17.0.19" 2026-04-21')).toBe(17);
    expect(parseJavaMajor('java version "24" 2025-03-18')).toBe(24);
  });

  it('eski 1.x şemasını ana sürüme çevirir (1.8 → 8)', () => {
    expect(parseJavaMajor('java version "1.8.0_401"')).toBe(8);
    expect(parseJavaMajor('java version "1.7.0_80"')).toBe(7);
  });

  it('ölçemediğinde null döner — sahte 0 ÜRETMEZ', () => {
    // "ölçülemedi" ile "çok eski" aynı şey değildir: 0 dönseydi köprü yanlışlıkla
    // "yetersiz JDK" hükmü verirdi.
    for (const bad of ['', 'command not found', 'version "x"', 'garbage']) {
      expect(parseJavaMajor(bad)).toBeNull();
    }
    expect(parseJavaMajor(undefined as unknown as string)).toBeNull();
    expect(parseJavaMajor(null as unknown as string)).toBeNull();
  });

  it('gereken en düşük sürüm capacitor toolchain ile aynı (21)', () => {
    expect(REQUIRED_JAVA_MAJOR).toBe(21);
  });
});

describe('köprü davranış kilitleri', () => {
  it('JDK bulunamazsa build ENGELLENMEZ (fail-soft)', () => {
    // Erken çıkış eklenirse gradle'ın kendi toolchain auto-detection'ı hiç denenmez
    // ve çalışan kurulumlarda APK üretimi yanlış yere durur.
    const warnBlock = SRC.slice(SRC.indexOf('Fail-soft'));
    expect(warnBlock).toContain('console.warn');
    expect(warnBlock.slice(0, warnBlock.indexOf('return process.env')))
      .not.toMatch(/process\.exit/);
  });

  it('kullanıcının kabuk ortamı KALICI değiştirilmez — yalnız çağrı ortamı', () => {
    // `process.env.JAVA_HOME = ...` ataması olsaydı köprü çağıranın ortamını ezerdi.
    expect(SRC).not.toMatch(/process\.env\.JAVA_HOME\s*=/);
    expect(SRC).toMatch(/\{\s*\.\.\.process\.env,\s*JAVA_HOME:/);
  });

  it('gradle çıkış kodu yukarı taşınır — sessiz başarı YOK', () => {
    // Eski saha kusuru: zincir exit 0 dönüp bayat APK bırakıyordu.
    expect(SRC).toMatch(/process\.exit\(result\.status \?\? 1\)/);
  });

  it('import edildiğinde yan etki üretmez (main guard)', () => {
    // Bu dosyanın import edilebilmesi zaten kanıt; guard'ın kaldırılmadığını da kilitle.
    expect(SRC).toMatch(/import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  });
});
