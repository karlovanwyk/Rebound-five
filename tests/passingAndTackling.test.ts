/**
 * Passing, tackling and control switching, through the World API.
 */
import { describe, expect, it } from 'vitest';
import { BALL, PLAYER } from '../src/config';
import type { Intent } from '../src/input/Intent';
import { createIntent } from '../src/input/Intent';
import { choosePassReceiver } from '../src/sim/players/Kicking';
import type { World } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/World';

/** Put everyone far away, then place the named players. */
function emptyPitch(seed = 5): { world: World; intents: Intent[] } {
  const world = createWorld({ seed, skipKickoff: true });
  world.players.forEach((p, i) => p.pos.set(-18 + i * 0.1, 0, i % 2 === 0 ? -11 : 11));
  return { world, intents: world.players.map(() => createIntent()) };
}

function giveBall(world: World, playerId: number): void {
  const p = world.players[playerId];
  world.ball.pos.set(p.pos.x + Math.cos(p.facing) * PLAYER.footOffset, BALL.radius, p.pos.z);
  world.ball.ownerId = playerId;
}

describe('passing', () => {
  it('chooses the teammate inside the aim cone', () => {
    const { world } = emptyPitch();
    const passer = world.players[4];
    passer.pos.set(0, 0, 0);
    world.players[3].pos.set(8, 0, 0); // straight ahead
    world.players[2].pos.set(0, 0, 8); // 90 degrees to the side
    expect(choosePassReceiver(world, passer, 1, 0)?.id).toBe(3);
    expect(choosePassReceiver(world, passer, 0, 1)?.id).toBe(2);
    expect(choosePassReceiver(world, passer, 0, -1)).toBeNull(); // nobody up there
  });

  it('a ground pass reaches the receiver and counts as completed', () => {
    const { world, intents } = emptyPitch();
    const passer = world.players[4];
    const receiver = world.players[3];
    passer.pos.set(-5, 0, 0);
    passer.facing = 0;
    receiver.pos.set(7, 0, 0);
    giveBall(world, passer.id);
    intents[passer.id].moveX = 1;
    intents[passer.id].pass = true;
    stepWorld(world, intents);
    intents[passer.id].pass = false;
    intents[passer.id].moveX = 0;
    expect(world.stats[0].passes).toBe(1);
    // Human control follows the pass.
    expect(world.teams[0].controlledId).toBe(receiver.id);
    for (let i = 0; i < 180 && world.ball.ownerId !== receiver.id; i++) stepWorld(world, intents);
    expect(world.ball.ownerId).toBe(receiver.id);
    expect(world.stats[0].passesCompleted).toBe(1);
  });

  it('a through ball is lofted', () => {
    const { world, intents } = emptyPitch();
    const passer = world.players[4];
    passer.pos.set(-5, 0, 0);
    world.players[3].pos.set(5, 0, 3);
    giveBall(world, passer.id);
    intents[passer.id].moveX = 1;
    intents[passer.id].throughBall = true;
    stepWorld(world, intents);
    expect(world.ball.vel.y).toBeGreaterThan(2);
  });
});

describe('tackling', () => {
  function standingTackleWins(seed: number): boolean {
    const { world, intents } = emptyPitch(seed);
    const carrier = world.players[9]; // team 1 striker, facing -x
    const tackler = world.players[1];
    carrier.pos.set(0, 0, 0);
    carrier.facing = Math.PI;
    giveBall(world, carrier.id);
    tackler.pos.set(-1.3, 0, 0); // in front of the carrier, facing them
    tackler.facing = 0;
    intents[tackler.id].tackle = true;
    stepWorld(world, intents);
    intents[tackler.id].tackle = false;
    for (let i = 0; i < 20; i++) stepWorld(world, intents);
    return world.stats[0].tacklesWon === 1;
  }

  it('a standing tackle from the front usually wins the ball', () => {
    const wins = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(standingTackleWins).length;
    expect(wins).toBeGreaterThanOrEqual(5);
  });

  it('a slide tackle knocks the ball away and the carrier down', () => {
    const { world, intents } = emptyPitch();
    const carrier = world.players[9];
    const slider = world.players[1];
    carrier.pos.set(0, 0, 0);
    carrier.facing = Math.PI;
    giveBall(world, carrier.id);
    slider.pos.set(-3, 0, 0);
    slider.facing = 0;
    slider.vel.set(PLAYER.sprintSpeed, 0, 0);
    intents[slider.id].moveX = 1;
    intents[slider.id].sprint = true;
    intents[slider.id].tackle = true;
    stepWorld(world, intents);
    intents[slider.id].tackle = false;
    expect(slider.action).toBe('slide');
    for (let i = 0; i < 30; i++) stepWorld(world, intents);
    expect(world.stats[0].tacklesWon).toBe(1);
    expect(['fallen', 'none']).toContain(carrier.action);
    expect(world.ball.ownerId).not.toBe(carrier.id);
  });
});

describe('control switching', () => {
  it('switches to the teammate nearest the ball when defending', () => {
    const { world, intents } = emptyPitch();
    world.teams[0].controlledId = 1;
    world.players[1].pos.set(-15, 0, 0);
    world.players[2].pos.set(4, 0, 0);
    world.players[9].pos.set(5, 0, 0);
    world.players[9].facing = Math.PI;
    giveBall(world, 9);
    stepWorld(world, intents);
    expect(world.teams[0].controlledId).toBe(2);
  });

  it('the switch button picks a different player', () => {
    const { world, intents } = emptyPitch();
    world.teams[0].controlledId = 4;
    intents[4].switchPlayer = true;
    stepWorld(world, intents);
    expect(world.teams[0].controlledId).not.toBe(4);
    expect(world.players[world.teams[0].controlledId].isKeeper).toBe(false);
  });
});
