/**
 * transport.mjs — Cihaz transport SÖZLEŞMESİ ve TEK GİRİŞ: createTransport().
 *
 * PR-2 kapsamı: yalnız iletişim katmanı. Uygulamaya müdahale YOK, performans
 * ölçümü YOK, sensör analizi YOK, Vehicle HAL doğrulaması YOK.
 *
 * SÖZLEŞME (her transport bunu sağlar — adb de, none da):
 *   {
 *     kind: 'adb' | 'none',
 *     available: boolean,
 *     serial: string|null,          // REDAKTE (ham seri no dışarı çıkmaz)
 *     describe(): object,
 *     shell(args[], opts?)  → OpResult    // adb shell <args>
 *     exec(args[], opts?)   → OpResult    // ham adb <args>
 *     push(local, remote)   → OpResult
 *     pull(remote, local)   → OpResult
 *     isAlive()             → boolean
 *   }
 *
 * DEMİR KURALLAR:
 *  - Public API **ASLA throw etmez.** Her şey OpResult döner (status + reason).
 *  - Her komut zaman-sınırlıdır (bounded); asılı kalan komut Lab'i kilitleyemez.
 *  - Retry **en fazla 1** ve YALNIZ geçici transport hatasında (broken pipe,
 *    device offline, protocol fault). Timeout retry EDİLMEZ (zaman bütçesi kutsal).
 *  - ADB yoksa → **null transport**: her çağrı `SKIPPED_NA` döner. Hiçbir faz
 *    çökmez, hiçbir kontrol sessizce "geçti" sayılmaz.
 */
import { TRANSPORT_KIND, OP_STATUS, createOpResult } from '../types/device-types.mjs';
import { createAdbTransport, findAdb } from '../transport/adb.mjs';

/** Hiçbir şey yapamayan ama ASLA çökmeyen transport. */
export function createNullTransport(reason = 'ADB bulunamadı — cihaz katmanı kullanılamıyor') {
  const skipped = () => createOpResult({ status: OP_STATUS.SKIPPED_NA, reason });

  return Object.freeze({
    kind:      TRANSPORT_KIND.NONE,
    available: false,
    serial:    null,
    reason,

    describe() {
      return Object.freeze({ kind: TRANSPORT_KIND.NONE, available: false, serial: null, adbPath: null, reason });
    },

    async shell() { return skipped(); },
    async exec()  { return skipped(); },
    async push()  { return skipped(); },
    async pull()  { return skipped(); },
    isAlive()     { return false; },
  });
}

/**
 * TEK GİRİŞ. adb varsa ve hazır bir cihaz varsa ADB transport, aksi hâlde null transport.
 * **Asla throw etmez** — en kötü ihtimalle null transport döner.
 *
 * @param {{env?:object, exec?:Function, exists?:Function, serial?:string|null,
 *          timeoutMs?:number, adbPath?:string|null}} opts  (hepsi enjekte edilebilir → testte gerçek adb GEREKMEZ)
 */
export async function createTransport(opts = {}) {
  try {
    const adbPath = opts.adbPath ?? findAdb(opts.env, opts.exists);
    if (!adbPath) {
      return createNullTransport('adb çalıştırılabilir dosyası bulunamadı (ANDROID_HOME / platform-tools / PATH)');
    }
    return await createAdbTransport({ ...opts, adbPath });
  } catch (err) {
    // Sözleşme: createTransport throw ETMEZ. Beklenmedik hata bile null transport'a düşer.
    return createNullTransport(`transport kurulamadı: ${String(err?.message ?? err).slice(0, 160)}`);
  }
}
