import type { Vehicle } from '../types'
import { MOCK_VEHICLES } from './mock.data'

let _store: Vehicle[] = [...MOCK_VEHICLES]

export async function listVehicles(): Promise<Vehicle[]> {
  await tick()
  return [..._store]
}

export async function updateVehicle(id: string, patch: Partial<Vehicle>): Promise<Vehicle> {
  await tick()
  const idx = _store.findIndex((v) => v.id === id)
  if (idx === -1) throw new Error('Araç bulunamadı')
  _store[idx] = { ..._store[idx], ...patch }
  return _store[idx]
}

export async function deleteVehicle(id: string): Promise<void> {
  await tick()
  _store = _store.filter((v) => v.id !== id)
}

function tick() { return new Promise((r) => setTimeout(r, 180)) }
