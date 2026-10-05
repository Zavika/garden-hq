import { create } from "zustand";

interface UiState {
  selectedPlotId: string | null;
  hoveredPlotId: string | null;
  selectPlot: (id: string | null) => void;
  hoverPlot: (id: string | null) => void;
}

export const useUi = create<UiState>((set) => ({
  selectedPlotId: null,
  hoveredPlotId: null,
  selectPlot: (selectedPlotId) => set({ selectedPlotId }),
  hoverPlot: (hoveredPlotId) => set({ hoveredPlotId }),
}));
