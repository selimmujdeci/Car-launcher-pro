import { create } from 'zustand';
import type { NotificationEvent } from '@/types/realtime';

interface NotificationStoreState {
  notifications: NotificationEvent[];
  addNotifications: (events: NotificationEvent[]) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  unreadCount: () => number;
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
}));
