export type Priority = 'high' | 'medium' | 'low';
export type WeekStart = 'monday' | 'sunday';
export type ProjectStatus = 'on-track' | 'at-risk' | 'completed';

export type Task = {
  id: string;
  title: string;
  dueDate: string;
  category: string;
  priority: Priority;
  completed: boolean;
  projectId?: string;
  calendarEventId?: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  day: number;
  startMinutes: number;
  endMinutes: number;
  color: string;
  taskId?: string;
};

export type CalendarEventDraft = Pick<CalendarEvent, 'title' | 'date' | 'startMinutes' | 'endMinutes' | 'color'>;

export type Project = {
  id: string;
  name: string;
  description: string;
  progress: number;
  status: ProjectStatus;
};

export type PlannerData = {
  tasks: Task[];
  events: CalendarEvent[];
  projects: Project[];
  preferences: { focusMode: boolean; weekStart: WeekStart; compactRows: boolean };
};
