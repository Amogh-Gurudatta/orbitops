// Open/closed state of the command palette (shared by the console bar button and the hotkey).
import { create } from 'zustand';

interface PaletteState {
  isOpen: boolean;
  open(open: boolean): void;
}

export const useCommandPalette = create<PaletteState>()((set) => ({
  isOpen: false,
  open: (isOpen) => set({ isOpen }),
}));
