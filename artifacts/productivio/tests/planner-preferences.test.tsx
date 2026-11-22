// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

vi.mock('@clerk/react', () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: 'student-test',
      fullName: 'Riley Student',
      primaryEmailAddress: { emailAddress: 'riley@example.edu' },
    },
  }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock('@/components/auth/ClerkAuthProvider', () => ({
  SignInPage: () => null,
  SignUpPage: () => null,
}));

const storagePrefix = 'productivio:student:student-test:';

type TestTask = {
  id: string;
  title: string;
  dueDate: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
};

function saveStudentValue(key: string, value: unknown) {
  window.localStorage.setItem(`${storagePrefix}${key}`, JSON.stringify(value));
}

function savePreferences({
  focusMode = true,
  compactRows = false,
  weekStart = 'monday',
}: {
  focusMode?: boolean;
  compactRows?: boolean;
  weekStart?: 'monday' | 'sunday';
} = {}) {
  saveStudentValue('focus-mode', focusMode);
  saveStudentValue('dense-layout', compactRows);
  saveStudentValue('week-start', weekStart);
}

function task(id: string, title: string, dueDate: string, priority: TestTask['priority'] = 'medium'): TestTask {
  return { id, title, dueDate, category: 'Study', priority, completed: false };
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function weekStartDate(date: Date, weekStart: 'monday' | 'sunday') {
  const firstDay = weekStart === 'sunday' ? 0 : 1;
  return addDays(date, -((date.getDay() - firstDay + 7) % 7));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function navigateTo(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
}

function weeklyTaskCount() {
  const values = Array.from(screen.getByTestId('metric-tasks').querySelectorAll('span'))
    .map(span => span.textContent?.trim() ?? '');
  return values.find(value => /^\d+$/.test(value)) ?? null;
}

function comesBefore(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('planner preferences', () => {
  it('changes which tasks appear on the dashboard when focus mode is switched off', () => {
    savePreferences({ focusMode: true });
    saveStudentValue('tasks', [
      task('urgent-task', 'Prepare for the exam', '2099-05-01', 'high'),
      task('future-task', 'Plan the study session', '2099-05-02', 'low'),
    ]);
    render(<App />);

    expect(screen.queryByTestId('row-task-urgent-task')).not.toBeNull();
    expect(screen.queryByTestId('row-task-future-task')).toBeNull();

    navigateTo('link-nav-settings');
    fireEvent.click(screen.getByTestId('toggle-focus-mode'));
    navigateTo('link-nav-overview');

    expect(screen.getByRole('heading', { name: 'Next up' })).not.toBeNull();
    expect(screen.queryByTestId('row-task-future-task')).not.toBeNull();
  });

  it('uses compact row spacing in both the dashboard and task list', () => {
    savePreferences({ focusMode: false, compactRows: false });
    saveStudentValue('tasks', [task('spacing-task', 'Review lecture notes', '2099-05-03')]);
    render(<App />);

    expect(screen.getByTestId('row-task-spacing-task').classList.contains('py-3')).toBe(true);

    navigateTo('link-nav-settings');
    fireEvent.click(screen.getByTestId('toggle-dense-layout'));
    navigateTo('link-nav-overview');
    expect(screen.getByTestId('row-task-spacing-task').classList.contains('py-1.5')).toBe(true);

    navigateTo('link-nav-tasks');
    expect(screen.getByTestId('row-task-spacing-task').classList.contains('py-1.5')).toBe(true);
  });

  it('updates calendar ordering and weekly task counts for Sunday week starts', () => {
    savePreferences({ focusMode: false, weekStart: 'monday' });
    const monday = weekStartDate(new Date(), 'monday');
    saveStudentValue('tasks', [
      task('monday-task', 'Start the weekly reading', dateKey(monday)),
      task('sunday-task', 'Finish the weekly reading', dateKey(addDays(monday, 6))),
    ]);
    render(<App />);

    expect(weeklyTaskCount()).toBe('2');
    navigateTo('link-nav-calendar');
    expect(comesBefore(
      screen.getByTestId('button-calendar-slot-1-9'),
      screen.getByTestId('button-calendar-slot-7-9'),
    )).toBe(true);

    navigateTo('link-nav-settings');
    fireEvent.change(screen.getByTestId('select-week-start'), { target: { value: 'sunday' } });
    navigateTo('link-nav-overview');
    expect(weeklyTaskCount()).toBe('1');

    navigateTo('link-nav-calendar');
    expect(comesBefore(
      screen.getByTestId('button-calendar-slot-7-9'),
      screen.getByTestId('button-calendar-slot-1-9'),
    )).toBe(true);
  });

  it('restores focus mode, compact rows, and week start after a fresh app mount', () => {
    savePreferences({ focusMode: true, compactRows: false, weekStart: 'monday' });
    saveStudentValue('tasks', [
      task('persisted-task', 'Keep working on the outline', '2099-05-04', 'low'),
    ]);
    const firstLoad = render(<App />);

    navigateTo('link-nav-settings');
    fireEvent.click(screen.getByTestId('toggle-focus-mode'));
    fireEvent.click(screen.getByTestId('toggle-dense-layout'));
    fireEvent.change(screen.getByTestId('select-week-start'), { target: { value: 'sunday' } });

    firstLoad.unmount();
    window.history.replaceState({}, '', '/settings');
    render(<App />);

    expect(screen.getByTestId('toggle-focus-mode').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('toggle-dense-layout').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('select-week-start') as HTMLSelectElement).value).toBe('sunday');

    navigateTo('link-nav-overview');
    expect(screen.getByRole('heading', { name: 'Next up' })).not.toBeNull();
    expect(screen.getByTestId('row-task-persisted-task').classList.contains('py-1.5')).toBe(true);
  });

  it('shows overdue incomplete tasks separately on the dashboard and updates when completed or rescheduled', async () => {
    const yesterday = dateKey(addDays(new Date(), -1));
    const tomorrow = dateKey(addDays(new Date(), 1));
    savePreferences({ focusMode: false });
    saveStudentValue('tasks', [
      task('overdue-open', 'Submit overdue lab report', yesterday, 'high'),
      { ...task('overdue-done', 'Already finished past task', yesterday, 'low'), completed: true },
      task('upcoming-open', 'Prepare seminar slides', tomorrow, 'medium'),
    ]);
    render(<App />);

    const overdueSection = screen.getByTestId('dashboard-overdue-section');
    const upcomingSection = screen.getByTestId('dashboard-upcoming-section');

    expect(within(overdueSection).queryByTestId('row-task-overdue-open')).not.toBeNull();
    expect(within(overdueSection).queryByTestId('row-task-overdue-done')).toBeNull();
    expect(within(overdueSection).queryByTestId('row-task-upcoming-open')).toBeNull();
    expect(within(upcomingSection).queryByTestId('row-task-upcoming-open')).not.toBeNull();
    expect(within(upcomingSection).queryByTestId('row-task-overdue-open')).toBeNull();

    // Completing the overdue task removes it from overdue work
    fireEvent.click(within(overdueSection).getByTestId('button-toggle-task-overdue-open'));
    await waitFor(() => {
      expect(screen.queryByTestId('dashboard-overdue-section')).toBeNull();
    });

    // Reopening and moving its due date to tomorrow keeps it out of overdue work
    navigateTo('link-nav-tasks');
    fireEvent.click(screen.getByTestId('button-toggle-task-overdue-open'));
    fireEvent.click(screen.getByTestId('button-edit-task-overdue-open'));
    fireEvent.change(screen.getByTestId('input-task-date'), { target: { value: tomorrow } });
    fireEvent.click(screen.getByTestId('button-save-task'));

    navigateTo('link-nav-overview');
    expect(screen.queryByTestId('dashboard-overdue-section')).toBeNull();
    expect(within(screen.getByTestId('dashboard-upcoming-section')).queryByTestId('row-task-overdue-open')).not.toBeNull();
  });

  it('creates calendar-linked tasks with dates matching both Monday and Sunday week starts', () => {
    savePreferences({ focusMode: false, weekStart: 'monday' });
    saveStudentValue('tasks', []);
    saveStudentValue('events', []);
    render(<App />);

    // Monday start: Sunday is the 7th day (end of this week)
    const mondayWeekSunday = dateKey(addDays(weekStartDate(new Date(), 'monday'), 6));
    navigateTo('link-nav-calendar');
    fireEvent.click(screen.getByTestId('button-calendar-slot-7-10'));
    expect((screen.getByTestId('input-event-date') as HTMLInputElement).value).toBe(mondayWeekSunday);
    fireEvent.change(screen.getByTestId('input-event-title'), { target: { value: 'Monday-week Sunday review' } });
    fireEvent.click(screen.getByTestId('button-save-event'));

    navigateTo('link-nav-overview');
    expect(weeklyTaskCount()).toBe('1');

    // Switch to Sunday start: Sunday is the 1st day (start of this week)
    navigateTo('link-nav-settings');
    fireEvent.change(screen.getByTestId('select-week-start'), { target: { value: 'sunday' } });
    const sundayWeekSunday = dateKey(weekStartDate(new Date(), 'sunday'));
    navigateTo('link-nav-calendar');
    fireEvent.click(screen.getByTestId('button-calendar-slot-7-11'));
    expect((screen.getByTestId('input-event-date') as HTMLInputElement).value).toBe(sundayWeekSunday);
    fireEvent.change(screen.getByTestId('input-event-title'), { target: { value: 'Sunday-week Sunday prep' } });
    fireEvent.click(screen.getByTestId('button-save-event'));

    const storedTasks = JSON.parse(window.localStorage.getItem(`${storagePrefix}tasks`)!) as TestTask[];
    expect(storedTasks.find(t => t.title === 'Monday-week Sunday review')?.dueDate).toBe(mondayWeekSunday);
    expect(storedTasks.find(t => t.title === 'Sunday-week Sunday prep')?.dueDate).toBe(sundayWeekSunday);

    navigateTo('link-nav-overview');
    const expectedCount = mondayWeekSunday === sundayWeekSunday ? '2' : '1';
    expect(weeklyTaskCount()).toBe(expectedCount);
  });

  it('syncs planner data and preferences across open tabs for the active student only', async () => {
    savePreferences({ focusMode: true, compactRows: false, weekStart: 'monday' });
    saveStudentValue('tasks', [task('initial-task', 'Initial study task', '2099-05-01', 'high')]);
    render(<App />);

    expect(screen.queryByTestId('row-task-initial-task')).not.toBeNull();
    expect(screen.queryByTestId('row-task-synced-task')).toBeNull();

    // Simulate another tab updating tasks and preferences for the same student
    const updatedTasks = [
      task('initial-task', 'Initial study task', '2099-05-01', 'high'),
      task('synced-task', 'Added in another tab', '2099-05-02', 'low'),
    ];
    window.localStorage.setItem(`${storagePrefix}tasks`, JSON.stringify(updatedTasks));
    window.localStorage.setItem(`${storagePrefix}focus-mode`, JSON.stringify(false));
    window.localStorage.setItem(`${storagePrefix}dense-layout`, JSON.stringify(true));

    fireEvent(window, new StorageEvent('storage', {
      key: `${storagePrefix}tasks`,
      newValue: JSON.stringify(updatedTasks),
      storageArea: window.localStorage,
    }));

    await waitFor(() => {
      expect(screen.queryByTestId('row-task-synced-task')).not.toBeNull();
      expect(screen.getByRole('heading', { name: 'Next up' })).not.toBeNull();
      expect(screen.getByTestId('row-task-synced-task').classList.contains('py-1.5')).toBe(true);
    });

    // Storage event for another student must be ignored
    const otherStudentKey = 'productivio:student:other-student:tasks';
    const otherTasks = [task('other-task', 'Other student secret', '2099-05-03', 'high')];
    window.localStorage.setItem(otherStudentKey, JSON.stringify(otherTasks));
    fireEvent(window, new StorageEvent('storage', {
      key: otherStudentKey,
      newValue: JSON.stringify(otherTasks),
      storageArea: window.localStorage,
    }));

    expect(screen.queryByTestId('row-task-other-task')).toBeNull();
    expect(screen.queryByTestId('row-task-synced-task')).not.toBeNull();
  });

  it('does not overwrite unsaved local edits when another tab writes to storage', async () => {
    savePreferences({ focusMode: false });
    saveStudentValue('tasks', [task('local-task', 'Local study task', '2099-05-01', 'high')]);
    window.history.replaceState({}, '', '/tasks');
    render(<App />);

    // Force local save to fail
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === `${storagePrefix}projects`) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    });

    fireEvent.click(within(screen.getByTestId('row-task-local-task')).getByRole('button', { name: 'Complete task' }));
    expect(await screen.findByTestId('storage-save-warning')).not.toBeNull();

    // Another tab dispatches a storage event while this tab has unsaved edits
    fireEvent(window, new StorageEvent('storage', {
      key: `${storagePrefix}tasks`,
      newValue: JSON.stringify([task('remote-task', 'Remote tab task', '2099-05-02', 'high')]),
      storageArea: window.localStorage,
    }));

    // Local unsaved state and warning must remain intact
    expect(screen.getByTestId('storage-save-warning')).not.toBeNull();
    expect(screen.queryByTestId('row-task-remote-task')).toBeNull();
    expect(within(screen.getByTestId('row-task-local-task')).getByRole('button', { name: 'Reopen task' })).not.toBeNull();
  });

  it('preserves task filters when toggling tasks, supports clickable search results, and handles Q/Escape shortcuts', () => {
    savePreferences({ focusMode: false });
    saveStudentValue('tasks', [
      task('high-task', 'High priority exam prep', '2099-05-01', 'high'),
      task('low-task', 'Low priority reading', '2099-05-02', 'low'),
    ]);
    window.history.replaceState({}, '', '/tasks');
    render(<App />);

    // Filter to high priority and toggle task: filter must remain 'high' (not reset by remount)
    fireEvent.change(screen.getByTestId('select-task-priority'), { target: { value: 'high' } });
    expect(screen.queryByTestId('row-task-low-task')).toBeNull();
    fireEvent.click(screen.getByTestId('button-toggle-task-high-task'));
    expect((screen.getByTestId('select-task-priority') as HTMLSelectElement).value).toBe('high');
    expect(screen.queryByTestId('row-task-low-task')).toBeNull();

    // Reset filters button restores all tasks
    fireEvent.click(screen.getByTestId('button-task-filter'));
    expect((screen.getByTestId('select-task-priority') as HTMLSelectElement).value).toBe('all');
    expect(screen.queryByTestId('row-task-low-task')).not.toBeNull();

    // Global search result opens the task editor
    fireEvent.change(screen.getByTestId('input-global-search'), { target: { value: 'exam prep' } });
    fireEvent.click(screen.getByTestId('button-search-result-0'));
    expect((screen.getByTestId('input-task-title') as HTMLInputElement).value).toBe('High priority exam prep');

    // Escape closes the modal; Q opens Quick Add
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('input-task-title')).toBeNull();
    fireEvent.keyDown(window, { key: 'q' });
    expect(screen.queryByTestId('input-task-title')).not.toBeNull();
  });
});
