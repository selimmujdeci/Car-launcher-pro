import { create } from 'zustand';
import { mockNotifications } from '@/lib/mockData';
import type { NotificationEvent, NotificationType, NotificationSeverity } from '@/types/realtime';

// Seed from legacy mock notifications
const seedNotifications = (): NotificationEvent[] =>
  mockNotifications.map((n, i) => ({
    id: `seed-${i}`,
    vehicleId: '',
    plate: n.message.split(' — ')[0] ?? '',
    type: (n.type === 'alarm' ? 'speed' : n.type === 'warning' ? 'fuel' : 'speed') as NotificationType,
    message: n.message,
    severity: (n.type === 'alarm' ? 'critical' : n.type === 'warning' ? 'warning' : 'info') as NotificationSeverity,
    timestamp: Date.now() - (n.read ? 3_600_000 : 60_000) + i * -30_000,
    read: n.read,
  }));

interface NotificationStoreState {
  notifications: NotificationEvent[];
  addNotifications: (events: NotificationEvent[]) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  unreadCount: () => number;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  notifications: seedNotifications(),

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
