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
 * NEDEN-2 (saha 2026-08-08): `apk:safe` bu makinede gradle aşamasında düşüyordu —
 * `Cannot find a Java installation matching {languageVersion=21}`. Capacitor plugin
 * modülleri **JDK 21 toolchain** ister; `JAVA_HOME` ise JDK 17'yi gösteriyordu.
 * Android Studio kendi JBR'sini (JDK 21) taşır ama gradle onu CLI'dan görmez.
 * Bu köprü artık JAVA_HOME'un sürümünü ÖLÇER, yetersizse bilinen konumlarda
 * JDK 21+ arar ve gradle'a yalnız o çağrı için geçirir.
 * **Fail-soft:** uygun JDK bulunamazsa iş DURDURULMAZ — uyarılır ve gradle kendi
 * toolchain auto-detection'ını denemeye bırakılır (yanlış pozitifle build engellenmez).
 *
 * Kullanım: node scripts/gradle-build.mjs clean assembleDebug
 *           node scripts/gradle-build.mjs assembleRelease
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const isWindows = process.platform === 'win32';

/* ── JDK toolchain çözümü ─────────────────────────────────────────────────── */

/** Capacitor plugin modüllerinin istediği en düşük Java dili sürümü. */
export const REQUIRED_JAVA_MAJOR = 21;

/**
 * `java -version` çıktısından ANA sürümü çıkarır. Saf fonksiyon — kilitlenebilir.
 * Hem eski (`"1.8.0_401"`) hem yeni (`"21.0.10"`) biçimi tanır; ölçemezse `null`
 * döner (0 DEĞİL — "ölçülemedi" ile "çok eski" aynı şey değildir).
 */
export function parseJavaMajor(versionOutput) {
  if (typeof versionOutput !== 'string') return null;
  const m = versionOutput.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const first = Number(m[1]);
  if (!Number.isFinite(first)) return null;
  // 1.8 → 8 · 1.7 → 7 (eski şema); 9+ zaten ana sürümdür.
  if (first === 1) {
    const second = Number(m[2]);
    return Number.isFinite(second) ? second : null;
  }
  return first;
}

function javaMajorOf(javaHome) {
  if (!javaHome) return null;
  const bin = join(javaHome, 'bin', isWindows ? 'java.exe' : 'java');
  if (!existsSync(bin)) return null;
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  if (r.error) return null;
  return parseJavaMajor(`${r.stderr ?? ''}${r.stdout ?? ''}`);
}

/** Android Studio JBR'si JDK 21 taşır; gradle onu CLI'dan kendiliğinden görmez. */
function candidateJavaHomes() {
  const c = [process.env.JAVA_HOME, process.env.JDK_HOME];
  if (isWindows) {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const local = process.env['LOCALAPPDATA'] ?? '';
    c.push(join(pf, 'Android', 'Android Studio', 'jbr'));
    if (local) c.push(join(local, 'Programs', 'Android Studio', 'jbr'));
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Android Studio.app/Contents/jbr/Contents/Home');
  } else {
    c.push('/opt/android-studio/jbr', '/usr/local/android-studio/jbr');
  }
  return c.filter(Boolean);
}

/**
 * Gradle'a verilecek ortamı hazırlar. JAVA_HOME zaten yeterliyse HİÇ dokunulmaz
 * (mevcut davranış birebir korunur); değilse yalnız bu çağrı için değiştirilir —
 * kullanıcının kabuk ortamı kalıcı olarak DEĞİŞTİRİLMEZ.
 */
function resolveBuildEnv() {
  const current = javaMajorOf(process.env.JAVA_HOME);
  if (current !== null && current >= REQUIRED_JAVA_MAJOR) return process.env;

  for (const home of candidateJavaHomes()) {
    const major = javaMajorOf(home);
    if (major !== null && major >= REQUIRED_JAVA_MAJOR) {
      console.log(
        `[gradle-build] JAVA_HOME (Java ${current ?? 'ölçülemedi'}) toolchain için yetersiz — ` +
        `bu çağrıda Java ${major} kullanılıyor: ${home}`,
      );
      return { ...process.env, JAVA_HOME: home };
    }
  }

  // Fail-soft: engelleme. Gradle kendi auto-detection'ını deneyebilir.
  console.warn(
    `[gradle-build] UYARI: Java ${REQUIRED_JAVA_MAJOR}+ bulunamadı ` +
    `(JAVA_HOME=${process.env.JAVA_HOME ?? 'tanımsız'}, ölçülen=${current ?? 'ölçülemedi'}). ` +
    'Gradle "Cannot find a Java installation matching {languageVersion=21}" verirse sebebi budur.',
  );
  return process.env;
}

/* ── Çalıştırma ───────────────────────────────────────────────────────────── */

function main() {
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
    env: resolveBuildEnv(),
  });

  if (result.error) {
    console.error(`[gradle-build] gradle çalıştırılamadı: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

// Yalnız DOĞRUDAN çalıştırıldığında koşar; import edildiğinde (kilit testleri)
// hiçbir yan etki üretmez — aksi hâlde import `process.exit(2)` tetiklerdi.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
