import type { User, Vehicle, AuthUser } from '../types'

export const MOCK_AUTH_USER: AuthUser = {
  id:          'u0',
  email:       'admin@carlauncher.pro',
  full_name:   'Ahmet Yılmaz',
  role:        'super_admin',
  institution: 'Merkez',
}

export const MOCK_USERS: User[] = [
  { id:'u1', full_name:'Ahmet Yılmaz',   email:'ahmet@example.com',   role:'super_admin', status:'active',   institution:'Merkez',               last_login:'2026-04-21T08:30:00Z', created_at:'2024-01-01T00:00:00Z' },
  { id:'u2', full_name:'Fatma Kaya',     email:'fatma@ist.bel.tr',    role:'admin',       status:'active',   institution:'İstanbul Belediyesi',   last_login:'2026-04-20T16:45:00Z', created_at:'2024-03-15T00:00:00Z' },
  { id:'u3', full_name:'Mehmet Demir',   email:'mehmet@ist.bel.tr',   role:'operator',    status:'active',   institution:'İstanbul Belediyesi',   last_login:'2026-04-21T07:00:00Z', created_at:'2024-06-01T00:00:00Z' },
  { id:'u4', full_name:'Ali Çelik',      email:'ali@ist.bel.tr',      role:'operator',    status:'active',   institution:'İstanbul Belediyesi',   last_login:'2026-04-21T06:30:00Z', created_at:'2024-08-20T00:00:00Z' },
  { id:'u5', full_name:'Zeynep Arslan',  email:'zeynep@ankara.bel.tr',role:'admin',       status:'active',   institution:'Ankara Büyükşehir',     last_login:'2026-04-19T14:20:00Z', created_at:'2024-04-10T00:00:00Z' },
  { id:'u6', full_name:'Hasan Öztürk',  email:'hasan@ankara.bel.tr', role:'operator',    status:'active',   institution:'Ankara Büyükşehir',     last_login:'2026-04-21T09:15:00Z', created_at:'2025-01-05T00:00:00Z' },
  { id:'u7', full_name:'Ayşe Şahin',    email:'ayse@viewer.com',     role:'viewer',      status:'inactive', institution:'İstanbul Belediyesi',   last_login:'2026-03-10T11:00:00Z', created_at:'2025-02-20T00:00:00Z' },
  { id:'u8', full_name:'Burak Koç',     email:'burak@pending.com',   role:'operator',    status:'pending',  institution:'Ankara Büyükşehir',     created_at:'2026-04-18T00:00:00Z' },
]

export const MOCK_VEHICLES: Vehicle[] = [
  { id:'v1', plate:'34 ABC 001', brand:'Ford',        model:'Transit',  year:2022, fuel_type:'diesel',   status:'active',      current_km:48250,  driver_name:'Ali Çelik',    institution:'İstanbul Belediyesi', speed:42, last_seen:'2026-04-21T09:20:00Z', ins_expiry:'2026-12-31', created_at:'2022-06-01T00:00:00Z' },
  { id:'v2', plate:'34 DEF 002', brand:'Renault',     model:'Master',   year:2021, fuel_type:'diesel',   status:'idle',        current_km:71340,                               institution:'İstanbul Belediyesi', speed:0,  last_seen:'2026-04-21T08:55:00Z', ins_expiry:'2026-08-20', created_at:'2021-09-15T00:00:00Z' },
  { id:'v3', plate:'06 GHI 003', brand:'Mercedes',    model:'Sprinter', year:2023, fuel_type:'diesel',   status:'active',      current_km:22100,  driver_name:'Hasan Öztürk', institution:'Ankara Büyükşehir',   speed:65, last_seen:'2026-04-21T09:18:00Z', ins_expiry:'2027-03-31', created_at:'2023-02-10T00:00:00Z' },
  { id:'v4', plate:'34 JKL 004', brand:'Volkswagen',  model:'Crafter',  year:2020, fuel_type:'diesel',   status:'maintenance', current_km:95600,                               institution:'İstanbul Belediyesi',          last_seen:'2026-04-18T17:30:00Z', ins_expiry:'2026-05-15', created_at:'2020-11-05T00:00:00Z' },
  { id:'v5', plate:'06 MNO 005', brand:'Toyota',      model:'Proace',   year:2024, fuel_type:'hybrid',   status:'active',      current_km:8900,                                institution:'Ankara Büyükşehir',   speed:28, last_seen:'2026-04-21T09:05:00Z', ins_expiry:'2027-11-30', created_at:'2024-01-20T00:00:00Z' },
  { id:'v6', plate:'35 PQR 006', brand:'Fiat',        model:'Ducato',   year:2019, fuel_type:'diesel',   status:'offline',     current_km:138000,                                                                          last_seen:'2026-04-10T14:00:00Z', ins_expiry:'2025-08-01', created_at:'2019-07-30T00:00:00Z' },
]
