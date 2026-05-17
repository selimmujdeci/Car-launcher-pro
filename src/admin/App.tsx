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
import { ChaosSimulator } from './ChaosSimulator'
import { SuperAdminGuard } from './components/auth/SuperAdminGuard'
import { SuperAdminShell, EmptyModule } from './layouts/SuperAdminShell'
import { HealthCenter }   from './pages/superadmin/HealthCenter'
import { FeatureFlags }   from './pages/superadmin/FeatureFlags'
import { PolicyCenter }   from './pages/superadmin/PolicyCenter'

export function AdminApp() {
  return (
    <AuthProvider>
      <RoleProvider>
        <BrowserRouter basename="/admin">
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* Super Admin Control Center — kendi layout'ı var */}
            <Route
              path="sa"
              element={<SuperAdminGuard><SuperAdminShell /></SuperAdminGuard>}
            >
              <Route index element={<Navigate to="health" replace />} />
              <Route path="health"   element={<HealthCenter />} />
              <Route path="fleet"    element={<EmptyModule label="Fleet Center"    description="Anonim filo operasyonel görünümü" />} />
              <Route path="flags"    element={<FeatureFlags />} />
              <Route path="policies" element={<PolicyCenter />} />
              <Route path="rollout"  element={<EmptyModule label="Rollout Center"  description="Sürüm dağıtım planları & onay akışı" />} />
              <Route path="audit"    element={<EmptyModule label="Audit Center"    description="Denetim kaydı & aksiyon geçmişi" />} />
            </Route>

            <Route element={<AdminLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="users"      element={<Users />} />
              <Route path="vehicles"   element={<Vehicles />} />
              <Route path="settings"   element={<Settings />} />
              <Route path="superadmin" element={<SuperAdmin />} />
              {/* DEV-only: /admin/chaos — sidebar'da görünmez, doğrudan URL ile erişilir */}
              {import.meta.env.DEV && (
                <Route path="chaos" element={<ChaosSimulator />} />
              )}
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </RoleProvider>
    </AuthProvider>
  )
}
