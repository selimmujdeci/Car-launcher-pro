'use client';

import { memo, useState, useCallback, useEffect, useId, useRef } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import {
  loadFuelEntries, addFuelEntry, loadServiceEntries, addServiceEntry,
  averageConsumption, totalCost,
  STORAGE_MODE_LABEL, STORAGE_MODE_HINT, ENTRY_SYNC_LABEL,
  deleteFuelEntry, deleteServiceEntry, DELETE_SCOPE_MESSAGE,
  updateFuelEntry, updateServiceEntry, UPDATE_MODE_MESSAGE,
  type FuelEntry, type ServiceEntry, type RecordsStorageMode, type EntrySync,
} from '@/lib/recordsService';
import { useRecordsSync, queueFailureMessage } from '@/hooks/useRecordsSync';
import { Icon, type IconName } from '@/components/pwa/ui/Icon';
import { EmptyState, IconBadge, SegmentedButton, StatusPill, TONE_ROLES, type Tone } from '@/components/pwa/ui/primitives';


interface Props { vehicle: LiveVehicle | null }

/* ── Depo modu rozeti ─────────────────────────────────────────────────────────
 *
 * ÖLÇÜLEN KUSUR (2026-08-14): bu sekme tamamen `localStorage`taydı ve kullanıcıya
 * bunu HİÇ söylemiyordu — telefon değişince kayıtların yok olacağı bilinmiyordu.
 * Verinin NEREDE yaşadığı artık her zaman görünür.
 */
const MODE_STYLE: Record<RecordsStorageMode, { color: string; bg: string; border: string }> = {
  SERVER:       { color: 'var(--md-success)', bg: 'color-mix(in srgb, var(--md-success) 8%, transparent)', border: 'color-mix(in srgb, var(--md-success) 22%, transparent)' },
  LOCAL_ONLY:   { color: 'var(--md-warning)', bg: 'color-mix(in srgb, var(--md-warning) 8%, transparent)', border: 'color-mix(in srgb, var(--md-warning) 25%, transparent)' },
  // Kuyrukta bekleyen kayıt YEŞİL olmaz — yeşil "hesabınızda" demektir ve
  // henüz hak edilmemiştir. Mavi: "iş sürüyor", hüküm verilmedi.
  QUEUED:       { color: 'var(--md-primary)', bg: 'color-mix(in srgb, var(--md-primary) 8%, transparent)', border: 'color-mix(in srgb, var(--md-primary) 25%, transparent)' },
  SERVER_ERROR: { color: 'var(--md-error)', bg: 'color-mix(in srgb, var(--md-error) 8%, transparent)',  border: 'color-mix(in srgb, var(--md-error) 25%, transparent)' },
};

/* ── Tek kaydın durum rozeti ──────────────────────────────────────────────
 *
 * Sunucuda DOĞRULANMIŞ kayıt rozet taşımaz (gürültü olurdu); sunucuda
 * olmayanlar ise nerede olduklarını AÇIKÇA söyler. Kayıt listede duruyor
 * diye "gönderildi" sanılmamalıdır.
 */
const SYNC_STYLE: Record<Exclude<EntrySync, 'SERVER'>, { color: string; bg: string }> = {
  QUEUED: { color: 'var(--md-primary)', bg: 'color-mix(in srgb, var(--md-primary) 12%, transparent)' },
  LOCAL:  { color: 'var(--md-warning)', bg: 'color-mix(in srgb, var(--md-warning) 12%, transparent)' },
};

/**
 * Kaydetme sonrası mesaj — moda göre TEK yerde. "Kaydedildi" kelimesi
 * yalnız kaydın gerçekten o yere gittiği modda geçer; `QUEUED` için
 * "hesabınıza" DENMEZ (henüz işlenmedi).
 */
const SAVE_MESSAGE: Record<RecordsStorageMode, string> = {
  SERVER:       'Hesabınıza kaydedildi.',
  LOCAL_ONLY:   'Yalnız bu cihaza kaydedildi.',
  QUEUED:       'Bağlantı yok — kayıt sıraya alındı, bağlantı gelince gönderilecek.',
  SERVER_ERROR: 'Sunucuya yazılamadı — yalnız bu cihaza kaydedildi.',
};

/* ── Silme düğmesi ────────────────────────────────────────────────────────
 *
 * İKİ AŞAMALI: ilk dokunuş "Sil?" sorusuna döner, ikinci dokunuş siler.
 * Kayıt silme geri alınamaz ve araç içi/mobil kullanımda yanlış dokunma
 * gerçektir — tek dokunuşla veri yok edilmez. Onay 4 sn sonra kendiliğinden
 * geri alınır (kullanıcı vazgeçmiş olabilir, ekran kilitli kalmaz).
 */
const DeleteButton = memo(function DeleteButton({
  onConfirm, busy, label,
}: { onConfirm: () => void; busy: boolean; label: string }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handle = useCallback(() => {
    if (busy) return;
    if (armed) {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => { setArmed(false); timer.current = null; }, 4000);
  }, [armed, busy, onConfirm]);

  return (
    <button
      onClick={handle}
      disabled={busy}
      data-testid="record-delete"
      data-armed={armed ? 'true' : 'false'}
      aria-label={label}
      className="md-state flex-shrink-0 inline-flex items-center justify-center gap-1 md-label-l disabled:opacity-40"
      style={{
        minWidth: 48, minHeight: 48, padding: armed ? '0 12px' : 0,
        borderRadius: 'var(--md-shape-full)',
        color:      armed ? 'var(--md-on-error-container)' : 'var(--md-on-surface-variant)',
        background: armed ? 'var(--md-error-container)' : 'transparent',
      }}
    >
      {/* İlk dokunuş silmez; "Emin misin?" metni ikinci dokunuşu ister. */}
      {busy ? '…' : armed ? 'Emin misin?' : <Icon name="delete" title="Sil" />}
    </button>
  );
});

const EntrySyncBadge = memo(function EntrySyncBadge({ sync }: { sync?: EntrySync }) {
  if (!sync || sync === 'SERVER') return null;
  const s = SYNC_STYLE[sync];
  return (
    <span
      data-testid="entry-sync-badge"
      data-sync={sync}
      className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold flex-shrink-0"
      style={{ color: s.color, background: s.bg }}
    >
      {ENTRY_SYNC_LABEL[sync]}
    </span>
  );
});

const StorageBadge = memo(function StorageBadge({ mode }: { mode: RecordsStorageMode }) {
  const s = MODE_STYLE[mode];
  return (
    <div
      data-testid="records-storage-mode"
      data-mode={mode}
      className="flex items-start gap-3 px-1"
    >
      <span className="flex-shrink-0 mt-0.5" style={{ color: s.color }}>
        <Icon name={mode === 'SERVER' ? 'cloud_done' : 'cloud_off'} size={20} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block md-label-l" style={{ color: s.color }}>{STORAGE_MODE_LABEL[mode]}</span>
        <span className="block md-body-s md-on-surface-variant">{STORAGE_MODE_HINT[mode]}</span>
      </span>
    </div>
  );
});

/** Servis kalemi → ikon (görünüm; `SERVICE_DEFS` sözlüğü DEĞİŞMEZ). */
const SERVICE_ICON: Record<string, IconName> = {
  oil: 'oil_barrel', tires: 'tire_repair', brakes: 'car_repair', filter: 'air', ac: 'ac_unit', timing: 'settings',
};
const STATUS_TONE: Record<ServiceStatus, Tone> = { ok: 'success', soon: 'warning', overdue: 'error', unknown: 'neutral' };

/* ── Servis kalemleri ─────────────────────────────────────────────────────── */

interface ServiceDef {
  key:          string;
  label:        string;
  icon:         string;
  intervalKm:   number;
  intervalDays: number;
}

/**
 * F4.3: `export` — Araç Hafızası servis anahtarını Türkçe etikete çevirmek
 * için AYNI sözlüğü okur. Etiketler burada TEK yerde durur; ikinci bir
 * servis kataloğu kurulmaz. (Aralık alanları hafızada KULLANILMAZ: hafıza
 * geçmişi listeler, bakım zamanı hesaplamaz.)
 */
export const SERVICE_DEFS: ServiceDef[] = [
  { key: 'oil',    label: 'Yağ Değişimi',     icon: '🛢',  intervalKm: 10_000, intervalDays: 365 },
  { key: 'tires',  label: 'Lastik Rotasyonu', icon: '🔄',  intervalKm: 15_000, intervalDays: 365 },
  { key: 'brakes', label: 'Fren Balata',      icon: '🛑',  intervalKm: 30_000, intervalDays: 730 },
  { key: 'filter', label: 'Hava Filtresi',    icon: '💨',  intervalKm: 20_000, intervalDays: 365 },
  { key: 'ac',     label: 'Klima Bakımı',     icon: '❄️',  intervalKm: 40_000, intervalDays: 730 },
  { key: 'timing', label: 'Triger Kayışı',    icon: '⚙️',  intervalKm: 60_000, intervalDays: 1825 },
];

/* ── Yakıt sekmesi ────────────────────────────────────────────────────────── */

function FuelTab({ vehicle }: { vehicle: LiveVehicle | null }) {
  const [log,     setLog]     = useState<FuelEntry[]>([]);
  const [mode,    setMode]    = useState<RecordsStorageMode>('LOCAL_ONLY');
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState('');
  const [adding,  setAdding]  = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  /**
   * Düzenlenen kayıt — `null` ise form YENİ kayıt içindir. Ekleme ve düzenleme
   * AYNI formu kullanır: iki ayrı form iki ayrı doğrulama yolu demek olurdu ve
   * biri düzeltilip diğeri unutulurdu.
   */
  const [editing, setEditing] = useState<FuelEntry | null>(null);
  const formId = useId();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const [form, setForm] = useState({
    date:      new Date().toISOString().split('T')[0],
    km:        '',
    liters:    '',
    pricePerL: '',
  });

  const reload = useCallback(async (vid: string) => {
    setLoading(true);
    const res = await loadFuelEntries(vid);
    if (!mounted.current) return;
    setLog(res.entries);
    setMode(res.mode);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!vehicle?.id) { setLoading(false); return; }
    void reload(vehicle.id);
  }, [vehicle?.id, reload]);

  /* Aracın OBD'den okunan kilometresi — ölçülmemişse `null` (0 varsayılmaz). */
  const vehicleKm: number | null =
    typeof vehicle?.odometer === 'number' && vehicle.odometer > 0
      ? Math.round(vehicle.odometer)
      : null;

  /* ── KİLOMETRE ÖNERİSİ ────────────────────────────────────────────────
   * Araçtan okunan kilometre forma ÖNERİ olarak konur — kullanıcı görür ve
   * değiştirebilir. Sessizce yazılmaz: elle girilen ile araçtan okunan
   * karışırsa hangisinin ölçüm olduğu bilinemez, o yüzden alanın altında
   * kaynağı yazılır. Ölçüm yoksa alan BOŞ kalır (uydurma değer YOK).
   *
   * Yalnız form AÇILDIĞINDA ve alan boşken doldurulur; kullanıcı bir şey
   * yazdıysa araçtan gelen yeni değer onun yazdığını EZMEZ. */
  useEffect(() => {
    // DÜZENLEMEDE öneri YAPILMAZ: geçmiş bir dolumu düzeltirken bugünkü
    // kilometreyi önermek kaydı bozardı.
    if (!adding || editing !== null || vehicleKm === null) return;
    setForm((f) => (f.km === '' ? { ...f, km: String(vehicleKm) } : f));
  }, [adding, editing, vehicleKm]);

  const closeForm = useCallback(() => {
    setAdding(false);
    setEditing(null);
    setForm((f) => ({ ...f, liters: '', pricePerL: '' }));
  }, []);

  const startEdit = useCallback((entry: FuelEntry) => {
    setSaveMsg('');
    setEditing(entry);
    setAdding(true);
    setForm({
      date:      entry.filledOn,
      km:        entry.odometerKm != null ? String(entry.odometerKm) : '',
      liters:    String(entry.liters),
      pricePerL: entry.pricePerL != null ? String(entry.pricePerL) : '',
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!vehicle?.id) return;
    const liters = parseFloat(form.liters);
    if (!form.date || !Number.isFinite(liters) || liters <= 0) {
      setSaveMsg('Tarih ve litre zorunludur.');
      return;
    }
    // Kilometre ve fiyat BOŞ bırakılabilir → `null` (sahte 0 yazılmaz).
    const kmRaw    = parseFloat(form.km);
    const priceRaw = parseFloat(form.pricePerL);

    const fields = {
      filledOn:   form.date,
      odometerKm: Number.isFinite(kmRaw) && kmRaw > 0 ? Math.round(kmRaw) : null,
      liters:     Math.round(liters * 100) / 100,
      pricePerL:  Number.isFinite(priceRaw) && priceRaw >= 0 ? Math.round(priceRaw * 100) / 100 : null,
    };

    const res = editing
      ? await updateFuelEntry(vehicle.id, editing, fields)
      : await addFuelEntry(vehicle.id, fields);
    if (!mounted.current) return;

    /* Yalancı onay YOK: kayıt gerçekten kalıcı olmadıysa "kaydedildi" denmez.
       Düzenleme başarısızsa form AÇIK KALIR — kullanıcı yazdığını kaybetmez. */
    if (!res.saved) {
      setSaveMsg(res.error ?? 'Kayıt yapılamadı.');
      return;
    }
    setSaveMsg(editing ? UPDATE_MODE_MESSAGE[res.mode] : SAVE_MESSAGE[res.mode]);
    closeForm();
    await reload(vehicle.id);
  }, [form, vehicle, editing, reload, closeForm]);

  /* Silme: kaydın yaşadığı HER yerden gider (sunucu · kuyruk · cihaz).
     Sonuç DÜRÜST bildirilir — silinemeyen kayıt listede KALIR. */
  const handleDelete = useCallback(async (entry: FuelEntry) => {
    if (!vehicle?.id) return;
    setDeleting(entry.id);
    const res = await deleteFuelEntry(vehicle.id, entry);
    if (!mounted.current) return;
    setDeleting(null);
    setSaveMsg(res.deleted ? DELETE_SCOPE_MESSAGE[res.scope] : (res.error ?? 'Kayıt silinemedi.'));
    if (res.deleted) await reload(vehicle.id);
  }, [vehicle, reload]);

  const avg   = averageConsumption(log);
  const cost  = totalCost(log);
  const liters = log.reduce((a, e) => a + e.liters, 0);

  if (!vehicle) {
    return <p className="py-6 text-center text-sm pwa-text-3">Araç seçilmedi</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <StorageBadge mode={mode} />

      {/* İstatistikler — ölçülemeyen değer SAYI olarak basılmaz. Tek özet
          kartı: üç sayı yan yana, ayraçla; renk anlam taşımaz. */}
      <section className="md-card-filled grid grid-cols-3 py-4" aria-label="Yakıt özeti">
        {[
          { label: 'Ort. Tüketim',   value: avg  != null ? avg.toFixed(1)  : null, unit: 'L/100 km' },
          { label: 'Toplam Litre',   value: log.length > 0 ? liters.toFixed(1) : null, unit: 'litre' },
          { label: 'Toplam Harcama', value: cost != null ? Math.round(cost).toLocaleString('tr-TR') : null, unit: '₺' },
        ].map(({ label, value, unit }, i) => (
          <div key={label} className="flex flex-col items-center text-center px-2"
            style={i > 0 ? { borderLeft: '1px solid var(--md-outline-variant)' } : undefined}>
            <span className="md-label-m md-on-surface-variant">{label}</span>
            <span className="mt-1 md-title-l md-on-surface tabular-nums" style={{ fontWeight: 500 }}>{value ?? '—'}</span>
            <span className="md-body-s md-on-surface-variant">{value != null ? unit : 'yeterli kayıt yok'}</span>
          </div>
        ))}
      </section>

      {saveMsg && (
        <p data-testid="records-save-msg" className="text-xs px-1" style={{ color: 'var(--pwa-text-2)' }}>
          {saveMsg}
        </p>
      )}

      {/* Ekleme formu */}
      {adding ? (
        <div className="md-card-elevated flex flex-col gap-4 p-4">
          <p data-testid="fuel-form-title" className="md-title-m md-on-surface">
            {editing ? 'Yakıt Kaydını Düzenle' : 'Yakıt Ekle'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'date',      label: 'Tarih',              type: 'date',   placeholder: '' },
              { key: 'km',        label: 'Kilometre (ops.)',   type: 'number', placeholder: '85000' },
              { key: 'liters',    label: 'Litre *',            type: 'number', placeholder: '40.5' },
              { key: 'pricePerL', label: '₺/Litre (ops.)',     type: 'number', placeholder: '45.50' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} className="flex flex-col gap-1">
                <label htmlFor={`${formId}-${key}`} className="md-body-s md-on-surface-variant px-1">
                  {label}
                </label>
                <input
                  id={`${formId}-${key}`}
                  type={type}
                  inputMode={type === 'number' ? 'decimal' : undefined}
                  placeholder={placeholder}
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="md-field"
                />
              </div>
            ))}
          </div>

          <p className="md-body-s md-on-surface-variant">
            {/* Kaynak AÇIKÇA yazılır: türetilmiş değer elle girilmiş gibi gösterilmez. */}
            {vehicleKm !== null
              ? <>Kilometre <b>araçtan okundu</b> ({vehicleKm.toLocaleString('tr')} km) — yanlışsa değiştirebilirsiniz. </>
              : <>Araçtan kilometre okunamadı; elle girebilirsiniz. </>}
            Kilometre veya fiyat boş bırakılabilir — bilinmeyen değer <b>0 olarak kaydedilmez</b>,
            yalnız o kaydın hesaplamaları dışında kalır.
          </p>

          <div className="flex justify-end gap-2">
            <button onClick={closeForm} className="md-btn-text md-state min-h-12">İptal</button>
            <button
              onClick={() => void handleSubmit()}
              data-testid="fuel-form-save"
              className="md-btn-filled md-state min-h-12"
            >
              Kaydet
            </button>
          </div>
        </div>
      ) : (
        /* Extended FAB — bu yüzeyin TEK birincil eylemi. */
        <button
          onClick={() => { setAdding(true); setSaveMsg(''); }}
          className="md-fab md-state"
        >
          <Icon name="add" />
          Yakıt ekle
        </button>
      )}

      {/* Kayıt listesi */}
      {loading ? (
        <p className="py-6 text-center text-sm pwa-text-3">Kayıtlar yükleniyor…</p>
      ) : log.length > 0 ? (
        <section className="md-card-elevated overflow-hidden" aria-label="Yakıt kayıtları">
          {log.slice(0, 10).map((entry, i) => (
            <div key={entry.id} className="flex items-center gap-3 pl-4 pr-1 py-2"
              style={i > 0 ? { borderTop: '1px solid var(--md-outline-variant)' } : undefined}>
              <IconBadge name="local_gas_station" />
              <div className="flex-1 min-w-0">
                <p className="md-body-l md-on-surface tabular-nums">
                  {entry.liters.toFixed(1)} L
                  <span className="md-on-surface-variant">
                    {' · '}{entry.pricePerL != null
                      ? `${Math.round(entry.liters * entry.pricePerL).toLocaleString('tr-TR')} ₺`
                      : 'fiyat yok'}
                  </span>
                </p>
                <p className="md-body-s md-on-surface-variant tabular-nums">
                  {new Date(entry.filledOn).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {/* Kilometre bilinmiyorsa em-dash — 0 km BASILMAZ. */}
                  {' · '}{entry.odometerKm != null ? `${entry.odometerKm.toLocaleString('tr')} km` : '— km'}
                </p>
                <EntrySyncBadge sync={entry.sync} />
              </div>
              {/* Düzenleme: yanlış girilen litre/kilometre kaydı SİLMEDEN
                  düzeltilebilir — silip yeniden girmek sunucudaki kimliği ve
                  kaydın tarihçesini kaybettirirdi. */}
              <button
                onClick={() => startEdit(entry)}
                data-testid="record-edit"
                aria-label={`${entry.filledOn} tarihli yakıt kaydını düzenle`}
                className="md-icon-btn md-state flex-shrink-0"
              >
                <Icon name="edit" />
              </button>
              <DeleteButton
                busy={deleting === entry.id}
                label={`${entry.filledOn} tarihli yakıt kaydını sil`}
                onConfirm={() => { void handleDelete(entry); }}
              />
            </div>
          ))}
        </section>
      ) : (
        !adding && (
          <EmptyState icon="local_gas_station" title="Henüz yakıt kaydı yok"
            body="İlk dolumu eklediğinizde tüketim ve harcama burada hesaplanır." />
        )
      )}
      {/* FAB son kaydın üstünü örtmesin. */}
      {!adding && <div aria-hidden="true" style={{ height: 72 }} />}
    </div>
  );
}

/* ── Servis sekmesi ───────────────────────────────────────────────────────── */

type ServiceStatus = 'ok' | 'soon' | 'overdue' | 'unknown';

/**
 * Servis durumu — SAF.
 *
 * ÖLÇÜLEN KUSUR: eski kod `vehicle?.odometer ?? 0` kullanıyordu. Aracın
 * kilometresi bilinmiyorken bu 0 demekti ve `kmSince = 0 − lastKm` NEGATİF
 * çıkıp her kalemi sahte "İyi" yapıyordu. Artık kilometre bilinmiyorsa hüküm
 * `unknown`dır — uydurma yeşil YOK.
 */
export function judgeService(
  def: ServiceDef,
  last: ServiceEntry | undefined,
  currentKm: number | null,
  /**
   * ARACIN ANLIK KİLOMETRESİ YOKKEN kullanılan **alt sınır**: kullanıcının
   * girdiği kayıtlardaki en yüksek kilometre. Araç bundan AZ gitmiş olamaz.
   * Bkz. aşağıdaki asimetri kuralı.
   */
  knownFloorKm: number | null = null,
): ServiceStatus {
  if (!last) return 'unknown';
  if (last.odometerKm === null) return 'unknown';

  if (currentKm !== null) {
    const kmSince = currentKm - last.odometerKm;
    if (kmSince < 0) return 'unknown';         // km geriye gitmiş → veri güvenilmez

    const kmLeft = def.intervalKm - kmSince;
    if (kmLeft < 0) return 'overdue';
    if (kmLeft < def.intervalKm * 0.15) return 'soon';
    return 'ok';
  }

  /* ── ALT SINIR ÇIKARIMI — ASİMETRİK ──────────────────────────────────
   * Aracın anlık kilometresi ölçülemiyorsa (OBD bağlı değil / odometre
   * okunamıyor) elimizde yalnız kayıtlardan gelen bir ALT SINIR vardır:
   * araç en az bu kadar gitmiştir. Bu sınır **tek yönde** hüküm kurar:
   *
   *   · "GEÇMİŞ" denebilir — alt sınır bile aralığı aşmışsa, gerçek
   *     kilometre daha da yüksektir; hüküm kesindir.
   *   · "İYİ" DENEMEZ — alt sınır aralığın altında kalması gerçek
   *     kilometrenin de altında olduğunu KANITLAMAZ. Yeşil basmak
   *     ölçülmemiş bir iyimserliktir (kütük #383 sınıfı).
   *
   * Bu yüzden sonuç ya `overdue` ya `unknown`dır — `ok`/`soon` asla.
   */
  if (knownFloorKm === null) return 'unknown';
  const kmSinceAtLeast = knownFloorKm - last.odometerKm;
  if (kmSinceAtLeast < 0) return 'unknown';
  return kmSinceAtLeast > def.intervalKm ? 'overdue' : 'unknown';
}

/**
 * Kayıtlardan türetilen **en yüksek bilinen kilometre** (alt sınır) — SAF.
 * Bilinmeyen kilometreler hesaba girmez; hiç ölçüm yoksa `null` döner
 * (0 bir iddiadır, yokluk değildir).
 */
export function knownOdometerFloor(
  fuel: readonly FuelEntry[],
  service: readonly ServiceEntry[],
): number | null {
  let max: number | null = null;
  for (const e of [...fuel, ...service]) {
    if (typeof e.odometerKm === 'number' && Number.isFinite(e.odometerKm) && e.odometerKm > 0) {
      max = max === null ? e.odometerKm : Math.max(max, e.odometerKm);
    }
  }
  return max;
}

/* ── Elle girilen kilometrenin doğrulaması (SAF) ──────────────────────────
 *
 * ÖLÇÜLEN KUSUR (2026-08-14, devir belgesi B5): "Yapıldı" düğmesi aracın
 * kilometresi okunamıyorken kaydı sessizce `odometer_km = null` ile yazıyordu.
 * Kullanıcıya HİÇ SORULMUYORDU — oysa kilometreyi bilen tek kişi oydu ve
 * bakım hükmü (`judgeService`) tam olarak o alan yüzünden `unknown` kalıyordu.
 * Yani ürün, kendisine verilebilecek veriyi istemeden "hesaplayamıyorum" diyordu.
 *
 * Doğrulama kuralları veri tabanı CHECK'iyle aynı sınırları kullanır; boş
 * bırakmak GEÇERLİDİR (bilinmiyor = `null`, sahte 0 YOK).
 */
export const ODOMETER_MAX_KM = 3_000_000;

export interface OdometerInputResult {
  /** Kaydedilecek değer — `null` = kullanıcı bilmiyor. */
  km:      number | null;
  /** Doluysa kayıt YAPILMAZ (girdi kabul edilemez). */
  error?:  string;
  /** Doluysa kayıt yapılır ama kullanıcı bilgilendirilir. */
  warning?: string;
}

export function validateOdometerInput(raw: string, floorKm: number | null): OdometerInputResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { km: null };          // "bilmiyorum" geçerli bir cevaptır

  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n)) return { km: null, error: 'Kilometre sayı olmalı.' };
  if (n < 0) return { km: null, error: 'Kilometre negatif olamaz.' };
  if (n > ODOMETER_MAX_KM) {
    return { km: null, error: `Kilometre ${ODOMETER_MAX_KM.toLocaleString('tr')} km'den büyük olamaz.` };
  }

  const km = Math.round(n);
  /* Araç kilometresi geriye gitmez. Girdi kayıtlardaki en yüksek değerin
     altındaysa REDDEDİLMEZ (kullanıcı eski bir bakımı sonradan giriyor
     olabilir) ama SESSİZ de geçilmez — bu kayıtla bakım hükmü kurulamaz. */
  if (floorKm !== null && km < floorKm) {
    return {
      km,
      warning: `Bu değer kayıtlarınızdaki en yüksek kilometreden (${floorKm.toLocaleString('tr')} km) düşük. Kaydedilir, ancak bakım durumu bu kalem için hesaplanamayabilir.`,
    };
  }
  return { km };
}

const STATUS_CFG: Record<ServiceStatus, { color: string; label: string; bg: string; border: string }> = {
  ok:      { color: 'var(--md-success)', label: 'İyi',        bg: 'color-mix(in srgb, var(--md-success) 8%, transparent)', border: 'color-mix(in srgb, var(--md-success) 20%, transparent)' },
  soon:    { color: 'var(--md-warning)', label: 'Yakında',    bg: 'color-mix(in srgb, var(--md-warning) 8%, transparent)', border: 'color-mix(in srgb, var(--md-warning) 25%, transparent)' },
  overdue: { color: 'var(--md-error)', label: 'Geçmiş',     bg: 'color-mix(in srgb, var(--md-error) 8%, transparent)',  border: 'color-mix(in srgb, var(--md-error) 25%, transparent)' },
  unknown: { color: 'var(--md-outline)', label: 'Bilinmiyor', bg: 'var(--pwa-surface-3)',  border: 'var(--pwa-border-soft)' },
};

function ServiceTab({ vehicle }: { vehicle: LiveVehicle | null }) {
  const [entries, setEntries] = useState<ServiceEntry[]>([]);
  const [fuelLog, setFuelLog] = useState<FuelEntry[]>([]);
  const [mode,    setMode]    = useState<RecordsStorageMode>('LOCAL_ONLY');
  const [loading, setLoading] = useState(true);
  const [msg,     setMsg]     = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async (vid: string) => {
    setLoading(true);
    /* Yakıt kayıtları da okunur: aracın anlık kilometresi ölçülemiyorsa
       bakım hükmü için tek kanıt kullanıcının girdiği kilometrelerdir. */
    const [svc, fuel] = await Promise.all([loadServiceEntries(vid), loadFuelEntries(vid)]);
    if (!mounted.current) return;
    setEntries(svc.entries);
    setFuelLog(fuel.entries);
    setMode(svc.mode);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!vehicle?.id) { setLoading(false); return; }
    void reload(vehicle.id);
  }, [vehicle?.id, reload]);

  /* Aracın kilometresi ÖLÇÜLMEMİŞSE `null` — 0 varsayılmaz. */
  const currentKm: number | null =
    typeof vehicle?.odometer === 'number' && vehicle.odometer > 0
      ? Math.round(vehicle.odometer)
      : null;

  /* Ölçülmüş anlık kilometre yoksa kayıtlardan gelen ALT SINIR — yalnız
     "geçmiş" hükmü kurabilir, "iyi" kuramaz (bkz. judgeService). */
  const floorKm = knownOdometerFloor(fuelLog, entries);

  /**
   * Açık olan satır-içi form. İki iş AYNI formu paylaşır — ikisi de "bu bakım
   * hangi kilometrede yapıldı" sorusudur:
   *   `ASK_KM` — yeni "Yapıldı" kaydı, araçtan kilometre okunamadı.
   *   `EDIT`   — var olan kaydın tarihini/kilometresini düzeltme.
   */
  type ServiceSheet =
    | { mode: 'ASK_KM'; serviceKey: string }
    | { mode: 'EDIT';   serviceKey: string; entry: ServiceEntry };

  const [sheet,     setSheet]     = useState<ServiceSheet | null>(null);
  const [kmDraft,   setKmDraft]   = useState('');
  const [dateDraft, setDateDraft] = useState('');

  const saveDone = useCallback(async (key: string, odometerKm: number | null) => {
    if (!vehicle?.id) return;
    const res = await addServiceEntry(vehicle.id, {
      serviceKey:  key,
      performedOn: new Date().toISOString().split('T')[0],
      odometerKm,   // bilinmiyorsa null — sahte 0 YAZILMAZ
    });
    if (!mounted.current) return;
    if (!res.saved) { setMsg(res.error ?? 'Kayıt yapılamadı.'); return; }
    setSheet(null);
    setKmDraft('');
    setMsg(SAVE_MESSAGE[res.mode]);
    await reload(vehicle.id);
  }, [vehicle, reload]);

  /** Var olan kaydı günceller — kalem anahtarı DEĞİŞMEZ. */
  const saveEdit = useCallback(async (entry: ServiceEntry, performedOn: string, odometerKm: number | null) => {
    if (!vehicle?.id) return;
    const res = await updateServiceEntry(vehicle.id, entry, { performedOn, odometerKm });
    if (!mounted.current) return;
    // Başarısızsa form AÇIK KALIR — kullanıcı girdiğini kaybetmez.
    if (!res.saved) { setMsg(res.error ?? 'Kayıt güncellenemedi.'); return; }
    setSheet(null);
    setKmDraft('');
    setMsg(UPDATE_MODE_MESSAGE[res.mode]);
    await reload(vehicle.id);
  }, [vehicle, reload]);

  /**
   * "Yapıldı" akışı. Araçtan kilometre OKUNABİLİYORSA doğrudan kaydedilir —
   * ölçüm varken kullanıcıya soru sormak gereksiz sürtünmedir. Okunamıyorsa
   * ARTIK SORULUR: eskiden sessizce `null` yazılıyor ve bakım hükmü bu yüzden
   * hiç kurulamıyordu.
   */
  const markDone = useCallback((key: string) => {
    if (currentKm !== null) { void saveDone(key, currentKm); return; }
    setMsg('');
    setKmDraft('');
    setSheet({ mode: 'ASK_KM', serviceKey: key });
  }, [currentKm, saveDone]);

  const startEdit = useCallback((entry: ServiceEntry) => {
    setMsg('');
    setKmDraft(entry.odometerKm != null ? String(entry.odometerKm) : '');
    setDateDraft(entry.performedOn);
    setSheet({ mode: 'EDIT', serviceKey: entry.serviceKey, entry });
  }, []);

  const closeSheet = useCallback(() => { setSheet(null); setKmDraft(''); }, []);

  /**
   * Formdan gelen değeri doğrulayıp kaydeder. Boş kilometre = "bilmiyorum" →
   * `null` (sahte 0 YOK). Doğrulama TEK yerdedir; ekleme ile düzenleme aynı
   * kuralı kullanır.
   */
  const submitSheet = useCallback(() => {
    if (!sheet) return;
    const res = validateOdometerInput(kmDraft, floorKm);
    if (res.error) { setMsg(res.error); return; }
    if (res.warning) setMsg(res.warning);

    if (sheet.mode === 'ASK_KM') { void saveDone(sheet.serviceKey, res.km); return; }
    if (!dateDraft) { setMsg('Tarih zorunludur.'); return; }
    void saveEdit(sheet.entry, dateDraft, res.km);
  }, [sheet, kmDraft, dateDraft, floorKm, saveDone, saveEdit]);

  /* Yanlışlıkla "Yapıldı" basılan kalemin SON kaydını geri alır. Kayıt
     nerede yaşıyorsa oradan gider — kuyruktaysa gönderilmeden iptal edilir. */
  const undoLast = useCallback(async (entry: ServiceEntry) => {
    if (!vehicle?.id) return;
    setDeleting(entry.serviceKey);
    const res = await deleteServiceEntry(vehicle.id, entry);
    if (!mounted.current) return;
    setDeleting(null);
    setMsg(res.deleted ? DELETE_SCOPE_MESSAGE[res.scope] : (res.error ?? 'Kayıt silinemedi.'));
    if (res.deleted) await reload(vehicle.id);
  }, [vehicle, reload]);

  if (!vehicle) {
    return <p className="py-6 text-center text-sm pwa-text-3">Araç seçilmedi</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <StorageBadge mode={mode} />

      {/* Kilometre ölçülmemişse bunu AÇIKÇA söyler — bakım hükmü bu yüzden verilemez. */}
      <p className="md-body-s md-on-surface-variant px-1 inline-flex items-center gap-1.5">
        <Icon name="speed" size={18} />
        {currentKm != null
          ? `Mevcut km: ${currentKm.toLocaleString('tr')}`
          : 'Araç kilometresi okunamadı — bakım durumu hesaplanamıyor'}
      </p>

      {msg && (
        <p data-testid="service-save-msg" className="md-body-s md-on-surface-variant px-1">{msg}</p>
      )}

      {loading && <p className="py-4 text-center md-body-m md-on-surface-variant" role="status">Kayıtlar yükleniyor…</p>}

      {SERVICE_DEFS.map((def) => {
        // Her kalem için EN SON kayıt (liste tarihe göre azalan gelir).
        const last = entries.find((e) => e.serviceKey === def.key);
        const st   = judgeService(def, last, currentKm, floorKm);
        const cfg  = STATUS_CFG[st];

        const kmSince = last?.odometerKm != null && currentKm != null
          ? currentKm - last.odometerKm : null;
        const kmLeft  = kmSince != null ? def.intervalKm - kmSince : null;

        return (
          <section key={def.key} className="md-card-elevated overflow-hidden" aria-label={def.label}>
          <div className="flex items-start gap-4 px-4 pt-4 pb-2">
            <IconBadge name={SERVICE_ICON[def.key] ?? 'build'} tone={st === 'unknown' ? 'neutral' : STATUS_TONE[st]} />

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="md-title-m md-on-surface">{def.label}</p>
                <StatusPill tone={STATUS_TONE[st]}>{cfg.label}</StatusPill>
                {/* Son kayıt sunucuda değilse bunu söyler — bakım hükmü
                    gönderilmemiş bir kayda dayanıyor olabilir. */}
                <EntrySyncBadge sync={last?.sync} />
              </div>
              <p className="md-body-s mt-1 md-on-surface-variant">
                {last
                  ? `Son: ${new Date(last.performedOn).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: '2-digit' })}`
                  : 'Kayıt yok'}
                {last && (last.odometerKm != null
                  ? ` · ${last.odometerKm.toLocaleString('tr')} km`
                  : ' · km bilinmiyor')}
                {kmLeft != null && kmLeft > 0 && ` · ${kmLeft.toLocaleString('tr')} km kaldı`}
                {kmLeft != null && kmLeft <= 0 && ` · ${Math.abs(kmLeft).toLocaleString('tr')} km geçmiş!`}
                {/* Anlık kilometre ölçülemiyorsa hükmün NEYE dayandığı
                    açıkça yazılır — "en az" kelimesi tahmini gizlemez. */}
                {currentKm === null && floorKm != null && last?.odometerKm != null &&
                  ` · araç ölçülemiyor, kayıtlara göre en az ${(floorKm - last.odometerKm).toLocaleString('tr')} km`}
              </p>

              {/* ARALIK ÇUBUĞU — yalnız GERÇEK kilometre farkı biliniyorsa
                  çizilir (ölçülmemiş ilerleme uydurulmaz). Bakım aralığının
                  ne kadarının kullanıldığını tek bakışta gösterir. */}
              {kmSince != null && kmSince >= 0 && (
                <div className="mt-2.5" role="img"
                  aria-label={`Bakım aralığının yüzde ${Math.min(100, Math.round((kmSince / def.intervalKm) * 100))} kullanıldı`}>
                  <div style={{ height: 4, borderRadius: 2, background: 'var(--md-surface-container-highest)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: `${Math.min(100, (kmSince / def.intervalKm) * 100)}%`,
                      background: TONE_ROLES[STATUS_TONE[st]].fg,
                    }} />
                  </div>
                  <p className="md-label-m md-on-surface-variant mt-1 tabular-nums">
                    {kmSince.toLocaleString('tr')} / {def.intervalKm.toLocaleString('tr')} km
                  </p>
                </div>
              )}
            </div>
          </div>

          {!last && (
            /* Kaydı olmayan kalemde tek eylem başlık satırının altında,
               sağa yaslı ve kompakt — boş bir eylem satırı açılmaz. */
            <div className="flex justify-end px-3 pb-3 -mt-10">
              <button
                onClick={() => markDone(def.key)}
                data-testid={`service-done-${def.key}`}
                className="md-btn-text md-state"
                style={{ minHeight: 40 }}
              >
                <Icon name="done" size={18} />
                Yapıldı
              </button>
            </div>
          )}
          {last && <div className="flex items-center justify-end gap-1 px-2 pb-2">
            {/* Kayıt varsa DÜZELTİLEBİLİR ve geri alınabilir — yanlış
                kilometre yüzünden kaydı silmek zorunda kalınmaz. */}
            {last && (
              <button
                onClick={() => startEdit(last)}
                data-testid={`service-edit-${def.key}`}
                aria-label={`${def.label} son kaydını düzenle`}
                className="md-icon-btn md-state"
              >
                <Icon name="edit" />
              </button>
            )}
            {last && (
              <DeleteButton
                busy={deleting === def.key}
                label={`${def.label} son kaydını geri al`}
                onConfirm={() => { void undoLast(last); }}
              />
            )}
            <button
              onClick={() => markDone(def.key)}
              data-testid={`service-done-${def.key}`}
              className="md-btn-tonal md-state ml-1"
              style={{ minHeight: 40 }}
            >
              <Icon name="done" size={18} />
              Yapıldı
            </button>
          </div>}

          {/* ── KİLOMETRE FORMU ───────────────────────────────────────────
              İki mod, tek form: yeni kayıtta araçtan ölçüm ALINAMADIĞINDA
              açılır; düzenlemede var olan kaydı düzeltir. Kilometreyi boş
              bırakmak geçerli bir cevaptır ("bilmiyorum" → null); uydurma 0 YOK. */}
          {sheet?.serviceKey === def.key && (
            <div
              data-testid="service-km-prompt"
              data-mode={sheet.mode}
              className="flex flex-col gap-3 px-4 py-4"
              style={{ borderTop: '1px solid var(--md-outline-variant)', background: 'var(--md-surface-container)' }}
            >
              <p className="md-title-s md-on-surface">
                {def.label} — {sheet.mode === 'EDIT' ? 'kaydı düzenle' : 'kilometre'}
              </p>
              <p className="md-body-s md-on-surface-variant">
                {sheet.mode === 'EDIT'
                  ? <>Bu kalemin son kaydını düzeltebilirsiniz. Kilometreyi bilmiyorsanız <b>boş bırakın</b> — kayıt korunur, yalnız bakım durumu hesaplanamaz.</>
                  : <>Araçtan kilometre okunamadı. Bakım durumunun hesaplanabilmesi için bakımın yapıldığı kilometreyi girin. <b>Bilmiyorsanız boş bırakın</b> — kayıt yine tutulur, yalnız bu kalem için "Bilinmiyor" görünür.</>}
                {floorKm !== null && (
                  <> Kayıtlarınızdaki en yüksek kilometre: <b>{floorKm.toLocaleString('tr')} km</b>.</>
                )}
              </p>

              {sheet.mode === 'EDIT' && (
                <input
                  type="date"
                  data-testid="service-date-input"
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                  aria-label="Bakım tarihi"
                  className="md-field"
                />
              )}

              <input
                type="number"
                inputMode="numeric"
                autoFocus
                data-testid="service-km-input"
                placeholder={floorKm !== null ? String(floorKm) : '85000'}
                value={kmDraft}
                onChange={(e) => setKmDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSheet(); }}
                aria-label="Bakım kilometresi"
                className="md-field"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={closeSheet} className="md-btn-text md-state min-h-12">Vazgeç</button>
                {sheet.mode === 'ASK_KM' && (
                  <button
                    onClick={() => void saveDone(def.key, null)}
                    data-testid="service-km-unknown"
                    className="md-btn-outlined md-state min-h-12"
                  >
                    Bilmiyorum
                  </button>
                )}
                <button onClick={submitSheet} data-testid="service-km-save" className="md-btn-filled md-state min-h-12">
                  Kaydet
                </button>
              </div>
            </div>
          )}
          </section>
        );
      })}
    </div>
  );
}

/* ── Ana bileşen ──────────────────────────────────────────────────────────── */

type RecordsTab = 'fuel' | 'service';

/* ── Bekleyen kayıt şeridi ────────────────────────────────────────────────
 *
 * Kuyruğu SÜREN ve durumunu gösteren tek yüzey. Bekleyen kayıt yokken
 * hiçbir şey çizmez (boş durumda gürültü yapmaz) ama hook yine de mount
 * kalır — kuyruğu asıl boşaltan `online` aboneliği ondadır.
 *
 * Sayı okunamadıysa `0` BASILMAZ; "durum okunamadı" denir (sahte "hepsi
 * gitti" iddiası yasak).
 */
const QUEUE_TYPE_LABEL: Record<'FUEL_LOG_ADD' | 'SERVICE_RECORD_ADD', string> = {
  FUEL_LOG_ADD:       'Yakıt kaydı',
  SERVICE_RECORD_ADD: 'Servis kaydı',
};

const PendingQueueStrip = memo(function PendingQueueStrip() {
  const { pending, failed, failedItems, syncing, syncNow, retryItem, discardItem } = useRecordsSync();

  const unknown = pending === null;
  const nothing = pending === 0 && (failed === 0 || failed === null);
  if (!unknown && nothing) return null;

  return (
    <div className="flex flex-col gap-2">
      <div
        data-testid="records-queue-strip"
        data-pending={pending === null ? 'unknown' : String(pending)}
        data-failed={failed === null ? 'unknown' : String(failed)}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
        style={{ background: 'color-mix(in srgb, var(--md-primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-primary) 20%, transparent)' }}
      >
        <div className="flex-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--md-primary)' }}>
            {unknown
              ? 'Sıra durumu okunamadı'
              : `${pending} kayıt gönderilmeyi bekliyor`}
          </p>
          <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'var(--pwa-text-3)' }}>
            {unknown
              ? 'Cihaz deposu okunamadı — bekleyen kayıt olup olmadığı bilinmiyor.'
              : 'Bağlantı geldiğinde otomatik gönderilir. Bu kayıtlar henüz hesabınıza işlenmedi.'}
          </p>
        </div>
        <button
          onClick={() => void syncNow()}
          disabled={syncing}
          className="px-3 py-2 rounded-xl text-xs font-semibold flex-shrink-0 transition-all active:scale-95 disabled:opacity-50"
          style={{ background: 'color-mix(in srgb, var(--md-primary) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--md-primary) 30%, transparent)', color: 'var(--md-primary)' }}
        >
          {syncing ? 'Gönderiliyor…' : 'Şimdi gönder'}
        </button>
      </div>

      {/* GÖNDERİLEMEYEN KAYITLAR — TEK TEK.
          Yalnız adet göstermek kullanıcıyı çaresiz bırakır: hangi kaydın
          neden gitmediğini bilmeden ne yeniden deneyebilir ne vazgeçebilir.
          Gerekçe UYDURULMAZ; kuyruğun kaydettiği kod çevrilir, kod yoksa
          bunu da açıkça söyler. */}
      {failedItems.map((entry) => (
        <div
          key={entry.id}
          data-testid="records-queue-failed"
          data-status={entry.status}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
          style={{ background: 'color-mix(in srgb, var(--md-error) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-error) 22%, transparent)' }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: 'var(--md-error)' }}>
              {QUEUE_TYPE_LABEL[entry.type]} gönderilemedi
            </p>
            <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'var(--pwa-text-3)' }}>
              {queueFailureMessage(entry)}
              {` · ${entry.attemptCount}/${entry.maxAttempts} deneme`}
            </p>
          </div>
          <button
            onClick={() => void retryItem(entry.id)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 transition-all active:scale-95"
            style={{ background: 'color-mix(in srgb, var(--md-primary) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--md-primary) 30%, transparent)', color: 'var(--md-primary)' }}
          >
            Yeniden dene
          </button>
          <button
            onClick={() => void discardItem(entry.id)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 transition-all active:scale-95 pwa-text-3"
            style={{ background: 'var(--pwa-border-soft)', border: '1px solid var(--pwa-border)' }}
          >
            Vazgeç
          </button>
        </div>
      ))}
    </div>
  );
});

const RecordsPanel = memo(function RecordsPanel({ vehicle }: Props) {
  const [tab, setTab] = useState<RecordsTab>('fuel');

  return (
    <div className="flex flex-col gap-4">
      <PendingQueueStrip />
      {/* Alt sekme anahtarı — M3 segment düğmesi */}
      <SegmentedButton<RecordsTab>
        label="Kayıt türü"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'fuel',    label: 'Yakıt',  icon: 'local_gas_station' },
          { id: 'service', label: 'Servis', icon: 'build' },
        ]}
      />

      {tab === 'fuel'    && <FuelTab    vehicle={vehicle} />}
      {tab === 'service' && <ServiceTab vehicle={vehicle} />}
    </div>
  );
});

export default RecordsPanel;
