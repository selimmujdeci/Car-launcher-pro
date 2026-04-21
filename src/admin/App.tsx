import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { RoleProvider } from './hooks/useRole'
import { AdminLayout } from './components/layout/AdminLayout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Users } from './pages/Users'
import { Vehicles } from './pages/Vehicles'
import { Settings } from './pages/Settings'
import { SuperAdmin } from './pages/SuperAdmin'

export function AdminApp() {
  return (
    <AuthProvider>
      <RoleProvider>
        <BrowserRouter basename="/admin">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AdminLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="users"    element={<Users />} />
              <Route path="vehicles" element={<Vehicles />} />
              <Route path="settings"   element={<Settings />} />
              <Route path="superadmin" element={<SuperAdmin />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </RoleProvider>
    </AuthProvider>
  )
}
