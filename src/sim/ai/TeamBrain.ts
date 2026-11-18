/**
 * TeamBrain.ts: the team-level layer of the AI. It looks at the whole pitch and decides:
 *
 *  1. Mode: attacking (we have the ball), defending (they have it) or loose. The brain
 *     only notices a change after `reactionTime`, so slower presets stay in the old shape
 *     for a moment after losing the ball.
 *  2. Formation: home positions stored as normalised pitch coordinates. u runs from our
 *     goal line (-1) to theirs (+1), v from one touchline (-1) to the other (+1). The
 *     shape shifts with the ball (u and v move toward it) and differs between attack and
 *     defence. Normalised coordinates make the same shape work for either team, whichever
 *     way they attack.
 *  3. Roles for each player: carrier, receiver, support, cover, presser, marker, chaser or
 *     position. The player states (PlayerStates.ts) carry the roles out.
 *  4. Support spots: for attackers without the ball, a few candidate spots near their home
 *     are scored (open passing lane, space, forward progress) and the best is kept.
 */
import type { DifficultyPreset } from '../../config';
import { PITCH, PLAYER } from '../../config';
import type { BallPrediction } from '../ball/BallPrediction';
import type { XZ } from '../math';
import { clamp, smoothstep } from '../math';
import type { PlayerState, TeamId, World } from '../types';
import type { Interception } from './Interception';
import { findInterception, passLaneRisk } from './Interception';

export type TeamMode = 'attack' | 'defend' | 'loose';
export type Role =
  | 'keeper'
  | 'carrier'
  | 'receiver'
  | 'support'
  | 'cover'
  | 'presser'
  | 'marker'
  | 'chaser'
  | 'position';

/** [u, v] home positions by player index (0 = keeper). */
const DEFEND_SHAPE: ReadonlyArray<readonly [number, number]> = [
  [-0.95, 0],
  [-0.72, 0],
  [-0.46, -0.45],
  [-0.46, 0.45],
  [-0.1, 0],
];
const ATTACK_SHAPE: ReadonlyArray<readonly [number, number]> = [
  [-0.95, 0],
  [-0.32, 0],
  [0.12, -0.62],
  [0.12, 0.62],
  [0.55, 0],
];

export class TeamBrain {
  rawMode: TeamMode = 'loose';
  /** The mode the players act on: rawMode, delayed by the reaction time. */
  mode: TeamMode = 'loose';
  private modeDelay = 0;
  /** Indexed by player id. Only this team's entries are filled in. */
  readonly roles: Role[] = [];
  readonly homes: XZ[] = [];
  readonly supportSpots: XZ[] = [];
  readonly markTargets: number[] = [];
  readonly intercepts: Array<Interception | null> = [];
  private presserId = -1;
  private supportTimer = 0;

  constructor(
    readonly team: TeamId,
    private readonly preset: () => DifficultyPreset,
  ) {}

  update(world: World, prediction: BallPrediction, dt: number): void {
    this.updateMode(world, dt);
    this.updateHomes(world);
    this.updateIntercepts(world, prediction);
    this.assignRoles(world);
    this.supportTimer -= dt;
    if (this.supportTimer <= 0) {
      this.updateSupportSpots(world);
      this.supportTimer = 0.4;
    }
  }

  private updateMode(world: World, dt: number): void {
    const { ball } = world;
    let raw: TeamMode = 'loose';
    if (ball.ownerId !== null)
      raw = world.players[ball.ownerId].team === this.team ? 'attack' : 'defend';
    else if (world.pendingPass) raw = world.pendingPass.team === this.team ? 'attack' : 'defend';

    if (raw !== this.rawMode) {
      this.rawMode = raw;
      this.modeDelay = this.preset().reactionTime;
    }
    if (this.modeDelay > 0) this.modeDelay -= dt;
    if (this.modeDelay <= 0) this.mode = this.rawMode;
  }

  /** Convert the formation's normalised [u, v] into metres, shifted toward the ball. */
  private updateHomes(world: World): void {
    const attackDir = world.teams[this.team].attackDir;
    const L = PITCH.halfLength;
    const W = PITCH.halfWidth;
    const ballU = (world.ball.pos.x * attackDir) / L;
    const ballV = world.ball.pos.z / W;
    const shape = this.mode === 'attack' ? ATTACK_SHAPE : DEFEND_SHAPE;
    // Pressing teams hold a higher line when defending.
    const lineHeight = this.mode === 'attack' ? 0 : (this.preset().pressIntensity - 0.5) * 0.15;

    for (const p of this.teamPlayers(world)) {
      const [u0, v0] = shape[p.index] ?? shape[1];
      let u = u0;
      let v = v0;
      if (!p.isKeeper) {
        u = clamp(u0 + ballU * 0.35 + lineHeight, -0.85, 0.82);
        v = clamp(v0 * 0.85 + ballV * 0.3, -0.82, 0.82);
      }
      this.homes[p.id] = { x: u * L * attackDir, z: v * W };
    }
  }

  /** Where each of our players could first reach the ball's predicted path. */
  private updateIntercepts(world: World, prediction: BallPrediction): void {
    const reaction = this.preset().reactionTime * 0.5;
    for (const p of this.teamPlayers(world)) {
      this.intercepts[p.id] = findInterception(
        prediction,
        p.pos,
        PLAYER.sprintSpeed,
        reaction,
        0.5,
        p.isKeeper ? 2.2 : 1.0,
      );
    }
  }

  private assignRoles(world: World): void {
    const players = this.teamPlayers(world);
    const outfield = players.filter((p) => !p.isKeeper);
    for (const p of players) {
      this.roles[p.id] = p.isKeeper ? 'keeper' : 'position';
      this.markTargets[p.id] = -1;
    }
    if (this.mode === 'attack') this.assignAttackRoles(world, outfield);
    else if (this.mode === 'defend') this.assignDefendRoles(world, outfield);
    else this.assignLooseRoles(world, outfield);

    // Two things need no thinking time: the player on the ball plays it, and the player
    // a pass is aimed at goes to meet it.
    const { ball, pendingPass } = world;
    if (
      ball.ownerId !== null &&
      !ball.heldByKeeper &&
      world.players[ball.ownerId].team === this.team
    ) {
      this.roles[ball.ownerId] = 'carrier';
    }
    if (pendingPass && pendingPass.team === this.team && pendingPass.toId !== null) {
      if (!world.players[pendingPass.toId].isKeeper) this.roles[pendingPass.toId] = 'receiver';
    }
  }

  private assignAttackRoles(world: World, outfield: PlayerState[]): void {
    const { ball, pendingPass } = world;
    for (const p of outfield) this.roles[p.id] = 'support';
    if (ball.ownerId !== null && world.players[ball.ownerId].team === this.team) {
      this.roles[ball.ownerId] = ball.heldByKeeper ? 'keeper' : 'carrier';
    }
    if (pendingPass && pendingPass.team === this.team && pendingPass.toId !== null) {
      const receiver = world.players[pendingPass.toId];
      if (!receiver.isKeeper) this.roles[receiver.id] = 'receiver';
    }
    // The deepest supporting player stays back as cover against the counter-attack.
    const attackDir = world.teams[this.team].attackDir;
    const supporters = outfield.filter((p) => this.roles[p.id] === 'support');
    if (supporters.length > 1) {
      const deepest = supporters.reduce((a, b) =>
        a.pos.x * attackDir < b.pos.x * attackDir ? a : b,
      );
      this.roles[deepest.id] = 'cover';
    }
  }

  private assignDefendRoles(world: World, outfield: PlayerState[]): void {
    const { ball } = world;
    const preset = this.preset();
    const attackDir = world.teams[this.team].attackDir;

    // Presser: whoever gets to the ball soonest. Hysteresis: the current presser keeps
    // the job unless someone is clearly quicker, so two players don't swap every tick.
    const timeTo = (p: PlayerState): number =>
      this.intercepts[p.id]?.time ??
      Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z) / PLAYER.sprintSpeed;
    const sorted = [...outfield].sort((a, b) => timeTo(a) - timeTo(b));
    let presser = sorted[0];
    const current = outfield.find((p) => p.id === this.presserId);
    if (current && timeTo(current) < timeTo(presser) + 0.3) presser = current;
    if (!presser) return;
    this.presserId = presser.id;
    this.roles[presser.id] = 'presser';

    // High-intensity teams double up when the ball is deep in their own half.
    const ballU = (ball.pos.x * attackDir) / PITCH.halfLength;
    if (preset.pressIntensity > 0.75 && ballU < -0.35) {
      const second = sorted.find((p) => p !== presser);
      if (second) this.roles[second.id] = 'presser';
    }

    // Everyone else marks the most dangerous attackers (closest to our goal); the
    // deepest player left over covers.
    const remaining = outfield.filter((p) => this.roles[p.id] === 'position');
    if (remaining.length === 0) return;
    const deepest = remaining.reduce((a, b) => (a.pos.x * attackDir < b.pos.x * attackDir ? a : b));
    const markers = remaining.length >= 3 ? remaining.filter((p) => p !== deepest) : remaining;
    if (remaining.length >= 3) this.roles[deepest.id] = 'cover';

    const ownGoalX = -attackDir * PITCH.halfLength;
    const threats = world.players
      .filter((p) => p.team !== this.team && !p.isKeeper && p.id !== ball.ownerId)
      .sort(
        (a, b) => Math.hypot(a.pos.x - ownGoalX, a.pos.z) - Math.hypot(b.pos.x - ownGoalX, b.pos.z),
      );
    const free = new Set(markers);
    for (const threat of threats) {
      if (free.size === 0) break;
      let best: PlayerState | null = null;
      let bestDistance = Infinity;
      for (const m of free) {
        const d = Math.hypot(m.pos.x - threat.pos.x, m.pos.z - threat.pos.z);
        if (d < bestDistance) {
          best = m;
          bestDistance = d;
        }
      }
      if (!best) break;
      free.delete(best);
      this.roles[best.id] = 'marker';
      this.markTargets[best.id] = threat.id;
    }
  }

  private assignLooseRoles(world: World, outfield: PlayerState[]): void {
    let chaser: PlayerState | null = null;
    let best = Infinity;
    for (const p of outfield) {
      const t = this.intercepts[p.id]?.time ?? Infinity;
      if (t < best) {
        best = t;
        chaser = p;
      }
    }
    if (!chaser && outfield.length > 0) {
      const { ball } = world;
      chaser = outfield.reduce((a, b) =>
        Math.hypot(a.pos.x - ball.pos.x, a.pos.z - ball.pos.z) <
        Math.hypot(b.pos.x - ball.pos.x, b.pos.z - ball.pos.z)
          ? a
          : b,
      );
    }
    if (chaser) this.roles[chaser.id] = 'chaser';
  }

  /**
   * Score a 3x3 grid of spots (4 m apart) around each supporter's home and keep the best.
   * Good spots have an open lane from the ball, space around them, are ahead of the ball,
   * at a sensible passing distance, and aren't on top of another supporter.
   */
  private updateSupportSpots(world: World): void {
    const { ball } = world;
    const attackDir = world.teams[this.team].attackDir;
    const opponents = world.players.filter((p) => p.team !== this.team).map((p) => p.pos);
    const taken: XZ[] = [];

    for (const p of this.teamPlayers(world)) {
      const home = this.homes[p.id];
      if (!home) continue;
      if (this.roles[p.id] !== 'support') {
        this.supportSpots[p.id] = home;
        continue;
      }
      let bestSpot = home;
      let bestScore = -Infinity;
      for (const dx of [-4, 0, 4]) {
        for (const dz of [-4, 0, 4]) {
          const spot = {
            x: clamp(home.x + dx, -PITCH.halfLength + 2, PITCH.halfLength - 2),
            z: clamp(home.z + dz, -PITCH.halfWidth + 1.5, PITCH.halfWidth - 1.5),
          };
          const distance = Math.hypot(spot.x - ball.pos.x, spot.z - ball.pos.z);
          let nearest = Infinity;
          for (const o of opponents)
            nearest = Math.min(nearest, Math.hypot(spot.x - o.x, spot.z - o.z));
          const lane = 1 - passLaneRisk(ball.pos, spot, 13, opponents, PLAYER.runSpeed, 0.2, false);
          const progress = clamp(((spot.x - ball.pos.x) * attackDir) / 15, -1, 1);
          const distanceFit = 1 - Math.min(1, Math.abs(distance - 11) / 11);
          let crowding = 0;
          for (const t of taken) if (Math.hypot(spot.x - t.x, spot.z - t.z) < 4) crowding += 0.25;
          const score =
            0.35 * lane +
            0.3 * smoothstep(1, 7, nearest) +
            0.2 * progress +
            0.15 * distanceFit -
            crowding;
          if (score > bestScore) {
            bestScore = score;
            bestSpot = spot;
          }
        }
      }
      this.supportSpots[p.id] = bestSpot;
      taken.push(bestSpot);
    }
  }

  private teamPlayers(world: World): PlayerState[] {
    return world.players.filter((p) => p.team === this.team);
  }
}
