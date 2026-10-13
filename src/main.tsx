import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider, ThemeProvider, useAuth } from './hooks'
import { ProtectedLayout } from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Records from './pages/Records'
import { SECTIONS } from './lib/sections'
import Companies from './pages/Companies'
import NewOperation from './pages/NewOperation'
import Reports from './pages/Reports'
import BankMovements from './pages/BankMovements'
import Suppliers from './pages/Suppliers'
import SettingsPage from './pages/Settings'

function Home() {
  const { session, loading } = useAuth()
  if (loading) return null
  return <Navigate to={session ? '/dashboard' : '/login'} replace />
}

const root: Root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!)
if (import.meta.hot) import.meta.hot.data.root = root

root.render(
  <StrictMode>
    <ThemeProvider><AuthProvider><BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/registros" element={<Records />} />
          <Route path={SECTIONS.flight.path} element={<Records key="flight" section="flight" />} />
          <Route path={SECTIONS.flight.path + "/nuevo"} element={<NewOperation key="flight" section="flight" />} />
          <Route path={SECTIONS.hotel.path} element={<Records key="hotel" section="hotel" />} />
          <Route path={SECTIONS.hotel.path + "/nuevo"} element={<NewOperation key="hotel" section="hotel" />} />
          <Route path={SECTIONS.loan.path} element={<Records key="loan" section="loan" />} />
          <Route path={SECTIONS.loan.path + "/nuevo"} element={<NewOperation key="loan" section="loan" />} />
          <Route path={SECTIONS.food.path} element={<Records key="food" section="food" />} />
          <Route path={SECTIONS.food.path + "/nuevo"} element={<NewOperation key="food" section="food" />} />
          <Route path={SECTIONS.transport.path} element={<Records key="transport" section="transport" />} />
          <Route path={SECTIONS.transport.path + "/nuevo"} element={<NewOperation key="transport" section="transport" />} />
          <Route path={SECTIONS.other.path} element={<Records key="other" section="other" />} />
          <Route path={SECTIONS.other.path + "/nuevo"} element={<NewOperation key="other" section="other" />} />
          <Route path="/empresas" element={<Companies />} />
          <Route path="/proveedores-tarjetas" element={<Suppliers />} />
          <Route path="/proveedores" element={<Navigate to="/proveedores-tarjetas" replace />} />
          <Route path="/reportes" element={<Reports />} />
          <Route path="/movimientos-bancarios" element={<BankMovements />} />
          <Route path="/configuracion" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter></AuthProvider></ThemeProvider>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
