/**
 * Player mechanics through the public World API: dribbling and shot power.
 */
import { describe, expect, it } from 'vitest';
import { KICK, PLAYER } from '../src/config';
import { createIntent } from '../src/input/Intent';
import { createWorld, stepWorld } from '../src/sim/World';

function practiceWorld() {
  const world = createWorld({ seed: 1, playersPerTeam: [1, 0], skipKickoff: true });
  const player = world.players[0];
  player.pos.set(-10, 0, 0);
  world.ball.pos.set(-10 + PLAYER.footOffset, world.ball.pos.y, 0);
  return { world, player, intents: [createIntent()] };
}

describe('dribbling', () => {
  it('keeps the ball close with touches while running', () => {
    const { world, intents } = practiceWorld();
    intents[0].moveX = 1;
    let maxGap = 0;
    let touches = 0;
    for (let i = 0; i < 120; i++) {
      stepWorld(world, intents);
      if (world.events.some((e) => e.type === 'kick' && e.kind === 'touch')) touches++;
      maxGap = Math.max(maxGap, Math.abs(world.ball.pos.x - world.players[0].pos.x));
    }
    expect(world.ball.ownerId).toBe(0);
    expect(touches).toBeGreaterThan(4); // several separate touches, not a glued ball
    expect(maxGap).toBeLessThan(PLAYER.keepRadius);
    expect(world.players[0].pos.x).toBeGreaterThan(-1); // actually moved ~10 m in 2 s
  });
});

describe('shooting', () => {
  function shootAfterHolding(ticks: number): number {
    const { world, intents } = practiceWorld();
    for (let i = 0; i < 10; i++) stepWorld(world, intents); // gain possession
    intents[0].shoot = true;
    for (let i = 0; i < ticks; i++) stepWorld(world, intents);
    intents[0].shoot = false;
    stepWorld(world, intents);
    return Math.hypot(world.ball.vel.x, world.ball.vel.z);
  }

  it('a quick tap gives a soft shot', () => {
    const speed = shootAfterHolding(3);
    expect(speed).toBeLessThan(KICK.shotMinSpeed + 3);
  });

  it('holding for the full charge time gives a full-power shot', () => {
    const speed = shootAfterHolding(Math.ceil(PLAYER.shotChargeTime * 60) + 5);
    expect(speed).toBeGreaterThan(KICK.shotMaxSpeed - 3);
  });
});
