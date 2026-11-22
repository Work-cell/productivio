import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Server-side copy of a student's planner. The browser remains the primary
 * editing surface; this row exists so authorised AI assistants can read and
 * change the same planner through the MCP server.
 */
export const plannerStates = pgTable("planner_states", {
  userId: text("user_id").primaryKey(),
  // Normalised planner document: tasks, events, projects, preferences.
  data: jsonb("data").notNull(),
  revision: integer("revision").notNull().default(0),
  // "app" for browser writes, "assistant" for MCP tool writes.
  updatedBy: text("updated_by").notNull().default("app"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlannerStateRow = typeof plannerStates.$inferSelect;
