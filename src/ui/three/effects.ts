/**
 * Weapon fire and damage flashes, from the same BattleFx stream as the 2D map.
 *
 * Placeholder: draws nothing yet.
 */
import { Group } from 'three'
import type { Layer, LayerContext } from './layer'

export class EffectsLayer implements Layer {
  readonly group = new Group()

  update(_ctx: LayerContext): void {}

  dispose(): void {}
}
