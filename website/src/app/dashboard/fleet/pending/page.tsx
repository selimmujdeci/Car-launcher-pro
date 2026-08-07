'use client';

/**
 * /dashboard/fleet/pending — BEKLEYEN ÇEVRİMDIŞI İŞLEMLER.
 *
 * Dürüstlük kuralı: buradaki hiçbir işlem "tamamlandı" DEĞİLDİR. Kullanıcı
 * her satırda neyin beklediğini, kaç kez denendiğini ve neden bekletildiğini görür.
 */

import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import {
  LoadingState, EmptyState, OfflineBanner, StateCard,
} from '@/components/fleet/FleetUi';
import type { OperationType, SyncStatus } from '@/lib/offline/types';
import { isFleetErrorCode, messageFor } from '@/lib/fleet/errors';

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
};

const STATUS_TEXT: Record<SyncStatus, string> = {
  PENDING:               'Sırada bekliyor',
  BLOCKED_BY_DEPENDENCY: 'Önce başka bir işlem tamamlanmalı',
  SYNCING:               'Gönderiliyor',
  SYNCED:                'Tamamlandı',
  RETRYABLE_FAILED:      'Gönderilemedi — tekrar denenecek',
  PERMANENT_FAILED:      'Gönderilemedi — tekrar denenmeyecek',
  CONFLICT:              'Sunucudaki durumla çakıştı',
  EXPIRED:               'Süresi doldu',
  CANCELLED:             'İptal edildi',
};

/**
 * Başarısız işlemin NEDENİ (düz Türkçe).
 *
 * NEDEN VAR (staging'de ölçüldü): sunucu `last_admin_protected` /
 * `cannot_modify_self_role` gibi 409 kodlarını döndürüyor; bunlar conflict
 * DEĞİL, kalıcı iş kuralı reddi → `PERMANENT_FAILED`. Önceden ekran yalnız
 * "Gönderilemedi" yazıyordu ve kullanıcı NEDENİNİ hiç göremiyordu — oysa
 * mesaj `errors.ts`te zaten hazırdı.
 *
 * Tanınmayan kod ham hâlde GÖSTERİLMEZ (teknik yığın sızmaz).
 */
function failureReason(failureCode: string | null): string | null {
  if (!failureCode) return null;
  if (isFleetErrorCode(failureCode)) return messageFor(failureCode);
  return 'Sunucu bu işlemi kabul etmedi. Ayrıntı için filo yöneticinize danışın.';
}

export default function FleetPendingPage() {
  const { userId, loading } = useSessionUser();
  const fleet = useFleet(userId);

  if (loading || fleet.phase === 'loading') return <LoadingState label="Bekleyen işlemler yükleniyor…" />;

  const shown = fleet.queueItems.filter((i) => i.status !== 'SYNCED');

  return (
    <div className="space-y-5">
      {fleet.phase === 'offline' ? <OfflineBanner pendingCount={fleet.pending.length} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Bekleyen işlemler</h2>
        <button
          type="button"
          onClick={() => void fleet.sync()}
          className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Şimdi gönder
        </button>
      </div>

      {!fleet.queueKnown ? (
        /**
         * "OKUNAMADI" ≠ "YOK".
         *
         * Telefonda ölçüldü: kuyruk okuma kapısı kapalıyken bu ekran
         * "Bekleyen işlem yok — Tüm işlemleriniz sunucuya iletildi" diyordu,
         * oysa cihazda bekleyen bir işlem duruyordu. Bilinmeyen durum artık
         * DÜRÜSTÇE bilinmeyen olarak gösterilir.
         */
        <EmptyState
          title="Bekleyen işlemler okunamadı"
          hint="Cihazdaki kuyruk şu an okunamıyor. Bu, bekleyen işleminiz olmadığı ANLAMINA GELMEZ — ekranı yenileyip tekrar deneyin."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title="Bekleyen işlem yok"
          hint="Tüm işlemleriniz sunucuya iletildi. Çevrimdışıyken yaptığınız değişiklikler burada listelenir."
        />
      ) : (
        <div className="space-y-3">
          {shown.map((item) => (
            <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">{OPERATION_LABEL[item.operationType]}</p>
                  <p className="mt-1 text-sm text-white/60">{STATUS_TEXT[item.status]}</p>
                  {failureReason(item.failureCode)
                    ? <p className="mt-1 text-sm text-amber-200">{failureReason(item.failureCode)}</p>
                    : null}
                  <p className="mt-1 text-xs text-white/40">
                    {new Date(item.createdAt).toLocaleString('tr-TR')}
                    {item.attemptCount > 0 ? ` · ${item.attemptCount} deneme` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  {item.status !== 'EXPIRED' && item.status !== 'CANCELLED' ? (
                    <button
                      type="button"
                      onClick={() => void fleet.retryItem(item.id)}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5"
                    >
                      Yeniden dene
                    </button>
                  ) : null}
                  {item.status !== 'CANCELLED' ? (
                    <button
                      type="button"
                      onClick={() => void fleet.cancelItem(item.id)}
                      className="rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10"
                    >
                      Vazgeç
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <StateCard title="Bu işlemler henüz kesinleşmedi">
        Buradaki kayıtlar yalnızca cihazınızda duruyor. Sunucu onaylamadan hiçbiri
        gerçekleşmiş sayılmaz.
      </StateCard>
    </div>
  );
}
