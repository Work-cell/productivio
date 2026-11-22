import { describe, expect, it } from 'vitest';
import type { AssistantCommandPlan } from '@workspace/api-client-react';
import {
  applyAssistantPlan,
  type AssistantPlannerSnapshot,
} from './assistant-planner';

const makeSnapshot = (): AssistantPlannerSnapshot => ({
  tasks: [
    {
      id: 'task-1',
      title: 'Read chapter',
      dueDate: '2026-11-16',
      category: 'Study',
      priority: 'medium',
      completed: false,
      projectId: 'project-1',
      calendarEventId: 'event-1',
    },
  ],
  projects: [
    { id: 'project-1', name: 'Biology', description: 'Coursework', progress: 0, status: 'on-track' },
  ],
  events: [
    {
      id: 'event-1',
      title: 'Read chapter',
      date: '2026-11-16',
      day: 1,
      startMinutes: 600,
      endMinutes: 660,
      color: 'teal',
      taskId: 'task-1',
    },
  ],
});

const makePlan = (commands: unknown[]): AssistantCommandPlan => ({
  summary: 'Proposed planner changes',
  commands: commands as AssistantCommandPlan['commands'],
});

describe('applyAssistantPlan', () => {
  it('adds a calendar event and its linked task together', () => {
    const result = applyAssistantPlan(makePlan([
      {
        kind: 'event.add',
        title: 'Review notes',
        date: '2026-11-17',
        startMinutes: 600,
        endMinutes: 645,
        color: 'teal',
      },
    ]), makeSnapshot(), prefix => `${prefix}-new`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newEvent = result.snapshot.events.find(event => event.id === 'event-new');
    const newTask = result.snapshot.tasks.find(task => task.id === 'task-new');
    expect(newEvent?.taskId).toBe(newTask?.id);
    expect(newTask?.calendarEventId).toBe(newEvent?.id);
    expect(newTask?.dueDate).toBe('2026-11-17');
    expect(newEvent?.day).toBe(2);
  });

  it('keeps linked task and calendar details in sync after task edits', () => {
    const result = applyAssistantPlan(makePlan([
      {
        kind: 'task.update',
        id: 'task-1',
        changes: { title: 'Study cell division', dueDate: '2026-11-18' },
      },
    ]), makeSnapshot());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.events[0]).toMatchObject({
      title: 'Study cell division',
      date: '2026-11-18',
      day: 3,
    });
  });

  it('removes a linked task when its calendar event is removed', () => {
    const result = applyAssistantPlan(makePlan([
      { kind: 'event.remove', id: 'event-1' },
    ]), makeSnapshot());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.events).toHaveLength(0);
    expect(result.snapshot.tasks).toHaveLength(0);
  });

  it('keeps project tasks and unassigns them when a project is removed', () => {
    const result = applyAssistantPlan(makePlan([
      { kind: 'project.remove', id: 'project-1' },
    ]), makeSnapshot());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.projects).toHaveLength(0);
    expect(result.snapshot.tasks).toHaveLength(1);
    expect(result.snapshot.tasks[0].projectId).toBeUndefined();
  });

  it('rejects the entire plan if an item changed before approval', () => {
    const original = makeSnapshot();
    const result = applyAssistantPlan(makePlan([
      { kind: 'task.remove', id: 'missing-task' },
      { kind: 'project.remove', id: 'project-1' },
    ]), original);

    expect(result.ok).toBe(false);
    expect(original.tasks).toHaveLength(1);
    expect(original.projects).toHaveLength(1);
    expect(original.events).toHaveLength(1);
  });
});
