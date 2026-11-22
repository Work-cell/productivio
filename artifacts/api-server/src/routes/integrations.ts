import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq } from "drizzle-orm";
import { aiConnections, db, pendingDeletions } from "@workspace/db";
import {
  PlannerValidationError,
  loadPlanner,
  parsePlannerInput,
  savePlanner,
} from "../lib/planner-store";
import { revokeConnectionTokens } from "../lib/oauth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Every route here is scoped to the signed-in student's own data. */
const requireUserId = (req: Request) => getAuth(req).userId ?? null;

/* ----------------------------- planner sync ----------------------------- */

router.get("/planner", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }
  const loaded = await loadPlanner(userId);
  res.json({ exists: loaded.exists, revision: loaded.revision, updatedBy: loaded.updatedBy, planner: loaded.data });
});

router.put("/planner", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }
  try {
    const planner = parsePlannerInput((req.body as { planner?: unknown } | undefined)?.planner);
    const saved = await savePlanner(userId, planner, "app");
    res.json({ revision: saved.revision, planner: saved.data });
  } catch (error) {
    if (error instanceof PlannerValidationError) {
      res.status(400).json({ error: "invalid_planner", message: error.message });
      return;
    }
    logger.error({ err: error, userId }, "Failed to save planner");
    res.status(500).json({ error: "save_failed", message: "The planner could not be saved." });
  }
});

/* ---------------------------- AI connections ---------------------------- */

router.get("/integrations", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }

  const connections = await db
    .select()
    .from(aiConnections)
    .where(eq(aiConnections.userId, userId))
    .orderBy(desc(aiConnections.createdAt));

  res.json({
    connections: connections.map(connection => ({
      id: connection.id,
      clientName: connection.clientName,
      scopes: connection.scope.split(" ").filter(Boolean),
      createdAt: connection.createdAt,
      lastUsedAt: connection.lastUsedAt,
      revokedAt: connection.revokedAt,
    })),
  });
});

/** Disconnecting takes effect immediately: every token for the connection dies. */
router.delete("/integrations/:connectionId", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }
  const [connection] = await db
    .select()
    .from(aiConnections)
    .where(and(eq(aiConnections.id, req.params.connectionId), eq(aiConnections.userId, userId)))
    .limit(1);

  if (!connection) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  await db.update(aiConnections).set({ revokedAt: new Date() }).where(eq(aiConnections.id, connection.id));
  await revokeConnectionTokens(connection.id);
  logger.info({ userId, connectionId: connection.id }, "Revoked AI connection");
  res.json({ revoked: true });
});

/* --------------------------- deletion approvals -------------------------- */

router.get("/deletion-requests", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }
  const rows = await db
    .select()
    .from(pendingDeletions)
    .where(and(eq(pendingDeletions.userId, userId), eq(pendingDeletions.status, "pending")))
    .orderBy(desc(pendingDeletions.createdAt));

  res.json({
    requests: rows.map(row => ({
      id: row.id,
      kind: row.targetKind,
      targetId: row.targetId,
      title: row.targetTitle,
      createdAt: row.createdAt,
    })),
  });
});

/** Approving applies the deletion exactly once, using the student's own data. */
router.post("/deletion-requests/:id/approve", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }

  const [request] = await db
    .select()
    .from(pendingDeletions)
    .where(and(eq(pendingDeletions.id, req.params.id), eq(pendingDeletions.userId, userId), eq(pendingDeletions.status, "pending")))
    .limit(1);

  if (!request) {
    res.status(404).json({ error: "not_found", message: "This deletion request is no longer open." });
    return;
  }

  const loaded = await loadPlanner(userId);
  let planner = loaded.data;
  if (request.targetKind === "task") {
    planner = { ...planner, tasks: planner.tasks.filter(task => task.id !== request.targetId) };
    planner = { ...planner, events: planner.events.filter(event => event.taskId !== request.targetId) };
  } else if (request.targetKind === "event") {
    const event = planner.events.find(item => item.id === request.targetId);
    planner = {
      ...planner,
      events: planner.events.filter(item => item.id !== request.targetId),
      tasks: planner.tasks.filter(task => task.id !== event?.taskId),
    };
  } else if (request.targetKind === "project") {
    planner = {
      ...planner,
      projects: planner.projects.filter(project => project.id !== request.targetId),
      tasks: planner.tasks.map(task => task.projectId === request.targetId ? { ...task, projectId: undefined } : task),
    };
  }

  const saved = await savePlanner(userId, parsePlannerInput(planner), "app");
  await db
    .update(pendingDeletions)
    .set({ status: "approved", resolvedAt: new Date(), resolvedBy: userId })
    .where(eq(pendingDeletions.id, request.id));

  res.json({ approved: true, revision: saved.revision, planner: saved.data });
});

router.post("/deletion-requests/:id/deny", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }
  const updated = await db
    .update(pendingDeletions)
    .set({ status: "denied", resolvedAt: new Date(), resolvedBy: userId })
    .where(and(eq(pendingDeletions.id, req.params.id), eq(pendingDeletions.userId, userId), eq(pendingDeletions.status, "pending")))
    .returning({ id: pendingDeletions.id });

  if (!updated.length) {
    res.status(404).json({ error: "not_found", message: "This deletion request is no longer open." });
    return;
  }
  res.json({ denied: true });
});

export default router;
