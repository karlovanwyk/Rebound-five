/**
 * config.ts: every tuning number in the game lives here.
 *
 * The simulation (src/sim), the renderer (src/render) and the UI all read these objects.
 * The sim reads them every tick and never keeps its own copy, so the #debug panel
 * (lil-gui) can change them while a match is running. That is also why these objects are
 * mutable: they are not frozen or marked `as const`.
 *
 * Units: metres, seconds, radians, metres per second. The pitch lies on the XZ plane and
 * Y points up. Team 0 defends the goal at x = -halfLength and attacks toward +x.
 */

/** Fixed-timestep settings. See core/Loop.ts for why the sim runs at a fixed rate. */
export const SIM = {
  tickRate: 60,
  /** Seconds per tick. Always 1 / tickRate. */
  dt: 1 / 60,
  /** The ball is integrated in smaller sub-steps so a fast shot can't pass through a post. */
  ballSubsteps: 4,
};

/** Arena geometry. The pitch is enclosed by boards, so the ball never goes out of play. */
export const PITCH = {
  halfLength: 20,
  halfWidth: 12,
  goalHalfWidth: 2.5,
  goalHeight: 2.2,
  goalDepth: 1.4,
  postRadius: 0.07,
  boardHeight: 1.1,
  /** Netting above the boards keeps the ball in. It acts as an invisible ceiling too. */
  ceilingHeight: 14,
  /** Semicircle around each goal where the keeper may use their hands. */
  keeperBoxRadius: 6,
  centreCircleRadius: 3,
};

/** Ball physics. The maths is explained in sim/ball/BallPhysics.ts and docs/PHYSICS.md. */
export const BALL = {
  radius: 0.12,
  gravity: 9.81,
  /** Quadratic air drag coefficient k in a = -k |v| v (units 1/m). */
  airDrag: 0.011,
  /** Magnus (curve) coefficient S in a = S (spin x v). */
  magnus: 0.004,
  /** How quickly spin dies away, per second (exponential decay). */
  spinDecay: 0.7,
  /** Fraction of vertical speed kept after bouncing on the grass. */
  groundRestitution: 0.55,
  /** Fraction of speed kept after hitting the boards. */
  boardRestitution: 0.7,
  postRestitution: 0.75,
  /** Nets swallow almost all of the ball's speed. */
  netRestitution: 0.12,
  /** Fraction of horizontal speed kept on each bounce (grass grabs the ball). */
  bounceFriction: 0.88,
  /** Rolling resistance as a constant deceleration in m/s^2. */
  rollingDeceleration: 2.6,
  /** Below this downward speed a bounce becomes a roll, so the ball settles. */
  restBounceSpeed: 0.9,
};

/** Player movement and ball control. Humans and CPU players share every number here. */
export const PLAYER = {
  bodyRadius: 0.32,
  runSpeed: 5.6,
  sprintSpeed: 7.6,
  /** Carrying the ball slows you down a little. */
  dribbleSpeedFactor: 0.93,
  /** Charging a shot slows you down too. */
  chargingSpeedFactor: 0.8,
  acceleration: 24,
  deceleration: 30,
  turnRate: 12,
  turnRateDribbling: 8,
  /** Distance from the body centre to the "foot point" where the ball is played. */
  footOffset: 0.38,
  /** A loose ball within this distance of the foot point can be trapped. */
  pickupRadius: 0.6,
  /** The carrier loses the ball when it gets further away than this. */
  keepRadius: 1.3,
  /** The ball must be this close to the body centre to pass or shoot. */
  kickReach: 0.95,
  maxKickHeight: 1.1,
  /** Seconds between dribble touches (walking and sprinting). */
  touchInterval: 0.22,
  sprintTouchInterval: 0.3,
  /** Each touch pushes the ball at this multiple of the carrier's speed. */
  touchSpeedFactor: 1.32,
  sprintTouchSpeedFactor: 1.62,
  /** A ball arriving faster than this (relative to you) bounces off instead of being trapped. */
  trapMaxSpeed: 17,
  /** After kicking, you can't touch the ball again for this long. */
  kickLockout: 0.3,
  /** A pass/shot pressed slightly before the ball arrives is remembered this long. */
  actionBuffer: 0.22,
  /** Holding shoot for this long gives full power. */
  shotChargeTime: 0.9,
};

/** Passing and shooting. */
export const KICK = {
  /** Teammates within this angle of your aim are pass candidates. */
  passConeDegrees: 55,
  /** 1 = pass goes exactly to the receiver; 0 = exactly where you aimed. */
  passAimAssist: 0.88,
  /** Ground passes are struck so they still have this speed when they arrive. */
  passArriveSpeed: 5,
  passMinSpeed: 7,
  passMaxSpeed: 21,
  /** Through balls are played this far ahead of the receiver. */
  throughLead: 5.5,
  throughMinFlight: 0.7,
  throughMaxFlight: 1.5,
  shotMinSpeed: 13,
  shotMaxSpeed: 28.5,
  /** Upward speed at minimum and maximum power. Power shots rise. */
  shotLiftMin: 0.8,
  shotLiftMax: 5.0,
  /** Shot direction error (radians, standard deviation) at zero and full power. */
  shotErrorBase: 0.015,
  shotErrorAtFullPower: 0.075,
  /** Maximum side spin (rad/s) from striking across the ball. Creates curve. */
  shotCurveSpin: 32,
  /** A "shot" while facing away from goal becomes a clearance at this speed range. */
  clearanceMinSpeed: 10,
  clearanceMaxSpeed: 20,
};

/** Tackling. A standing tackle is a quick poke; sprint + tackle is a slide. */
export const TACKLE = {
  /** How far in front of the tackler a standing tackle reaches. */
  standReach: 1.25,
  standDuration: 0.35,
  /** Seconds into the tackle animation when the foot arrives. */
  standContactTime: 0.12,
  standSuccess: 0.62,
  /** Tackling from behind rarely works. */
  standFromBehindSuccess: 0.3,
  cooldown: 0.6,
  /** Extra cooldown after a missed standing tackle. */
  missPenalty: 0.35,
  slideSpeed: 8.8,
  slideDuration: 0.6,
  /** The slide can only win the ball during this first fraction of its duration. */
  slideActiveFraction: 0.75,
  slideReach: 0.85,
  /** Speed the ball is knocked away at when a tackle wins it. */
  knockSpeed: 5.5,
  /** How long a tackled player is off their feet. */
  stumbleTime: 0.35,
  knockdownTime: 0.9,
};

/** Goalkeeper rules. Every keeper (yours and the CPU's) uses these. */
export const KEEPER = {
  /** Horizontal reach of the hands when standing. */
  handReach: 0.8,
  /** Highest ball a keeper can reach (with a jump). */
  reachHeight: 2.4,
  diveSpeed: 6.2,
  diveDuration: 0.55,
  /** Length of the stretched body along the dive direction. */
  diveReach: 1.5,
  /** Balls slower than this (relative to the keeper) are caught when the keeper is set. */
  catchMaxSpeed: 19,
  /** Diving catches only work on slower shots; faster ones are parried. */
  diveCatchMaxSpeed: 12,
  /** A shot this close to the keeper's body counts as "into the hands". */
  centredRadius: 0.5,
  /** A parry keeps this fraction of the ball's speed. */
  parrySpeedFactor: 0.35,
  /** The keeper must release the ball within this many seconds. */
  holdMaxTime: 6,
};

/**
 * One CPU difficulty preset. Difficulty changes only how well the AI decides. It
 * never changes speed or physics: those come from PLAYER, KICK and KEEPER for everyone.
 */
export interface DifficultyPreset {
  label: string;
  /** Seconds before the team reacts to a change of possession. */
  reactionTime: number;
  /** Seconds between re-evaluating pass / shoot / dribble while on the ball. */
  decisionInterval: number;
  /** Aim noise on passes (radians, standard deviation). */
  passError: number;
  /** Aim noise on shots (fraction of the goal's half-width, standard deviation). */
  shotError: number;
  /** Random noise added to every option's score: higher means sloppier choices. */
  decisionNoise: number;
  /** 0..1: sprinting to press, a second presser near goal, how high the line pushes. */
  pressIntensity: number;
  /** Distance at which a presser attempts a tackle. */
  tackleRange: number;
  /** Chance a presser chooses a slide tackle when it can. */
  slideTackleChance: number;
  /** Seconds the keeper needs to react to a shot. */
  keeperReaction: number;
  /** Error in the keeper's prediction of where a shot crosses the line (metres). */
  keeperError: number;
  /** 0..1: how well the keeper narrows the angle by coming off the line. */
  keeperPositioning: number;
  /** A shot must score at least this (0..1) before the AI takes it. */
  shootThreshold: number;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export const AI: {
  presets: Record<Difficulty, DifficultyPreset>;
  /** Your AI teammates always play at this level. */
  teammateDifficulty: Difficulty;
} = {
  presets: {
    easy: {
      label: 'Easy',
      reactionTime: 0.5,
      decisionInterval: 0.7,
      passError: 0.22,
      shotError: 0.45,
      decisionNoise: 0.22,
      pressIntensity: 0.25,
      tackleRange: 1.0,
      slideTackleChance: 0.05,
      keeperReaction: 0.36,
      keeperError: 0.9,
      keeperPositioning: 0.55,
      shootThreshold: 0.42,
    },
    normal: {
      label: 'Normal',
      reactionTime: 0.28,
      decisionInterval: 0.4,
      passError: 0.12,
      shotError: 0.25,
      decisionNoise: 0.12,
      pressIntensity: 0.6,
      tackleRange: 1.15,
      slideTackleChance: 0.15,
      keeperReaction: 0.24,
      keeperError: 0.5,
      keeperPositioning: 0.8,
      shootThreshold: 0.36,
    },
    hard: {
      label: 'Hard',
      reactionTime: 0.14,
      decisionInterval: 0.2,
      passError: 0.05,
      shotError: 0.13,
      decisionNoise: 0.04,
      pressIntensity: 0.95,
      tackleRange: 1.25,
      slideTackleChance: 0.25,
      keeperReaction: 0.15,
      keeperError: 0.25,
      keeperPositioning: 1,
      shootThreshold: 0.32,
    },
  },
  teammateDifficulty: 'normal',
};

/** Match flow. */
export const MATCH = {
  /** Real minutes per match (the clock shows 90 minutes squeezed into this). */
  lengthOptions: [2, 3, 5],
  defaultMinutes: 3,
  kickoffDelay: 1.6,
  goalCelebration: 3.4,
  /** After kickoff, opponents stay out of the centre circle for up to this long. */
  kickoffProtection: 3,
  /** Control auto-switches to a teammate this much closer to the ball than you. */
  autoSwitchMargin: 1.5,
  autoSwitchCooldown: 0.45,
  /** A shot not saved or scored within this time counts as off target. */
  shotResolveTime: 2.5,
};

/** Colours used by the renderer and the minimap. */
export const COLORS = {
  sky: '#0a1424',
  fog: '#0a1424',
  grassLight: '#3f9142',
  grassDark: '#367f39',
  lines: '#f2f5f0',
  surround: '#1d3326',
  boards: '#14213d',
  boardStripe: '#ffd23f',
  glass: '#9fd3ff',
  posts: '#f8f8f8',
  net: '#e9eef2',
  stands: '#20262f',
  controlRing: '#ffd23f',
  skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'],
  hair: ['#2b1b0e', '#5a3825', '#d6b370', '#111111', '#8a5a2b'],
};

export interface Kit {
  id: string;
  name: string;
  /** Three-letter code for the scoreboard. */
  short: string;
  shirt: string;
  shorts: string;
  socks: string;
  keeper: string;
  /** Which achievement unlocks this kit, or null if it's available from the start. */
  unlock: 'easy' | 'normal' | 'hard' | null;
}

/** Team kits the player can choose. All names are invented for this game. */
export const KITS: Kit[] = [
  {
    id: 'copperfox',
    name: 'Copperfox FC',
    short: 'CFX',
    shirt: '#e8742a',
    shorts: '#ffffff',
    socks: '#e8742a',
    keeper: '#2d2d2d',
    unlock: null,
  },
  {
    id: 'tidewater',
    name: 'Tidewater Comets',
    short: 'TWC',
    shirt: '#17a398',
    shorts: '#0d2b45',
    socks: '#17a398',
    keeper: '#f2c14e',
    unlock: null,
  },
  {
    id: 'northwind',
    name: 'Northwind Owls',
    short: 'NWO',
    shirt: '#7cc6fe',
    shorts: '#ffffff',
    socks: '#1d3557',
    keeper: '#e63946',
    unlock: null,
  },
  {
    id: 'basalt',
    name: 'Basalt Wanderers',
    short: 'BSW',
    shirt: '#3a3d55',
    shorts: '#2b2d42',
    socks: '#a7c957',
    keeper: '#ff7f51',
    unlock: null,
  },
  {
    id: 'voltage',
    name: 'Voltage City',
    short: 'VLT',
    shirt: '#d4ff1e',
    shorts: '#111111',
    socks: '#d4ff1e',
    keeper: '#7b2cbf',
    unlock: 'easy',
  },
  {
    id: 'emberline',
    name: 'Emberline Athletic',
    short: 'EMB',
    shirt: '#b5121b',
    shorts: '#f5c518',
    socks: '#b5121b',
    keeper: '#1b998b',
    unlock: 'normal',
  },
  {
    id: 'aurora',
    name: 'Aurora Sound',
    short: 'AUR',
    shirt: '#7b2cbf',
    shorts: '#2ec4b6',
    socks: '#7b2cbf',
    keeper: '#ffbe0b',
    unlock: 'hard',
  },
];

export interface BallDesign {
  id: string;
  name: string;
  base: string;
  panel: string;
  unlock: 'easy' | 'normal' | 'hard' | 'cup' | null;
}

/** Ball designs, drawn procedurally onto a canvas texture by render/BallModel.ts. */
export const BALL_DESIGNS: BallDesign[] = [
  { id: 'classic', name: 'Classic', base: '#ffffff', panel: '#1a1a1a', unlock: null },
  { id: 'neon', name: 'Neon', base: '#f9ff4f', panel: '#ff2d95', unlock: 'easy' },
  { id: 'retro', name: 'Retro', base: '#d39b5f', panel: '#5b3a1e', unlock: 'normal' },
  { id: 'galaxy', name: 'Galaxy', base: '#1b1f3b', panel: '#a5b4fc', unlock: 'hard' },
  { id: 'trophy', name: 'Trophy Gold', base: '#ffd166', panel: '#9a6b00', unlock: 'cup' },
];

export interface CpuTeam {
  id: string;
  name: string;
  short: string;
  difficulty: Difficulty;
  /** Two kits; the one that contrasts best with yours is worn. */
  kits: [Kit, Kit];
}

function cpuKit(
  id: string,
  name: string,
  short: string,
  shirt: string,
  shorts: string,
  socks: string,
  keeper: string,
): Kit {
  return { id, name, short, shirt, shorts, socks, keeper, unlock: null };
}

/** CPU opponents, from gentle to fierce. Quick Match picks by difficulty; the Cup plays all three. */
export const CPU_TEAMS: CpuTeam[] = [
  {
    id: 'meadowbank',
    name: 'Meadowbank Larks',
    short: 'MBL',
    difficulty: 'easy',
    kits: [
      cpuKit(
        'meadowbank-home',
        'Meadowbank Larks',
        'MBL',
        '#3a9d23',
        '#ffffff',
        '#3a9d23',
        '#f4d35e',
      ),
      cpuKit(
        'meadowbank-away',
        'Meadowbank Larks',
        'MBL',
        '#f1faee',
        '#3a9d23',
        '#f1faee',
        '#f4d35e',
      ),
    ],
  },
  {
    id: 'ironclad',
    name: 'Ironclad Rovers',
    short: 'IRO',
    difficulty: 'normal',
    kits: [
      cpuKit('ironclad-home', 'Ironclad Rovers', 'IRO', '#c1121f', '#2b2d42', '#c1121f', '#8ecae6'),
      cpuKit('ironclad-away', 'Ironclad Rovers', 'IRO', '#adb5bd', '#c1121f', '#adb5bd', '#8ecae6'),
    ],
  },
  {
    id: 'obsidian',
    name: 'Obsidian Royals',
    short: 'OBR',
    difficulty: 'hard',
    kits: [
      cpuKit('obsidian-home', 'Obsidian Royals', 'OBR', '#16161d', '#d4af37', '#16161d', '#e85d04'),
      cpuKit('obsidian-away', 'Obsidian Royals', 'OBR', '#d4af37', '#16161d', '#d4af37', '#e85d04'),
    ],
  },
];

/** The three cup rounds, played in order against increasingly difficult opponents. */
export const CUP_ROUNDS: Array<{ name: string; opponentId: string }> = [
  { name: 'Quarter-final', opponentId: 'meadowbank' },
  { name: 'Semi-final', opponentId: 'ironclad' },
  { name: 'Final', opponentId: 'obsidian' },
];
