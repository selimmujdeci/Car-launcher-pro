/**
 * adasStatusText.ts — ADAS durumunun sürücüye söylenen DÜRÜST metni. SAF.
 *
 * İlke: "çalışıyor" yalnız gerçekten çalışırken söylenir; kısıtlı/bekleyen durum
 * NEDENİYLE birlikte anlatılır (kullanıcı neden uyarı almadığını bilmeli).
 */

import type { AdasReason, AdasStatus } from './adasTypes';
import type { UsbCameraVerdict } from './adasCameraDiscovery';

export type AdasTone = 'ok' | 'info' | 'warn' | 'off';

export interface AdasStatusText {
  title: string;
  detail: string | null;
  tone: AdasTone;
}

const REASON_TEXT: Record<AdasReason, string> = {
  parked: 'Araç park hâlinde — kamera kapalı, kalkışta otomatik açılır.',
  no_speed: 'Hız bilgisi yok (GPS/OBD) — hız gelince başlar.',
  reverse: 'Geri vites — ileri yön uyarıları beklemede.',
  safe_mode: 'Sistem güvenli modda — görüntü işleme durduruldu.',
  no_camera: 'Kamera bulunamadı.',
  permission_denied: 'Kamera izni verilmedi. İzni verip ADAS\'ı yeniden açın.',
  camera_missing: 'Seçili kamera takılı değil. USB kamerayı takın veya başka kamera seçin.',
  camera_lost: 'Kamera bağlantısı koptu — yeniden bağlanmayı deniyor.',
  camera_error: 'Kamera açılamadı — yeniden deneniyor.',
  frozen: 'Kamera görüntüsü dondu — uyarılar geçici olarak kapalı.',
  low_light: 'Düşük ışık — ön çarpışma ve kalkış uyarısı kısıtlı; şerit uyarısı sürüyor.',
  calibration_pending: 'Kalibre ediliyor — şeritli düz yolda 40 km/sa üstünde sürün. Takip mesafesi uyarısı kalibrasyon bitince açılır.',
};

export function describeAdasStatus(status: AdasStatus, reason: AdasReason | null, calibrationProgress: number): AdasStatusText {
  const detail = reason ? REASON_TEXT[reason] : null;
  switch (status) {
    case 'off': return { title: 'Kapalı', detail: null, tone: 'off' };
    case 'standby': return { title: 'Beklemede', detail, tone: 'info' };
    case 'starting': return { title: 'Kamera açılıyor…', detail: null, tone: 'info' };
    case 'calibrating': {
      const pct = Math.round(Math.max(0, Math.min(1, calibrationProgress)) * 100);
      return { title: `Etkin · kalibrasyon %${pct}`, detail, tone: 'ok' };
    }
    case 'active': return { title: 'Etkin', detail: null, tone: 'ok' };
    case 'degraded': return { title: 'Kısıtlı', detail, tone: 'warn' };
    case 'unavailable': return { title: 'Kullanılamıyor', detail, tone: 'warn' };
  }
}

export function describeUsbVerdict(v: UsbCameraVerdict): string | null {
  switch (v) {
    case 'usb_ready': return 'USB/harici kamera hazır — listeden seçebilirsiniz.';
    case 'usb_not_exposed':
      return 'USB kamera takılı, ancak bu cihazın yazılımı onu Android kamera sistemine açmıyor '
        + '(harici kamera desteği yok). Kamera uygulamada seçilemez — cihaz üreticisinin '
        + 'UVC/harici kamera destekli yazılımı gerekir.';
    case 'no_camera': return 'Hiç kamera bulunamadı. USB (UVC) kamera takabilirsiniz.';
    case 'builtin_only':
    case 'unknown':
      return null;
  }
}
