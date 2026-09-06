import { createContext, useContext } from 'react';
import type { SolveResult } from './types.ts';

/** Null until the solver is wired in, and while a graph has no constraint. */
const SolveContext = createContext<SolveResult | null>(null);

export const SolveProvider = SolveContext.Provider;

export function useSolve(): SolveResult | null {
  return useContext(SolveContext);
}
