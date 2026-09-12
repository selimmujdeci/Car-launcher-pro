'use client';

/**
 * /dashboard/fleet/transfer — ARAÇ SAHİPLİĞİ DEVRİ.
 *
 * Dört bölüm: başlatma · gelen · giden (bekleyen) · geçmiş.
 *
 * DÜRÜSTLÜK KURALLARI:
 *   · Çevrimdışıyken hiçbir eylem gösterilmez; açık uyarı yazılır.
 *   · "Tamamlandı" YALNIZ sunucu onayından sonra.
 *   · Ham hata metni gösterilmez — bounded kod → Türkçe mesaj.
 *   · Pairing politikası kullanıcıya AÇIKÇA anlatılır (sürpriz yok).
 */

import { useState } from 'react';
import { useSessionUser } from '@/hooks/useSessionUser';
import { useFleet } from '@/hooks/useFleet';
import { useOwnershipTransfer } from '@/hooks/useOwnershipTransfer';
import {
  type OwnerType, type TransferRecord,
  transferStatusLabel, ownerTypeLabel, expiryBucket, expiryBucketLabel,
} from '@/lib/fleet/ownershipTransfer';

export default function TransferPage() {
  const { userId } = useSessionUser();
  const fleet = useFleet(userId);
  const transfer = useOwnershipTransfer({
    userId,
    companyId: fleet.company?.id ?? null,
    role: fleet.role,
  });

  const [vehicleId, setVehicleId]   = useState('');
  const [targetType, setTargetType] = useState<OwnerType>('INDIVIDUAL');
  const [targetId, setTargetId]     = useState('');

  const offline = transfer.uiState === 'offline_required';
  const busy = ['submitting', 'accepting', 'rejecting', 'cancelling'].includes(transfer.uiState);

  const selected = fleet.vehicles.find((v) => v.vehicle_id === vehicleId) ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-white">Araç Sahipliği Devri</h2>
        <p className="mt-1 text-xs text-white/40">
          Sahiplik devri sunucuda tek işlemde uygulanır. İnternet bağlantısı gereklidir.
        </p>
      </header>

      {offline && (
        <Notice tone="warn">
          İnternet bağlantısı yok. Sahiplik devri çevrimdışı yapılamaz ve
          kaydedilmez. Bağlantı sağlandığında tekrar deneyin.
        </Notice>
      )}

      {transfer.outcome?.message && (
        <Notice tone={transfer.outcome.ok ? 'ok' : 'error'}>
          {transfer.outcome.ok ? 'İşlem tamamlandı.' : transfer.outcome.message}
        </Notice>
      )}

      {/* ── A · Devir başlatma ───────────────────────────────────────── */}
      <Section title="Devir başlat">
        <div className="space-y-3">
          <Field label="Araç">
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={offline || busy}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white"
            >
              <option value="">Seçiniz…</option>
              {fleet.vehicles.map((v) => (
                <option key={v.vehicle_id} value={v.vehicle_id}>
                  {v.plate ?? v.name ?? v.vehicle_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </Field>

          {selected && (
            <p className="text-xs text-white/50">
              Mevcut sahiplik:{' '}
              {selected.owner_id ? ownerTypeLabel('INDIVIDUAL') : ownerTypeLabel('COMPANY')}
            </p>
          )}

          <Field label="Hedef türü">
            <div className="flex gap-2">
              {(['INDIVIDUAL', 'COMPANY'] as OwnerType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTargetType(t)}
                  disabled={offline || busy}
                  className={`rounded-xl border px-4 py-2 text-sm ${
                    targetType === t
                      ? 'border-white/40 bg-white/10 text-white'
                      : 'border-white/15 text-white/60'
                  }`}
                >
                  {ownerTypeLabel(t)}
                </button>
              ))}
            </div>
          </Field>

          <Field label={targetType === 'INDIVIDUAL' ? 'Hedef kullanıcı kimliği' : 'Hedef filo kimliği'}>
            <input
              value={targetId}
              onChange={(e) => setTargetId(e.target.value.trim())}
              disabled={offline || busy}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-xs text-white"
            />
          </Field>

          {/* Güvenlik özeti — sürpriz YOK. */}
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-100/80">
            <p className="font-semibold">Devir tamamlandığında:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>Aracın sahipliği hedefe geçer.</li>
              <li>Sizin ve diğer kullanıcıların araç eşleştirmeleri <b>kaldırılır</b>.</li>
              <li>Araca gönderilmiş, henüz iletilmemiş komutlar <b>iptal edilir</b>.</li>
              <li>Kullanılmamış eşleştirme kodları geçersiz olur.</li>
              <li>Araçtaki cihaz kurulumu (head unit) korunur.</li>
            </ul>
            <p className="mt-2">Bu işlem hedef taraf onaylayana kadar tamamlanmaz.</p>
          </div>

          <button
            type="button"
            disabled={offline || busy || !vehicleId || !targetId}
            onClick={() => {
              if (!selected) return;
              void transfer.start({
                vehicle: {
                  id:         selected.vehicle_id,
                  owner_id:   selected.owner_id,
                  company_id: fleet.company?.id ?? null,
                  // Revizyon sunucudan gelmiyorsa devir BAŞLATILMAZ
                  // (hook `UNKNOWN_REVISION` ile reddeder).
                  revision:   readRevision(selected),
                },
                targetType,
                targetId,
              });
            }}
            className="rounded-xl border border-white/20 px-5 py-2 text-sm text-white disabled:opacity-40"
          >
            {transfer.uiState === 'submitting' ? 'Gönderiliyor…' : 'Devri başlat'}
          </button>
        </div>
      </Section>

      {/* ── B · Gelen devir istekleri ────────────────────────────────── */}
      <Section title={`Size gelen devir istekleri (${transfer.incoming.length})`}>
        {transfer.incoming.length === 0 ? (
          <Empty>Bekleyen devir isteği yok.</Empty>
        ) : (
          transfer.incoming.map((t) => (
            <TransferCard key={t.id} transfer={t}>
              {transfer.actionsFor(t).includes('ACCEPT') && (
                <ActionButton
                  disabled={busy}
                  onClick={() => void transfer.accept(t.id)}
                  label={transfer.uiState === 'accepting' ? 'Kabul ediliyor…' : 'Kabul et'}
                />
              )}
              {transfer.actionsFor(t).includes('REJECT') && (
                <ActionButton
                  disabled={busy}
                  onClick={() => void transfer.reject(t.id)}
                  label="Reddet"
                />
              )}
              {transfer.actionsFor(t).length === 0 && (
                <p className="text-xs text-white/40">
                  {offline
                    ? 'Çevrimdışısınız — işlem yapılamaz.'
                    : 'Bu isteği onaylama yetkiniz yok (filo yöneticisi gerekir).'}
                </p>
              )}
            </TransferCard>
          ))
        )}
      </Section>

      {/* ── C · Gönderdiğiniz devirler ───────────────────────────────── */}
      <Section title={`Gönderdiğiniz devirler (${transfer.outgoing.length})`}>
        {transfer.outgoing.length === 0 ? (
          <Empty>Bekleyen gönderilmiş devir yok.</Empty>
        ) : (
          transfer.outgoing.map((t) => (
            <TransferCard key={t.id} transfer={t}>
              {transfer.actionsFor(t).includes('CANCEL') && (
                <ActionButton
                  disabled={busy}
                  onClick={() => void transfer.cancel(t.id)}
                  label={transfer.uiState === 'cancelling' ? 'İptal ediliyor…' : 'İptal et'}
                />
              )}
            </TransferCard>
          ))
        )}
      </Section>

      {/* ── D · Geçmiş ───────────────────────────────────────────────── */}
      <Section title="Geçmiş">
        {transfer.history.length === 0 ? (
          <Empty>Sonuçlanmış devir yok.</Empty>
        ) : (
          transfer.history.map((t) => <TransferCard key={t.id} transfer={t} />)
        )}
      </Section>

      <button
        type="button"
        onClick={() => void transfer.refresh()}
        className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/70"
      >
        YENİLE
      </button>
    </div>
  );
}

/**
 * Araç revizyonu — sunucu listesi bu alanı taşımıyorsa `null`.
 * UYDURULMAZ: null dönerse hook devri `UNKNOWN_REVISION` ile reddeder.
 */
function readRevision(vehicle: unknown): number | null {
  const raw = (vehicle as { revision?: unknown } | null)?.revision;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/* ── Sunum bileşenleri ─────────────────────────────────────────────────── */

function TransferCard({ transfer, children }: { transfer: TransferRecord; children?: React.ReactNode }) {
  const bucket = expiryBucket(transfer, Date.now());
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-white/60">
          Araç {transfer.vehicleId.slice(0, 8)}…
        </span>
        <span className="text-sm text-white/90">{transferStatusLabel(transfer.status)}</span>
      </div>
      <p className="mt-1 text-xs text-white/50">
        Hedef: {ownerTypeLabel(transfer.toOwnerType)}
        {transfer.status === 'PENDING' && ` · Kalan süre: ${expiryBucketLabel(bucket)}`}
      </p>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

function ActionButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border border-white/20 px-4 py-1.5 text-sm text-white disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-white/50">{label}</span>
      {children}
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-white/40">{children}</p>;
}

function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'error'; children: React.ReactNode }) {
  const cls =
    tone === 'ok'    ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-100/90'
    : tone === 'warn'? 'border-amber-400/30 bg-amber-400/5 text-amber-100/90'
    :                  'border-rose-400/30 bg-rose-400/5 text-rose-100/90';
  return <div className={`rounded-2xl border p-3 text-sm ${cls}`}>{children}</div>;
}
