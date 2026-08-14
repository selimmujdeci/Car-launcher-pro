'use client';

/**
 * /dashboard/fleet/conflicts — ÇAKIŞMA MERKEZİ.
 *
 * Kullanıcıya teknik hata yığını GÖSTERİLMEZ. Her çakışmada şunlar yazılır:
 * ne oldu · hangi araç/üye etkilendi · sunucudaki gerçek durum · yerelde
 * bekleyen işlem · seçenekler.
 *
 * ⚠️ Sahiplik çakışmasında "zorla devral" seçeneği ÜRETİLMEZ.
 */

import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import { LoadingState, EmptyState, StateCard } from '@/components/fleet/FleetUi';
import { policyFor, actionsFor, type ConflictAction } from '@/lib/offline/conflictEngine';
import { CONFLICT_CODES, type ConflictCode, type OperationType } from '@/lib/offline/types';

const OPERATION_LABEL: Record<OperationType, string> = {
  COMPANY_CREATE:         'Filo oluşturma',
  COMPANY_UPDATE:         'Filo bilgisi güncelleme',
  MEMBER_ADD:             'Üye ekleme',
  MEMBER_ROLE_UPDATE:     'Rol değiştirme',
  MEMBER_REMOVE:          'Üye kaldırma',
  VEHICLE_PAIR:           'Araç eşleştirme',
  VEHICLE_TRANSFER_START:  'Sahiplik devri başlatma',
  VEHICLE_TRANSFER_ACCEPT: 'Sahiplik devrini kabul',
  VEHICLE_TRANSFER_REJECT: 'Sahiplik devrini ret',
  VEHICLE_TRANSFER_CANCEL: 'Sahiplik devrini iptal',
  VEHICLE_ASSIGN_COMPANY: 'Aracı filoya atama',
  VEHICLE_REMOVE_COMPANY: 'Aracı filodan çıkarma',
  OWNERSHIP_CLAIM:        'Sahiplik talebi',
  LOCATION_EVENT:         'Konum kaydı',
  VEHICLE_EVENT:          'Araç olayı',
  FUEL_LOG_ADD:           'Yakıt kaydı',
  SERVICE_RECORD_ADD:     'Servis kaydı',
};

const ACTION_LABEL: Record<ConflictAction, string> = {
  RETRY:               'Yeniden dene',
  CANCEL:              'Vazgeç',
  ACCEPT_SERVER_STATE: 'Sunucudaki durumu kabul et',
  NOTIFY_ADMIN:        'Yöneticiye bildir',
};

function isConflictCode(value: string | null): value is ConflictCode {
  return value !== null && (CONFLICT_CODES as readonly string[]).includes(value);
}

export default function FleetConflictsPage() {
  const { userId, loading } = useSessionUser();
  const fleet = useFleet(userId);

  if (loading || fleet.phase === 'loading') return <LoadingState label="Çakışmalar yükleniyor…" />;

  if (fleet.conflicts.length === 0) {
    return (
      <EmptyState
        title="Çakışma yok"
        hint="Çevrimdışıyken yaptığınız işlemler sunucudaki durumla çeliştiğinde burada listelenir."
      />
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-white">Çakışmalar</h2>

      {fleet.conflicts.map((item) => {
        const code = isConflictCode(item.failureCode) ? item.failureCode : null;
        if (!code) {
          return (
            <StateCard key={item.id} tone="error" title="Tanımlanamayan çakışma">
              Bu işlem uygulanamadı. Güvenlik gereği işlem otomatik olarak
              tekrar denenmiyor. Vazgeçip yeniden deneyebilirsiniz.
            </StateCard>
          );
        }
        const policy  = policyFor(code);
        const actions = actionsFor(code);

        return (
          <div key={item.id} className="rounded-2xl border border-red-500/25 bg-red-500/[0.05] p-5">
            <h3 className="text-base font-semibold text-white">{policy.title}</h3>

            <dl className="mt-4 space-y-3 text-sm">
              <Block label="Ne oldu?" value={policy.explanation} />
              <Block
                label="Etkilenen kayıt"
                value={
                  item.vehicleId ? `Araç: ${item.vehicleId}`
                  : typeof item.payload.userId === 'string' ? `Üye: ${String(item.payload.userId)}`
                  : item.companyId ? `Filo: ${item.companyId}`
                  : 'Belirtilmedi'
                }
              />
              <Block
                label="Yerelde bekleyen işlem"
                value={`${OPERATION_LABEL[item.operationType]} · ${new Date(item.createdAt).toLocaleString('tr-TR')}`}
              />
              <Block
                label="Sunucudaki gerçek durum"
                value={
                  policy.resolution === 'SERVER_WINS'
                    ? 'Sunucudaki kayıt geçerli kabul edildi; sizin bekleyen işleminiz uygulanmadı.'
                    : 'Sunucudaki kayıt sizin işleminizle çelişiyor. Nasıl devam edileceğine siz karar vermelisiniz.'
                }
              />
              {policy.dataLossRisk ? (
                <Block
                  label="Dikkat"
                  value="Yeniden denerseniz sunucudaki daha yeni değişiklik üzerine yazılabilir."
                />
              ) : null}
            </dl>

            <div className="mt-5 flex flex-wrap gap-2">
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => {
                    if (action === 'RETRY') void fleet.retryItem(item.id);
                    else if (action === 'CANCEL' || action === 'ACCEPT_SERVER_STATE') void fleet.cancelItem(item.id);
                    // NOTIFY_ADMIN: kullanıcı yöneticisine kendisi ulaşır; uygulama
                    // sahiplik/tenant sınırını aşan otomatik bildirim GÖNDERMEZ.
                  }}
                  className={`rounded-xl px-4 py-2 text-sm font-medium ${
                    action === 'RETRY'
                      ? 'border border-white/15 text-white/80 hover:bg-white/5'
                      : action === 'ACCEPT_SERVER_STATE'
                        ? 'bg-sky-600 text-white hover:bg-sky-500'
                        : 'border border-white/15 text-white/70 hover:bg-white/5'
                  }`}
                >
                  {ACTION_LABEL[action]}
                </button>
              ))}
            </div>

            {code === 'VEHICLE_ALREADY_OWNED' || code === 'OWNERSHIP_CHANGED' ? (
              <p className="mt-4 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">
                Güvenlik gereği bir aracın sahipliği uygulama üzerinden zorla devralınamaz.
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-white/45">{label}</dt>
      <dd className="mt-0.5 leading-relaxed text-white/85">{value}</dd>
    </div>
  );
}
