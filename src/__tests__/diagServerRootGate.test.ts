/**
 * Teşhis HTTP sunucusu (port 8899, tüm arayüzler, kimlik doğrulamasız) ROOT uçları.
 *
 * KÖK (inceleme 2026-09-29): `/enable-adb` (root ile ağ ADB'si → cihazın tam kontrolü)
 * ve `/root-check` yalnız `BuildConfig.DEBUG` ile kapılıydı. Dağıtılan APK `apk:safe`
 * → `assembleDebug` olduğundan bu kapı dağıtımda AÇIKTI; JS tarafı sunucuyu yalnız
 * `import.meta.env.DEV`'de başlatsa da WebView'da çalışan herhangi bir kod native
 * metodu çağırabilir. Root uçları artık açık opt-in (`-PcarosRootDiag=true`) ister.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

describe('teşhis sunucusu root uçları', () => {
  const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
  const gradle = read('android/app/build.gradle');

  it('root uçları DEBUG + açık opt-in ister', () => {
    for (const ep of ['/root-check', '/enable-adb']) {
      const re = new RegExp(`if \\(BuildConfig\\.DEBUG && BuildConfig\\.ROOT_DIAG_ENABLED && "${ep}"\\.equals\\(path\\)\\)`);
      expect(plugin, `${ep} kapısı gevşemiş`).toMatch(re);
    }
    // Kapısız root kabuğu çağrısı yok: runRootShell yalnız bu iki uçta.
    expect(plugin.split('runRootShell(').length - 1).toBe(3);   // 2 çağrı + 1 tanım
  });

  it('opt-in varsayılanı kapalı; release\'te her zaman kapalı', () => {
    expect(gradle).toMatch(/buildConfigField "boolean", "ROOT_DIAG_ENABLED",\s*\(project\.findProperty\('carosRootDiag'\) == 'true'\) \? 'true' : 'false'/);
    const release = gradle.slice(gradle.indexOf('buildTypes {'), gradle.indexOf('debug {', gradle.indexOf('buildTypes {')));
    expect(release).toContain(`buildConfigField "boolean", "ROOT_DIAG_ENABLED", 'false'`);
  });

  it('uygulama sunucuyu yalnız geliştirme derlemesinde başlatır', () => {
    const panel = read('src/components/obd/DTCPanel.tsx');
    expect(panel).toMatch(/if \(import\.meta\.env\.DEV\) \{[\s\S]{0,200}CarLauncher\.startDiagServer/);
    const calls = panel.split('startDiagServer?.()').length - 1;
    expect(calls).toBe(1);
  });
});
