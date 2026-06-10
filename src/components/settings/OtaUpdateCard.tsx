/**
 * OtaUpdateCard — OTA v1 / Commit 6: minimal güncelleme kartı
 *
 * SettingsPage "Hakkında" paneli içinde yaşar. Detay ekranı YOK —
 * tek satır durum + tek aksiyon butonu. Park kapısı: araç hareketliyken
 * indirme/kurulum butonu kilitli (otaUpdateService de ayrıca zorlar).
 */
import { useOtaStore, resumeOtaFlow } from '../../platform/otaUpdateService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';

const STATE_LABEL: Record<string, string> = {
  idle:                     'Sistem güncel',
  checking:                 'Güncelleme kontrol ediliyor…',
  available:                'Yeni sürüm hazır',
  downloading:              'İndiriliyor',
  verified:                 'İndirildi ve doğrulandı',
  install_prompted:         'Kurulum başlatılıyor…',
  installed_waiting_reboot: 'Sistem kurulum onayı bekleniyor',
  failed:                   'Güncelleme hatası',
};

const ACTION_LABEL: Record<string, string> = {
  idle:      'Kontrol Et',
  available: 'İndir',
  verified:  'Kur',
  failed:    'Tekrar Dene',
};

export function OtaUpdateCard() {
  const ota   = useOtaStore();
  const speed = useUnifiedVehicleStore((s) => s.speed);
  const parked = (speed ?? 0) <= 0;

  const actionLabel = ACTION_LABEL[ota.state];
  const needsPark   = ota.state === 'available' || ota.state === 'verified';
  const disabled    = needsPark && !parked;

  let detail = STATE_LABEL[ota.state] ?? ota.state;
  if (ota.release && (ota.state === 'available' || ota.state === 'verified'
      || ota.state === 'downloading' || ota.state === 'installed_waiting_reboot')) {
    detail += ` — v${ota.release.versionName}`;
  }
  if (ota.state === 'downloading') detail += ` %${ota.progressPercent}`;
  if (ota.state === 'failed' && ota.errorCode) detail += ` (${ota.errorCode})`;

  return (
    <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="min-w-0">
        <div className="text-[12px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
          Sistem Güncellemesi
        </div>
        <div className="text-[11px] font-bold mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
          {detail}
          {ota.awaitingPermission && ota.state === 'verified'
            ? ' · İzin verdikten sonra tekrar dokun'
            : ''}
        </div>
        {disabled && (
          <div className="text-[10px] font-bold mt-0.5" style={{ color: '#fbbf24' }}>
            Güvenlik: güncelleme için aracı durdurun
          </div>
        )}
      </div>
      {actionLabel && (
        <button
          onClick={() => { void resumeOtaFlow(); }}
          disabled={disabled}
          className="px-3 py-1.5 rounded-xl text-[11px] font-black flex-shrink-0 disabled:opacity-40"
          style={{
            background: 'rgba(96,165,250,0.12)',
            border: '1px solid rgba(96,165,250,0.25)',
            color: '#93c5fd',
          }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
