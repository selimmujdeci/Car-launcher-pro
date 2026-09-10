/**
 * SavedLocationsPanel — "Özel Konumlar" açılır paneli (NavigationHUD'dan
 * çıkarıldı, görev: isimli kayıt + yeniden adlandırma + paylaşım; P0-NAV-04
 * dosya-şişmesi kilidine uyum — bkz. regression.guards.test.ts).
 *
 * TEK OTORİTE: `savedLocationsService` (id/lat/lng/name/timestamp —
 * `useStore().settings.customLocations`). Bu bileşen persistence'a DOĞRUDAN
 * dokunmaz, yalnız servisi çağırır — Mavi (useVoiceCommandHandler) AYNI
 * servisi kullanır (CLAUDE.md §6 tek otorite).
 */
import { memo, useCallback, useState } from 'react';
import {
  MapPin, Star, Plus, Trash2, X, Loader2, Share2, Pencil, Check,
} from 'lucide-react';
import { useStore } from '../../../store/useStore';
import { _haversineMeters } from '../../../platform/gps/gpsMath';
import { formatDistance } from '../../../platform/navigationService';
import type { Address } from '../../../platform/addressBookService';
import {
  addSavedLocation, renameSavedLocation, removeSavedLocation, shareSavedLocation,
  type SavedLocation,
} from '../../../platform/savedLocations/savedLocationsService';

interface SavedLocationsPanelProps {
  gpsLat: number | null;
  gpsLon: number | null;
  onNavigate: (dest: Address) => void;
  onClose: () => void;
}

export const SavedLocationsPanel = memo(function SavedLocationsPanel({
  gpsLat, gpsLon, onNavigate, onClose,
}: SavedLocationsPanelProps) {
  const customLocations = useStore(s => s.settings.customLocations ?? []);
  const [addError, setAddError]       = useState('');
  // İsimli kayıt akışı: "Konum Ekle" tıklanınca isim girişi açılır (görev §1).
  const [addingName, setAddingName]   = useState(false);
  const [nameInput, setNameInput]     = useState('');
  // Sonradan yeniden adlandırma (görev §2) — sil-yeniden-oluştur YOK, ID korunur.
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editInput, setEditInput]     = useState('');
  const [shareBusyId, setShareBusyId] = useState<string | null>(null);

  const startAddLocation = useCallback(() => {
    if (!gpsLat || !gpsLon) {
      setAddError('GPS sinyali yok');
      setTimeout(() => setAddError(''), 2500);
      return;
    }
    setNameInput('');
    setAddingName(true);
  }, [gpsLat, gpsLon]);

  // TEK otorite: savedLocationsService.addSavedLocation (UI ve Mavi AYNI yolu kullanır).
  // Boş isim → mevcut fallback ("Konum N") KORUNUR (addSavedLocation'ın kendi kuralı).
  const confirmAddLocation = useCallback(() => {
    if (!gpsLat || !gpsLon) { setAddingName(false); return; }
    addSavedLocation(gpsLat, gpsLon, nameInput);
    setAddingName(false);
    setNameInput('');
  }, [gpsLat, gpsLon, nameInput]);

  const startRename = useCallback((loc: SavedLocation) => {
    setEditingId(loc.id);
    setEditInput(loc.name);
  }, []);

  const confirmRename = useCallback(() => {
    if (editingId) renameSavedLocation(editingId, editInput);
    setEditingId(null);
    setEditInput('');
  }, [editingId, editInput]);

  const shareLocation = useCallback((loc: SavedLocation) => {
    setShareBusyId(loc.id);
    void shareSavedLocation(loc).finally(() => setShareBusyId(null));
  }, []);

  const removeCustomLocation = useCallback((id: string) => {
    removeSavedLocation(id);
  }, []);

  return (
    <div
      className="absolute left-full ml-2 rounded-2xl overflow-hidden animate-in fade-in slide-in-from-left-2 duration-200"
      style={{
        bottom:        0,
        width:         296,
        maxHeight:     320,
        background:    'rgba(10,14,26,0.45)',
        backdropFilter:'blur(22px)',
        border:        '1px solid rgba(255,255,255,0.10)',
        boxShadow:     '0 20px 50px rgba(0,0,0,0.5)',
      }}
    >
      {/* Başlık */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08]">
        <div className="flex items-center gap-2">
          <Star className="w-3.5 h-3.5" style={{ color: '#E0A23C' }} />
          <span className="text-[11px] font-black uppercase tracking-widest text-white">
            Özel Konumlar
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Kapat"
          className="w-6 h-6 rounded-lg flex items-center justify-center active:scale-90 transition-all bg-white/[0.04] border border-white/[0.06]"
        >
          <X className="w-3.5 h-3.5 text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))]" />
        </button>
      </div>

      {/* Konum Ekle — isim girişi (görev §1) */}
      {addingName ? (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]"
          style={{ background: 'rgba(224,162,60,0.08)' }}>
          <input
            autoFocus
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmAddLocation(); if (e.key === 'Escape') setAddingName(false); }}
            placeholder="Konum adı (ör. Annemler)"
            maxLength={60}
            className="flex-1 min-w-0 bg-white/[0.06] border border-white/[0.12] rounded-lg px-2.5 py-2 text-[12px] font-bold text-white placeholder:text-[color:var(--oem-ink-3,rgba(240,235,224,0.4))] outline-none focus:border-[#E0A23C]"
          />
          <button
            onClick={confirmAddLocation}
            aria-label="Kaydet"
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
            style={{ background: 'rgba(224,162,60,0.22)', border: '1px solid rgba(224,162,60,0.4)' }}
          >
            <Check className="w-4 h-4" style={{ color: '#E0A23C' }} />
          </button>
          <button
            onClick={() => setAddingName(false)}
            aria-label="Vazgeç"
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-white/[0.04] border border-white/[0.08]"
          >
            <X className="w-4 h-4 text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))]" />
          </button>
        </div>
      ) : (
        <button
          onClick={startAddLocation}
          disabled={!gpsLat || !gpsLon}
          className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'rgba(224,162,60,0.08)' }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(224,162,60,0.18)', border: '1px solid rgba(224,162,60,0.35)' }}>
            <Plus className="w-4 h-4" style={{ color: '#E0A23C' }} />
          </div>
          <div className="flex flex-col items-start min-w-0">
            <span className="text-[12px] font-black uppercase tracking-wider leading-none" style={{ color: '#E8B86A' }}>
              Konum Ekle
            </span>
            <span className="text-[9px] font-bold text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] mt-1">
              Bulunduğun yeri kaydet
            </span>
          </div>
        </button>
      )}

      {addError && (
        <div className="mx-2 mt-2 px-2 py-1 rounded-lg text-[10px] font-mono text-center bg-red-900/60 border border-red-700/50 text-red-300">
          {addError}
        </div>
      )}

      {/* Liste */}
      <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
        {customLocations.length === 0 ? (
          <div className="px-3 py-5 text-center">
            <MapPin className="w-5 h-5 text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] mx-auto mb-2" />
            <span className="text-[10px] font-bold text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] uppercase tracking-wider">
              Henüz kayıtlı konum yok
            </span>
          </div>
        ) : (
          customLocations.map((loc) => (
            <div
              key={loc.id}
              className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03]"
            >
              {editingId === loc.id ? (
                <>
                  <input
                    autoFocus
                    type="text"
                    value={editInput}
                    onChange={(e) => setEditInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setEditingId(null); }}
                    maxLength={60}
                    className="flex-1 min-w-0 bg-white/[0.06] border border-white/[0.12] rounded-lg px-2 py-1.5 text-[11px] font-bold text-white outline-none focus:border-[#E0A23C]"
                  />
                  <button
                    onClick={confirmRename}
                    aria-label="Adı kaydet"
                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
                    style={{ background: 'rgba(224,162,60,0.22)', border: '1px solid rgba(224,162,60,0.4)' }}
                  >
                    <Check className="w-3.5 h-3.5" style={{ color: '#E0A23C' }} />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    aria-label="Vazgeç"
                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-white/[0.04] border border-white/[0.08]"
                  >
                    <X className="w-3.5 h-3.5 text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))]" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      onNavigate({
                        id:        loc.id,
                        name:      loc.name,
                        latitude:  loc.lat,
                        longitude: loc.lng,
                        type:      'history',
                      });
                    }}
                    aria-label={`${loc.name} — git`}
                    className="flex-1 flex items-center gap-2 min-w-0 active:scale-[0.98] transition-all text-left"
                  >
                    <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(224,162,60,0.10)', border: '1px solid rgba(224,162,60,0.20)' }}>
                      <MapPin className="w-3 h-3" style={{ color: '#E0A23C' }} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] font-black text-white truncate leading-none">
                        {loc.name}
                      </span>
                      <span className="text-[9px] font-mono text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))] mt-1 truncate">
                        {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                        {gpsLat != null && gpsLon != null && (
                          <> · {formatDistance(_haversineMeters(gpsLat, gpsLon, loc.lat, loc.lng))}</>
                        )}
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => shareLocation(loc)}
                    disabled={shareBusyId === loc.id}
                    aria-label={`${loc.name} — paylaş`}
                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-white/[0.05] border border-white/[0.10] disabled:opacity-50"
                  >
                    {shareBusyId === loc.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[color:var(--oem-ink-3,rgba(240,235,224,0.52))]" />
                      : <Share2 className="w-3.5 h-3.5 text-[color:var(--oem-ink-3,rgba(240,235,224,0.7))]" />}
                  </button>
                  <button
                    onClick={() => startRename(loc)}
                    aria-label={`${loc.name} — adını değiştir`}
                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-white/[0.05] border border-white/[0.10]"
                  >
                    <Pencil className="w-3.5 h-3.5 text-[color:var(--oem-ink-3,rgba(240,235,224,0.7))]" />
                  </button>
                  <button
                    onClick={() => removeCustomLocation(loc.id)}
                    aria-label={`${loc.name} — sil`}
                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 active:scale-90 transition-all bg-[var(--oem-danger-soft)] border border-[var(--oem-danger)]"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-[color:var(--oem-danger)]" />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
});
