import type { GameIndex } from '../data/loader.ts';
import { splitterItem, undergroundItem } from './entities.ts';
import type { BuildEntity } from './types.ts';

export function entityName(entity: BuildEntity, index: GameIndex): string {
  switch (entity.kind) {
    case 'belt':
      return index.belts.get(entity.beltId)?.name ?? 'Belt';
    case 'inserter':
      return index.inserters.get(entity.inserterId)?.name ?? 'Inserter';
    case 'machine':
      return index.machines.get(entity.machineId)?.name ?? 'Machine';
    case 'source':
      return `${index.items.get(entity.itemId)?.name ?? 'Item'} source`;
    case 'sink':
      return 'Sink';
    case 'chest':
      return 'Steel chest';
    case 'underground': {
      const item = index.items.get(undergroundItem(entity.beltId))?.name ?? 'Underground belt';
      return `${item} ${entity.io === 'in' ? 'entrance' : 'exit'}`;
    }
    case 'splitter':
      return index.items.get(splitterItem(entity.beltId))?.name ?? 'Splitter';
  }
}

/** Simulated time as m:ss. */
export function formatClock(tick: number): string {
  const seconds = Math.floor(tick / 60);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
