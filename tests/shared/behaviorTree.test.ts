// Verifies the internal behavior tree runtime's selector and sequence semantics.
import { describe, expect, it } from 'vitest';
import { ActionNode, BehaviorStatus, SelectorNode, SequenceNode } from '../../src/shared/ai/behaviorTree.js';

describe('behavior tree runtime', () => {
  it('runs a sequence until a child fails', () => {
    const calls: string[] = [];
    const tree = new SequenceNode([
      new ActionNode(() => {
        calls.push('a');
        return BehaviorStatus.Success;
      }),
      new ActionNode(() => {
        calls.push('b');
        return BehaviorStatus.Failure;
      }),
      new ActionNode(() => {
        calls.push('c');
        return BehaviorStatus.Success;
      }),
    ]);

    expect(tree.tick({})).toBe(BehaviorStatus.Failure);
    expect(calls).toEqual(['a', 'b']);
  });

  it('selects the first non-failing child', () => {
    const tree = new SelectorNode([
      new ActionNode(() => BehaviorStatus.Failure),
      new ActionNode(() => BehaviorStatus.Running),
    ]);

    expect(tree.tick({})).toBe(BehaviorStatus.Running);
  });
});
