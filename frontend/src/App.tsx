import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AuthGuard from '@/components/layout/AuthGuard'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/app/LoginPage'
import ResourcesPage from '@/pages/app/ResourcesPage'
import AgentsPage from '@/pages/app/AgentsPage'
import LocationsPage from '@/pages/app/LocationsPage'
import ClassificationsPage from '@/pages/app/ClassificationsPage'
import InstitutionAdminPage from '@/pages/app/InstitutionAdminPage'
import MetadataTemplatesPage from '@/pages/app/MetadataTemplatesPage'
import FlagsPage from '@/pages/app/FlagsPage'
import AcquisitionsPage from '@/pages/app/AcquisitionsPage'
import SearchPage from '@/pages/app/SearchPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/app',
    element: <AuthGuard />,
    children: [{
      element: <AppLayout />,
      children: [
        { index: true,                element: <Navigate to="resources" replace /> },
        { path: 'resources',          element: <ResourcesPage /> },
        { path: 'agents',             element: <AgentsPage /> },
        { path: 'locations',          element: <LocationsPage /> },
        { path: 'classifications',    element: <ClassificationsPage /> },
        { path: 'administration',     element: <InstitutionAdminPage /> },
        { path: 'administration/templates', element: <MetadataTemplatesPage /> },
        { path: 'flags',                   element: <FlagsPage /> },
        { path: 'acquisitions',            element: <AcquisitionsPage /> },
        { path: 'search',                  element: <SearchPage /> },
        // Legacy redirects
        { path: 'institution',        element: <Navigate to="/app/administration" replace /> },
        { path: 'hierarchy',          element: <Navigate to="/app/administration" replace /> },
      ],
    }],
  },
  { path: '*', element: <Navigate to="/app" replace /> },
])

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}