import { Suspense, lazy } from 'react';

import type { AgentSidebarProps } from '../../agent-sidebar/view/AgentSidebar';
import type { WorkspacePanelProps } from '../../workspace/view/WorkspacePanel';

const WorkspacePanel = lazy(() => import('../../workspace/view/WorkspacePanel'));
const AgentSidebar = lazy(() => import('../../agent-sidebar/view/AgentSidebar'));

export type MainContentRightRailProps = {
  /** The experimental switch; off renders the legacy Workspace panel. */
  agentSidebarV2: boolean;
  /** Whether the selected rail is open; a closed rail renders nothing. */
  open: boolean;
  workspace: WorkspacePanelProps;
  agentSidebar: AgentSidebarProps;
};

/**
 * The one place the two right-hand rails meet: exactly one of them renders,
 * never both. The cutover PR deletes the legacy branch along with this seam.
 */
export default function MainContentRightRail({
  agentSidebarV2,
  open,
  workspace,
  agentSidebar,
}: MainContentRightRailProps) {
  if (!open) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      {agentSidebarV2 ? <AgentSidebar {...agentSidebar} /> : <WorkspacePanel {...workspace} />}
    </Suspense>
  );
}
