import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { useCmsData } from './hooks/useCmsData'
import { DashboardPage } from './pages/DashboardPage'
import { DevicesPage } from './pages/DevicesPage'
import { HistoryPage } from './pages/HistoryPage'
import { MapsPage } from './pages/MapsPage'
import { PanelSetupPage } from './pages/PanelSetupPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatusPage } from './pages/StatusPage'

export default function App() {
  const data = useCmsData()

  return (
    <BrowserRouter>
      <Routes>
        <Route
          element={
            <AppShell
              license={data.license}
              wsConnected={data.connected}
              mockMode={data.mockMode}
            />
          }
        >
          <Route
            index
            element={
              <DashboardPage
                panels={data.panels}
                devices={data.devices}
                writeAllowed={data.writeAllowed}
                events={data.events}
                loadError={data.loadError}
                onRefresh={data.refresh}
              />
            }
          />
          <Route
            path="devices"
            element={
              <DevicesPage
                panels={data.panels}
                devices={data.devices}
                writeAllowed={data.writeAllowed}
                onRefresh={data.refresh}
              />
            }
          />
          <Route
            path="panels/:panelId"
            element={
              <PanelSetupPage
                writeAllowed={data.writeAllowed}
                onRefresh={data.refresh}
                lastEvent={data.lastEvent}
              />
            }
          />
          <Route
            path="status"
            element={
              <StatusPage
                panels={data.panels}
                devices={data.devices}
                onRefresh={data.refresh}
              />
            }
          />
          <Route
            path="maps"
            element={
              <MapsPage
                maps={data.maps}
                devices={data.devices}
                panels={data.panels}
                writeAllowed={data.writeAllowed}
                onRefresh={data.refresh}
              />
            }
          />
          <Route
            path="history"
            element={<HistoryPage panels={data.panels} liveEvents={data.events} />}
          />
          <Route
            path="settings"
            element={<SettingsPage license={data.license} onChanged={data.refresh} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
