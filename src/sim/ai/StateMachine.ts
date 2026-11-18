/**
 * StateMachine.ts: a small, generic finite state machine.
 *
 * Each state is an object with three optional hooks:
 *   enter(ctx)   runs once when the state becomes active (set up timers, pick targets);
 *   execute(ctx) runs every tick; it returns the name of the next state, or null to stay;
 *   exit(ctx)    runs once when leaving (clean up).
 * States are stateless singletons: per-player data lives in the context (`ctx.memory`),
 * so all ten players can share the same state objects.
 */
export interface State<C> {
  readonly name: string;
  enter?(ctx: C): void;
  execute(ctx: C): string | null;
  exit?(ctx: C): void;
}

export class StateMachine<C> {
  private current: State<C>;
  private readonly states = new Map<string, State<C>>();

  constructor(states: readonly State<C>[], initial: string) {
    for (const state of states) this.states.set(state.name, state);
    this.current = this.get(initial);
  }

  get name(): string {
    return this.current.name;
  }

  change(name: string, ctx: C): void {
    if (name === this.current.name) return;
    this.current.exit?.(ctx);
    this.current = this.get(name);
    this.current.enter?.(ctx);
  }

  update(ctx: C): void {
    const next = this.current.execute(ctx);
    if (next !== null && next !== this.current.name) this.change(next, ctx);
  }

  private get(name: string): State<C> {
    const state = this.states.get(name);
    if (!state) throw new Error(`Unknown state "${name}"`);
    return state;
  }
}
