import { create } from 'zustand'

interface UIState {
  selectedNodeId: number | null
  sidebarOpen: boolean
  setSelectedNode: (id: number | null) => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>((set) => ({
  selectedNodeId: null,
  sidebarOpen: true,
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
