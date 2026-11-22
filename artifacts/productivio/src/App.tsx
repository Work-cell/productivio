import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  ArrowUpRight, BarChart3, BookOpen, BriefcaseBusiness, CalendarDays,
  CalendarPlus, Check, CheckCircle2, CheckSquare2, ChevronLeft,
  ChevronRight, Circle, CircleAlert, Clock3, Command, Filter,
  Bot, FileDown, FolderKanban, GraduationCap, LayoutDashboard, ListTodo, LockKeyhole, Menu,
  LogIn, LogOut, MoreHorizontal, Moon, Pencil, Plus, Search, Settings, ShieldCheck,
  SlidersHorizontal, Sun, Target, Trash2, Upload, UserRound, X
} from 'lucide-react';
import { useClerk, useUser } from '@clerk/react';
import { Link, Redirect, Route, Switch, useLocation } from 'wouter';
import { SignInPage, SignUpPage } from '@/components/auth/ClerkAuthProvider';
import StudentLandingPage from '@/components/auth/StudentLandingPage';
import StudentWorkspaceGate from '@/components/auth/StudentWorkspaceGate';
import ConnectAiPage from '@/pages/ConnectAiPage';
import AiIntegrationsSettings from '@/components/settings/AiIntegrationsSettings';
import AICommandPanel from '@/components/assistant/AICommandPanel';
import { useServerPlannerSync } from '@/lib/use-server-planner-sync';
import { BASE_URL } from '@/lib/api-base';
import { applyAssistantPlan } from '@/lib/assistant-planner';
import { trackSignUpCompletedOnce } from '@/lib/analytics';
import type {
  AssistantCommandPlan,
  AssistantCommandRequestProvider,
  AssistantEventContext,
  AssistantProjectContext,
  AssistantTaskContext,
} from '@workspace/api-client-react';

type Priority = 'high' | 'medium' | 'low';
type WeekStart = 'monday' | 'sunday';
type ProjectStatus = 'on-track' | 'at-risk' | 'completed';
type Task = { id: string; title: string; dueDate: string; category: string; priority: Priority; completed: boolean; projectId?: string; calendarEventId?: string };
type CalendarEvent = { id: string; title: string; date: string; day: number; startMinutes: number; endMinutes: number; color: string; taskId?: string };
type CalendarEventDraft = Pick<CalendarEvent, 'title' | 'date' | 'startMinutes' | 'endMinutes' | 'color'>;
type Project = { id: string; name: string; description: string; progress: number; status: ProjectStatus };
type PlannerData = {
  tasks: Task[];
  events: CalendarEvent[];
  projects: Project[];
  preferences: { focusMode: boolean; weekStart: WeekStart; compactRows: boolean };
};
type ToastMessage = { id: number; text: string; tone?: 'good' | 'warn' };

const guestSessionKey = 'productivio:guest-session-v1';
const guestUserId = 'guest';

function hasGuestSession() {
  try {
    return window.sessionStorage.getItem(guestSessionKey) === 'active';
  } catch {
    return false;
  }
}

const today = new Date();
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};
const monday = addDays(today, -(today.getDay() === 0 ? 6 : today.getDay() - 1));
const dateForDay = (day: number) => dayKey(addDays(monday, day - 1));
const getWeekStart = (date: Date, weekStart: WeekStart) => {
  const firstDay = weekStart === 'sunday' ? 0 : 1;
  return addDays(date, -((date.getDay() - firstDay + 7) % 7));
};
const weekdayFromDate = (value: string) => {
  const weekday = new Date(`${value}T12:00:00`).getDay();
  return weekday === 0 ? 7 : weekday;
};
const dateForWeekday = (weekday: number, weekStart: WeekStart, referenceDate: Date = today) => {
  const firstWeekday = weekStart === 'sunday' ? 7 : 1;
  const offset = (weekday - firstWeekday + 7) % 7;
  return dayKey(addDays(getWeekStart(referenceDate, weekStart), offset));
};
const formatShortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const projectProgress = (project: Project, tasks: Task[]) => {
  const projectTasks = tasks.filter(task => task.projectId === project.id);
  return projectTasks.length ? Math.round((projectTasks.filter(task => task.completed).length / projectTasks.length) * 100) : 0;
};
const projectStatus = (project: Project, tasks: Task[]): ProjectStatus => projectProgress(project, tasks) >= 100 ? 'completed' : project.status === 'completed' ? 'on-track' : project.status;

const seedTasks: Task[] = [
  { id: 'task-1', title: 'Finish statistics problem set', dueDate: dateForDay(1), category: 'Statistics', priority: 'high', completed: false, projectId: 'project-1' },
  { id: 'task-2', title: 'Read chapter 6: urban ecologies', dueDate: dateForDay(2), category: 'Environmental Studies', priority: 'medium', completed: false, projectId: 'project-1' },
  { id: 'task-3', title: 'Sketch mobile app wireframes', dueDate: dateForDay(3), category: 'Design Studio', priority: 'high', completed: false, projectId: 'project-2' },
  { id: 'task-4', title: 'Review flashcards for French', dueDate: dateForDay(4), category: 'French', priority: 'low', completed: true, projectId: 'project-3' },
  { id: 'task-5', title: 'Submit lab partner notes', dueDate: dateForDay(5), category: 'Biology', priority: 'medium', completed: false, projectId: 'project-2' },
  { id: 'task-6', title: 'Plan weekend research sprint', dueDate: dateForDay(6), category: 'Personal', priority: 'low', completed: false },
];
const seedEvents: CalendarEvent[] = [
  { id: 'event-1', title: 'Statistics lecture', day: 1, date: dateForWeekday(1, 'monday'), startMinutes: 10 * 60, endMinutes: 12 * 60, color: 'teal' },
  { id: 'event-2', title: 'Design critique', day: 2, date: dateForWeekday(2, 'monday'), startMinutes: 14 * 60, endMinutes: 16 * 60, color: 'coral' },
  { id: 'event-3', title: 'Library deep work', day: 3, date: dateForWeekday(3, 'monday'), startMinutes: 9 * 60, endMinutes: 11 * 60, color: 'gold' },
  { id: 'event-4', title: 'French conversation', day: 4, date: dateForWeekday(4, 'monday'), startMinutes: 15 * 60, endMinutes: 17 * 60, color: 'lilac' },
  { id: 'event-5', title: 'Research lab', day: 5, date: dateForWeekday(5, 'monday'), startMinutes: 11 * 60, endMinutes: 14 * 60, color: 'teal' },
];
const seedProjects: Project[] = [
  { id: 'project-1', name: 'Thesis research', description: 'A comparative study of public space and belonging.', progress: 68, status: 'on-track' },
  { id: 'project-2', name: 'Studio portfolio', description: 'Curating the work that deserves a second look.', progress: 42, status: 'at-risk' },
  { id: 'project-3', name: 'French fluency', description: 'Small daily reps toward a confident conversation.', progress: 84, status: 'on-track' },
];

const normalizeCalendarEvents = (value: unknown, weekStart: WeekStart): CalendarEvent[] => {
  if (!Array.isArray(value)) return seedEvents;
  return value.map((entry) => {
    const event = entry as {
      id: string; title: string; day?: number; date?: unknown;
      startMinutes?: number; endMinutes?: number; startHour?: number; endHour?: number;
      color: string; taskId?: string;
    };
    const legacyDay = Number.isInteger(event.day) && event.day! >= 1 && event.day! <= 7 ? event.day! : 1;
    const storedDate = typeof event.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(event.date) &&
      !Number.isNaN(Date.parse(`${event.date}T00:00:00Z`)) &&
      new Date(`${event.date}T00:00:00Z`).toISOString().slice(0, 10) === event.date
      ? event.date
      : dateForWeekday(legacyDay, weekStart);
    return {
      ...event,
      date: storedDate,
      day: weekdayFromDate(storedDate),
      startMinutes: typeof event.startMinutes === 'number' ? event.startMinutes : (event.startHour ?? 9) * 60,
      endMinutes: typeof event.endMinutes === 'number' ? event.endMinutes : (event.endHour ?? 10) * 60,
    };
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, label: string, maxLength = 500): string => {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${label} is not valid.`);
  return value;
};

const requireId = (value: unknown, label: string): string => {
  const id = requireString(value, label, 200);
  if (!id.trim()) throw new Error(`${label} is not valid.`);
  return id;
};

const requireOptionalId = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined;
  return requireId(value, label);
};

const requireInteger = (value: unknown, label: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} is not valid.`);
  }
  return value;
};

const requireArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value) || value.length > 10000) throw new Error(`${label} must be a list with 10,000 items or fewer.`);
  return value;
};

const requireDate = (value: unknown, label: string): string => {
  const date = requireString(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} must be a valid date.`);
  }
  return date;
};

function parsePlannerExport(value: unknown): PlannerData {
  if (!isRecord(value) || value.format !== 'productivio-planner' || value.version !== 1 || !isRecord(value.data)) {
    throw new Error('This is not a supported Productivio planner file.');
  }

  const raw = value.data;
  const exportWeekStart: WeekStart = isRecord(raw.preferences) && raw.preferences.weekStart === 'sunday' ? 'sunday' : 'monday';
  const tasks = requireArray(raw.tasks, 'Tasks').map((entry): Task => {
    if (!isRecord(entry)) throw new Error('A task in this file is not valid.');
    if (entry.priority !== 'high' && entry.priority !== 'medium' && entry.priority !== 'low') throw new Error('A task priority is not valid.');
    if (typeof entry.completed !== 'boolean') throw new Error('A task completion value is not valid.');
    return {
      id: requireId(entry.id, 'Task ID'),
      title: requireId(entry.title, 'Task title'),
      dueDate: requireDate(entry.dueDate, 'Task due date'),
      category: requireString(entry.category, 'Task category', 200),
      priority: entry.priority,
      completed: entry.completed,
      projectId: requireOptionalId(entry.projectId, 'Task project ID'),
      calendarEventId: requireOptionalId(entry.calendarEventId, 'Task calendar event ID'),
    };
  });

  const events = requireArray(raw.events, 'Calendar events').map((entry): CalendarEvent => {
    if (!isRecord(entry)) throw new Error('A calendar event in this file is not valid.');
    if (entry.color !== 'teal' && entry.color !== 'coral' && entry.color !== 'gold' && entry.color !== 'lilac') {
      throw new Error('A calendar event color is not valid.');
    }
    const startMinutes = requireInteger(entry.startMinutes, 'Event start time', 0, 1439);
    const endMinutes = requireInteger(entry.endMinutes, 'Event end time', 1, 1440);
    if (endMinutes <= startMinutes) throw new Error('A calendar event must end after it starts.');
    const date = entry.date === undefined
      ? dateForWeekday(requireInteger(entry.day, 'Event day', 1, 7), exportWeekStart)
      : requireDate(entry.date, 'Event date');
    return {
      id: requireId(entry.id, 'Event ID'),
      title: requireId(entry.title, 'Event title'),
      date,
      day: weekdayFromDate(date),
      startMinutes,
      endMinutes,
      color: entry.color,
      taskId: requireOptionalId(entry.taskId, 'Event task ID'),
    };
  });

  const projects = requireArray(raw.projects, 'Projects').map((entry): Project => {
    if (!isRecord(entry)) throw new Error('A project in this file is not valid.');
    if (entry.status !== 'on-track' && entry.status !== 'at-risk' && entry.status !== 'completed') {
      throw new Error('A project status is not valid.');
    }
    const progress = entry.progress;
    if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 100) {
      throw new Error('A project progress value is not valid.');
    }
    return {
      id: requireId(entry.id, 'Project ID'),
      name: requireId(entry.name, 'Project name'),
      description: requireString(entry.description, 'Project description', 3000),
      progress,
      status: entry.status,
    };
  });

  if (!isRecord(raw.preferences)) throw new Error('Planner preferences are missing or invalid.');
  const preferences = raw.preferences;
  if (typeof preferences.focusMode !== 'boolean' || typeof preferences.compactRows !== 'boolean' ||
      (preferences.weekStart !== 'monday' && preferences.weekStart !== 'sunday')) {
    throw new Error('Planner preferences are not valid.');
  }

  const uniqueIds = (items: { id: string }[], label: string) => {
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error(`${label} contain duplicate IDs.`);
  };
  uniqueIds(tasks, 'Tasks');
  uniqueIds(events, 'Calendar events');
  uniqueIds(projects, 'Projects');
  const projectIds = new Set(projects.map(project => project.id));
  const eventIds = new Set(events.map(event => event.id));
  const taskIds = new Set(tasks.map(task => task.id));
  if (tasks.some(task => task.projectId && !projectIds.has(task.projectId))) throw new Error('A task refers to a project that is not in this file.');
  if (tasks.some(task => task.calendarEventId && !eventIds.has(task.calendarEventId))) throw new Error('A task refers to a calendar event that is not in this file.');
  if (events.some(event => event.taskId && !taskIds.has(event.taskId))) throw new Error('A calendar event refers to a task that is not in this file.');

  return { tasks, events, projects, preferences: preferences as PlannerData['preferences'] };
}

function downloadPlannerExport(data: PlannerData): boolean {
  let url: string | null = null;
  let link: HTMLAnchorElement | null = null;
  try {
    const file = new Blob([JSON.stringify({
      format: 'productivio-planner',
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
    }, null, 2)], { type: 'application/json' });
    url = URL.createObjectURL(file);
    link = document.createElement('a');
    link.href = url;
    link.download = `productivio-planner-${dayKey(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    return true;
  } catch {
    return false;
  } finally {
    link?.remove();
    if (url) {
      try { URL.revokeObjectURL(url); } catch { /* ignore cleanup error */ }
    }
  }
}

const plannerStorageKeys = ['tasks', 'week-start', 'events', 'projects', 'focus-mode', 'dense-layout'] as const;
const studentStoragePrefix = (userId: string) => `productivio:student:${encodeURIComponent(userId)}:`;
const studentStorageKey = (userId: string, key: typeof plannerStorageKeys[number]) => `${studentStoragePrefix(userId)}${key}`;

function readStoredJson<T>(storageKey: string, fallback: T, normalize?: (value: unknown) => T): T {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? (normalize ? normalize(JSON.parse(stored)) : JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readPlannerFromStorage(userId: string): PlannerData {
  const weekStart = readStoredJson<WeekStart>(studentStorageKey(userId, 'week-start'), 'monday', value => value === 'sunday' ? 'sunday' : 'monday');
  const initialEvents = seedEvents.map(event => ({ ...event, date: dateForWeekday(event.day, weekStart) }));
  return {
    tasks: readStoredJson<Task[]>(studentStorageKey(userId, 'tasks'), seedTasks),
    events: readStoredJson<CalendarEvent[]>(studentStorageKey(userId, 'events'), initialEvents, value => normalizeCalendarEvents(value, weekStart)),
    projects: readStoredJson<Project[]>(studentStorageKey(userId, 'projects'), seedProjects),
    preferences: {
      weekStart,
      focusMode: readStoredJson<boolean>(studentStorageKey(userId, 'focus-mode'), true),
      compactRows: readStoredJson<boolean>(studentStorageKey(userId, 'dense-layout'), false),
    },
  };
}

type WriteTransactionResult = { ok: true } | { ok: false; rollbackFailed: boolean };

function writePlannerTransaction(userId: string, data: PlannerData): WriteTransactionResult {
  const entries: Array<[string, string]> = [
    [studentStorageKey(userId, 'tasks'), JSON.stringify(data.tasks)],
    [studentStorageKey(userId, 'week-start'), JSON.stringify(data.preferences.weekStart)],
    [studentStorageKey(userId, 'events'), JSON.stringify(data.events)],
    [studentStorageKey(userId, 'projects'), JSON.stringify(data.projects)],
    [studentStorageKey(userId, 'focus-mode'), JSON.stringify(data.preferences.focusMode)],
    [studentStorageKey(userId, 'dense-layout'), JSON.stringify(data.preferences.compactRows)],
  ];
  const previous = new Map<string, string | null>();
  const written: string[] = [];
  try {
    for (const [key] of entries) {
      previous.set(key, localStorage.getItem(key));
    }
    for (const [key, serialized] of entries) {
      localStorage.setItem(key, serialized);
      written.push(key);
    }
    return { ok: true };
  } catch {
    let rollbackFailed = false;
    for (const key of written.reverse()) {
      try {
        const oldValue = previous.get(key);
        if (oldValue === null || oldValue === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, oldValue);
      } catch {
        rollbackFailed = true;
      }
    }
    return { ok: false, rollbackFailed };
  }
}

function usePlannerStorage(userId: string) {
  const [planner, setPlanner] = useState<PlannerData>(() => readPlannerFromStorage(userId));
  const [saveFailed, setSaveFailed] = useState(false);
  const [rollbackFailed, setRollbackFailed] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const skipNextSaveRef = useRef(false);
  const saveFailedRef = useRef(false);
  saveFailedRef.current = saveFailed;

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const result = writePlannerTransaction(userId, planner);
    setSaveFailed(!result.ok);
    setRollbackFailed(!result.ok && result.rollbackFailed);
  }, [userId, planner, saveAttempt]);

  useEffect(() => {
    const prefix = studentStoragePrefix(userId);
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key !== null && !event.key.startsWith(prefix)) return;
      if (saveFailedRef.current) return;
      skipNextSaveRef.current = true;
      setPlanner(readPlannerFromStorage(userId));
      setSaveFailed(false);
      setRollbackFailed(false);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [userId]);

  const setTasks = useCallback((updater: Task[] | ((current: Task[]) => Task[])) => {
    setPlanner(current => {
      const next = typeof updater === 'function' ? updater(current.tasks) : updater;
      return next === current.tasks ? current : { ...current, tasks: next };
    });
  }, []);
  const setEvents = useCallback((updater: CalendarEvent[] | ((current: CalendarEvent[]) => CalendarEvent[])) => {
    setPlanner(current => {
      const next = typeof updater === 'function' ? updater(current.events) : updater;
      return next === current.events ? current : { ...current, events: next };
    });
  }, []);
  const setProjects = useCallback((updater: Project[] | ((current: Project[]) => Project[])) => {
    setPlanner(current => {
      const next = typeof updater === 'function' ? updater(current.projects) : updater;
      return next === current.projects ? current : { ...current, projects: next };
    });
  }, []);
  const setWeekStart = useCallback((weekStart: WeekStart) => {
    setPlanner(current => current.preferences.weekStart === weekStart ? current : { ...current, preferences: { ...current.preferences, weekStart } });
  }, []);
  const setFocusMode = useCallback((focusMode: boolean) => {
    setPlanner(current => current.preferences.focusMode === focusMode ? current : { ...current, preferences: { ...current.preferences, focusMode } });
  }, []);
  const setDense = useCallback((compactRows: boolean) => {
    setPlanner(current => current.preferences.compactRows === compactRows ? current : { ...current, preferences: { ...current.preferences, compactRows } });
  }, []);
  const replacePlanner = useCallback((data: PlannerData) => {
    setPlanner(data);
  }, []);
  const retryStorageSave = useCallback(() => {
    setSaveAttempt(current => current + 1);
  }, []);
  const removeLocalPlanner = useCallback((): boolean => {
    try {
      for (const key of plannerStorageKeys) {
        localStorage.removeItem(studentStorageKey(userId, key));
      }
      skipNextSaveRef.current = true;
      setSaveFailed(false);
      setRollbackFailed(false);
      setPlanner(readPlannerFromStorage(userId));
      return true;
    } catch {
      return false;
    }
  }, [userId]);

  return {
    planner,
    tasks: planner.tasks,
    setTasks,
    events: planner.events,
    setEvents,
    projects: planner.projects,
    setProjects,
    weekStart: planner.preferences.weekStart,
    setWeekStart,
    focusMode: planner.preferences.focusMode,
    setFocusMode,
    dense: planner.preferences.compactRows,
    setDense,
    replacePlanner,
    saveFailed,
    rollbackFailed,
    retryStorageSave,
    removeLocalPlanner,
  };
}

function PlannerWorkspace({
  userId,
  guestMode = false,
  onExitGuest,
}: {
  userId: string;
  guestMode?: boolean;
  onExitGuest?: () => void;
}) {
  const {
    planner,
    tasks, setTasks,
    events, setEvents,
    projects, setProjects,
    weekStart, setWeekStart,
    focusMode, setFocusMode,
    dense, setDense,
    replacePlanner,
    saveFailed: storageSaveFailed,
    rollbackFailed: storageRollbackFailed,
    retryStorageSave,
    removeLocalPlanner,
  } = usePlannerStorage(userId);
  const { isLoaded: accountLoaded, isSignedIn, user } = useUser();
  // Assistant edits land in the server planner; this keeps the browser in step.
  const refreshFromServer = useServerPlannerSync({
    userId,
    enabled: !guestMode,
    planner,
    replacePlanner,
  });
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [taskModal, setTaskModal] = useState<{ open: boolean; task?: Task; date?: string; projectId?: string }>({ open: false });
  const [eventModal, setEventModal] = useState<{ open: boolean; date?: string; minutes?: number; event?: CalendarEvent }>({ open: false });
  const [assistantProvider, setAssistantProvider] = useState<AssistantCommandRequestProvider | null>(null);
  const [assistantApiKey, setAssistantApiKey] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  useEffect(() => {
    setEvents(current => {
      let changed = false;
      const syncedEvents = current.map(event => {
        const linkedTask = tasks.find(task => task.id === event.taskId || task.calendarEventId === event.id);
        if (!linkedTask) return event;
        const day = weekdayFromDate(linkedTask.dueDate);
        if (event.title === linkedTask.title && event.date === linkedTask.dueDate && event.day === day && event.taskId === linkedTask.id) return event;
        changed = true;
        return { ...event, title: linkedTask.title, date: linkedTask.dueDate, day, taskId: linkedTask.id };
      });
      return changed ? syncedEvents : current;
    });
  }, [tasks, setEvents]);
  const accountName = guestMode ? 'Guest planner' : user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || (accountLoaded ? 'Signed out' : 'Loading account');
  const accountEmail = guestMode ? 'Saved in this browser' : user?.primaryEmailAddress?.emailAddress ?? '';
  const accountImageUrl = user?.imageUrl;
  // Server address students paste into an AI assistant that supports MCP.
  const mcpUrl = useMemo(() => {
    const origin = BASE_URL || (typeof window === 'undefined' ? '' : window.location.origin);
    const basePath = BASE_URL ? '' : import.meta.env.BASE_URL.replace(/\/$/, '');
    return `${origin}${basePath}/mcp`;
  }, []);
  const assistantTasks: AssistantTaskContext[] = tasks.slice(0, 50).map(task => ({
    id: task.id,
    title: task.title,
    dueDate: task.dueDate,
    category: task.category,
    priority: task.priority,
    completed: task.completed,
    projectId: task.projectId ?? null,
    calendarEventId: task.calendarEventId ?? null,
  }));
  const assistantProjects: AssistantProjectContext[] = projects.slice(0, 25).map(project => ({
    id: project.id,
    name: project.name,
    description: project.description.slice(0, 500),
    progress: projectProgress(project, tasks),
    status: projectStatus(project, tasks),
  }));
  const assistantEvents: AssistantEventContext[] = events.slice(0, 50).map(event => ({
    id: event.id,
    title: event.title,
    date: event.date,
    startMinutes: event.startMinutes,
    endMinutes: event.endMinutes,
    color: event.color as AssistantEventContext['color'],
    taskId: event.taskId ?? tasks.find(task => task.calendarEventId === event.id)?.id ?? null,
  }));
  const notify = (text: string, tone: ToastMessage['tone'] = 'good') => {
    const id = Date.now();
    setToast({ id, text, tone });
    window.setTimeout(() => setToast(current => current?.id === id ? null : current), 2600);
  };
  const downloadPlannerCopy = () => {
    const ok = downloadPlannerExport({
      tasks,
      events,
      projects,
      preferences: { focusMode, weekStart, compactRows: dense },
    });
    if (ok) {
      setDownloadFailed(false);
      notify('Planner copy downloaded');
    } else {
      setDownloadFailed(true);
    }
    return ok;
  };
  const toggleTask = (id: string) => {
    setTasks(current => current.map(task => task.id === id ? { ...task, completed: !task.completed } : task));
    const task = tasks.find(item => item.id === id);
    notify(task?.completed ? 'Task reopened' : 'Task marked complete');
  };
  const deleteTask = (id: string) => {
    const task = tasks.find(item => item.id === id);
    setTasks(current => current.filter(task => task.id !== id));
    const linkedEventId = task?.calendarEventId ?? events.find(event => event.taskId === id)?.id;
    if (linkedEventId) setEvents(current => current.filter(event => event.id !== linkedEventId));
    notify('Task removed', 'warn');
  };
  const saveTask = (draft: Omit<Task, 'id' | 'completed'>, id?: string) => {
    if (id) {
      const existing = tasks.find(task => task.id === id);
      const linkedEventId = existing?.calendarEventId ?? events.find(event => event.taskId === id)?.id;
      setTasks(current => current.map(task => task.id === id ? { ...task, ...draft, calendarEventId: linkedEventId ?? task.calendarEventId } : task));
      if (linkedEventId) {
        setEvents(current => current.map(event => event.id === linkedEventId ? {
          ...event,
          title: draft.title,
          date: draft.dueDate,
          day: weekdayFromDate(draft.dueDate),
        } : event));
      }
    } else setTasks(current => [{ ...draft, id: uid('task'), completed: false }, ...current]);
    setTaskModal({ open: false });
    notify(id ? 'Task updated' : 'Task added');
  };
  const saveEvent = (draft: CalendarEventDraft, existing?: CalendarEvent) => {
    if (existing) {
      const linkedTaskId = existing.taskId ?? tasks.find(task => task.calendarEventId === existing.id)?.id;
      setEvents(current => current.map(event => event.id === existing.id ? {
        ...event,
        ...draft,
        day: weekdayFromDate(draft.date),
      } : event));
      if (linkedTaskId) {
        setTasks(current => current.map(task => task.id === linkedTaskId ? {
          ...task,
          title: draft.title,
          dueDate: draft.date,
          calendarEventId: existing.id,
        } : task));
      }
      notify(linkedTaskId ? 'Calendar event and linked task updated' : 'Calendar event updated');
    } else {
      const eventId = uid('event');
      const taskId = uid('task');
      setEvents(current => [...current, { ...draft, id: eventId, day: weekdayFromDate(draft.date), taskId }]);
      setTasks(current => [{
        id: taskId,
        title: draft.title,
        dueDate: draft.date,
        category: 'Scheduled',
        priority: 'medium',
        completed: false,
        calendarEventId: eventId,
      }, ...current]);
      notify('Event and linked task added');
    }
    setEventModal({ open: false });
  };
  const deleteEvent = (id: string) => {
    const event = events.find(item => item.id === id);
    setEvents(current => current.filter(item => item.id !== id));
    const linkedTaskId = event?.taskId ?? tasks.find(task => task.calendarEventId === id)?.id;
    if (linkedTaskId) setTasks(current => current.filter(task => task.id !== linkedTaskId));
    notify(linkedTaskId ? 'Event and linked task removed' : 'Event removed', 'warn');
  };
  const applyAssistantCommands = (plan: AssistantCommandPlan): string | undefined => {
    if (!plan.commands.length) return "No planner changes were proposed. Revise the request and try again.";
    const result = applyAssistantPlan(plan, { tasks, projects, events }, uid);
    if (!result.ok) return result.error;
    setTasks(result.snapshot.tasks);
    setProjects(result.snapshot.projects);
    setEvents(result.snapshot.events);
    notify(`${plan.commands.length} planner ${plan.commands.length === 1 ? 'change' : 'changes'} applied`);
    return undefined;
  };
  const saveProject = (draft: Omit<Project, 'id'>, id?: string) => {
    const normalizedDraft = { ...draft, progress: id ? projects.find(project => project.id === id)?.progress ?? 0 : 0 };
    if (id) setProjects(current => current.map(project => project.id === id ? { ...project, ...normalizedDraft } : project));
    else setProjects(current => [...current, { ...normalizedDraft, id: uid('project') }]);
    notify(id ? 'Project updated' : 'Project created');
  };
  const deleteProject = (id: string) => {
    setProjects(current => current.filter(project => project.id !== id));
    setTasks(current => current.map(task => task.projectId === id ? { ...task, projectId: undefined } : task));
    notify('Project removed; its tasks are still available', 'warn');
  };
  const replacePlannerData = (data: PlannerData) => {
    replacePlanner(data);
    notify('Planner data replaced');
  };
  const handleRemoveLocalPlanner = () => {
    const ok = removeLocalPlanner();
    if (ok) notify('Local planner removed from this browser', 'warn');
    return ok;
  };

  const [, setLocation] = useLocation();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (taskModal.open) setTaskModal({ open: false });
        else if (eventModal.open) setEventModal({ open: false });
        else if (search) setSearch('');
        return;
      }
      if (event.key.toLowerCase() !== 'q' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      event.preventDefault();
      setTaskModal({ open: true });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [taskModal.open, eventModal.open, search]);

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return [
      ...tasks.filter(task => task.title.toLowerCase().includes(query)).slice(0, 4).map(task => ({
        type: 'Task',
        label: task.title,
        meta: formatShortDate(task.dueDate),
        onSelect: () => { setSearch(''); setTaskModal({ open: true, task }); },
      })),
      ...projects.filter(project => `${project.name} ${project.description}`.toLowerCase().includes(query)).slice(0, 3).map(project => ({
        type: 'Project',
        label: project.name,
        meta: `${projectProgress(project, tasks)}% complete`,
        onSelect: () => { setSearch(''); setLocation('/projects'); },
      })),
    ];
  }, [projects, search, tasks, setLocation]);

  return (
    <div className="min-h-[100dvh] bg-background">
      <WorkspaceShell
        search={search}
        setSearch={setSearch}
        searchResults={searchResults}
        mobileNav={mobileNav}
        setMobileNav={setMobileNav}
        onQuickAdd={() => setTaskModal({ open: true })}
        accountName={accountName}
        accountEmail={accountEmail}
        accountImageUrl={accountImageUrl}
        isSignedIn={Boolean(isSignedIn)}
        guestMode={guestMode}
        onExitGuest={onExitGuest}
      >
        <>
          {storageSaveFailed && (
            <section
              role="status"
              aria-live="polite"
              className="mb-6 flex flex-col gap-3 rounded-xl border border-[#e7b2a9] bg-[#fff2ef] p-4 text-[#713a34] sm:flex-row sm:items-center sm:justify-between"
              data-testid="storage-save-warning"
            >
              <div className="flex min-w-0 items-start gap-3">
                <CircleAlert size={18} className="mt-0.5 shrink-0 text-[#9d473d]" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold">Your latest changes could not be saved</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    {storageRollbackFailed
                      ? 'Your changes are still available in this tab, but browser storage could not be restored to its previous state. Download a copy now or try saving again.'
                      : 'Your changes are still available in this tab, but may be lost if you leave or reload. Check browser storage, download a copy, or try saving again.'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={downloadPlannerCopy}
                  className="rounded-lg border border-[#d9a49c] bg-white px-3 py-2 text-xs font-bold hover:bg-[#fff9f7]"
                  data-testid="button-download-storage-copy"
                >
                  Download a copy
                </button>
                <button
                  type="button"
                  onClick={retryStorageSave}
                  className="rounded-lg bg-[#9d473d] px-3 py-2 text-xs font-bold text-white hover:opacity-90"
                  data-testid="button-retry-storage-save"
                >
                  Try saving again
                </button>
              </div>
            </section>
          )}
          {downloadFailed && (
            <section
              role="alert"
              className="mb-6 flex flex-col gap-3 rounded-xl border border-[#e7b2a9] bg-[#fff2ef] p-4 text-[#713a34] sm:flex-row sm:items-center sm:justify-between"
              data-testid="download-error-banner"
            >
              <div className="flex min-w-0 items-start gap-3">
                <CircleAlert size={18} className="mt-0.5 shrink-0 text-[#9d473d]" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold">Your planner copy could not be downloaded</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    Check your browser’s download settings and try again, or keep this tab open while resolving storage issues.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={downloadPlannerCopy}
                  className="rounded-lg bg-[#9d473d] px-3 py-2 text-xs font-bold text-white hover:opacity-90"
                  data-testid="button-retry-download-copy"
                >
                  Try download again
                </button>
                <button
                  type="button"
                  onClick={() => setDownloadFailed(false)}
                  className="rounded-lg border border-[#d9a49c] bg-white px-3 py-2 text-xs font-bold hover:bg-[#fff9f7]"
                  data-testid="button-dismiss-download-error"
                >
                  Dismiss
                </button>
              </div>
            </section>
          )}
          <Switch>
            <Route path="/">{() => <Dashboard tasks={tasks} projects={projects} events={events} onToggle={toggleTask} onAdd={() => setTaskModal({ open: true })} focusMode={focusMode} compactRows={dense} weekStart={weekStart} />}</Route>
            <Route path="/tasks">{() => <TasksView tasks={tasks} onToggle={toggleTask} onDelete={deleteTask} onEdit={task => setTaskModal({ open: true, task })} onAdd={() => setTaskModal({ open: true })} compactRows={dense} />}</Route>
            <Route path="/assistant">{() => <div className="animate-in space-y-5">
              <PageIntro eyebrow="Your AI · your planner" title="Give your planner a command." description="Connect OpenAI or Anthropic, describe what should change, then review every proposed edit before applying it." />
              <AICommandPanel
                provider={assistantProvider}
                apiKey={assistantApiKey}
                onProviderChange={setAssistantProvider}
                onApiKeyChange={setAssistantApiKey}
                tasks={assistantTasks}
                projects={assistantProjects}
                events={assistantEvents}
                weekStart={weekStart}
                onApply={applyAssistantCommands}
              />
            </div>}</Route>
            <Route path="/calendar">{() => <CalendarView
              events={events}
              tasks={tasks}
              onAdd={(date, minutes) => setEventModal({ open: true, date, minutes })}
              onEditEvent={event => setEventModal({ open: true, date: event.date, minutes: event.startMinutes, event })}
              onEditTask={task => setTaskModal({ open: true, task })}
              onDelete={deleteEvent}
              weekStart={weekStart}
            />}</Route>
            <Route path="/projects">{() => <ProjectsView projects={projects} tasks={tasks} onSave={saveProject} onDelete={deleteProject} onAddTask={projectId => setTaskModal({ open: true, projectId })} />}</Route>
            <Route path="/settings">{() => <SettingsView accountName={accountName} accountEmail={accountEmail} accountImageUrl={accountImageUrl} isSignedIn={Boolean(isSignedIn)} guestMode={guestMode} focusMode={focusMode} setFocusMode={setFocusMode} compactRows={dense} setCompactRows={setDense} weekStart={weekStart} setWeekStart={setWeekStart} onDownload={downloadPlannerCopy} downloadFailed={downloadFailed} onImport={replacePlannerData} onRemoveLocalPlanner={handleRemoveLocalPlanner} mcpUrl={mcpUrl} onPlannerChanged={refreshFromServer} />}</Route>
            <Route>{() => <NotFoundView />}</Route>
          </Switch>
        </>
      </WorkspaceShell>
      {taskModal.open && <TaskModal task={taskModal.task} projects={projects} initialDate={taskModal.date} initialProjectId={taskModal.projectId} onClose={() => setTaskModal({ open: false })} onSave={saveTask} />}
      {eventModal.open && <EventModal event={eventModal.event} hasLinkedTask={Boolean(eventModal.event && (eventModal.event.taskId || tasks.some(task => task.calendarEventId === eventModal.event?.id)))} date={eventModal.date ?? dayKey(today)} minutes={eventModal.minutes ?? 9 * 60} onClose={() => setEventModal({ open: false })} onSave={saveEvent} />}
      {toast && <div className={`fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-3 text-sm font-semibold shadow-xl animate-pop ${toast.tone === 'warn' ? 'border-[#e7b2a9] bg-[#fff2ef] text-[#9d473d]' : 'border-[#a9d3c8] bg-[#e9f6f1] text-[#236d60]'}`} data-testid="status-toast"><CheckCircle2 size={16} />{toast.text}</div>}
    </div>
  );
}

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare2 },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/assistant', label: 'AI Console', icon: Command },
];

function WorkspaceShell({ children, search, setSearch, searchResults, mobileNav, setMobileNav, onQuickAdd, accountName, accountEmail, accountImageUrl, isSignedIn, guestMode, onExitGuest }: {
  children: ReactNode; search: string; setSearch: (value: string) => void; searchResults: { type: string; label: string; meta: string; onSelect: () => void }[];
  mobileNav: boolean; setMobileNav: (value: boolean) => void; onQuickAdd: () => void;
  accountName: string; accountEmail: string; accountImageUrl?: string; isSignedIn: boolean; guestMode: boolean; onExitGuest?: () => void;
}) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const firstName = accountName.split(/\s+/)[0];
  const pageTitle = location === '/' ? (isSignedIn ? `Good morning, ${firstName}` : 'Good morning') : navItems.find(item => item.href === location)?.label ?? 'Workspace';
  return (
    <div className="flex min-h-[100dvh]">
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-300 lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`} data-testid="sidebar">
        <div className="mb-8 flex items-center justify-between px-3">
          <Link href="/" onClick={() => setMobileNav(false)} className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg"><Target size={19} strokeWidth={2.5} /></span>
            <span className="font-display text-[19px] font-bold tracking-[-.04em]">Productivio</span>
          </Link>
          <button className="text-sidebar-foreground/60 lg:hidden" onClick={() => setMobileNav(false)} data-testid="button-close-mobile-nav"><X size={18} /></button>
        </div>
        <button onClick={onQuickAdd} className="mb-7 flex items-center justify-between rounded-xl bg-sidebar-primary px-3.5 py-3 text-sm font-bold text-sidebar-primary-foreground transition-transform hover:-translate-y-0.5 active:translate-y-0" data-testid="button-sidebar-quick-add">
          <span className="flex items-center gap-2"><Plus size={17} />Quick add</span><span className="rounded-md bg-sidebar-primary-foreground/15 px-1.5 py-0.5 font-mono-custom text-[10px]">Q</span>
        </button>
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-sidebar-foreground/45">Workspace</p>
        <nav className="space-y-1" aria-label="Main navigation">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = location === item.href;
            return <Link key={item.href} href={item.href} onClick={() => setMobileNav(false)} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/63 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`} data-testid={`link-nav-${item.label.toLowerCase()}`}>
              <Icon size={17} className={active ? 'text-sidebar-primary' : 'text-sidebar-foreground/45 group-hover:text-sidebar-primary'} />{item.label}
            </Link>;
          })}
        </nav>
        <p className="mb-2 mt-8 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-sidebar-foreground/45">Account</p>
        <Link href="/settings" onClick={() => setMobileNav(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${location === '/settings' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/63 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`} data-testid="link-nav-settings"><Settings size={17} className="text-sidebar-foreground/45" />Settings</Link>
        <div className="mt-auto">
           <div className="flex items-center gap-2 border-t border-sidebar-border pt-4">
             <AccountAvatar name={accountName} imageUrl={accountImageUrl} size="h-9 w-9" />
             <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{accountName}</p><p className="truncate text-[11px] text-sidebar-foreground/45">{accountEmail || (isSignedIn ? 'No email on account' : 'Student account')}</p></div>
              {guestMode ? (
                <>
                  <Link
                    href="/sign-in"
                    aria-label="Sign in to an account"
                    title="Sign in to an account"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    data-testid="link-guest-sign-in"
                  >
                    <LogIn size={16} />
                  </Link>
                  <button
                    type="button"
                    onClick={onExitGuest}
                    aria-label="Leave guest mode"
                    title="Leave guest mode. Your planner stays saved in this browser."
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    data-testid="button-leave-guest"
                  >
                    <LogOut size={16} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })}
                  aria-label="Sign out"
                  title="Sign out"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  data-testid="button-sign-out"
                >
                  <LogOut size={16} />
                </button>
              )}
          </div>
        </div>
      </aside>
      {mobileNav && <button aria-label="Close navigation" onClick={() => setMobileNav(false)} className="fixed inset-0 z-40 bg-[#17212f]/45 lg:hidden" data-testid="button-nav-backdrop" />}
      <main className="min-w-0 flex-1 lg:ml-[252px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md sm:px-8 lg:px-10" data-testid="top-header">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileNav(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary lg:hidden" data-testid="button-open-mobile-nav"><Menu size={20} /></button>
            <div><p className="font-mono-custom text-[10px] uppercase tracking-[.13em] text-muted-foreground">{location === '/' ? today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'Your workspace'}</p><h1 className="font-display text-xl font-bold tracking-[-.04em] sm:text-2xl" data-testid="text-active-title">{pageTitle}</h1></div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="relative hidden w-[230px] md:block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search workspace" className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-10 text-xs outline-none transition-colors placeholder:text-muted-foreground/75 focus:border-primary/50 focus:ring-2 focus:ring-primary/10" data-testid="input-global-search" />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 py-0.5 font-mono-custom text-[9px] text-muted-foreground"><Command size={10} /></span>
              {search && <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-xl animate-pop" data-testid="search-results">
                {searchResults.length ? searchResults.map((result, index) => <button type="button" key={`${result.type}-${index}`} onClick={result.onSelect} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-secondary" data-testid={`button-search-result-${index}`}><span className="flex items-center gap-2 text-xs font-semibold"><span className="rounded bg-secondary px-1.5 py-1 text-[9px] font-mono-custom text-muted-foreground">{result.type}</span>{result.label}</span><span className="text-[10px] text-muted-foreground">{result.meta}</span></button>) : <p className="px-3 py-4 text-center text-xs text-muted-foreground">No matches in your workspace.</p>}
              </div>}
            </div>
             <Link href="/settings" aria-label="Open settings" className="grid h-10 w-10 place-items-center rounded-full bg-secondary font-display text-xs font-bold text-primary" data-testid="button-profile"><AccountAvatar name={accountName} imageUrl={accountImageUrl} size="h-10 w-10" /></Link>
          </div>
        </header>
        <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">{children}</div>
      </main>
    </div>
  );
}

function AccountAvatar({ name, imageUrl, size }: { name: string; imageUrl?: string; size: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'S';
  return <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#e9ad8f] font-display text-xs font-bold text-[#3d2b2e] ${size}`}>
    {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : initials}
  </span>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div><p className="mb-2 flex items-center gap-2 font-mono-custom text-[10px] font-medium uppercase tracking-[.16em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{eyebrow}</p><h2 className="font-display text-3xl font-bold tracking-[-.055em] sm:text-[38px]">{title}</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p></div>
    {action}
  </div>;
}

function Dashboard({ tasks, projects, events, onToggle, onAdd, focusMode, compactRows, weekStart }: { tasks: Task[]; projects: Project[]; events: CalendarEvent[]; onToggle: (id: string) => void; onAdd: () => void; focusMode: boolean; compactRows: boolean; weekStart: WeekStart }) {
  const pending = tasks.filter(task => !task.completed);
  const todayKey = dayKey(today);
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const upcomingEvents = [...events]
    .filter(event => event.date > todayKey || event.date === todayKey && event.endMinutes > nowMinutes)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
    .slice(0, 3);
  const weekStartDate = getWeekStart(today, weekStart);
  const weekStartKey = dayKey(weekStartDate);
  const weekEndKey = dayKey(addDays(weekStartDate, 6));
  const dueThisWeek = tasks.filter(task => task.dueDate >= weekStartKey && task.dueDate <= weekEndKey);
  const openDueThisWeek = dueThisWeek.filter(task => !task.completed).length;
  const completedDueThisWeek = dueThisWeek.filter(task => task.completed).length;
  const progress = projects.length ? Math.round(projects.reduce((sum, project) => sum + projectProgress(project, tasks), 0) / projects.length) : 0;
  const orderedPending = pending.slice().sort((left, right) => left.dueDate.localeCompare(right.dueDate) || (left.priority === 'high' ? -1 : right.priority === 'high' ? 1 : 0));
  const overdueTasks = orderedPending.filter(task => task.dueDate < todayKey);
  const upcomingPending = orderedPending.filter(task => task.dueDate >= todayKey);
  const focus = focusMode
    ? upcomingPending.filter(task => task.dueDate <= todayKey || task.priority === 'high').slice(0, 4)
    : upcomingPending.slice(0, 8);
  const weekLabel = `${weekStart === 'sunday' ? 'Sunday' : 'Monday'} start · ${formatShortDate(weekStartKey)} – ${formatShortDate(weekEndKey)}`;
  return <div className="animate-in">
    <PageIntro eyebrow={weekLabel} title="Make room for good work." description="Here’s the shape of your day. Keep the important things close, and let the rest wait." action={<button onClick={onAdd} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 active:translate-y-0" data-testid="button-dashboard-add-task"><Plus size={17} />Add a task</button>} />
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Tasks due this week" value={String(dueThisWeek.length)} detail={`${openDueThisWeek} still open`} icon={<ListTodo size={18} />} accent="teal" testId="metric-tasks" />
      <MetricCard label="Upcoming events" value={String(events.length)} detail="Across 5 days" icon={<CalendarDays size={18} />} accent="gold" testId="metric-events" />
      <MetricCard label="Project progress" value={`${progress}%`} detail="Average across projects" icon={<BarChart3 size={18} />} accent="coral" testId="metric-progress" />
      <MetricCard label="Completed tasks due this week" value={String(completedDueThisWeek)} detail="From this week’s workload" icon={<CheckCircle2 size={18} />} accent="lilac" testId="metric-completed" />
    </section>
    {overdueTasks.length > 0 && (
      <section className="mt-5" data-testid="dashboard-overdue-section">
        <div className="surface rounded-2xl border border-[#e7b2a9] bg-[#fff7f5] p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="font-mono-custom text-[10px] uppercase tracking-[.14em] text-[#9d473d]">Needs attention · {overdueTasks.length} overdue</p>
              <h3 className="mt-1 font-display text-xl font-bold tracking-[-.035em] text-[#713a34]">Overdue work</h3>
            </div>
            <Link href="/tasks" className="flex items-center gap-1 text-xs font-bold text-[#9d473d] hover:underline" data-testid="link-overdue-all-tasks">View all <ArrowUpRight size={14} /></Link>
          </div>
          <div className="space-y-1">
            {overdueTasks.map(task => <TaskRow key={task.id} task={task} onToggle={onToggle} compactRows={compactRows} overdue />)}
          </div>
        </div>
      </section>
    )}
    <section className="mt-5" data-testid="dashboard-upcoming-section">
      <div className="surface rounded-2xl p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between"><div><p className="font-mono-custom text-[10px] uppercase tracking-[.14em] text-muted-foreground">{focusMode ? 'A small, honest list' : 'Your upcoming work'}</p><h3 className="mt-1 font-display text-xl font-bold tracking-[-.035em]">{focusMode ? 'Today’s focus' : 'Next up'}</h3></div><Link href="/tasks" className="flex items-center gap-1 text-xs font-bold text-primary hover:underline" data-testid="link-view-all-tasks">View all <ArrowUpRight size={14} /></Link></div>
        <div className="space-y-1">
          {focus.map(task => <TaskRow key={task.id} task={task} onToggle={onToggle} compactRows={compactRows} />)}
          {!focus.length && <EmptyState icon={<CheckCircle2 size={22} />} title="Clear runway" text="Nothing urgent is asking for your attention." />}
        </div>
        <button onClick={onAdd} className="mt-4 flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" data-testid="button-focus-add"><Plus size={15} /> Add another focus item</button>
      </div>
    </section>
    <section className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <div className="surface rounded-2xl p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="font-mono-custom text-[10px] uppercase tracking-[.14em] text-muted-foreground">Keep an eye on them</p><h3 className="mt-1 font-display text-xl font-bold tracking-[-.035em]">Project health</h3></div><Link href="/projects" className="text-xs font-bold text-primary hover:underline" data-testid="link-view-projects">All projects</Link></div><div className="grid gap-3 sm:grid-cols-3">{projects.map(project => <ProjectMini key={project.id} project={project} tasks={tasks} />)}</div></div>
      <div className="surface rounded-2xl p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between"><div><p className="font-mono-custom text-[10px] uppercase tracking-[.14em] text-muted-foreground">Right now</p><h3 className="mt-1 font-display text-xl font-bold tracking-[-.035em]">Your schedule</h3></div><Link href="/calendar" className="text-xs font-bold text-primary hover:underline" data-testid="link-view-calendar">Open calendar</Link></div>
        {upcomingEvents.length
          ? upcomingEvents.map(event => <div key={event.id} className="flex items-center gap-3 border-b border-border py-3 last:border-0"><span className={`h-2 w-2 rounded-full ${event.color === 'coral' ? 'bg-accent' : event.color === 'gold' ? 'bg-[#d7aa50]' : event.color === 'lilac' ? 'bg-[#9f8bc0]' : 'bg-primary'}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{event.title}</p><p className="mt-0.5 font-mono-custom text-[10px] text-muted-foreground">{formatShortDate(event.date)} · {formatTime(event.startMinutes)} — {formatTime(event.endMinutes)}</p></div><Clock3 size={15} className="text-muted-foreground" /></div>)
          : <p className="py-4 text-xs text-muted-foreground">Nothing scheduled ahead. Add an event from your calendar.</p>}
      </div>
    </section>
    <section className="mt-5">
      <Link href="/assistant" className="relative block overflow-hidden rounded-2xl bg-[#202c3b] p-6 text-[#f5f0e6] transition-transform hover:-translate-y-0.5 sm:p-7" data-testid="link-dashboard-ai-console"><div className="absolute right-[-30px] top-[-40px] h-40 w-40 rounded-full border-[22px] border-[#6fbaaa]/20" /><div className="relative max-w-lg"><span className="mb-5 flex items-center gap-2 text-xs font-bold text-[#9ed6c5]"><Command size={15} />Your AI, your planner</span><h3 className="font-display text-2xl font-bold leading-tight tracking-[-.04em] sm:text-3xl">Make planner changes with your own AI.</h3><p className="mt-3 max-w-md text-sm leading-relaxed text-[#c5d0cf]">Connect OpenAI or Anthropic, describe what should change, and review every proposed command before it updates your tasks, projects, or calendar.</p><span className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#f2c59d] px-4 py-2.5 text-xs font-bold text-[#3c3030]">Open AI command panel <ArrowUpRight size={14} /></span></div></Link>
    </section>
  </div>;
}

function MetricCard({ label, value, detail, icon, accent, testId }: { label: string; value: string; detail: string; icon: ReactNode; accent: string; testId: string }) {
  const colors: Record<string, string> = { teal: 'bg-[#d8eee7] text-[#287867]', gold: 'bg-[#f6eacb] text-[#98732f]', coral: 'bg-[#fae0d5] text-[#ab5c46]', lilac: 'bg-[#e8e0f3] text-[#715995]' };
  return <div className="surface rounded-2xl p-5 transition-transform hover:-translate-y-0.5" data-testid={testId}><div className="flex items-start justify-between"><span className={`grid h-9 w-9 place-items-center rounded-xl ${colors[accent]}`}>{icon}</span><span className="font-mono-custom text-[10px] text-muted-foreground">This week</span></div><p className="mt-5 text-xs font-semibold text-muted-foreground">{label}</p><div className="mt-1 flex items-end justify-between"><span className="font-display text-3xl font-bold tracking-[-.05em]">{value}</span><span className="mb-1 text-[10px] text-muted-foreground">{detail}</span></div></div>;
}

function TaskRow({ task, onToggle, onDelete, onEdit, compactRows = false, overdue = false }: { task: Task; onToggle: (id: string) => void; onDelete?: (id: string) => void; onEdit?: (task: Task) => void; compactRows?: boolean; overdue?: boolean }) {
  return <div className={`group flex items-center gap-3 rounded-xl px-2 ${compactRows ? 'py-1.5' : 'py-3'} transition-colors hover:bg-secondary/70 ${task.completed ? 'opacity-55' : ''}`} data-testid={`row-task-${task.id}`}>
    <button onClick={() => onToggle(task.id)} className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-all ${task.completed ? 'border-primary bg-primary text-primary-foreground' : 'border-[#abc9c0] text-transparent hover:border-primary'}`} data-testid={`button-toggle-task-${task.id}`} aria-label={task.completed ? 'Reopen task' : 'Complete task'}>{task.completed && <Check size={12} strokeWidth={3} />}</button>
    <div className="min-w-0 flex-1"><p className={`truncate text-xs font-semibold ${task.completed ? 'line-through' : ''}`}>{task.title}</p><div className="mt-1 flex items-center gap-2"><span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{task.category}</span>{overdue && !task.completed && <span className="rounded bg-[#fae0d5] px-1.5 py-0.5 text-[9px] font-bold text-[#9d473d]">Overdue</span>}<span className={`font-mono-custom text-[9px] ${task.priority === 'high' ? 'text-[#b85d4b]' : task.priority === 'medium' ? 'text-[#9b762d]' : 'text-muted-foreground'}`}>{task.priority} priority</span></div></div>
    <span className={`hidden shrink-0 font-mono-custom text-[10px] sm:block ${overdue && !task.completed ? 'font-bold text-[#9d473d]' : 'text-muted-foreground'}`}>{formatShortDate(task.dueDate)}</span>
    {(onDelete || onEdit) && <div className="flex gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"><button onClick={() => onEdit?.(task)} className="rounded-md p-1.5 text-muted-foreground hover:bg-card hover:text-foreground" data-testid={`button-edit-task-${task.id}`}><Pencil size={13} /></button><button onClick={() => onDelete?.(task.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-[#fff0ed] hover:text-destructive" data-testid={`button-delete-task-${task.id}`}><Trash2 size={13} /></button></div>}
  </div>;
}

function TasksView({ tasks, onToggle, onDelete, onEdit, onAdd, compactRows }: { tasks: Task[]; onToggle: (id: string) => void; onDelete: (id: string) => void; onEdit: (task: Task) => void; onAdd: () => void; compactRows: boolean }) {
  const [filter, setFilter] = useState<'all' | 'open' | 'completed'>('all');
  const [priority, setPriority] = useState<'all' | Priority>('all');
  const visible = tasks.filter(task => filter === 'all' || filter === 'open' && !task.completed || filter === 'completed' && task.completed).filter(task => priority === 'all' || task.priority === priority);
  return <div className="animate-in"><PageIntro eyebrow="Task manager" title="Everything in its place." description="A flexible list for the things you want out of your head and into the week." action={<button onClick={onAdd} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5" data-testid="button-task-add"><Plus size={17} />New task</button>} />
    <div className="surface overflow-hidden rounded-2xl"><div className="flex flex-col justify-between gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:px-6"><div className="flex items-center gap-1 rounded-xl bg-secondary p-1">{(['all', 'open', 'completed'] as const).map(option => <button key={option} onClick={() => setFilter(option)} className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition-colors ${filter === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} data-testid={`button-filter-${option}`}>{option}{option === 'open' && <span className="ml-1.5 font-mono-custom text-[10px] text-primary">{tasks.filter(task => !task.completed).length}</span>}</button>)}</div><div className="flex items-center gap-2"><SlidersHorizontal size={15} className="text-muted-foreground" /><select value={priority} onChange={event => setPriority(event.target.value as typeof priority)} className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs font-semibold outline-none" data-testid="select-task-priority"><option value="all">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select><button type="button" onClick={() => { setFilter('all'); setPriority('all'); }} disabled={filter === 'all' && priority === 'all'} aria-label="Reset task filters" title="Reset task filters" className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-secondary disabled:opacity-40" data-testid="button-task-filter"><Filter size={15} /></button></div></div><div className="p-3 sm:p-5">{visible.length ? visible.map(task => <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} compactRows={compactRows} />) : <EmptyState icon={<ListTodo size={22} />} title="Nothing here yet" text="Try another view or add a fresh task." action={onAdd} />}</div><div className="flex items-center justify-between border-t border-border bg-secondary/45 px-5 py-3 text-[10px] text-muted-foreground"><span>{visible.length} {visible.length === 1 ? 'task' : 'tasks'} showing</span><span className="font-mono-custom">{tasks.filter(task => task.completed).length}/{tasks.length} complete</span></div></div>
  </div>;
}

const formatTime = (minutes: number) => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
};

function CalendarView({
  events, tasks, onAdd, onEditEvent, onEditTask, onDelete, weekStart,
}: {
  events: CalendarEvent[];
  tasks: Task[];
  onAdd: (date: string, minutes: number) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onEditTask: (task: Task) => void;
  onDelete: (id: string) => void;
  weekStart: WeekStart;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const hours = Array.from({ length: 11 }, (_, index) => index + 9);
  const days = weekStart === 'sunday' ? [7, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7];
  const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const currentDay = today.getDay() === 0 ? 7 : today.getDay();
  const firstDate = getWeekStart(addDays(today, weekOffset * 7), weekStart);
  const lastDate = addDays(firstDate, 6);
  const dateForColumn = (day: number) => dateForWeekday(day, weekStart, firstDate);
  const weekLabel = `Week of ${formatShortDate(dayKey(firstDate))} — ${formatShortDate(dayKey(lastDate))}`;
  const calendarStart = 9 * 60;
  const hourHeight = 72;
  const calendarHeight = hours.length * hourHeight;
  const eventColors: Record<string, string> = {
    coral: 'border-[#cf795d] bg-[#fae0d5] text-[#854937]',
    gold: 'border-[#c39a43] bg-[#f6eacb] text-[#80621f]',
    lilac: 'border-[#9077b6] bg-[#e8e0f3] text-[#5d4c7e]',
    teal: 'border-[#4f9e8a] bg-[#d8eee7] text-[#236d60]',
  };

  return <div className="animate-in">
    <PageIntro
      eyebrow={weekLabel}
      title="Make time visible."
      description="Tasks appear on their due dates; scheduled events stay linked to those tasks."
      action={<div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
          <button onClick={() => setWeekOffset(offset => offset - 1)} className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Previous week" data-testid="button-calendar-previous-week">←</button>
          <button onClick={() => setWeekOffset(0)} className="rounded-lg px-2.5 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid="button-calendar-today">Today</button>
          <button onClick={() => setWeekOffset(offset => offset + 1)} className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Next week" data-testid="button-calendar-next-week">→</button>
        </div>
        <button onClick={() => onAdd(weekOffset === 0 ? dayKey(today) : dateForColumn(days[0]), calendarStart)} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground" data-testid="button-calendar-add"><CalendarPlus size={17} />Add event</button>
      </div>}
    />
    <div className="surface overflow-x-auto rounded-2xl">
      <div className="min-w-[760px] p-4 sm:p-6">
        <div className="grid grid-cols-[62px_repeat(7,minmax(92px,1fr))] border-b border-border">
          <div />
          {days.map(day => {
            const date = dateForColumn(day);
            const isToday = date === dayKey(today);
            return <div key={day} className={`border-l border-border px-2 pb-3 text-center ${isToday ? 'text-primary' : ''}`}>
              <p className="font-mono-custom text-[9px] font-medium tracking-[.15em]">{dayNames[day - 1]}</p>
              <p className={`mx-auto mt-1 grid h-8 w-8 place-items-center rounded-full font-display text-sm font-bold ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>{Number(date.slice(-2))}</p>
            </div>;
          })}
        </div>
        <div className="grid grid-cols-[62px_repeat(7,minmax(92px,1fr))] border-b border-border">
          <div className="px-1 py-2 font-mono-custom text-[8px] font-bold uppercase tracking-wide text-muted-foreground">Tasks due</div>
          {days.map(day => {
            const date = dateForColumn(day);
            const dueTasks = tasks.filter(task =>
              task.dueDate === date &&
              !events.some(event => event.id === task.calendarEventId || event.taskId === task.id)
            );
            return <div key={day} className="min-h-12 border-l border-border/70 px-1 py-1">
              {dueTasks.length
                ? <div className="space-y-1">
                    {dueTasks.slice(0, 3).map(task => <button key={task.id} onClick={() => onEditTask(task)} title={`Edit task: ${task.title}`} className={`flex w-full min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-1 text-left text-[9px] font-semibold ${task.completed ? 'bg-secondary text-muted-foreground line-through' : 'bg-[#fff1e8] text-[#8b523e] hover:bg-[#fbe4d7]'}`} data-testid={`button-calendar-due-task-${task.id}`}>
                      {task.completed && <Check size={10} className="shrink-0" />}
                      <span className="truncate">{task.title}</span>
                    </button>)}
                    {dueTasks.length > 3 && <p className="px-1 text-[8px] text-muted-foreground">+{dueTasks.length - 3} more</p>}
                  </div>
                : <span className="px-1 text-[9px] text-muted-foreground/50">—</span>}
            </div>;
          })}
        </div>
        <div className="grid grid-cols-[62px_repeat(7,minmax(92px,1fr))]">
          <div className="relative" style={{ height: calendarHeight }}>
            {hours.map(hour => <span key={hour} className="absolute right-3 font-mono-custom text-[9px] text-muted-foreground" style={{ top: (hour - 9) * hourHeight + 8 }}>{formatTime(hour * 60)}</span>)}
          </div>
          {days.map(day => {
            const date = dateForColumn(day);
            return <div key={day} className="relative border-l border-border/70" style={{ height: calendarHeight }}>
              {hours.map(hour => <button key={`${date}-${hour}`} onClick={() => onAdd(date, hour * 60)} className="absolute inset-x-0 border-b border-border/70 text-left transition-colors hover:bg-secondary/65" style={{ top: (hour - 9) * hourHeight, height: hourHeight }} data-testid={`button-calendar-slot-${day}-${hour}`} aria-label={`Add event on ${dayNames[day - 1]} at ${formatTime(hour * 60)}`} />)}
              {events.filter(event => event.date === date).map(event => {
                const top = ((event.startMinutes - calendarStart) / 60) * hourHeight;
                const height = Math.max(((event.endMinutes - event.startMinutes) / 60) * hourHeight, 28);
                const linkedTask = tasks.find(task => task.id === event.taskId || task.calendarEventId === event.id);
                return <div key={event.id} className="group absolute inset-x-1 z-10" style={{ top, height }}>
                  <button onClick={() => onEditEvent(event)} className={`absolute inset-0 flex flex-col justify-center overflow-hidden rounded-lg border-l-[3px] px-2 py-1 pr-7 text-left text-[10px] font-bold shadow-sm transition-transform hover:-translate-y-0.5 ${eventColors[event.color] ?? eventColors.teal}`} title={linkedTask ? 'Edit event and linked task' : 'Edit event'} data-testid={`button-calendar-event-${event.id}`}>
                    <span className={`truncate ${linkedTask?.completed ? 'line-through opacity-70' : ''}`}>{event.title}</span>
                    <small className="mt-1 font-mono-custom text-[8px] font-normal opacity-70">{formatTime(event.startMinutes)} — {formatTime(event.endMinutes)}{linkedTask?.completed ? ' · complete' : ''}</small>
                  </button>
                  <button onClick={() => onDelete(event.id)} className="absolute right-1 top-1 z-20 grid h-5 w-5 place-items-center rounded-md bg-card/80 text-muted-foreground hover:bg-card hover:text-destructive" aria-label={`Remove ${event.title}${linkedTask ? ' and linked task' : ''}`} title={linkedTask ? 'Remove event and linked task' : 'Remove event'} data-testid={`button-remove-calendar-event-${event.id}`}><Trash2 size={10} /></button>
                </div>;
              })}
            </div>;
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-6 py-3 font-mono-custom text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />Scheduled event</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-accent" />Task due</span>
        <span className="ml-auto">Click a task or event to edit; removing a linked event removes its task.</span>
      </div>
    </div>
  </div>;
}

function ProjectsView({ projects, tasks, onSave, onDelete, onAddTask }: {
  projects: Project[];
  tasks: Task[];
  onSave: (draft: Omit<Project, 'id'>, id?: string) => void;
  onDelete: (id: string) => void;
  onAddTask: (projectId: string) => void;
}) {
  const [editing, setEditing] = useState<Project | null>(null);
  const averageProgress = projects.length ? Math.round(projects.reduce((sum, project) => sum + projectProgress(project, tasks), 0) / projects.length) : 0;
  return <div className="animate-in"><PageIntro eyebrow="Project tracking" title="The bigger picture." description="Give your longer arcs a little attention, too. Progress is calculated from the tasks you assign to each project." action={<button onClick={() => setEditing({ id: '', name: '', description: '', progress: 0, status: 'on-track' })} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground" data-testid="button-project-add"><Plus size={17} />New project</button>} />
    <div className="grid gap-4 xl:grid-cols-3">{projects.map((project, index) => {
      const projectTasks = tasks.filter(task => task.projectId === project.id);
      const progress = projectProgress(project, tasks);
      const status = projectStatus(project, tasks);
      return <div key={project.id} className={`surface group rounded-2xl p-5 transition-transform hover:-translate-y-1 animate-in stagger-${(index % 4) + 1}`} data-testid={`card-project-${project.id}`}>
        <div className="flex items-start justify-between"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${status === 'on-track' ? 'bg-[#d8eee7] text-[#287867]' : status === 'at-risk' ? 'bg-[#fae0d5] text-[#a45442]' : 'bg-[#e8e0f3] text-[#715995]'}`}>{status === 'on-track' ? 'On track' : status === 'at-risk' ? 'Needs attention' : 'Completed'}</span><div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"><button onClick={() => setEditing(project)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid={`button-edit-project-${project.id}`} aria-label={`Edit ${project.name}`}><Pencil size={14} /></button><button onClick={() => onDelete(project.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-[#fae0d5] hover:text-[#a45442]" data-testid={`button-delete-project-${project.id}`} aria-label={`Remove ${project.name}`} title="Remove project"><Trash2 size={14} /></button></div></div>
        <div className="mt-7"><h3 className="font-display text-xl font-bold tracking-[-.04em]">{project.name}</h3><p className="mt-2 min-h-[40px] text-xs leading-relaxed text-muted-foreground">{project.description}</p></div>
        <div className="mt-7 flex items-end justify-between"><span className="font-mono-custom text-[10px] uppercase tracking-[.12em] text-muted-foreground">Progress</span><span className="font-display text-2xl font-bold">{progress}<small className="text-sm text-muted-foreground">%</small></span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${status === 'at-risk' ? 'bg-accent' : status === 'completed' ? 'bg-[#9f8bc0]' : 'bg-primary'}`} style={{ width: `${progress}%` }} /></div>
        <div className="mt-4 flex items-center justify-between gap-3"><span className="text-[10px] text-muted-foreground">{projectTasks.filter(task => task.completed).length} of {projectTasks.length} tasks complete</span><button onClick={() => onAddTask(project.id)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold text-primary hover:bg-secondary" data-testid={`button-add-project-task-${project.id}`}><Plus size={13} />Add task</button></div>
      </div>;
    })}</div>
    {!projects.length && <EmptyState icon={<FolderKanban size={22} />} title="No projects yet" text="Create a project to group related tasks and watch its progress grow." action={() => setEditing({ id: '', name: '', description: '', progress: 0, status: 'on-track' })} />}
    <div className="mt-5 surface rounded-2xl p-5 sm:p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f6eacb] text-[#98732f]"><Target size={18} /></span><div><h3 className="font-display font-bold">A note on momentum</h3><p className="text-xs text-muted-foreground">Your average project progress is {averageProgress}%. Add and complete tasks to move it forward.</p></div></div></div>
    {editing && <ProjectModal project={editing.id ? editing : undefined} onClose={() => setEditing(null)} onSave={(draft, id) => { onSave(draft, id); setEditing(null); }} />}
  </div>;
}

function SettingsView({ accountName, accountEmail, accountImageUrl, isSignedIn, guestMode, focusMode, setFocusMode, compactRows, setCompactRows, weekStart, setWeekStart, onDownload, downloadFailed, onImport, onRemoveLocalPlanner, mcpUrl, onPlannerChanged }: {
  accountName: string;
  accountEmail: string;
  accountImageUrl?: string;
  isSignedIn: boolean;
  guestMode: boolean;
  focusMode: boolean;
  setFocusMode: (value: boolean) => void;
  compactRows: boolean;
  setCompactRows: (value: boolean) => void;
  weekStart: WeekStart;
  setWeekStart: (value: WeekStart) => void;
  onDownload: () => boolean;
  downloadFailed: boolean;
  onImport: (data: PlannerData) => void;
  onRemoveLocalPlanner: () => boolean;
  mcpUrl: string;
  onPlannerChanged?: () => void;
}) {
  const [importPreview, setImportPreview] = useState<PlannerData | null>(null);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [removeSuccess, setRemoveSuccess] = useState('');
  const [removeError, setRemoveError] = useState('');

  const selectImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setImportError('');
    setImportSuccess('');
    if (file.size > 10 * 1024 * 1024) {
      setImportError('This file is larger than 10 MB. Choose a smaller Productivio planner file.');
      return;
    }
    try {
      const parsed = parsePlannerExport(JSON.parse(await file.text()));
      setImportPreview(parsed);
    } catch (error) {
      setImportPreview(null);
      setImportError(error instanceof Error ? error.message : 'This planner file could not be read.');
    }
  };

  const confirmImport = () => {
    if (!importPreview) return;
    onImport(importPreview);
    setImportPreview(null);
    setImportSuccess('Planner data imported. Your previous planner on this account was replaced.');
  };

  return <>
    <div className="animate-in max-w-4xl"><PageIntro eyebrow="Preferences" title="Make it feel like yours." description="A few thoughtful defaults, so opening Productivio feels familiar every time." /><div className="space-y-4">
     <SettingsSection icon={<UserRound size={18} />} title="Profile" note="Your signed-in student account"><div className="flex items-center gap-4"><AccountAvatar name={accountName} imageUrl={accountImageUrl} size="h-14 w-14 text-base" /><div className="min-w-0"><p className="text-sm font-bold">{accountName}</p><p className="text-xs text-muted-foreground">{accountEmail || (isSignedIn ? 'No email address on this account' : 'Sign in to view your account details')}</p></div></div></SettingsSection>
    <SettingsSection icon={<SlidersHorizontal size={18} />} title="Workspace defaults" note="Small details that shape your day"><SettingToggle label="Focus mode" description="Keep the dashboard list centered on urgent and high-priority tasks." value={focusMode} onChange={() => setFocusMode(!focusMode)} testId="toggle-focus-mode" /><SettingToggle label="Compact task rows" description="Fit more of your list on screen." value={compactRows} onChange={() => setCompactRows(!compactRows)} testId="toggle-dense-layout" /><div className="flex items-center justify-between border-t border-border py-4"><div><p className="text-sm font-bold">Week starts on</p><p className="mt-1 text-xs text-muted-foreground">Used by your calendar and weekly task summary.</p></div><select value={weekStart} onChange={event => setWeekStart(event.target.value as WeekStart)} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold outline-none" data-testid="select-week-start"><option value="monday">Monday</option><option value="sunday">Sunday</option></select></div></SettingsSection>
     {!guestMode && isSignedIn && <SettingsSection icon={<Bot size={18} />} title="AI assistants" note="ChatGPT, Claude, and other MCP apps"><AiIntegrationsSettings mcpUrl={mcpUrl} onPlannerChanged={onPlannerChanged} /></SettingsSection>}
     <SettingsSection icon={<ShieldCheck size={18} />} title="Your data" note="Saved in this browser">       <div className="flex items-center gap-3 rounded-xl bg-[#e9f6f1] p-4 text-[#236d60]"><LockKeyhole size={18} /><p className="text-xs leading-relaxed"><strong>Your planner is saved in this browser on this device.</strong> It is not backed up or synced. Clearing this browser’s site data removes it.</p></div>
       <div className="flex flex-col gap-3 border-t border-border py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold">Download a copy</p><p className="mt-1 text-xs text-muted-foreground">Save your tasks, calendar, projects, and preferences to a JSON file.</p></div><button type="button" onClick={onDownload} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:opacity-90" data-testid="button-download-planner"><FileDown size={16} />Download planner data</button></div>
       {downloadFailed && <p role="alert" className="rounded-lg bg-[#fff2ef] px-3 py-2 text-xs font-semibold text-[#9d473d]" data-testid="text-download-error">Your planner copy could not be downloaded. Check your browser’s download settings and try again.</p>}
       <div className="rounded-xl border border-[#ead8a8] bg-[#fff9e9] p-4 text-xs leading-relaxed text-[#765d2d]"><strong>Keep this file private.</strong> It may contain private study details, including task titles, project notes, and calendar events.</div>
       <div className="flex flex-col gap-3 border-t border-border py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold">Import a planner copy</p><p className="mt-1 text-xs text-muted-foreground">Choose a Productivio JSON file to validate it before replacing your current planner.</p></div><label className="flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground hover:bg-secondary" data-testid="label-import-planner"><Upload size={16} />Choose planner file<input type="file" accept=".json,application/json" onChange={selectImportFile} className="sr-only" aria-label="Choose a Productivio planner file" data-testid="input-import-planner" /></label></div>
       {importError && <p role="alert" className="rounded-lg bg-[#fff2ef] px-3 py-2 text-xs font-semibold text-[#9d473d]" data-testid="text-import-error">{importError}</p>}
       {importSuccess && <p role="status" className="rounded-lg bg-[#e9f6f1] px-3 py-2 text-xs font-semibold text-[#236d60]" data-testid="text-import-success">{importSuccess}</p>}
       {isSignedIn && !guestMode && (
         <div className="flex flex-col gap-3 border-t border-border py-4 sm:flex-row sm:items-center sm:justify-between">
           <div>
             <p className="text-sm font-bold">Remove planner from this browser</p>
             <p className="mt-1 text-xs text-muted-foreground">Delete only your saved planner data from this shared browser. Other student accounts and guest planners are not affected.</p>
           </div>
           <button
             type="button"
             onClick={() => {
               setRemoveSuccess('');
               setRemoveError('');
               setConfirmRemoveOpen(true);
             }}
             className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#e7b2a9] bg-[#fff2ef] px-4 py-2.5 text-xs font-bold text-[#9d473d] hover:bg-[#ffe7e2]"
             data-testid="button-remove-local-planner"
           >
             <Trash2 size={16} />Remove local planner
           </button>
         </div>
       )}
       {removeError && <p role="alert" className="rounded-lg bg-[#fff2ef] px-3 py-2 text-xs font-semibold text-[#9d473d]" data-testid="text-remove-local-error">{removeError}</p>}
       {removeSuccess && <p role="status" className="rounded-lg bg-[#e9f6f1] px-3 py-2 text-xs font-semibold text-[#236d60]" data-testid="text-remove-local-success">{removeSuccess}</p>}
     </SettingsSection>
   </div></div>
   {confirmRemoveOpen && <ModalShell title="Remove planner from this browser?" onClose={() => setConfirmRemoveOpen(false)}>
     <div className="space-y-4">
       <p className="text-sm leading-relaxed text-muted-foreground">This removes only your saved tasks, calendar events, projects, and preferences from this browser. Other student accounts and guest planners stay intact.</p>
       <p className="text-xs font-semibold text-[#9d473d]">Download a copy first if you want to keep a backup.</p>
       <div className="flex justify-end gap-2 border-t border-border pt-4">
         <button type="button" onClick={() => setConfirmRemoveOpen(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary" data-testid="button-cancel-remove-local-planner">Cancel</button>
         <button type="button" onClick={() => {
           const ok = onRemoveLocalPlanner();
           setConfirmRemoveOpen(false);
           if (ok) setRemoveSuccess('Your locally stored planner was removed from this browser.');
           else setRemoveError('Your locally stored planner could not be removed. Check that browser storage is available and try again.');
         }} className="rounded-lg bg-[#a3443e] px-4 py-2 text-xs font-bold text-white hover:opacity-90" data-testid="button-confirm-remove-local-planner">Remove planner data</button>
       </div>
     </div>
   </ModalShell>}
   {importPreview && <ModalShell title="Replace planner data?" onClose={() => setImportPreview(null)}>
     <div className="space-y-4">
       <p className="text-sm leading-relaxed text-muted-foreground">This file is valid. Importing will replace the planner data currently saved for this account on this browser.</p>
       <div className="rounded-xl bg-secondary/70 p-3 text-xs leading-relaxed"><p><strong>{importPreview.tasks.length}</strong> tasks · <strong>{importPreview.events.length}</strong> calendar events · <strong>{importPreview.projects.length}</strong> projects</p><p className="mt-1 text-muted-foreground">Your preferences will also be replaced.</p></div>
       <p className="text-xs font-semibold text-[#9d473d]">This replacement cannot be undone unless you have another planner copy.</p>
       <div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" onClick={() => setImportPreview(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary" data-testid="button-cancel-planner-import">Cancel</button><button type="button" onClick={confirmImport} className="rounded-lg bg-[#a3443e] px-4 py-2 text-xs font-bold text-white hover:opacity-90" data-testid="button-confirm-planner-import">Replace current planner</button></div>
     </div>
   </ModalShell>}
  </>;
}

function SettingsSection({ icon, title, note, children }: { icon: ReactNode; title: string; note: string; children: ReactNode }) {
  return <section className="surface rounded-2xl p-5 sm:p-6"><div className="mb-3 flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">{icon}</span><div><h3 className="font-display text-lg font-bold tracking-[-.03em]">{title}</h3><p className="text-xs text-muted-foreground">{note}</p></div></div><div className="divide-y divide-border">{children}</div></section>;
}
function SettingToggle({ label, description, value, onChange, testId }: { label: string; description: string; value: boolean; onChange: () => void; testId: string }) {
  return <div className="flex items-center justify-between gap-4 py-4"><div><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><button onClick={onChange} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-secondary'}`} data-testid={testId} aria-pressed={value}><span className={`absolute top-1 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>;
}

function TaskModal({ task, projects, initialDate, initialProjectId, onClose, onSave }: { task?: Task; projects: Project[]; initialDate?: string; initialProjectId?: string; onClose: () => void; onSave: (draft: Omit<Task, 'id' | 'completed'>, id?: string) => void }) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [date, setDate] = useState(task?.dueDate ?? initialDate ?? dayKey(today));
  const [category, setCategory] = useState(task?.category ?? 'Personal');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'medium');
  const [projectId, setProjectId] = useState(task?.projectId ?? initialProjectId ?? '');
  const submit = (event: FormEvent) => { event.preventDefault(); if (title.trim()) onSave({ title: title.trim(), dueDate: date, category, priority, projectId: projectId || undefined }, task?.id); };
  return <ModalShell title={task ? 'Edit task' : 'Add a task'} onClose={onClose}><form onSubmit={submit} className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-bold">What needs doing?</span><input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Outline the first chapter" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" data-testid="input-task-title" /></label><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-bold">Due date</span><input type="date" value={date} onChange={event => setDate(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none focus:border-primary" data-testid="input-task-date" /></label><label><span className="mb-1.5 block text-xs font-bold">Category</span><input value={category} onChange={event => setCategory(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-task-category" /></label></div><label className="block"><span className="mb-1.5 block text-xs font-bold">Project</span><select value={projectId} onChange={event => setProjectId(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none focus:border-primary" data-testid="select-task-project"><option value="">No project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div><span className="mb-2 block text-xs font-bold">Priority</span><div className="flex gap-2">{(['high', 'medium', 'low'] as Priority[]).map(option => <button type="button" key={option} onClick={() => setPriority(option)} className={`rounded-lg border px-3 py-2 text-xs font-bold capitalize ${priority === option ? 'border-primary bg-[#e9f6f1] text-primary' : 'border-border text-muted-foreground hover:bg-secondary'}`} data-testid={`button-priority-${option}`}>{option}</button>)}</div></div><div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary" data-testid="button-cancel-task">Cancel</button><button type="submit" className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground" data-testid="button-save-task">{task ? 'Save changes' : 'Add task'}</button></div></form></ModalShell>;
}

function EventModal({ event: existing, hasLinkedTask, date, minutes, onClose, onSave }: {
  event?: CalendarEvent;
  hasLinkedTask: boolean;
  date: string;
  minutes: number;
  onClose: () => void;
  onSave: (draft: CalendarEventDraft, existing?: CalendarEvent) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [eventDate, setEventDate] = useState(existing?.date ?? date);
  const [startTime, setStartTime] = useState(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  const endDefault = existing?.endMinutes ?? Math.min(minutes + 60, 19 * 60);
  const [endTime, setEndTime] = useState(`${String(Math.floor(endDefault / 60)).padStart(2, '0')}:${String(endDefault % 60).padStart(2, '0')}`);
  const [color, setColor] = useState(existing?.color ?? 'teal');
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
    const endMinutes = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
    if (title.trim() && eventDate && endMinutes > startMinutes) {
      onSave({ title: title.trim(), date: eventDate, startMinutes, endMinutes, color }, existing);
    }
  };
  return <ModalShell title={existing ? 'Edit calendar event' : 'Add to your calendar'} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold">Event name</span>
        <input autoFocus value={title} onChange={formEvent => setTitle(formEvent.target.value)} placeholder="e.g. Read in the library" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-event-title" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold">Date</span>
        <input type="date" value={eventDate} onChange={formEvent => setEventDate(formEvent.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none focus:border-primary" data-testid="input-event-date" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="mb-1.5 block text-xs font-bold">Starts at</span><input type="time" step="60" min="09:00" max="18:59" value={startTime} onChange={formEvent => setStartTime(formEvent.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none focus:border-primary" data-testid="input-event-start" /></label>
        <label><span className="mb-1.5 block text-xs font-bold">Ends at</span><input type="time" step="60" min="09:01" max="19:00" value={endTime} onChange={formEvent => setEndTime(formEvent.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" data-testid="input-event-end" /></label>
      </div>
      <p className="rounded-xl bg-secondary/60 p-3 text-[10px] leading-relaxed text-muted-foreground">
        {existing
          ? hasLinkedTask ? 'The linked task title and due date update when you change this event.' : 'This event is not linked to a task.'
          : 'Adding an event also creates a task due on this date. Its title and date stay in sync when you edit either one.'}
      </p>
      <div>
        <span className="mb-2 block text-xs font-bold">Color</span>
        <div className="flex gap-2">{[['teal', 'bg-[#76bba9]'], ['coral', 'bg-[#e9ad8f]'], ['gold', 'bg-[#d7aa50]'], ['lilac', 'bg-[#9f8bc0]']].map(([name, colorClass]) => <button type="button" key={name} onClick={() => setColor(name)} className={`h-8 w-8 rounded-full ${colorClass} ${color === name ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : ''}`} data-testid={`button-event-color-${name}`} aria-label={`${name} event color`} />)}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary" data-testid="button-cancel-event">Cancel</button>
        <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground" data-testid="button-save-event">{existing ? 'Save changes' : 'Add event'}</button>
      </div>
    </form>
  </ModalShell>;
}

function ProjectModal({ project, onClose, onSave }: { project?: Project; onClose: () => void; onSave: (draft: Omit<Project, 'id'>, id?: string) => void }) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState<ProjectStatus>(project?.status === 'completed' ? 'on-track' : project?.status ?? 'on-track');
  return <ModalShell title={project ? 'Edit project' : 'Start a project'} onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (name.trim()) onSave({ name: name.trim(), description: description.trim(), progress: project?.progress ?? 0, status: status === 'completed' ? 'on-track' : status }, project?.id); }} className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-bold">Project name</span><input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Senior thesis" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-project-name" /></label><label className="block"><span className="mb-1.5 block text-xs font-bold">Description</span><textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="What are you moving toward?" className="min-h-[85px] w-full resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-primary" data-testid="input-project-description" /></label><label className="block"><span className="mb-1.5 block text-xs font-bold">Health status</span><select value={status} onChange={event => setStatus(event.target.value as ProjectStatus)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none" data-testid="select-project-status"><option value="on-track">On track</option><option value="at-risk">Needs attention</option></select></label><p className="rounded-xl bg-secondary/60 p-3 text-[10px] leading-relaxed text-muted-foreground">Progress is calculated automatically from completed tasks assigned to this project. Add tasks from the project card or assign them while editing a task.</p><div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary" data-testid="button-cancel-project">Cancel</button><button type="submit" className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground" data-testid="button-save-project">Save project</button></div></form></ModalShell>;
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-[#182331]/45 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl animate-pop sm:p-6"><div className="mb-5 flex items-center justify-between"><h3 className="font-display text-xl font-bold tracking-[-.04em]">{title}</h3><button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid="button-close-modal"><X size={17} /></button></div>{children}</div></div>;
}

function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: () => void }) {
  return <div className="flex flex-col items-center justify-center px-5 py-12 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-primary">{icon}</span><h3 className="mt-4 font-display font-bold">{title}</h3><p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{text}</p>{action && <button onClick={action} className="mt-4 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground" data-testid="button-empty-action">Add something</button>}</div>;
}
function ProjectMini({ project, tasks }: { project: Project; tasks: Task[] }) {
  const progress = projectProgress(project, tasks);
  const status = projectStatus(project, tasks);
  return <div className="rounded-xl bg-secondary/60 p-3.5"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-bold">{project.name}</span><span className={`h-2 w-2 shrink-0 rounded-full ${status === 'on-track' ? 'bg-primary' : status === 'at-risk' ? 'bg-accent' : 'bg-[#9f8bc0]'}`} /></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background"><div className={`h-full rounded-full ${status === 'at-risk' ? 'bg-accent' : 'bg-primary'}`} style={{ width: `${progress}%` }} /></div><p className="mt-2 font-mono-custom text-[10px] text-muted-foreground">{progress}%</p></div>;
}
function NotFoundView() {
  return <div className="grid min-h-[60vh] place-items-center text-center"><div><span className="font-mono-custom text-xs text-primary">404 / page not found</span><h2 className="mt-3 font-display text-4xl font-bold tracking-[-.05em]">This page wandered off.</h2><Link href="/" className="mt-5 inline-flex rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground" data-testid="link-not-found-home">Back to overview</Link></div></div>;
}

function SignUpCompleteRoute() {
  const { isLoaded, isSignedIn } = useUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLocation('/sign-up', { replace: true });
      return;
    }

    trackSignUpCompletedOnce();
    setLocation('/', { replace: true });
  }, [isLoaded, isSignedIn, setLocation]);

  return <main className="grid min-h-[100dvh] place-items-center bg-background text-sm text-muted-foreground" aria-live="polite">Finishing sign-up…</main>;
}

function StudentWorkspaceRoute({ publicLanding = false }: { publicLanding?: boolean }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const [, setLocation] = useLocation();
  const [guestMode, setGuestMode] = useState(hasGuestSession);
  const [guestError, setGuestError] = useState('');

  useEffect(() => {
    if (!isSignedIn || !user) return;
    try {
      window.sessionStorage.removeItem(guestSessionKey);
    } catch {
      // The authenticated planner still uses its own student-scoped storage.
    }
    setGuestMode(false);
  }, [isSignedIn, user]);

  const continueAsGuest = () => {
    try {
      window.sessionStorage.setItem(guestSessionKey, 'active');
      setGuestError('');
      setGuestMode(true);
    } catch {
      setGuestError('Guest mode needs browser session storage. Enable it in your browser, or sign in to use an account.');
    }
  };

  const exitGuestMode = () => {
    try {
      window.sessionStorage.removeItem(guestSessionKey);
    } catch {
      return;
    }
    setGuestMode(false);
    setLocation('/');
  };

  if (!isLoaded) {
    return <main className="grid min-h-[100dvh] place-items-center bg-background text-sm text-muted-foreground" aria-live="polite">Loading your account…</main>;
  }
  if (!isSignedIn || !user) {
    if (guestMode) {
      return (
        <StudentWorkspaceGate key={guestUserId} userId={guestUserId}>
          <PlannerWorkspace
            key={guestUserId}
            userId={guestUserId}
            guestMode
            onExitGuest={exitGuestMode}
          />
        </StudentWorkspaceGate>
      );
    }
    return publicLanding
      ? <StudentLandingPage onContinueAsGuest={continueAsGuest} guestError={guestError} />
      : <Redirect to="/" />;
  }

  return (
    <StudentWorkspaceGate key={user.id} userId={user.id}>
      <PlannerWorkspace key={user.id} userId={user.id} />
    </StudentWorkspaceGate>
  );
}

function App() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/sign-up-complete" component={SignUpCompleteRoute} />
      <Route path="/connect-ai" component={ConnectAiPage} />
      <Route path="/" component={() => <StudentWorkspaceRoute publicLanding />} />
      <Route path="/tasks" component={() => <StudentWorkspaceRoute />} />
      <Route path="/assistant" component={() => <StudentWorkspaceRoute />} />
      <Route path="/calendar" component={() => <StudentWorkspaceRoute />} />
      <Route path="/projects" component={() => <StudentWorkspaceRoute />} />
      <Route path="/settings" component={() => <StudentWorkspaceRoute />} />
      <Route component={NotFoundView} />
    </Switch>
  );
}

export default App;