/**
 * buildStamp.ts — Derleme kimliği (hangi commit'ten, değişiklikli mi, ne zaman). SAF.
 *
 * NEDEN: cihazda test edilen APK'nın gerçekten düzeltilmiş koddan üretildiği hiçbir
 * yerde kanıtlanmıyordu. Saha tuzağı: yanlış çalışma kopyası/dal, `cap sync` atlanması,
 * eski `dist`, sessizce başarısız `adb install` ya da OTA'nın eski APK'yı geri kurması —
 * hepsi "eski kodla test" üretir ve hiçbiri görünür değildi.
 *
 * TEK KAYNAK: vite.config bu modülle damgayı ÜRETİR (define + `dist/build-stamp.json`);
 * `scripts/apk-dev.mjs` aynı dosyayı dist → assets/public → APK zincirinde DOĞRULAR;
 * Gradle debug `versionName` soneki aynı dosyadan okunur → cihazda `dumpsys package`
 * ile görünür. Gizli veri YOK: kısa commit, dal adı, zaman, değişiklik bayrağı.
 *
 * Saf string mantığı (fs/child_process yok) — vite.config (node), betik ve vitest aynı kodu kullanır.
 */

export const BUILD_STAMP_FILE = 'build-stamp.json';
export const UNKNOWN_COMMIT = 'unknown';

export interface BuildStamp {
  /** `git rev-parse --short HEAD`; git yoksa 'unknown'. */
  commit: string;
  /** Çalışma ağacında commit'lenmemiş değişiklik var mı; ölçülemediyse null (bilinmiyor). */
  dirty: boolean | null;
  /** `git rev-parse --abbrev-ref HEAD`; bilinmiyorsa 'unknown'. */
  branch: string;
  /** Derleme zamanı (ISO-8601, UTC). */
  time: string;
}

/** Git komutu çalıştırıcı: başarılıysa stdout, değilse null. */
export type GitRunner = (args: string) => string | null;

/**
 * Damgayı hesaplar. Git yoksa derleme DÜŞMEZ — alanlar 'unknown'/null olur
 * (sahte commit veya "temiz" üretilmez).
 */
export function computeBuildStamp(git: GitRunner, now: Date): BuildStamp {
  const commit = (git('rev-parse --short HEAD') ?? '').trim();
  const branch = (git('rev-parse --abbrev-ref HEAD') ?? '').trim();
  const status = git('status --porcelain');
  return {
    commit: commit.length > 0 ? commit : UNKNOWN_COMMIT,
    dirty: status === null ? null : status.trim().length > 0,
    branch: branch.length > 0 ? branch : UNKNOWN_COMMIT,
    time: now.toISOString(),
  };
}

/** Güvenilmez JSON'dan damga; şema dışıysa null. */
export function parseBuildStamp(raw: unknown): BuildStamp | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.commit !== 'string' || r.commit.length === 0) return null;
  if (!(typeof r.dirty === 'boolean' || r.dirty === null)) return null;
  if (typeof r.branch !== 'string' || typeof r.time !== 'string') return null;
  return { commit: r.commit, dirty: r.dirty, branch: r.branch, time: r.time };
}

/** Derleme kimliği: zamanın sıkıştırılmış hâli (`20261001T071234`) — her derleme TEKİLDİR. */
export function stampBuildId(time: string): string {
  return time.replace(/[-:]/g, '').slice(0, 15);
}

/**
 * Gradle debug `versionName` sonekiyle AYNI biçim:
 *   `<commit>.<buildId>` ya da `<commit>.dirty.<buildId>`
 * buildId sayesinde aynı commit üzerinde commit'lenmemiş değişiklikle yapılan İKİ
 * derleme de ayırt edilir (yalnız `.dirty` ikisinde de aynı olurdu).
 * `build.gradle` bu biçimi Groovy'de, `scripts/lib/apkProvenance.mjs` JS'te üretir —
 * üçünün eşitliği testle kilitlidir.
 */
export function stampVersionTag(s: Pick<BuildStamp, 'commit' | 'dirty' | 'time'>): string {
  const base = s.dirty === true ? `${s.commit}.dirty` : s.commit;
  return `${base}.${stampBuildId(s.time)}`;
}

/** Kullanıcıya gösterilen tek satır. */
export function formatBuildStamp(s: BuildStamp): string {
  const t = s.time.length >= 16 ? `${s.time.slice(0, 10)} ${s.time.slice(11, 16)} UTC` : s.time;
  const dirty = s.dirty === true ? ' · commit\'lenmemiş değişiklikli' : s.dirty === null ? ' · değişiklik durumu bilinmiyor' : '';
  return `${s.commit} · ${s.branch} · ${t}${dirty}`;
}
