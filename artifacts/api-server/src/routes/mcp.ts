import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { aiConnections, db, pendingDeletions } from "@workspace/db";
import { authenticateBearer, hasScope, type AuthenticatedConnection } from "../lib/oauth";
import {
  PlannerValidationError,
  isOverdue,
  loadPlanner,
  parsePlannerInput,
  recordPendingDeletion,
  savePlanner,
} from "../lib/planner-store";
import type {
  EventColor,
  PlannerDocument,
  PlannerEvent,
  PlannerTask,
  Priority,
  ProjectStatus,
} from "../lib/planner-schema";
import { publicBaseUrl } from "./oauth";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "productivio", version: "1.0.0" };

const router: IRouter = Router();

/* ------------------------------------------------------------------ */
/* Minimal JSON-RPC plumbing                                           */
/* ------------------------------------------------------------------ */

type RpcId = string | number | null;

const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

const toolText = (text: string, structured?: unknown, isError = false) => ({
  content: [{ type: "text", text }],
  ...(structured === undefined ? {} : { structuredContent: structured }),
  ...(isError ? { isError: true } : {}),
});

const todayKey = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Tool catalogue                                                      */
/* ------------------------------------------------------------------ */

const scopeFor = (tool: string): string => {
  if (tool === "delete_planner_item") return "planner:delete";
  if (tool === "get_planner" || tool === "list_pending_deletions") return "planner:read";
  return "planner:write";
};

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  description?: string;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
};

const TOOLS: Array<{ name: string; description: string; inputSchema: JsonSchema; annotations?: Record<string, unknown> }> = [
  {
    name: "get_planner",
    description: "Read the student's planner: tasks, calendar events, projects, preferences, and which tasks are overdue today.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_task",
    description: "Create a task for the student. Returns the created task including its new id.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What the student needs to do." },
        dueDate: { type: "string", description: "Due date in YYYY-MM-DD form." },
        category: { type: "string", description: "Course, subject, or label. Defaults to Personal." },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        projectId: { type: "string", description: "Optional existing project id." },
      },
      required: ["title", "dueDate"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description: "Change an existing task's title, due date, category, priority, completion, or project.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id from get_planner." },
        title: { type: "string" },
        dueDate: { type: "string" },
        category: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        completed: { type: "boolean" },
        projectId: { type: "string", description: "Existing project id, or an empty string to remove the assignment." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_event",
    description: "Add a calendar event. A linked task due on the same date is created automatically.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD." },
        startMinutes: { type: "number", description: "Minutes after midnight, 0–1439." },
        endMinutes: { type: "number", description: "Minutes after midnight, 1–1440, after the start." },
        color: { type: "string", enum: ["teal", "coral", "gold", "lilac"] },
      },
      required: ["title", "date", "startMinutes", "endMinutes"],
      additionalProperties: false,
    },
  },
  {
    name: "update_event",
    description: "Change an existing calendar event. A linked task's title and due date stay in sync.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        date: { type: "string" },
        startMinutes: { type: "number" },
        endMinutes: { type: "number" },
        color: { type: "string", enum: ["teal", "coral", "gold", "lilac"] },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_project",
    description: "Create a project that groups related tasks.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["on-track", "at-risk"] },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_project",
    description: "Rename a project, change its description, or change its health status.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["on-track", "at-risk"] },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_planner_item",
    description:
      "Request deletion of a task, event, or project. Nothing is deleted immediately: the student must approve the request in Productivio. Use list_pending_deletions to check the outcome.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["task", "event", "project"] },
        id: { type: "string" },
        reason: { type: "string", description: "Short explanation shown to the student." },
      },
      required: ["kind", "id"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "list_pending_deletions",
    description: "List deletion requests awaiting the student's decision and their current status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
];

/* ------------------------------------------------------------------ */
/* Tool handlers                                                       */
/* ------------------------------------------------------------------ */

class ToolError extends Error {}

const text = (value: unknown, label: string, max = 300): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ToolError(`${label} must be text of 1–${max} characters.`);
  }
  return value.trim();
};

const optionalText = (value: unknown, label: string, max = 300): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolError(`${label} must be text.`);
  return value.length > max ? value.slice(0, max) : value;
};

const priority = (value: unknown): Priority | undefined => {
  if (value === undefined) return undefined;
  if (value !== "high" && value !== "medium" && value !== "low") {
    throw new ToolError("priority must be high, medium, or low.");
  }
  return value;
};

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter = (counter + 1) % 100000).toString(36)}`;

function summarise(planner: PlannerDocument) {
  const today = todayKey();
  return {
    today,
    counts: {
      tasks: planner.tasks.length,
      openTasks: planner.tasks.filter(task => !task.completed).length,
      overdueTasks: planner.tasks.filter(task => isOverdue(task, today)).length,
      events: planner.events.length,
      projects: planner.projects.length,
    },
    overdue: planner.tasks.filter(task => isOverdue(task, today)),
    tasks: planner.tasks,
    events: planner.events,
    projects: planner.projects,
    preferences: planner.preferences,
  };
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AuthenticatedConnection,
  baseUrl: string,
): Promise<ReturnType<typeof toolText>> {
  const loaded = await loadPlanner(ctx.userId);

  switch (name) {
    case "get_planner": {
      return toolText(
        `Planner loaded: ${loaded.data.tasks.length} tasks, ${loaded.data.events.length} events, ${loaded.data.projects.length} projects.`,
        { revision: loaded.revision, planner: summarise(loaded.data) },
      );
    }

    case "create_task": {
      const title = text(args.title, "title");
      const dueDate = text(args.dueDate, "dueDate", 10);
      const projectId = optionalText(args.projectId, "projectId", 200);
      if (projectId && !loaded.data.projects.some(project => project.id === projectId)) {
        throw new ToolError("That project does not exist. Call get_planner for current project ids.");
      }
      const task: PlannerTask = {
        id: newId("task"),
        title,
        dueDate,
        category: optionalText(args.category, "category", 200) || "Personal",
        priority: priority(args.priority) ?? "medium",
        completed: false,
        ...(projectId ? { projectId } : {}),
      };
      const next: PlannerDocument = { ...loaded.data, tasks: [task, ...loaded.data.tasks] };
      const saved = await savePlanner(ctx.userId, parsePlannerInput(next), "assistant");
      return toolText(`Created task "${task.title}" due ${task.dueDate}.`, { task, revision: saved.revision });
    }

    case "update_task": {
      const id = text(args.id, "id", 200);
      const existing = loaded.data.tasks.find(task => task.id === id);
      if (!existing) throw new ToolError("That task does not exist. Call get_planner for current task ids.");

      const projectId = optionalText(args.projectId, "projectId", 200);
      if (projectId && !loaded.data.projects.some(project => project.id === projectId)) {
        throw new ToolError("That project does not exist. Call get_planner for current project ids.");
      }
      if (args.completed !== undefined && typeof args.completed !== "boolean") {
        throw new ToolError("completed must be true or false.");
      }

      const updated: PlannerTask = {
        ...existing,
        title: optionalText(args.title, "title") ?? existing.title,
        dueDate: optionalText(args.dueDate, "dueDate", 10) ?? existing.dueDate,
        category: optionalText(args.category, "category", 200) ?? existing.category,
        priority: priority(args.priority) ?? existing.priority,
        completed: typeof args.completed === "boolean" ? args.completed : existing.completed,
      };
      if (projectId === "") delete updated.projectId;
      else if (projectId) updated.projectId = projectId;

      const tasks = loaded.data.tasks.map(task => task.id === id ? updated : task);
      const events = loaded.data.events.map(event =>
        event.taskId === id ? { ...event, title: updated.title, date: updated.dueDate } : event);
      const saved = await savePlanner(ctx.userId, parsePlannerInput({ ...loaded.data, tasks, events }), "assistant");
      return toolText(`Updated task "${updated.title}".`, { task: updated, revision: saved.revision });
    }

    case "create_event": {
      const title = text(args.title, "title");
      const date = text(args.date, "date", 10);
      const startMinutes = args.startMinutes;
      const endMinutes = args.endMinutes;
      if (typeof startMinutes !== "number" || typeof endMinutes !== "number" || endMinutes <= startMinutes) {
        throw new ToolError("Provide startMinutes and endMinutes as numbers, with the end after the start.");
      }
      const color = (args.color ?? "teal") as EventColor;
      if (!["teal", "coral", "gold", "lilac"].includes(color)) {
        throw new ToolError("color must be teal, coral, gold, or lilac.");
      }
      const eventId = newId("event");
      const taskId = newId("task");
      const event: PlannerEvent = {
        id: eventId,
        title,
        date,
        day: new Date(`${date}T12:00:00Z`).getUTCDay() || 7,
        startMinutes,
        endMinutes,
        color,
        taskId,
      };
      const task: PlannerTask = {
        id: taskId,
        title,
        dueDate: date,
        category: "Scheduled",
        priority: "medium",
        completed: false,
        calendarEventId: eventId,
      };
      const saved = await savePlanner(
        ctx.userId,
        parsePlannerInput({ ...loaded.data, events: [...loaded.data.events, event], tasks: [task, ...loaded.data.tasks] }),
        "assistant",
      );
      return toolText(`Added "${event.title}" on ${event.date} and linked task.`, { event, task, revision: saved.revision });
    }

    case "update_event": {
      const id = text(args.id, "id", 200);
      const existing = loaded.data.events.find(event => event.id === id);
      if (!existing) throw new ToolError("That event does not exist. Call get_planner for current event ids.");

      const start = typeof args.startMinutes === "number" ? args.startMinutes : existing.startMinutes;
      const end = typeof args.endMinutes === "number" ? args.endMinutes : existing.endMinutes;
      if (end <= start) throw new ToolError("The event must end after it starts.");
      const color = (args.color ?? existing.color) as EventColor;
      if (!["teal", "coral", "gold", "lilac"].includes(color)) {
        throw new ToolError("color must be teal, coral, gold, or lilac.");
      }

      const updated: PlannerEvent = {
        ...existing,
        title: optionalText(args.title, "title") ?? existing.title,
        date: optionalText(args.date, "date", 10) ?? existing.date,
        startMinutes: start,
        endMinutes: end,
        color,
      };
      updated.day = new Date(`${updated.date}T12:00:00Z`).getUTCDay() || 7;

      const events = loaded.data.events.map(event => event.id === id ? updated : event);
      const linkedId = updated.taskId;
      const tasks = linkedId
        ? loaded.data.tasks.map(task => task.id === linkedId
          ? { ...task, title: updated.title, dueDate: updated.date, calendarEventId: updated.id }
          : task)
        : loaded.data.tasks;
      const saved = await savePlanner(ctx.userId, parsePlannerInput({ ...loaded.data, events, tasks }), "assistant");
      return toolText(`Updated event "${updated.title}".`, { event: updated, revision: saved.revision });
    }

    case "create_project": {
      const status = args.status;
      if (status !== undefined && status !== "on-track" && status !== "at-risk") {
        throw new ToolError("status must be on-track or at-risk.");
      }
      const project = {
        id: newId("project"),
        name: text(args.name, "name", 200),
        description: optionalText(args.description, "description", 3000) ?? "",
        progress: 0,
        status: (status ?? "on-track") as ProjectStatus,
      };
      const saved = await savePlanner(
        ctx.userId,
        parsePlannerInput({ ...loaded.data, projects: [...loaded.data.projects, project] }),
        "assistant",
      );
      return toolText(`Created project "${project.name}".`, { project, revision: saved.revision });
    }

    case "update_project": {
      const id = text(args.id, "id", 200);
      const existing = loaded.data.projects.find(project => project.id === id);
      if (!existing) throw new ToolError("That project does not exist. Call get_planner for current project ids.");
      const status = args.status;
      if (status !== undefined && status !== "on-track" && status !== "at-risk") {
        throw new ToolError("status must be on-track or at-risk.");
      }
      const updated = {
        ...existing,
        name: optionalText(args.name, "name", 200) ?? existing.name,
        description: optionalText(args.description, "description", 3000) ?? existing.description,
        status: (status ?? existing.status) as ProjectStatus,
      };
      const saved = await savePlanner(
        ctx.userId,
        parsePlannerInput({
          ...loaded.data,
          projects: loaded.data.projects.map(project => project.id === id ? updated : project),
        }),
        "assistant",
      );
      return toolText(`Updated project "${updated.name}".`, { project: updated, revision: saved.revision });
    }

    case "delete_planner_item": {
      const kind = args.kind;
      if (kind !== "task" && kind !== "event" && kind !== "project") {
        throw new ToolError("kind must be task, event, or project.");
      }
      const id = text(args.id, "id", 200);
      const title = kind === "task"
        ? loaded.data.tasks.find(task => task.id === id)?.title
        : kind === "event"
          ? loaded.data.events.find(event => event.id === id)?.title
          : loaded.data.projects.find(project => project.id === id)?.name;
      if (!title) throw new ToolError(`No ${kind} with that id exists. Call get_planner for current ids.`);

      const deletionId = await recordPendingDeletion({
        userId: ctx.userId,
        connectionId: ctx.connectionId,
        targetKind: kind,
        targetId: id,
        targetTitle: title,
      });
      const base = baseUrl;
      return toolText(
        `Deletion of ${kind} "${title}" is waiting for the student to approve it in Productivio. Nothing has been deleted yet. Ask the student to confirm at ${base}/settings.`,
        { deletionId, status: "pending_approval", targetKind: kind, targetId: id, targetTitle: title },
      );
    }

    case "list_pending_deletions": {
      const rows = await db
        .select()
        .from(pendingDeletions)
        .where(eq(pendingDeletions.userId, ctx.userId));
      return toolText(
        `${rows.filter(row => row.status === "pending").length} deletion request(s) awaiting approval.`,
        {
          deletions: rows.map(row => ({
            id: row.id,
            kind: row.targetKind,
            targetId: row.targetId,
            title: row.targetTitle,
            status: row.status,
          })),
        },
      );
    }

    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP transport                                                      */
/* ------------------------------------------------------------------ */

const readBearer = (req: Request) => {
  const header = req.header("authorization");
  return header ?? undefined;
};

/**
 * MCP Streamable HTTP endpoint. Responses are JSON (no server events), which
 * is permitted by the spec and keeps the endpoint simple behind a proxy.
 */
router.post("/mcp", async (req, res) => {
  const auth = await authenticateBearer(readBearer(req));
  if (!auth) {
    const base = publicBaseUrl(req);
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`);
    res.status(401).json(rpcError(null, -32001, "Authentication required. Connect Productivio from your AI assistant first."));
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    res.status(400).json(rpcError(null, -32600, "Invalid JSON-RPC request."));
    return;
  }

  const id = (body.id ?? null) as RpcId;
  const method = body.method;
  const params = (body.params ?? {}) as Record<string, unknown>;
  const notification = body.id === undefined;

  if (method === "initialize") {
    await touchConnection(auth.connectionId);
    res.json(rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        "Productivio planner for students. Read the planner before changing it, create or update tasks and events directly, and request deletion through delete_planner_item so the student can approve it.",
    }));
    return;
  }

  if (method === "ping") {
    res.json(rpcResult(id, {}));
    return;
  }

  if (method === "tools/list") {
    res.json(rpcResult(id, { tools: TOOLS }));
    return;
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const tool = TOOLS.find(entry => entry.name === name);
    if (!tool) {
      res.json(rpcResult(id, toolText(`Unknown tool ${name}.`, undefined, true)));
      return;
    }
    if (!hasScope(auth.scope, scopeFor(name))) {
      res.json(rpcResult(id, toolText(
        `${name} needs the ${scopeFor(name)} permission, which this connection was not granted. Reconnect from your AI assistant to add it.`,
        undefined,
        true,
      )));
      return;
    }

    const rawArgs = params.arguments;
    if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
      res.json(rpcResult(id, toolText("Tool arguments must be an object.", undefined, true)));
      return;
    }

    try {
      await touchConnection(auth.connectionId);
      res.json(rpcResult(id, await runTool(name, (rawArgs ?? {}) as Record<string, unknown>, auth, publicBaseUrl(req))));
    } catch (error) {
      const message = error instanceof PlannerValidationError || error instanceof ToolError
        ? error.message
        : "The planner change could not be saved.";
      res.json(rpcResult(id, toolText(message, undefined, true)));
    }
    return;
  }

  if (method.startsWith("notifications/")) {
    // Notifications have no response body.
    res.status(202).end();
    return;
  }

  if (notification) {
    res.status(202).end();
    return;
  }

  res.json(rpcError(id, -32601, `Unsupported method ${method}.`));
});

/** GET is reserved for server-sent events, which this server does not use. */
router.get("/mcp", (_req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json(rpcError(null, -32000, "Use POST for the Productivio MCP endpoint."));
});

/** DELETE ends a session; included for clients that follow the spec. */
router.delete("/mcp", (_req, res) => {
  res.status(204).end();
});

async function touchConnection(connectionId: string) {
  await db
    .update(aiConnections)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(aiConnections.id, connectionId), isNull(aiConnections.revokedAt)));
}

export default router;
