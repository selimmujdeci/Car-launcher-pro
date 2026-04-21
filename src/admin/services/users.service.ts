import type { User, CreateUserDTO } from '../types'
import { MOCK_USERS } from './mock.data'

let _store: User[] = [...MOCK_USERS]

export async function listUsers(): Promise<User[]> {
  await tick()
  return [..._store]
}

export async function createUser(dto: CreateUserDTO): Promise<User> {
  await tick()
  const user: User = {
    ...dto,
    id:         crypto.randomUUID(),
    status:     'pending',
    created_at: new Date().toISOString(),
  }
  _store = [user, ..._store]
  return user
}

export async function updateUser(id: string, patch: Partial<User>): Promise<User> {
  await tick()
  const idx = _store.findIndex((u) => u.id === id)
  if (idx === -1) throw new Error('Kullanıcı bulunamadı')
  _store[idx] = { ..._store[idx], ...patch }
  return _store[idx]
}

export async function deleteUser(id: string): Promise<void> {
  await tick()
  _store = _store.filter((u) => u.id !== id)
}

function tick() { return new Promise((r) => setTimeout(r, 180)) }
