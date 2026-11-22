import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pendingDeletions, plannerStates } from "@workspace/db";
import {
  emptyPlanner,
  PlannerValidationError,
  validatePlanner,
  withDerivedProgress,
  type PlannerDocument,
} from "./planner-schema";

export type LoadedPlanner = {
  data: PlannerDocument;
  revision: number;
  exists: boolean;
  /** "assistant" when the last write came from an MCP tool. */
  updatedBy: "app" | "assistant";
};

export { isOverdue } from "./planner-schema";

/** Loads a student's server-side planner, falling back to an empty planner. */
export async function loadPlanner(userId: string): Promise<LoadedPlanner> {
  const [row] = await db.select().from(plannerStates).where(eq(plannerStates.userId, userId)).limit(1);
  if (!row) return { data: emptyPlanner(), revision: 0, exists: false, updatedBy: "app" };

  let data: PlannerDocument;
  try {
    data = validatePlanner(row.data);
  } catch {
    // A row written by an older build should never take the endpoint down.
    return { data: emptyPlanner(), revision: row.revision, exists: false, updatedBy: "app" };
  }
  return { data, revision: row.revision, exists: true, updatedBy: row.updatedBy === "assistant" ? "assistant" : "app" };
}

/**
 * Writes a validated planner and bumps the revision. Returns the stored
 * document so callers can echo exactly what was saved.
 */
export async function savePlanner(
  userId: string,
  planner: PlannerDocument,
  updatedBy: "app" | "assistant",
): Promise<{ data: PlannerDocument; revision: number }> {
  const next = withDerivedProgress(planner);
  const [existing] = await db
    .select({ revision: plannerStates.revision })
    .from(plannerStates)
    .where(eq(plannerStates.userId, userId))
    .limit(1);

  const revision = (existing?.revision ?? 0) + 1;
  await db
    .insert(plannerStates)
    .values({ userId, data: next, revision, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: plannerStates.userId,
      set: { data: next, revision, updatedBy, updatedAt: new Date() },
    });

  return { data: next, revision };
}

/** Rejects unvalidated documents before they reach the database. */
export function parsePlannerInput(raw: unknown): PlannerDocument {
  return withDerivedProgress(validatePlanner(raw));
}

export { PlannerValidationError };

export async function recordPendingDeletion(input: {
  userId: string;
  connectionId: string;
  targetKind: "task" | "event" | "project";
  targetId: string;
  targetTitle: string;
}) {
  const id = `del_${randomUUID()}`;
  await db.insert(pendingDeletions).values({
    id,
    userId: input.userId,
    connectionId: input.connectionId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    targetTitle: input.targetTitle,
  });
  return id;
}

export async function listPendingDeletions(userId: string) {
  return db
    .select()
    .from(pendingDeletions)
    .where(eq(pendingDeletions.userId, userId));
}
