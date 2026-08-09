/**
 * Test setup: whole-battle tests fly with the cheap rollout self-model.
 *
 * The shipped default is selfRank: 'admiral' — measured, validated, and the
 * right way to play (see RolloutConfig in engine/ai.ts). It is also ~4.7x the
 * simulation cost, and flipping it took `npm test` from three and a half
 * minutes to eighteen. A suite nobody runs is worse than one that measures
 * nothing, so the suite runs the captain self-model instead.
 *
 * This is legitimate because of what these tests claim. The whole-battle
 * tests verify *mechanics* — tractors get reached for, scan gets lent,
 * battles terminate, replays stay exact — and every one of those claims is
 * as true under the cheap self-model as the expensive one. What they do not
 * claim is *strength*; strength claims live in the season baselines
 * (tools/season.ts), which always measure the shipped configuration.
 *
 * One canary stays on shipped doctrine: plotModel.test.ts fights a battle at
 * the true default, so a wedge or crash that only the admiral self-model can
 * produce still fails the suite.
 */
import { setRolloutConfig } from './engine/ai'

setRolloutConfig({ selfRank: 'captain' })
