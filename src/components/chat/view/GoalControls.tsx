import { useState } from 'react';

import { Button } from '../../../shared/view/ui/Button';
import type { GjcGoalOperation, GjcGoalSnapshot } from '../../../../shared/gjc-goal';

export type GoalControlsProps = {
  snapshot?: GjcGoalSnapshot;
  pending: boolean;
  connected: boolean;
  error?: string;
  control: (input: { operation: Exclude<GjcGoalOperation, 'get'>; objective?: string }) => Promise<unknown>;
  refresh: () => unknown;
};

export default function GoalControls({ snapshot, pending, connected, error, control, refresh }: GoalControlsProps) {
  const [objective, setObjective] = useState('');
  const [editing, setEditing] = useState(false);
  const goal = snapshot?.goal;
  const paused = goal?.status === 'paused' || snapshot?.resumeRequired === true;
  const terminal = goal?.status === 'complete' || goal?.status === 'dropped';
  const disabled = pending || !connected || !snapshot?.canControl;
  const run = (operation: Exclude<GjcGoalOperation, 'get'>) => {
    void control({ operation, ...(operation === 'create' ? { objective } : {}) }).then(() => { setEditing(false); setObjective(''); }).catch(() => {});
  };
  return <section aria-label="Session goal" className="border-b border-border bg-muted/30 px-4 py-2 text-xs">
    <div className="mx-auto flex max-w-217 flex-wrap items-center gap-2">
      {goal && <>
        <span role="status" className="font-semibold">Goal · {terminal ? goal.status === 'complete' ? 'Complete' : 'Cancelled' : paused ? 'Paused' : 'Active'}</span>
        <span dir="auto" className="min-w-0 flex-1 text-sm break-words">{goal.objective}</span>
        <span className="text-muted-foreground">{goal.tokensUsed.toLocaleString()} tokens</span>
        {!terminal && <>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => run(paused ? 'resume' : 'pause')}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => run('drop')}>Cancel goal</Button>
        </>}
      </>}
      {(!goal || terminal) && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setEditing(!editing)}>New goal</Button>}
      {!connected && <span>Reconnect to control goals.</span>}
      {snapshot && !snapshot.canControl && connected && <span className="text-muted-foreground">Goal controls are unavailable for this run or owner.</span>}
      {editing && <form className="flex w-full flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (objective.trim()) run('create'); }}>
        <label className="sr-only" htmlFor="session-goal-objective">Goal objective</label>
        <input id="session-goal-objective" className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" maxLength={8000} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="What should the agent finish?" />
        <Button size="sm" type="submit" disabled={disabled || !objective.trim()}>Start goal</Button>
      </form>}
      {(editing || (goal && !terminal)) && <p className="w-full text-muted-foreground">Each run pauses after 20 turns or 15 minutes. Stop pauses the goal. Resume starts a new run when idle. Child delegation is disabled during goals.</p>}
      {error && <div role="alert" className="w-full text-destructive">{error} <Button size="sm" variant="ghost" onClick={() => refresh()}>Refresh goal</Button></div>}
    </div>
  </section>;
}
