/**
 * gradle-build.mjs — Gradle wrapper'ı SHELL-BAĞIMSIZ çağıran köprü.
 *
 * NEDEN (saha 2026-07-23): apk:safe / release:apk / release:aab script'leri
 * `cd android && gradlew ...` kullanıyordu. npm Windows'ta script'leri cmd.exe ile
 * koşar ve cmd geçerli dizini PATH'te ARAMAZ → bare `gradlew` "not recognized"
 * verip SESSİZCE başarısız oluyordu (npm zinciri exit 0 dönse bile eski/bayat APK
 * kalıyordu — "temiz APK" garantisi sahte). `.\gradlew` denemesi de kırılgan:
 * JSON escape + npm + cmd katmanları arasında backslash tüketiliyor.
 *
 * ÇÖZÜM: gradle'ı Node ile spawn et — cwd AÇIKÇA `android/`, wrapper platforma
 * göre seçilir (Windows: gradlew.bat, POSIX: ./gradlew). Böylece shell tırnak/
 * backslash oyunlarına HİÇ girilmez ve gradle hata kodu DOĞRUDAN yukarı taşınır
 * (başarısız derleme → non-zero exit → apk:safe APK üretmez). Tek karar noktası.
 *
 * Kullanım: node scripts/gradle-build.mjs clean assembleDebug
 *           node scripts/gradle-build.mjs assembleRelease
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const tasks = process.argv.slice(2);
if (tasks.length === 0) {
  console.error('gradle-build: en az bir gradle görevi gerekir (ör. assembleDebug).');
  process.exit(2);
}

const androidDir = join(process.cwd(), 'android');
if (!existsSync(androidDir)) {
  console.error(`gradle-build: android dizini bulunamadı: ${androidDir}`);
  process.exit(2);
}

const isWindows = process.platform === 'win32';

// Windows: gradlew.bat batch dosyasıdır → cmd (shell) gerekir. Mutlak yol kullanılır
// (cmd'nin "geçerli dizini PATH'te aramama" davranışına takılmamak için) VE yol boşluk
// içerebildiğinden (ör. "caros pro") shell:true'da MANUEL tırnaklanır — Node shell:true'da
// otomatik tırnaklamaz, tırnaksız boşluklu yol komutu ortadan böler.
// POSIX: ./gradlew (cwd android) yeterli, shell gerekmez.
const command = isWindows ? `"${join(androidDir, 'gradlew.bat')}"` : './gradlew';

console.log(`[gradle-build] ${command} ${tasks.join(' ')}  (cwd=${androidDir})`);

const result = spawnSync(command, tasks, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
});

if (result.error) {
  console.error(`[gradle-build] gradle çalıştırılamadı: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
