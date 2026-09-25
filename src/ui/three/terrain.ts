/**
 * Terrain (Section K): planets, moons, asteroid fields, gas clouds, mission markers.
 *
 * Placeholder: draws nothing yet.
 */
import { Group } from 'three'
import type { Layer, LayerContext } from './layer'

export class TerrainLayer implements Layer {
  readonly group = new Group()

  update(_ctx: LayerContext): void {}

  dispose(): void {}
}
