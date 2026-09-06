import { assetUrl } from './assetUrl.ts';
import type { GameData, IconRef } from './schema.ts';

/**
 * Icons come from one sprite sheet drawn at its native 64px and scaled with
 * `background-size`, so a 16px slot and a 24px slot share the same download.
 */
export interface SpriteStyle {
  backgroundImage: string;
  backgroundPosition: string;
  backgroundSize: string;
  width: string;
  height: string;
}

export function spriteStyle(data: GameData, icon: IconRef, size: number): SpriteStyle {
  const scale = size / data.sprite.size;
  return {
    backgroundImage: `url(${assetUrl(data.sprite.url)})`,
    backgroundPosition: `${-icon.x * scale}px ${-icon.y * scale}px`,
    backgroundSize: `${data.sprite.width * scale}px ${data.sprite.height * scale}px`,
    width: `${size}px`,
    height: `${size}px`,
  };
}
