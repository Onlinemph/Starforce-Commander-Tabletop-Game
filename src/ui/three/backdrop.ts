/**
 * Deep space: starfield, nebula banks, the board plane, grid and edge.
 *
 * Placeholder: draws nothing yet.
 */
import { Group } from 'three'
import type { Layer, LayerContext } from './layer'

export class BackdropLayer implements Layer {
  readonly group = new Group()

  update(_ctx: LayerContext): void {}

  dispose(): void {}
}
