import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameIndex } from '../data/loader.ts';
import { stepWorld } from '../sim/step.ts';
import { compileWorld, type World } from '../sim/world.ts';
import type { Build } from './types.ts';

/** Simulation speeds offered, in game seconds per real second. */
export const SPEEDS = [1, 4, 16, 64] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * Work allowed per animation frame. At 64× a large build can need more ticks
 * than a frame has time for; past this budget the simulation runs slower than
 * asked rather than dropping frames.
 */
const FRAME_BUDGET_MS = 10;

/**
 * Holds the last compiled world, so the next compile can carry its state
 * across. A new key — another plan, or a reset — starts from nothing.
 */
class Engine {
  private world: World | null = null;
  private key = '';

  compile(build: Build, index: GameIndex, key: string): World {
    const carried = key === this.key ? this.world : null;
    this.world = compileWorld(build, index, carried);
    this.key = key;
    return this.world;
  }
}

export interface BuildWorld {
  /** The live world for the current build. Mutated in place as it runs. */
  world: World;
  /** Empties every belt, machine and chest and sets the clock back to zero. */
  reset: () => void;
}

/**
 * The plan's world, kept at the editor's level so a trip to the graph view
 * and back finds the simulation where it was left.
 */
export function useBuildWorld(build: Build, index: GameIndex, planId: string | null): BuildWorld {
  const [engine] = useState(() => new Engine());
  const [epoch, setEpoch] = useState(0);
  const world = useMemo(
    () => engine.compile(build, index, `${planId ?? ''}:${epoch}`),
    [build, index, planId, epoch, engine],
  );
  const reset = useCallback(() => setEpoch((value) => value + 1), []);
  return { world, reset };
}

export interface Simulation {
  /** The live world. Mutated in place every tick, so read it, do not hold it. */
  world: () => World;
  running: boolean;
  setRunning: (running: boolean) => void;
  speed: Speed;
  setSpeed: (speed: Speed) => void;
  reset: () => void;
  step: (ticks?: number) => void;
  /** Bumps a few times a second while running, for panels that show rates. */
  pulse: number;
}

/** Runs a world on animation frames while the build view is open. */
export function useSimulation({ world, reset: resetWorld }: BuildWorld): Simulation {
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [pulse, setPulse] = useState(0);
  const worldRef = useRef(world);
  useLayoutEffect(() => {
    worldRef.current = world;
  }, [world]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    let owed = 0;
    let lastPulse = last;
    const tick = (now: number): void => {
      // A backgrounded tab resumes without trying to catch up on lost time.
      const elapsed = Math.min(now - last, 100);
      last = now;
      owed += (elapsed / 1000) * 60 * speed;
      const started = performance.now();
      const live = worldRef.current;
      while (owed >= 1 && performance.now() - started < FRAME_BUDGET_MS) {
        const chunk = Math.min(Math.floor(owed), 60);
        stepWorld(live, chunk);
        owed -= chunk;
      }
      // Whatever the budget did not cover is dropped, not banked.
      owed = Math.min(owed, 1);
      if (now - lastPulse > 250) {
        lastPulse = now;
        setPulse((value) => value + 1);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, speed]);

  const reset = useCallback(() => {
    resetWorld();
    setPulse((value) => value + 1);
  }, [resetWorld]);

  const step = useCallback((ticks = 1) => {
    stepWorld(worldRef.current, ticks);
    setPulse((value) => value + 1);
  }, []);

  const read = useCallback(() => worldRef.current, []);

  return { world: read, running, setRunning, speed, setSpeed, reset, step, pulse };
}
