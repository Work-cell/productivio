/**
 * Validation and normalisation for the server-side planner document.
 *
 * The browser planner and the MCP tools share this shape, so any document
 * written by an assistant is validated with the same rules the app uses before
 * it is stored or handed back to a student.
 */

export type Priority = "high" | "medium" | "low";
export type WeekStart = "monday" | "sunday";
export type ProjectStatus = "on-track" | "at-risk" | "completed";
export type EventColor = "teal" | "coral" | "gold" | "lilac";

export type PlannerTask = {
  id: string;
  title: string;
  dueDate: string;
  category: string;
  priority: Priority;
  completed: boolean;
  projectId?: string;
  calendarEventId?: string;
};

export type PlannerEvent = {
  id: string;
  title: string;
  date: string;
  day: number;
  startMinutes: number;
  endMinutes: number;
  color: EventColor;
  taskId?: string;
};

export type PlannerProject = {
  id: string;
  name: string;
  description: string;
  progress: number;
  status: ProjectStatus;
};

export type PlannerPreferences = {
  focusMode: boolean;
  weekStart: WeekStart;
  compactRows: boolean;
};

export type PlannerDocument = {
  tasks: PlannerTask[];
  events: PlannerEvent[];
  projects: PlannerProject[];
  preferences: PlannerPreferences;
};

export const MAX_ITEMS = 10000;
export const MAX_TITLE = 300;
export const MAX_TEXT = 3000;

export class PlannerValidationError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, label: string, max: number): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new PlannerValidationError(`${label} must be text of 1–${max} characters.`);
  }
  return value;
};

const optionalString = (value: unknown, label: string, max: number): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, label, max);
};

const requireDate = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PlannerValidationError(`${label} must be a date in YYYY-MM-DD form.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new PlannerValidationError(`${label} must be a real calendar date.`);
  }
  return value;
};

const requireInt = (value: unknown, label: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new PlannerValidationError(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return value;
};

const requireArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw new PlannerValidationError(`${label} must be a list of ${MAX_ITEMS} items or fewer.`);
  }
  return value;
};

export const weekdayFromDate = (date: string): number => {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

export function validateTask(raw: unknown): PlannerTask {
  if (!isRecord(raw)) throw new PlannerValidationError("A task is not a valid object.");
  if (raw.priority !== "high" && raw.priority !== "medium" && raw.priority !== "low") {
    throw new PlannerValidationError("A task priority must be high, medium, or low.");
  }
  if (typeof raw.completed !== "boolean") {
    throw new PlannerValidationError("A task completion value must be true or false.");
  }
  const dueDate = requireDate(raw.dueDate, "A task due date");
  return {
    id: requireString(raw.id, "A task id", 200),
    title: requireString(raw.title, "A task title", MAX_TITLE),
    dueDate,
    category: requireString(raw.category, "A task category", 200),
    priority: raw.priority,
    completed: raw.completed,
    projectId: optionalString(raw.projectId, "A task project id", 200),
    calendarEventId: optionalString(raw.calendarEventId, "A task calendar event id", 200),
  };
}

export function validateEvent(raw: unknown): PlannerEvent {
  if (!isRecord(raw)) throw new PlannerValidationError("A calendar event is not a valid object.");
  if (raw.color !== "teal" && raw.color !== "coral" && raw.color !== "gold" && raw.color !== "lilac") {
    throw new PlannerValidationError("An event colour must be teal, coral, gold, or lilac.");
  }
  const startMinutes = requireInt(raw.startMinutes, "An event start time", 0, 1439);
  const endMinutes = requireInt(raw.endMinutes, "An event end time", 1, 1440);
  if (endMinutes <= startMinutes) {
    throw new PlannerValidationError("A calendar event must end after it starts.");
  }
  const date = requireDate(raw.date, "An event date");
  return {
    id: requireString(raw.id, "An event id", 200),
    title: requireString(raw.title, "An event title", MAX_TITLE),
    date,
    day: weekdayFromDate(date),
    startMinutes,
    endMinutes,
    color: raw.color,
    taskId: optionalString(raw.taskId, "An event task id", 200),
  };
}

export function validateProject(raw: unknown): PlannerProject {
  if (!isRecord(raw)) throw new PlannerValidationError("A project is not a valid object.");
  if (raw.status !== "on-track" && raw.status !== "at-risk" && raw.status !== "completed") {
    throw new PlannerValidationError("A project status must be on-track, at-risk, or completed.");
  }
  const progress = raw.progress;
  if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new PlannerValidationError("A project progress value must be between 0 and 100.");
  }
  return {
    id: requireString(raw.id, "A project id", 200),
    name: requireString(raw.name, "A project name", 200),
    description: optionalString(raw.description, "A project description", MAX_TEXT) ?? "",
    progress,
    status: raw.status,
  };
}

export function validatePreferences(raw: unknown): PlannerPreferences {
  if (!isRecord(raw)) throw new PlannerValidationError("Planner preferences are missing.");
  if (typeof raw.focusMode !== "boolean" || typeof raw.compactRows !== "boolean") {
    throw new PlannerValidationError("Planner preference toggles must be true or false.");
  }
  if (raw.weekStart !== "monday" && raw.weekStart !== "sunday") {
    throw new PlannerValidationError("The week start must be monday or sunday.");
  }
  return { focusMode: raw.focusMode, weekStart: raw.weekStart, compactRows: raw.compactRows };
}

export function validatePlanner(raw: unknown): PlannerDocument {
  if (!isRecord(raw)) throw new PlannerValidationError("The planner data is not a valid object.");

  const tasks = requireArray(raw.tasks, "Tasks").map(validateTask);
  const events = requireArray(raw.events, "Calendar events").map(validateEvent);
  const projects = requireArray(raw.projects, "Projects").map(validateProject);
  const preferences = validatePreferences(raw.preferences);

  const unique = (items: { id: string }[], label: string) => {
    if (new Set(items.map(item => item.id)).size !== items.length) {
      throw new PlannerValidationError(`${label} contain duplicate ids.`);
    }
  };
  unique(tasks, "Tasks");
  unique(events, "Calendar events");
  unique(projects, "Projects");

  const projectIds = new Set(projects.map(project => project.id));
  const taskIds = new Set(tasks.map(task => task.id));
  const eventIds = new Set(events.map(event => event.id));
  if (tasks.some(task => task.projectId && !projectIds.has(task.projectId))) {
    throw new PlannerValidationError("A task refers to a project that does not exist.");
  }
  if (tasks.some(task => task.calendarEventId && !eventIds.has(task.calendarEventId))) {
    throw new PlannerValidationError("A task refers to a calendar event that does not exist.");
  }
  if (events.some(event => event.taskId && !taskIds.has(event.taskId))) {
    throw new PlannerValidationError("A calendar event refers to a task that does not exist.");
  }

  return { tasks, events, projects, preferences };
}

export const emptyPlanner = (): PlannerDocument => ({
  tasks: [],
  events: [],
  projects: [],
  preferences: { focusMode: true, weekStart: "monday", compactRows: false },
});

/** Recomputes project progress from the tasks assigned to each project. */
export function withDerivedProgress(planner: PlannerDocument): PlannerDocument {
  return {
    ...planner,
    projects: planner.projects.map(project => {
      const owned = planner.tasks.filter(task => task.projectId === project.id);
      const progress = owned.length
        ? Math.round((owned.filter(task => task.completed).length / owned.length) * 100)
        : project.progress;
      const status: ProjectStatus = progress >= 100
        ? "completed"
        : project.status === "completed"
          ? "on-track"
          : project.status;
      return { ...project, progress, status };
    }),
  };
}

export const isOverdue = (task: PlannerTask, today: string) =>
  !task.completed && task.dueDate < today;
