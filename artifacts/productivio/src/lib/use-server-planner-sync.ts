import { useCallback, useEffect, useRef } from 'react';
import { BASE_URL } from '@/lib/api-base';
import type { PlannerData } from '@/lib/planner-types';

type ServerPlannerResponse = {
  exists: boolean;
  revision: number;
  updatedBy?: 'app' | 'assistant';
  planner: PlannerData;
};

const POLL_INTERVAL_MS = 20_000;

const isEmptyPlanner = (planner: PlannerData) =>
  planner.tasks.length === 0 && planner.events.length === 0 && planner.projects.length === 0;

/**
 * Keeps the browser planner and the server copy in step for signed-in students.
 *
 * Rules, in order:
 * - Nothing happens for guests: guest planners stay entirely in the browser.
 * - If the server has no planner yet, the browser planner is uploaded once.
 * - If the server copy was last changed by an assistant, it is adopted so the
 *   student sees the assistant's edits.
 * - If this browser has no planner yet (a new device), the server copy is
 *   adopted instead of overwriting it with an empty planner.
 * - Otherwise the browser remains the editing surface and pushes changes up.
 *
 * The browser stays usable when the API is unreachable; sync simply pauses.
 */
export function useServerPlannerSync({
  userId,
  enabled,
  planner,
  replacePlanner,
  onSynced,
}: {
  userId: string;
  enabled: boolean;
  planner: PlannerData;
  replacePlanner: (data: PlannerData) => void;
  onSynced?: () => void;
}) {
  const readyRef = useRef(false);
  const skipPushRef = useRef(false);
  const revisionRef = useRef(0);
  const plannerRef = useRef(planner);
  plannerRef.current = planner;

  const applyServerCopy = useCallback(
    (next: PlannerData) => {
      skipPushRef.current = true;
      replacePlanner(next);
      onSynced?.();
    },
    [onSynced, replacePlanner],
  );

  const adoptOrSeed = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch(`${BASE_URL}/api/planner`, { credentials: 'include' });
      if (!response.ok) return;
      const body = await response.json() as ServerPlannerResponse;
      revisionRef.current = body.revision;

      if (!body.exists) {
        await fetch(`${BASE_URL}/api/planner`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planner: plannerRef.current }),
        });
      } else if (body.updatedBy === 'assistant' || isEmptyPlanner(plannerRef.current)) {
        applyServerCopy(body.planner);
      }
    } catch {
      // Offline or API unavailable: the local planner keeps working.
    } finally {
      readyRef.current = true;
    }
  }, [applyServerCopy, enabled]);

  useEffect(() => {
    readyRef.current = false;
    revisionRef.current = 0;
    if (!enabled) return;
    void adoptOrSeed();
  }, [enabled, userId, adoptOrSeed]);

  useEffect(() => {
    if (!enabled || !readyRef.current) return;
    if (skipPushRef.current) {
      skipPushRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void fetch(`${BASE_URL}/api/planner`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planner }),
      })
        .then(async response => {
          if (!response.ok) return;
          const body = await response.json() as { revision?: number };
          if (typeof body.revision === 'number') revisionRef.current = body.revision;
        })
        .catch(() => {
          // Saving locally already succeeded; the server copy catches up later.
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [enabled, planner]);

  // Pick up assistant edits made while this tab stays open.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || !readyRef.current || document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(`${BASE_URL}/api/planner`, { credentials: 'include' });
        if (!response.ok) return;
        const body = await response.json() as ServerPlannerResponse;
        if (cancelled || body.revision <= revisionRef.current) return;
        revisionRef.current = body.revision;
        if (body.updatedBy === 'assistant') applyServerCopy(body.planner);
      } catch {
        // Ignore: the next poll or reload will sync again.
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [enabled, applyServerCopy]);

  /** Pull the assistant's newest edits, e.g. after approving a deletion. */
  return useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch(`${BASE_URL}/api/planner`, { credentials: 'include' });
      if (!response.ok) return;
      const body = await response.json() as ServerPlannerResponse;
      if (!body.exists) return;
      revisionRef.current = body.revision;
      applyServerCopy(body.planner);
    } catch {
      // Ignore: a later change or reload will sync again.
    }
  }, [applyServerCopy, enabled]);
}
