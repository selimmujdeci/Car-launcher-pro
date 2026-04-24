export type VehicleStatus = 'online' | 'offline' | 'alarm';

export interface Vehicle {
  id: string;
  plate: string;
  name: string;
  status: VehicleStatus;
  location: string;
  lastSeen: string;
  speed: number;
  driver: string;
  fuel: number;
  rpm: number;
  odometer: number;
  engineTemp: number;
}

export const mockVehicles: Vehicle[] = [
  {
    id: '1',
    plate: '34 ABC 001',
    name: 'Servis Aracı 1',
    status: 'online',
    location: 'Kadıköy, İstanbul',
    lastSeen: '1 dk önce',
    speed: 48,
    driver: 'Ahmet Yılmaz',
    fuel: 72,
    rpm: 1800,
    odometer: 84320,
    engineTemp: 88,
  },
  {
    id: '2',
    plate: '34 XYZ 445',
    name: 'Kurye Aracı A',
    status: 'online',
    location: 'Beşiktaş, İstanbul',
    lastSeen: '3 dk önce',
    speed: 0,
    driver: 'Mehmet Demir',
    fuel: 45,
    rpm: 0,
    odometer: 122040,
    engineTemp: 91,
  },
  {
    id: '3',
    plate: '06 DEF 223',
    name: 'Yönetici Aracı',
    status: 'alarm',
    location: 'Çankaya, Ankara',
    lastSeen: '5 dk önce',
    speed: 95,
    driver: 'Fatma Kaya',
    fuel: 28,
    rpm: 3200,
    odometer: 56780,
    engineTemp: 105,
  },
  {
    id: '4',
    plate: '35 GHI 780',
    name: 'Servis Aracı 2',
    status: 'offline',
    location: 'Konak, İzmir',
    lastSeen: '2 saat önce',
    speed: 0,
    driver: 'Ali Çelik',
    fuel: 61,
    rpm: 0,
    odometer: 37900,
    engineTemp: 20,
  },
  {
    id: '5',
    plate: '41 JKL 112',
    name: 'Lojistik Araç B',
    status: 'online',
    location: 'Gebze, Kocaeli',
    lastSeen: '2 dk önce',
    speed: 72,
    driver: 'Zeynep Arslan',
    fuel: 88,
    rpm: 2100,
    odometer: 209450,
    engineTemp: 87,
  },
  {
    id: '6',
    plate: '16 MNO 334',
    name: 'Satış Aracı 1',
    status: 'offline',
    location: 'Osmangazi, Bursa',
    lastSeen: '5 saat önce',
    speed: 0,
    driver: 'Emre Şahin',
    fuel: 15,
    rpm: 0,
    odometer: 91200,
    engineTemp: 20,
  },
];

export const mockNotifications = [
  { id: '1', type: 'alarm' as const, message: '06 DEF 223 — Motor sıcaklığı kritik seviyede (105°C)', time: '5 dk önce', read: false },
  { id: '2', type: 'alarm' as const, message: '06 DEF 223 — Hız limiti aşıldı (95 km/h)', time: '5 dk önce', read: false },
  { id: '3', type: 'warning' as const, message: '16 MNO 334 — Yakıt seviyesi düşük (%15)', time: '2 saat önce', read: false },
  { id: '4', type: 'info' as const, message: '41 JKL 112 — Bölge sınırı geçildi', time: '3 saat önce', read: true },
  { id: '5', type: 'info' as const, message: '34 ABC 001 — Günlük rota tamamlandı', time: '1 gün önce', read: true },
];
