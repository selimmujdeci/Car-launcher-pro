import { create } from 'zustand';
import type { NotificationEvent } from '@/types/realtime';

interface NotificationStoreState {
  notifications: NotificationEvent[];
  addNotifications: (events: NotificationEvent[]) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  unreadCount: () => number;
  /**
   * Hesap temizliğinin (çıkış / hesap değişimi) kullandığı tek kapı.
   *
   * Bildirimler araç bağlamı ve derin bağlantı taşır (`ACCOUNT_VEHICLE`
   * kapsamı) — yani ÖNCEKİ hesabın verisidir. Depo tanımı bunu
   * `PURGE_ON_LOGOUT` olarak işaretliyordu ama temizleyen kimse YOKTU;
   * çıkış doğrulaması da bu yüzden düşüyordu.
   */
  clearAuthority: () => void;
  /** Doğrulama: önceki hesaba ait bildirim kalmadı mı? */
  isAuthorityEmpty: () => boolean;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  notifications: [],

  addNotifications: (events) => {
    if (events.length === 0) return;
    set((state) => ({
      // newest first, cap at 200
      notifications: [...events, ...state.notifications].slice(0, 200),
    }));
  },

  markRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    })),

  unreadCount: () => get().notifications.filter((n) => !n.read).length,

  clearAuthority: () => set({ notifications: [] }),

  isAuthorityEmpty: () => get().notifications.length === 0,
}));
