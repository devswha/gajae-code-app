import { useQuery } from '@tanstack/react-query';

export type EgoActivityPage = {
  label: string;
  /** Origin and path only; the server drops query strings and fragments. */
  url: string;
  title: string;
  active: boolean;
};

export type EgoActivitySpace = { id: number; name: string; pages: EgoActivityPage[] };

export type EgoActivity = {
  /** The surface is live for this session: opted in, supported, backend is ego. */
  enabled: boolean;
  /** The separate picture opt-in is on too, so a page may be shown as a frame. */
  frames: boolean;
  spaces: EgoActivitySpace[];
  /** ego lite could not be read; show nothing rather than a stale state. */
  unavailable: boolean;
};

const IDLE: EgoActivity = { enabled: false, frames: false, spaces: [], unavailable: false };

/**
 * How often the browser state is re-read while a run is in flight. The server
 * shares one CLI execution across every reader inside its own one-second
 * window, so this is the display cadence, not the observation cost.
 */
const EGO_ACTIVITY_REFETCH_MS = 1_500;

export const egoActivityQueryKey = (sessionId: string) => ['ego-activity', sessionId] as const;

/** The frame endpoint for one page; the tick is what makes the browser re-fetch it. */
export function egoFrameUrl(sessionId: string, spaceId: number, label: string, tick: number): string {
  const params = new URLSearchParams({ sessionId, space: String(spaceId), page: label, t: String(tick) });
  return `/api/automation/ego-activity/frame?${params.toString()}`;
}

function parse(payload: unknown): EgoActivity {
  if (!payload || typeof payload !== 'object') return IDLE;
  const record = payload as Record<string, unknown>;
  if (record.enabled !== true) return IDLE;
  const spaces = Array.isArray(record.spaces) ? record.spaces : [];
  return {
    enabled: true,
    frames: record.frames === true,
    unavailable: record.unavailable === true,
    spaces: spaces.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const space = entry as Record<string, unknown>;
      if (typeof space.id !== 'number') return [];
      const pages = Array.isArray(space.pages) ? space.pages : [];
      return [{
        id: space.id,
        name: typeof space.name === 'string' ? space.name : '',
        pages: pages.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const page = item as Record<string, unknown>;
          return typeof page.label === 'string' && page.label
            ? [{
              label: page.label,
              url: typeof page.url === 'string' ? page.url : '',
              title: typeof page.title === 'string' ? page.title : '',
              active: page.active === true,
            }]
            : [];
        }),
      }];
    }),
  };
}

/**
 * What the agent's ego lite browser is doing in this session, read from ego
 * itself through the server (`docs/plans/ego-activity-contract.md`).
 *
 * It polls only while the session is actually running: the surface answers
 * "what is happening now", and an idle session must never keep a personal
 * browser under observation. A disabled surface, an unsupported platform or a
 * backend other than ego all come back as `enabled: false`, which also stops
 * the polling.
 */
export function useEgoActivity(sessionId: string | undefined, running: boolean): EgoActivity {
  const query = useQuery({
    queryKey: egoActivityQueryKey(sessionId ?? ''),
    enabled: Boolean(sessionId) && running,
    queryFn: async (): Promise<EgoActivity> => {
      const response = await fetch(`/api/automation/ego-activity?sessionId=${encodeURIComponent(sessionId ?? '')}`);
      if (!response.ok) return IDLE;
      return parse(await response.json().catch(() => null));
    },
    // Browser state is live state: it is never reused across mounts, and a
    // surface the server reports as off stops asking.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: (query) => (query.state.data?.enabled === false ? false : EGO_ACTIVITY_REFETCH_MS),
  });

  return running ? query.data ?? IDLE : IDLE;
}
