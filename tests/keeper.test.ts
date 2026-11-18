/**
 * Goalkeeper rules: catches, parries and dives.
 */
import { describe, expect, it } from 'vitest';
import { BALL, PITCH } from '../src/config';
import { createIntent } from '../src/input/Intent';
import type { SimEvent } from '../src/sim/events';
import type { World } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/World';

const KEEPER_ID = 5; // team 1's keeper defends the +x goal

function shotAtKeeper(
  speed: number,
  z: number,
  dive = false,
): { world: World; events: SimEvent[] } {
  const world = createWorld({ seed: 2, skipKickoff: true });
  world.players.forEach((p, i) => p.pos.set(-15, 0, i % 2 === 0 ? -11 : 11));
  const keeper = world.players[KEEPER_ID];
  keeper.pos.set(PITCH.halfLength - 0.8, 0, 0);
  keeper.facing = Math.PI;
  world.ball.pos.set(PITCH.halfLength - 9, 0.8, z);
  world.ball.vel.set(speed, 0, 0);
  world.ball.lastTouchId = 4;
  world.pendingShot = { team: 0, shooterId: 4, age: 0 };
  world.stats[0].shots = 1;

  const intents = world.players.map(() => createIntent());
  const events: SimEvent[] = [];
  for (let i = 0; i < 60; i++) {
    const timeToArrive = (keeper.pos.x - world.ball.pos.x) / speed;
    intents[KEEPER_ID].tackle = dive && timeToArrive < 0.25;
    intents[KEEPER_ID].moveZ = dive ? Math.sign(z) : 0;
    stepWorld(world, intents);
    events.push(...world.events);
  }
  return { world, events };
}

describe('goalkeeper', () => {
  it('catches a slow shot aimed at the body', () => {
    const { world, events } = shotAtKeeper(12, 0);
    expect(events.some((e) => e.type === 'save' && e.kind === 'catch')).toBe(true);
    expect(world.ball.heldByKeeper).toBe(true);
    expect(world.stats[1].saves).toBe(1);
    expect(world.stats[0].shotsOnTarget).toBe(1);
  });

  it('parries a thunderbolt away from goal', () => {
    const { world, events } = shotAtKeeper(27, 0.6);
    expect(events.some((e) => e.type === 'save' && e.kind === 'parry')).toBe(true);
    expect(world.match.score).toEqual([0, 0]);
  });

  it('a standing keeper cannot reach the corner, but a diving one can', () => {
    const standing = shotAtKeeper(16, 2.0);
    expect(standing.events.some((e) => e.type === 'save')).toBe(false);
    expect(standing.world.match.score[0]).toBe(1);

    const diving = shotAtKeeper(16, 2.0, true);
    expect(diving.events.some((e) => e.type === 'save')).toBe(true);
    expect(diving.world.match.score[0]).toBe(0);
  });

  it('holds the ball at hand height, safe from tackles', () => {
    const { world } = shotAtKeeper(10, 0);
    expect(world.ball.pos.y).toBeCloseTo(1.05);
    expect(world.ball.pos.y).toBeGreaterThan(BALL.radius);
  });
});
