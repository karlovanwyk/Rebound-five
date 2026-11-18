/**
 * How the AI rates passes and shots.
 */
import { describe, expect, it } from 'vitest';
import { BALL, PITCH } from '../src/config';
import { scorePass } from '../src/sim/ai/PassScoring';
import { evaluateShot } from '../src/sim/ai/ShotScoring';
import type { World } from '../src/sim/types';
import { createWorld } from '../src/sim/World';

/** A world with everyone parked in the far corners, ready to be placed. */
function emptyWorld(): World {
  const world = createWorld({ seed: 11, skipKickoff: true });
  world.players.forEach((p, i) => p.pos.set(i < 5 ? -19 : 19, 0, i % 2 === 0 ? -11.5 : 11.5));
  return world;
}

/** Give team 0's striker (id 4) the ball at `x, z`. */
function carrierAt(world: World, x: number, z: number) {
  const carrier = world.players[4];
  carrier.pos.set(x, 0, z);
  carrier.facing = 0;
  world.ball.pos.set(x + 0.38, BALL.radius, z);
  world.ball.ownerId = carrier.id;
  return carrier;
}

describe('pass scoring', () => {
  it('prefers an open lane over a blocked one', () => {
    const world = emptyWorld();
    const carrier = carrierAt(world, 0, 0);
    world.players[3].pos.set(8, 0, -4); // open
    world.players[2].pos.set(8, 0, 4); // blocked
    world.players[6].pos.set(4.2, 0, 2.1); // defender in the second lane
    const open = scorePass(world, carrier, world.players[3], false);
    const blocked = scorePass(world, carrier, world.players[2], false);
    expect(blocked.risk).toBeGreaterThan(open.risk);
    expect(open.score).toBeGreaterThan(blocked.score);
  });

  it('prefers moving the ball forward', () => {
    const world = emptyWorld();
    const carrier = carrierAt(world, 0, 0);
    world.players[3].pos.set(9, 0, 3);
    world.players[2].pos.set(-9, 0, 3);
    const forward = scorePass(world, carrier, world.players[3], false);
    const backward = scorePass(world, carrier, world.players[2], false);
    expect(forward.score).toBeGreaterThan(backward.score);
  });

  it('rejects passes that are too short', () => {
    const world = emptyWorld();
    const carrier = carrierAt(world, 0, 0);
    world.players[3].pos.set(1.5, 0, 0.5);
    expect(scorePass(world, carrier, world.players[3], false).score).toBe(0);
  });
});

describe('shot scoring', () => {
  function shotFrom(x: number, z: number, setup?: (world: World) => void) {
    const world = emptyWorld();
    world.players[5].pos.set(PITCH.halfLength - 0.8, 0, 0); // their keeper on the line
    setup?.(world);
    const shooter = carrierAt(world, x, z);
    return evaluateShot(world, shooter);
  }

  it('closer is better', () => {
    expect(shotFrom(10, 0).score).toBeGreaterThan(shotFrom(0, 0).score);
  });

  it('a wider angle is better at the same distance', () => {
    const central = shotFrom(10, 0);
    const tight = shotFrom(17, 8.5); // about the same distance, from near the touchline
    expect(central.openAngle).toBeGreaterThan(tight.openAngle);
    expect(central.score).toBeGreaterThan(tight.score);
  });

  it('a defender in the way lowers the score', () => {
    const clear = shotFrom(10, 0);
    const blocked = shotFrom(10, 0, (w) => {
      w.players[6].pos.set(12, 0, 0);
      w.players[7].pos.set(12, 0, -1.2);
      w.players[8].pos.set(12, 0, 1.2);
    });
    expect(blocked.score).toBeLessThan(clear.score);
    expect(blocked.blockers).toBeGreaterThan(0);
  });

  it('aims away from the keeper', () => {
    const shot = shotFrom(10, 0, (w) => w.players[5].pos.set(PITCH.halfLength - 0.8, 0, 1.6));
    expect(shot.aimZ).toBeLessThan(0);
  });

  it('cannot shoot from behind the goal line', () => {
    expect(shotFrom(PITCH.halfLength - 0.2, 6).score).toBe(0);
  });
});
