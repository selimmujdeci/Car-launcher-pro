/**
 * Universal Edit System Store — v3
 * Ekranda görünen HER eleman düzenlenebilir.
 * Global tip stili + lokal element override + kalıcı localStorage.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ElementStyle {
  visible: boolean;
  bgColor: string | null;
  bgOpacity: number;          // 5-95
  borderColor: string | null;
  borderWidth: number;        // 0-4
  textColor: string | null;
  accentColor: string | null;
  fontWeight: 400 | 600 | 700 | 900 | null;
  fontScale: number | null;   // 0.8-1.5 multiplier
  borderRadius: number | null; // rem 0-3
  size: 'small' | 'default' | 'large';
  glowLevel: 0 | 1 | 2 | 3;
  shadowLevel: 0 | 1 | 2 | 3;
  opacity: number;            // 40-100
}

export const STYLE_DEFAULTS: ElementStyle = {
  visible: true,
  bgColor: null,
  bgOpacity: 80,
  borderColor: null,
  borderWidth: 2,
  textColor: null,
  accentColor: null,
  fontWeight: null,
  fontScale: null,
  borderRadius: null,
  size: 'default',
  glowLevel: 0,
  shadowLevel: 1,
  opacity: 100,
};

export interface EditableInfo {
  id: string;
  type: string;
  label: string;
}

export const EDITABLE_REGISTRY: Record<string, EditableInfo> = {
  // ── Layout çerçevesi ──
  header:              { id: 'header',            type: 'header',   label: 'Üst Bar'            },
  'tab-bar':           { id: 'tab-bar',            type: 'tab-bar',  label: 'Sekme Bar'          },
  dock:                { id: 'dock',               type: 'dock',     label: 'Dock Bar'           },
  'smart-banner':      { id: 'smart-banner',       type: 'card',     label: 'Akıllı Öneri'       },
  // ── Ana widgetlar ──
  speedometer:         { id: 'speedometer',        type: 'speedo',   label: 'Hız Göstergesi'     },
  'map-card':          { id: 'map-card',            type: 'map',      label: 'Harita'             },
  // ── Dock butonları ──
  'dock-notifications':{ id: 'dock-notifications', type: 'dock-btn', label: 'Dock: Bildirim'     },
  'dock-navigation':   { id: 'dock-navigation',    type: 'dock-btn', label: 'Dock: Navigasyon'   },
  'dock-dashcam':      { id: 'dock-dashcam',       type: 'dock-btn', label: 'Dock: Dashcam'      },
  'dock-weather':      { id: 'dock-weather',       type: 'dock-btn', label: 'Dock: Hava'         },
  'dock-security':     { id: 'dock-security',      type: 'dock-btn', label: 'Dock: Güvenlik'     },
  'dock-entertainment':{ id: 'dock-entertainment', type: 'dock-btn', label: 'Dock: Eğlence'      },
  'dock-voice':        { id: 'dock-voice',         type: 'dock-btn', label: 'Dock: Ses Asistan'  },
  'dock-apps':         { id: 'dock-apps',          type: 'dock-btn', label: 'Dock: Uygulamalar'  },
  // ── Ana sekme içerikleri ──
  'media-hub':         { id: 'media-hub',          type: 'media',    label: 'Medya Oynatıcı'     },
  'digital-cluster':   { id: 'digital-cluster',    type: 'card',     label: 'Dijital Cluster'    },
  'tpms-widget':       { id: 'tpms-widget',        type: 'card',     label: 'Lastik Basıncı'     },
  'obd-panel':         { id: 'obd-panel',          type: 'card',     label: 'OBD Paneli'         },
  'dtc-panel':         { id: 'dtc-panel',          type: 'card',     label: 'Arıza Kodları'      },
  'sport-mode':        { id: 'sport-mode',         type: 'card',     label: 'Spor Modu'          },
  'trip-log':          { id: 'trip-log',           type: 'card',     label: 'Seyahat Kaydı'      },
  // ── Drawer modülleri ──
  'weather-card':      { id: 'weather-card',       type: 'card',     label: 'Hava Durumu'        },
  'security-suite':    { id: 'security-suite',     type: 'card',     label: 'Güvenlik Paketi'    },
  entertainment:       { id: 'entertainment',      type: 'card',     label: 'Eğlence Portalı'    },
  dashcam:             { id: 'dashcam',            type: 'card',     label: 'Dashcam'            },
  'nav-hud':           { id: 'nav-hud',            type: 'card',     label: 'Navigasyon HUD'     },
  // ── HomeScreen (compat) ──
  'clock-card':        { id: 'clock-card',         type: 'card',     label: 'Saat & Durum'       },
  'fav-apps':          { id: 'fav-apps',           type: 'app-grid', label: 'Favoriler'          },
  'notification-area': { id: 'notification-area',  type: 'card',     label: 'Bildirimler'        },
  'phone-panel':       { id: 'phone-panel',        type: 'card',     label: 'Telefon'            },
  'vehicle-reminder':  { id: 'vehicle-reminder',   type: 'card',     label: 'Araç Bakım'         },
};

interface EditStore {
  locked: boolean;
  editingId: string | null;
  elements: Record<string, Partial<ElementStyle>>;
  globalTypes: Record<string, Partial<ElementStyle>>;

  toggleLock: () => void;
  setLocked: (v: boolean) => void;
  setEditing: (id: string | null) => void;
  getStyle: (id: string) => ElementStyle;
  updateElement: (id: string, patch: Partial<ElementStyle>) => void;
  resetElement: (id: string) => void;
  updateGlobal: (type: string, patch: Partial<ElementStyle>) => void;
  resetAll: () => void;
}

export const useEditStore = create<EditStore>()(
  persist(
    (set, get) => ({
      locked: false,
      editingId: null,
      elements: {},
      globalTypes: {},

      toggleLock: () => set((s) => ({ locked: !s.locked })),
      setLocked: (v) => set({ locked: v }),
      setEditing: (id) => set({ editingId: id }),

      getStyle: (id): ElementStyle => {
        const s = get();
        const info = EDITABLE_REGISTRY[id];
        const global = info ? (s.globalTypes[info.type] ?? {}) : {};
        const local = s.elements[id] ?? {};
        return { ...STYLE_DEFAULTS, ...global, ...local };
      },

      updateElement: (id, patch) =>
        set((s) => ({
          elements: { ...s.elements, [id]: { ...(s.elements[id] ?? {}), ...patch } },
        })),

      resetElement: (id) =>
        set((s) => {
          const next = { ...s.elements };
          delete next[id];
          return { elements: next };
        }),

      updateGlobal: (type, patch) =>
        set((s) => ({
          globalTypes: {
            ...s.globalTypes,
            [type]: { ...(s.globalTypes[type] ?? {}), ...patch },
          },
        })),

      resetAll: () => set({ elements: {}, globalTypes: {}, editingId: null }),
    }),
    {
      name: 'car-edit-system-v3',
      partialize: (s) => ({
        elements: s.elements,
        globalTypes: s.globalTypes,
        locked: s.locked,
      }),
    }
  )
);
