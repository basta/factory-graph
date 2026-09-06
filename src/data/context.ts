import { createContext, useContext } from 'react';
import type { GameIndex } from './loader.ts';

const GameDataContext = createContext<GameIndex | null>(null);

export const GameDataProvider = GameDataContext.Provider;

export function useGameData(): GameIndex {
  const value = useContext(GameDataContext);
  if (!value) throw new Error('useGameData used outside GameDataProvider');
  return value;
}
