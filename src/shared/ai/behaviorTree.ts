// Provides a small behavior tree runtime for composable NPC decision logic.
export enum BehaviorStatus {
  Success = 'success',
  Failure = 'failure',
  Running = 'running',
}

export interface BehaviorNode<TContext> {
  tick(context: TContext): BehaviorStatus;
}

export class ActionNode<TContext> implements BehaviorNode<TContext> {
  constructor(private readonly action: (context: TContext) => BehaviorStatus) {}

  tick(context: TContext): BehaviorStatus {
    return this.action(context);
  }
}

export class SequenceNode<TContext> implements BehaviorNode<TContext> {
  constructor(private readonly children: BehaviorNode<TContext>[]) {}

  tick(context: TContext): BehaviorStatus {
    for (const child of this.children) {
      const status = child.tick(context);
      if (status !== BehaviorStatus.Success) {
        return status;
      }
    }

    return BehaviorStatus.Success;
  }
}

export class SelectorNode<TContext> implements BehaviorNode<TContext> {
  constructor(private readonly children: BehaviorNode<TContext>[]) {}

  tick(context: TContext): BehaviorStatus {
    for (const child of this.children) {
      const status = child.tick(context);
      if (status !== BehaviorStatus.Failure) {
        return status;
      }
    }

    return BehaviorStatus.Failure;
  }
}
