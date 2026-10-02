/**
 * adasCamera.ts — Yol kamerası seçimi ve USB tanısı.
 *
 * Otomatik seçim sırası: USB/harici (UVC ön kamera) → arka kamera → türü
 * bilinmeyen. ÖN (sürücüye bakan) kamera ASLA otomatik seçilmez.
 *
 * Sınıflandırma iki kanıtla yapılır:
 *  1) Etiket — "USB Camera (0c45:6366)", "camera2 0, facing back" …
 *  2) Android Camera2 yönü (native `listCameraHardware`) — Chromium harici
 *     kamerayı etikette "facing back" diye gösterir; gerçek yön
 *     (LENS_FACING_EXTERNAL) yalnız native taraftan öğrenilir.
 *
 * Etiketler kamera izni verilene dek boştur; o zaman tür `unknown` kalır ve
 * çalışma zamanı izin alındıktan sonra listeyi YENİDEN okur.
 */
import { CarLauncher, type NativeCameraHardware } from '../nativePlugin';
import { isNative } from '../bridge';
import type { CameraDirectionRecord } from './adasTypes';
import { cameraKeyOf } from './adasSupervisor';

export type AdasCameraKind = 'usb' | 'back' | 'front' | 'unknown';

export interface AdasCameraOption {
  readonly deviceId: string;
  readonly label: string;
  readonly kind: AdasCameraKind;
}

const CAMERA2_ID_RE = /camera2?\s+([^,\s]+),\s*facing/i;
const USB_RE = /usb|uvc|external|webcam|harici/i;
const BACK_RE = /facing back|\bback\b|rear|environment|arka/i;
const FRONT_RE = /facing front|\bfront\b|\buser\b|selfie/i;

/** Etiket + (varsa) native Camera2 yönüyle kamera türü. */
export function classifyCamera(label: string, hw: NativeCameraHardware | null): AdasCameraKind {
  const id = CAMERA2_ID_RE.exec(label)?.[1];
  if (id && hw) {
    const facing = hw.camera2.find((c) => c.id === id)?.facing;
    if (facing === 'external') return 'usb';
    if (facing === 'front') return 'front';
    if (facing === 'back') return 'back';
  }
  if (USB_RE.test(label)) return 'usb';
  if (FRONT_RE.test(label)) return 'front';
  if (BACK_RE.test(label)) return 'back';
  return 'unknown';
}

const RANK: Readonly<Record<AdasCameraKind, number>> = { usb: 1, back: 2, unknown: 3, front: 9 };

/**
 * Otomatik yol kamerası:
 *   1. USB/harici — kullanıcı onu yola bakması için taktı (arkaya bakarsa
 *      doğrulama yakalar ve aşağıdakilere dönülür)
 *   2. hareketle ÖNE baktığı doğrulanmış diğer kameralar (tür ne olursa olsun,
 *      ör. head unit'in "front" diye bildirdiği AHD ön kamera girişi)
 *   3. doğrulanmamış arka → bilinmeyen
 * ARKAYA baktığı doğrulanmış kamera (geri görüş) asla; doğrulanmamış ön (iç)
 * kamera otomatik seçilmez (elle seçilebilir, yön doğrulaması onu da sınar).
 * Uygun kamera yoksa `null`.
 */
export function pickAutoCamera(
  options: readonly AdasCameraOption[],
  directions: Readonly<Record<string, CameraDirectionRecord>> = {},
): AdasCameraOption | null {
  const facing = (o: AdasCameraOption) => directions[cameraKeyOf({ deviceId: o.deviceId, label: o.label })]?.facing;
  const rank = (o: AdasCameraOption) => (facing(o) === 'forward' ? Math.min(RANK[o.kind], 1.5) : RANK[o.kind]);
  const ok = options.filter((o) => o.deviceId && facing(o) !== 'backward' && rank(o) < RANK.front);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => rank(a) - rank(b))[0];
}

/** Native kamera donanımı; web'de ya da hata/zaman aşımında `null`. */
export async function readCameraHardware(timeoutMs = 3000): Promise<NativeCameraHardware | null> {
  if (!isNative) return null;
  try {
    const hw = await Promise.race([
      CarLauncher.listCameraHardware(),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (!hw || !Array.isArray(hw.usbVideo) || !Array.isArray(hw.camera2)) return null;
    return {
      usbVideo: hw.usbVideo,
      camera2: hw.camera2,
      externalCameraSupported: hw.externalCameraSupported === true,
    };
  } catch {
    return null;   // eski APK'da yöntem yok → tanı yok, seçim etiketle sürer
  }
}

/** Görüntü girişleri (etiketler izinden sonra dolar). */
export async function listAdasCameras(hw: NativeCameraHardware | null): Promise<AdasCameraOption[]> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.enumerateDevices) return [];
  try {
    const devices = await md.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label, kind: classifyCamera(d.label, hw) }));
  } catch {
    return [];
  }
}

/**
 * USB kamera tanısı — kullanıcıya dürüst açıklama için:
 *   USB_READY        — USB kamera var ve kullanılabilir.
 *   USB_NOT_EXPOSED  — USB'de görüntü cihazı takılı ama Android onu kamera
 *                      olarak sunmuyor (sistemde UVC/harici kamera desteği yok).
 *   NO_USB           — USB görüntü cihazı yok (ya da tanı yapılamadı).
 */
export type UsbDiagnosis = 'USB_READY' | 'USB_NOT_EXPOSED' | 'NO_USB';

export function diagnoseUsb(hw: NativeCameraHardware | null, options: readonly AdasCameraOption[]): UsbDiagnosis {
  if (options.some((o) => o.kind === 'usb')) return 'USB_READY';
  if (hw && hw.usbVideo.length > 0) return 'USB_NOT_EXPOSED';
  return 'NO_USB';
}
