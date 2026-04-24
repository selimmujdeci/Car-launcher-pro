export type Role = 'driver' | 'technician' | 'admin' | 'guest';

export type Permission =
  | 'reverseCamera'   // geri görüş kamerası
  | 'obdData'         // OBD veri okuma
  | 'canDebug'        // CAN debug paneli
  | 'settingsFull';   // tüm ayarlara erişim

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  guest:      [],
  driver:     ['reverseCamera', 'obdData'],
  technician: ['reverseCamera', 'obdData', 'canDebug'],
  admin:      ['reverseCamera', 'obdData', 'canDebug', 'settingsFull'],
} as const;
