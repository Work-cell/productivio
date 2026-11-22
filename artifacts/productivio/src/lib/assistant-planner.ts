import type { AssistantCommand, AssistantCommandPlan } from '@workspace/api-client-react';

export type AssistantTask = {
  id: string;
  title: string;
  dueDate: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  projectId?: string;
  calendarEventId?: string;
};

export type AssistantProject = {
  id: string;
  name: string;
  description: string;
  progress: number;
  status: 'on-track' | 'at-risk' | 'completed';
};

export type AssistantEvent = {
  id: string;
  title: string;
  date: string;
  day: number;
  startMinutes: number;
  endMinutes: number;
  color: string;
  taskId?: string;
};

export type AssistantPlannerSnapshot = {
  tasks: AssistantTask[];
  projects: AssistantProject[];
  events: AssistantEvent[];
};

export type AssistantPlannerResult =
  | { ok: true; snapshot: AssistantPlannerSnapshot }
  | { ok: false; error: string };

type IdFactory = (prefix: string) => string;

const defaultId: IdFactory = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const weekdayFromDate = (value: string) => {
  const weekday = new Date(`${value}T12:00:00`).getDay();
  return weekday === 0 ? 7 : weekday;
};

function validateTargets(commands: AssistantCommand[], snapshot: AssistantPlannerSnapshot): string | null {
  const taskIds = new Set(snapshot.tasks.map(task => task.id));
  const projectIds = new Set(snapshot.projects.map(project => project.id));
  const eventIds = new Set(snapshot.events.map(event => event.id));
  const usedTargets = new Set<string>();
  const claimTarget = (type: string, id: string) => {
    const key = `${type}:${id}`;
    if (usedTargets.has(key)) return false;
    usedTargets.add(key);
    return true;
  };

  for (const command of commands) {
    switch (command.kind) {
      case 'task.add':
        if (!isValidDate(command.dueDate)) return 'The proposed plan contains an invalid task date. Create a new plan.';
        if (command.projectId && !projectIds.has(command.projectId)) return 'The plan refers to a project that no longer exists. Create a new plan.';
        break;
      case 'task.update':
        if (!taskIds.has(command.id)) return 'A task in this plan has changed since it was generated. Create a new plan.';
        if (!claimTarget('task', command.id)) return 'The plan tries to change the same task more than once. Create a new plan.';
        if (command.changes.dueDate && !isValidDate(command.changes.dueDate)) return 'The proposed plan contains an invalid task date. Create a new plan.';
        if (command.changes.projectId && !projectIds.has(command.changes.projectId)) return 'The plan refers to a project that no longer exists. Create a new plan.';
        break;
      case 'task.remove':
        if (!taskIds.has(command.id)) return 'A task in this plan has changed since it was generated. Create a new plan.';
        if (!claimTarget('task', command.id)) return 'The plan tries to change the same task more than once. Create a new plan.';
        break;
      case 'project.add':
        break;
      case 'project.update':
      case 'project.remove':
        if (!projectIds.has(command.id)) return 'A project in this plan has changed since it was generated. Create a new plan.';
        if (!claimTarget('project', command.id)) return 'The plan tries to change the same project more than once. Create a new plan.';
        break;
      case 'event.add':
        if (!isValidDate(command.date) || command.endMinutes <= command.startMinutes) return 'The proposed plan contains an invalid event date or time. Create a new plan.';
        break;
      case 'event.update': {
        const event = snapshot.events.find(item => item.id === command.id);
        if (!event) return 'An event in this plan has changed since it was generated. Create a new plan.';
        if (!claimTarget('event', command.id)) return 'The plan tries to change the same event more than once. Create a new plan.';
        if (command.changes.date && !isValidDate(command.changes.date)) return 'The proposed plan contains an invalid event date. Create a new plan.';
        if ((command.changes.endMinutes ?? event.endMinutes) <= (command.changes.startMinutes ?? event.startMinutes)) return 'The proposed event would end before it starts. Create a new plan.';
        break;
      }
      case 'event.remove':
        if (!eventIds.has(command.id)) return 'An event in this plan has changed since it was generated. Create a new plan.';
        if (!claimTarget('event', command.id)) return 'The plan tries to change the same event more than once. Create a new plan.';
        break;
    }
  }
  return null;
}

export function applyAssistantPlan(
  plan: AssistantCommandPlan,
  snapshot: AssistantPlannerSnapshot,
  createId: IdFactory = defaultId,
): AssistantPlannerResult {
  const validationError = validateTargets(plan.commands, snapshot);
  if (validationError) return { ok: false, error: validationError };

  const tasks = snapshot.tasks.map(task => ({ ...task }));
  const projects = snapshot.projects.map(project => ({ ...project }));
  const events = snapshot.events.map(event => ({ ...event }));

  for (const command of plan.commands) {
    switch (command.kind) {
      case 'task.add': {
        const id = createId('task');
        if (tasks.some(task => task.id === id)) return { ok: false, error: 'Could not create a unique task. Try again.' };
        tasks.unshift({
          id,
          title: command.title,
          dueDate: command.dueDate,
          category: command.category ?? 'Personal',
          priority: command.priority ?? 'medium',
          completed: false,
          ...(command.projectId ? { projectId: command.projectId } : {}),
        });
        break;
      }
      case 'task.update': {
        const index = tasks.findIndex(task => task.id === command.id);
        const current = tasks[index];
        const { projectId, ...changes } = command.changes;
        const updated: AssistantTask = { ...current, ...changes };
        if (projectId !== undefined) {
          if (projectId === null) delete updated.projectId;
          else updated.projectId = projectId;
        }
        const linkedEventId = current.calendarEventId ?? events.find(event => event.taskId === current.id)?.id;
        if (linkedEventId) updated.calendarEventId = linkedEventId;
        tasks[index] = updated;
        if (linkedEventId) {
          for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
            if (events[eventIndex].id !== linkedEventId) continue;
            events[eventIndex] = {
              ...events[eventIndex],
              title: updated.title,
              date: updated.dueDate,
              day: weekdayFromDate(updated.dueDate),
              taskId: updated.id,
            };
          }
        }
        break;
      }
      case 'task.remove': {
        const task = tasks.find(item => item.id === command.id)!;
        const linkedEventId = task.calendarEventId ?? events.find(event => event.taskId === task.id)?.id;
        const eventIds = linkedEventId ? new Set([linkedEventId]) : new Set<string>();
        const linkedTaskIds = new Set([task.id]);
        tasks.splice(tasks.findIndex(item => item.id === task.id), 1);
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (eventIds.has(events[index].id) || events[index].taskId && linkedTaskIds.has(events[index].taskId!)) events.splice(index, 1);
        }
        break;
      }
      case 'project.add': {
        const id = createId('project');
        if (projects.some(project => project.id === id)) return { ok: false, error: 'Could not create a unique project. Try again.' };
        projects.unshift({ id, name: command.name, description: command.description ?? '', progress: 0, status: 'on-track' });
        break;
      }
      case 'project.update': {
        const index = projects.findIndex(project => project.id === command.id);
        projects[index] = { ...projects[index], ...command.changes };
        break;
      }
      case 'project.remove': {
        projects.splice(projects.findIndex(project => project.id === command.id), 1);
        for (let index = 0; index < tasks.length; index += 1) {
          if (tasks[index].projectId === command.id) {
            const unassigned = { ...tasks[index] };
            delete unassigned.projectId;
            tasks[index] = unassigned;
          }
        }
        break;
      }
      case 'event.add': {
        const eventId = createId('event');
        const taskId = createId('task');
        if (events.some(event => event.id === eventId) || tasks.some(task => task.id === taskId)) {
          return { ok: false, error: 'Could not create unique planner items. Try again.' };
        }
        events.push({
          id: eventId,
          title: command.title,
          date: command.date,
          day: weekdayFromDate(command.date),
          startMinutes: command.startMinutes,
          endMinutes: command.endMinutes,
          color: command.color,
          taskId,
        });
        tasks.unshift({
          id: taskId,
          title: command.title,
          dueDate: command.date,
          category: 'Scheduled',
          priority: 'medium',
          completed: false,
          calendarEventId: eventId,
        });
        break;
      }
      case 'event.update': {
        const index = events.findIndex(event => event.id === command.id);
        const updated = { ...events[index], ...command.changes };
        updated.day = weekdayFromDate(updated.date);
        events[index] = updated;
        const linkedTaskId = updated.taskId ?? tasks.find(task => task.calendarEventId === updated.id)?.id;
        if (linkedTaskId) {
          const taskIndex = tasks.findIndex(task => task.id === linkedTaskId);
          if (taskIndex !== -1) {
            tasks[taskIndex] = {
              ...tasks[taskIndex],
              title: updated.title,
              dueDate: updated.date,
              calendarEventId: updated.id,
            };
          }
        }
        break;
      }
      case 'event.remove': {
        const event = events.find(item => item.id === command.id)!;
        const linkedTaskId = event.taskId ?? tasks.find(task => task.calendarEventId === event.id)?.id;
        events.splice(events.findIndex(item => item.id === event.id), 1);
        if (linkedTaskId) {
          const taskIndex = tasks.findIndex(task => task.id === linkedTaskId);
          if (taskIndex !== -1) tasks.splice(taskIndex, 1);
        }
        break;
      }
    }
  }

  const projectIds = new Set(projects.map(project => project.id));
  const eventIds = new Set(events.map(event => event.id));
  const taskIds = new Set(tasks.map(task => task.id));
  if (tasks.some(task => task.projectId && !projectIds.has(task.projectId))) {
    return { ok: false, error: 'The plan leaves a task assigned to a removed project. Try a new plan.' };
  }
  if (tasks.some(task => task.calendarEventId && !eventIds.has(task.calendarEventId)) ||
      events.some(event => event.taskId && !taskIds.has(event.taskId))) {
    return { ok: false, error: 'The plan would break a task and calendar link. Try a new plan.' };
  }

  return { ok: true, snapshot: { tasks, projects, events } };
}
