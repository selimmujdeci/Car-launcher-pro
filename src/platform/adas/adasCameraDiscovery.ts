/**
 * adasCameraDiscovery.ts — Yol kamerası keşfi: dahili / USB (UVC) / harici.
 *
 * İKİ GÖZ:
 *   · WebView (`enumerateDevices`) — getUserMedia'nın AÇABİLECEĞİ kameralar.
 *   · Native tanı (`getCameraDiagnostics`) — Camera2 kimlikleri + USB veri yolundaki
 *     video sınıfı cihazlar. WebView'un göremediği USB kamerayı da görür.
 * İkisi karşılaştırılarak kullanıcıya DÜRÜST bir hüküm verilir: USB kamera takılıysa
 * ama sistem kamerası olarak açılmıyorsa sorun uygulamada değil, cihaz yazılımında
 * (harici kamera HAL'i yok) — "kamera bulunamadı" demekle yetinilmez.
 */

import { isNative } from '../bridge';
import { CarLauncher } from '../nativePlugin';
import type { NativeCameraDiagnostics, NativeUsbVideoDevice } from '../nativePlugin';
import type { AdasCameraInfo, AdasCameraKind } from './adasTypes';

/** Etiketten kamera türü. Android WebView etiketi: "camera2 0, facing back". */
export function classifyCameraLabel(label: string): AdasCameraKind {
  const l = label.toLowerCase();
  if (/\b(usb|uvc|webcam|logitech|hd pro|c9\d\d|c270|c310|brio)\b/.test(l)) return 'usb';
  if (/facing external|\bexternal\b|harici/.test(l)) return 'external';
  if (/facing back|\bback\b|\brear\b|environment|arka/.test(l)) return 'builtin_back';
  if (/facing front|\bfront\b|\buser\b|selfie|ön kamera/.test(l)) return 'builtin_front';
  return 'unknown';
}

/** WebView'un açabileceği kameralar. Etiket izin öncesi boş olabilir → sıra adı. */
export async function listRoadCameras(): Promise<AdasCameraInfo[]> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md || typeof md.enumerateDevices !== 'function') return [];
  try {
    const devices = await md.enumerateDevices();
    let n = 0;
    return devices
      .filter((d) => d.kind === 'videoinput' && d.deviceId.length > 0)
      .map((d) => {
        n += 1;
        const label = d.label || `Kamera ${n}`;
        return { deviceId: d.deviceId, label, kind: d.label ? classifyCameraLabel(d.label) : 'unknown' };
      });
  } catch {
    return [];
  }
}

/** Native tanı (yalnız native APK'da; eski APK/web → null, sahte veri üretilmez). */
export async function getNativeCameraDiagnostics(): Promise<NativeCameraDiagnostics | null> {
  if (!isNative || typeof CarLauncher.getCameraDiagnostics !== 'function') return null;
  try {
    return await CarLauncher.getCameraDiagnostics();
  } catch {
    return null;
  }
}

export type UsbCameraVerdict =
  | 'usb_ready'         // USB/harici kamera sistemde, seçilebilir
  | 'usb_not_exposed'   // UVC takılı ama Android kamera sistemi onu açmıyor (cihaz yazılımı)
  | 'builtin_only'      // USB yok, dahili kamera(lar) var
  | 'no_camera'         // hiçbir kamera yok
  | 'unknown';          // native tanı yok (web / eski APK)

export interface CameraDiscoveryReport {
  cameras: AdasCameraInfo[];
  usbDevices: NativeUsbVideoDevice[];
  verdict: UsbCameraVerdict;
}

/** Saf hüküm — iki gözün karşılaştırması. */
export function computeUsbCameraVerdict(
  diag: NativeCameraDiagnostics | null,
  cameras: readonly AdasCameraInfo[],
): UsbCameraVerdict {
  const webHasExternal = cameras.some((c) => c.kind === 'usb' || c.kind === 'external');
  if (diag === null) {
    if (webHasExternal) return 'usb_ready';
    return cameras.length > 0 ? 'unknown' : 'no_camera';
  }
  const systemExternal = diag.cameras.some((c) => c.facing === 'external');
  if (diag.usbVideoDevices.length > 0) {
    return systemExternal || webHasExternal ? 'usb_ready' : 'usb_not_exposed';
  }
  if (systemExternal || webHasExternal) return 'usb_ready';
  return cameras.length > 0 || diag.cameras.length > 0 ? 'builtin_only' : 'no_camera';
}

export async function discoverRoadCameras(): Promise<CameraDiscoveryReport> {
  const [cameras, diag] = await Promise.all([listRoadCameras(), getNativeCameraDiagnostics()]);
  return { cameras, usbDevices: diag?.usbVideoDevices ?? [], verdict: computeUsbCameraVerdict(diag, cameras) };
}

/**
 * Kamera listesi değişimine abone ol: WebView `devicechange` + native USB video
 * tak/çıkar olayı. Eski WebView'larda `devicechange` yoksa yalnız native kalır.
 */
export function subscribeCameraChanges(cb: () => void): () => void {
  let disposed = false;
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const onChange = (): void => { if (!disposed) cb(); };
  if (md && typeof md.addEventListener === 'function') md.addEventListener('devicechange', onChange);

  let handle: { remove: () => Promise<void> | void } | null = null;
  if (isNative) {
    try {
      void CarLauncher.addListener('usbCameraChanged', onChange)
        .then((h) => { if (disposed) void h.remove(); else handle = h; })
        .catch(() => { /* eski APK: olay yok */ });
    } catch { /* eklenti yok */ }
  }
  return () => {
    disposed = true;
    if (md && typeof md.removeEventListener === 'function') md.removeEventListener('devicechange', onChange);
    if (handle) { void handle.remove(); handle = null; }
  };
}
