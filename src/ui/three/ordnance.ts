/**
 * Everything smaller than a starship: fighter flights, homing weapons, shuttles and probes, escape pods, cloak datums, tractor links.
 *
 * Placeholder: draws nothing yet.
 */
import { Group } from 'three'
import type { Layer, LayerContext } from './layer'

export class OrdnanceLayer implements Layer {
  readonly group = new Group()

  update(_ctx: LayerContext): void {}

  dispose(): void {}
}
