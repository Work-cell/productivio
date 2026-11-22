// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import StudentWorkspaceGate from '../src/components/auth/StudentWorkspaceGate';

const authState = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  user: {
    id: 'student-a',
    fullName: 'Riley Student',
    primaryEmailAddress: { emailAddress: 'riley@example.edu' },
  },
}));

vi.mock('@clerk/react', () => ({
  useUser: () => authState,
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock('@/components/auth/ClerkAuthProvider', () => ({
  SignInPage: () => null,
  SignUpPage: () => null,
}));

const plannerKey = (userId: string, key: string) =>
  `productivio:student:${encodeURIComponent(userId)}:${key}`;

function saveTasks(
  userId: string,
  tasks: Array<{
    id: string;
    title: string;
    dueDate: string;
    category: string;
    priority: 'high' | 'medium' | 'low';
    completed: boolean;
  }>,
) {
  window.localStorage.setItem(
    plannerKey(userId, 'tasks'),
    JSON.stringify(tasks),
  );
}

function studentTask(id: string, title: string) {
  return {
    id,
    title,
    dueDate: '2099-05-01',
    category: 'Study',
    priority: 'medium' as const,
    completed: false,
  };
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  authState.isLoaded = true;
  authState.isSignedIn = true;
  authState.user.id = 'student-a';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('student planner privacy boundaries', () => {
  it('reads and writes separate planner values when students switch accounts', async () => {
    saveTasks('student-a', [studentTask('a-task', 'Student A study plan')]);
    saveTasks('student-b', [studentTask('b-task', 'Student B study plan')]);
    const view = renderAt('/tasks');

    const studentARow = screen.getByTestId('row-task-a-task');
    expect(
      within(studentARow).getByRole('button', { name: 'Complete task' }),
    ).not.toBeNull();
    expect(screen.queryByTestId('row-task-b-task')).toBeNull();

    fireEvent.click(
      within(studentARow).getByRole('button', { name: 'Complete task' }),
    );
    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem(plannerKey('student-a', 'tasks'))!,
        )[0].completed,
      ).toBe(true);
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(plannerKey('student-b', 'tasks'))!,
      )[0].completed,
    ).toBe(false);

    authState.user.id = 'student-b';
    view.rerender(<App />);
    const studentBRow = await screen.findByTestId('row-task-b-task');
    expect(screen.queryByTestId('row-task-a-task')).toBeNull();
    fireEvent.click(
      within(studentBRow).getByRole('button', { name: 'Complete task' }),
    );
    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem(plannerKey('student-b', 'tasks'))!,
        )[0].completed,
      ).toBe(true);
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(plannerKey('student-a', 'tasks'))!,
      )[0].completed,
    ).toBe(true);

    authState.user.id = 'student-a';
    view.rerender(<App />);
    const restoredStudentARow = await screen.findByTestId('row-task-a-task');
    expect(
      within(restoredStudentARow).getByRole('button', { name: 'Reopen task' }),
    ).not.toBeNull();
    expect(screen.queryByTestId('row-task-b-task')).toBeNull();
  });

  it('warns when planner saves fail and clears the warning after a successful retry', async () => {
    saveTasks('student-a', [studentTask('private-task', 'Private study plan')]);
    let shouldFail = true;
    let successfulTaskWrites = 0;
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === plannerKey('student-a', 'tasks')) {
        if (shouldFail) throw new DOMException('Storage is unavailable', 'QuotaExceededError');
        successfulTaskWrites += 1;
      }
      return originalSetItem.call(this, key, value);
    });

    renderAt('/tasks');

    const warning = await screen.findByTestId('storage-save-warning');
    expect(warning.textContent).toContain('Your latest changes could not be saved');
    expect(warning.textContent).not.toContain('Private study plan');
    expect(screen.getByTestId('row-task-private-task')).not.toBeNull();
    fireEvent.click(screen.getByTestId('button-task-add'));
    expect(screen.getByRole('heading', { name: 'Add a task' })).not.toBeNull();
    fireEvent.click(screen.getByTestId('button-cancel-task'));

    shouldFail = false;
    fireEvent.click(screen.getByTestId('button-retry-storage-save'));

    await waitFor(() => {
      expect(screen.queryByTestId('storage-save-warning')).toBeNull();
      expect(successfulTaskWrites).toBeGreaterThan(0);
    });
  });

  it('leaves legacy planner data untouched until the student chooses', () => {
    const legacyTasks = [studentTask('legacy-task', 'Older browser planner')];
    window.localStorage.setItem(
      'productivio:tasks',
      JSON.stringify(legacyTasks),
    );
    render(
      <StudentWorkspaceGate userId="student-a">
        <p>Planner content</p>
      </StudentWorkspaceGate>,
    );

    expect(
      screen.getByRole('heading', {
        name: 'A planner is saved in this browser',
      }),
    ).not.toBeNull();
    expect(screen.queryByText('Planner content')).toBeNull();
    expect(
      window.localStorage.getItem(plannerKey('student-a', 'tasks')),
    ).toBeNull();
    expect(window.localStorage.getItem('productivio:tasks')).toBe(
      JSON.stringify(legacyTasks),
    );
  });

  it('lets a student retry opening the planner after browser storage becomes available', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable', 'SecurityError');
    });
    render(
      <StudentWorkspaceGate userId="student-a">
        <p>Planner content</p>
      </StudentWorkspaceGate>,
    );

    expect(screen.getByRole('heading', { name: 'Your planner could not be opened' })).not.toBeNull();
    expect(screen.queryByText('Planner content')).toBeNull();

    getItem.mockRestore();
    fireEvent.click(screen.getByTestId('button-retry-open-planner'));

    expect(screen.getByText('Planner content')).not.toBeNull();
  });

  it('copies legacy planner values into the chosen student planner', () => {
    const legacyTasks = [studentTask('legacy-task', 'Older browser planner')];
    const legacyProjects = [{ id: 'legacy-project', name: 'History project' }];
    window.localStorage.setItem(
      'productivio:tasks',
      JSON.stringify(legacyTasks),
    );
    window.localStorage.setItem(
      'productivio:projects',
      JSON.stringify(legacyProjects),
    );
    render(
      <StudentWorkspaceGate userId="student-a">
        <p>Planner content</p>
      </StudentWorkspaceGate>,
    );

    fireEvent.click(screen.getByTestId('button-import-browser-workspace'));

    expect(screen.getByText('Planner content')).not.toBeNull();
    expect(window.localStorage.getItem(plannerKey('student-a', 'tasks'))).toBe(
      JSON.stringify(legacyTasks),
    );
    expect(
      window.localStorage.getItem(plannerKey('student-a', 'projects')),
    ).toBe(JSON.stringify(legacyProjects));
    expect(window.localStorage.getItem('productivio:tasks')).toBe(
      JSON.stringify(legacyTasks),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem('productivio:browser-workspace-import-v1')!,
      ),
    ).toEqual({
      userId: 'student-a',
      decision: 'imported',
    });
  });

  it('starts a clean planner without copying legacy values when chosen', () => {
    const legacyTasks = [studentTask('legacy-task', 'Older browser planner')];
    window.localStorage.setItem(
      'productivio:tasks',
      JSON.stringify(legacyTasks),
    );
    render(
      <StudentWorkspaceGate userId="student-a">
        <p>Planner content</p>
      </StudentWorkspaceGate>,
    );

    fireEvent.click(screen.getByTestId('button-start-fresh'));

    expect(screen.getByText('Planner content')).not.toBeNull();
    expect(
      window.localStorage.getItem(plannerKey('student-a', 'tasks')),
    ).toBeNull();
    expect(window.localStorage.getItem('productivio:tasks')).toBe(
      JSON.stringify(legacyTasks),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem('productivio:browser-workspace-import-v1')!,
      ),
    ).toEqual({
      userId: 'student-a',
      decision: 'fresh',
    });
  });

  it.each(['/tasks', '/calendar', '/projects', '/settings'])(
    'redirects signed-out visitors from %s to the public landing page',
    async (path) => {
      authState.isSignedIn = false;

      renderAt(path);

      expect(
        await screen.findByRole('heading', {
          name: /Make a plan that fits your actual day/,
        }),
      ).not.toBeNull();
      await waitFor(() => expect(window.location.pathname).toBe('/'));
    },
  );

  it('shows a clear message when a planner backup download fails and succeeds on retry', async () => {
    saveTasks('student-a', [studentTask('secret-task', 'Confidential thesis draft')]);
    renderAt('/settings');

    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('Downloads are blocked');
    });
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    fireEvent.click(screen.getByTestId('button-download-planner'));

    const banner = await screen.findByTestId('download-error-banner');
    expect(banner.textContent).toContain('Your planner copy could not be downloaded');
    expect(banner.textContent).not.toContain('Confidential thesis draft');

    createObjectURLSpy.mockReturnValue('blob:mock-planner');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByTestId('button-retry-download-copy'));

    await waitFor(() => {
      expect(screen.queryByTestId('download-error-banner')).toBeNull();
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-planner');
  });

  it('rolls back partial writes if a browser save fails midway', async () => {
    saveTasks('student-a', [studentTask('task-1', 'Original task')]);
    window.localStorage.setItem(plannerKey('student-a', 'projects'), JSON.stringify([
      { id: 'proj-1', name: 'Original project', description: 'Desc', progress: 0, status: 'on-track' },
    ]));

    const view = renderAt('/tasks');
    const originalSetItem = Storage.prototype.setItem;
    let failProjects = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (failProjects && key === plannerKey('student-a', 'projects')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    fireEvent.click(within(screen.getByTestId('row-task-task-1')).getByRole('button', { name: 'Complete task' }));

    expect(await screen.findByTestId('storage-save-warning')).not.toBeNull();
    // Tasks write must have been rolled back so storage is not partially updated.
    expect(JSON.parse(window.localStorage.getItem(plannerKey('student-a', 'tasks'))!)[0].completed).toBe(false);

    failProjects = false;
    fireEvent.click(screen.getByTestId('button-retry-storage-save'));

    await waitFor(() => {
      expect(screen.queryByTestId('storage-save-warning')).toBeNull();
      expect(JSON.parse(window.localStorage.getItem(plannerKey('student-a', 'tasks'))!)[0].completed).toBe(true);
    });
    view.unmount();
  });

  it('removes only the active signed-in student planner from a shared browser after confirmation', async () => {
    saveTasks('student-a', [studentTask('a-task', 'Student A task')]);
    saveTasks('student-b', [studentTask('b-task', 'Student B task')]);
    saveTasks('guest', [studentTask('g-task', 'Guest task')]);

    renderAt('/settings');

    fireEvent.click(screen.getByTestId('button-remove-local-planner'));
    // Cancelling leaves data intact
    fireEvent.click(screen.getByTestId('button-cancel-remove-local-planner'));
    expect(window.localStorage.getItem(plannerKey('student-a', 'tasks'))).not.toBeNull();

    // Confirming removes only student-a's keys
    fireEvent.click(screen.getByTestId('button-remove-local-planner'));
    fireEvent.click(screen.getByTestId('button-confirm-remove-local-planner'));

    expect(await screen.findByTestId('text-remove-local-success')).not.toBeNull();
    expect(window.localStorage.getItem(plannerKey('student-a', 'tasks'))).toBeNull();
    expect(window.localStorage.getItem(plannerKey('student-a', 'projects'))).toBeNull();
    expect(window.localStorage.getItem(plannerKey('student-b', 'tasks'))).toContain('Student B task');
    expect(window.localStorage.getItem(plannerKey('guest', 'tasks'))).toContain('Guest task');
  });

  it('keeps guest planner data separate from signed-in student accounts', async () => {
    saveTasks('guest', [studentTask('guest-task', 'Guest study session')]);
    saveTasks('student-a', [studentTask('student-a-task', 'Student A seminar')]);

    authState.isSignedIn = false;
    window.sessionStorage.setItem('productivio:guest-session-v1', 'active');
    const view = renderAt('/tasks');

    expect(await screen.findByTestId('row-task-guest-task')).not.toBeNull();
    expect(screen.queryByTestId('row-task-student-a-task')).toBeNull();

    fireEvent.click(within(screen.getByTestId('row-task-guest-task')).getByRole('button', { name: 'Complete task' }));
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(plannerKey('guest', 'tasks'))!)[0].completed).toBe(true);
    });

    // Switch to signed-in student
    authState.isSignedIn = true;
    authState.user.id = 'student-a';
    view.rerender(<App />);

    expect(await screen.findByTestId('row-task-student-a-task')).not.toBeNull();
    expect(screen.queryByTestId('row-task-guest-task')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(plannerKey('student-a', 'tasks'))!)[0].completed).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(plannerKey('guest', 'tasks'))!)[0].completed).toBe(true);

    // Return to guest mode via the landing page
    authState.isSignedIn = false;
    view.rerender(<App />);
    fireEvent.click(await screen.findByTestId('button-continue-as-guest'));
    fireEvent.click(screen.getByTestId('link-nav-tasks'));

    const restoredGuestRow = await screen.findByTestId('row-task-guest-task');
    expect(within(restoredGuestRow).getByRole('button', { name: 'Reopen task' })).not.toBeNull();
    expect(screen.queryByTestId('row-task-student-a-task')).toBeNull();
  });

  it('round-trips planner export/import, rejects invalid files, and honors cancellation', async () => {
    saveTasks('student-a', [studentTask('orig-task', 'Original student task')]);
    window.localStorage.setItem(plannerKey('student-a', 'projects'), JSON.stringify([
      { id: 'proj-orig', name: 'Original project', description: 'Notes', progress: 0, status: 'on-track' },
    ]));
    window.localStorage.setItem(plannerKey('student-a', 'events'), JSON.stringify([
      { id: 'ev-orig', title: 'Original seminar', date: '2099-05-01', day: 5, startMinutes: 600, endMinutes: 660, color: 'teal' },
    ]));
    window.localStorage.setItem(plannerKey('student-a', 'week-start'), JSON.stringify('sunday'));
    window.localStorage.setItem(plannerKey('student-a', 'focus-mode'), JSON.stringify(false));
    window.localStorage.setItem(plannerKey('student-a', 'dense-layout'), JSON.stringify(true));

    renderAt('/settings');

    // Capture exported JSON from Blob
    let exportedJson = '';
    const originalBlob = globalThis.Blob;
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts?: BlobPart[], options?: BlobPropertyBag) {
      if (parts && typeof parts[0] === 'string') exportedJson = parts[0];
      return new originalBlob(parts, options);
    } as unknown as typeof Blob);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByTestId('button-download-planner'));
    expect(exportedJson).toContain('Original student task');

    const uploadText = async (content: string, sizeOverride?: number) => {
      const file = new originalBlob([content], { type: 'application/json' }) as File;
      Object.defineProperty(file, 'name', { value: 'planner.json' });
      Object.defineProperty(file, 'text', { value: async () => content });
      if (sizeOverride !== undefined) Object.defineProperty(file, 'size', { value: sizeOverride });
      fireEvent.change(screen.getByTestId('input-import-planner'), { target: { files: [file] } });
    };

    // Malformed JSON
    await uploadText('{bad json');
    expect(await screen.findByTestId('text-import-error')).not.toBeNull();

    // Unsupported version
    await uploadText(JSON.stringify({ format: 'productivio-planner', version: 99, data: {} }));
    expect((await screen.findByTestId('text-import-error')).textContent).toContain('not a supported Productivio planner file');

    // Oversized file
    await uploadText(exportedJson, 11 * 1024 * 1024);
    expect((await screen.findByTestId('text-import-error')).textContent).toContain('larger than 10 MB');

    // Inconsistent file (task references missing project)
    const inconsistent = JSON.parse(exportedJson);
    inconsistent.data.tasks[0].projectId = 'missing-project';
    await uploadText(JSON.stringify(inconsistent));
    expect((await screen.findByTestId('text-import-error')).textContent).toContain('project that is not in this file');

    // Valid import cancelled leaves current planner unchanged
    const modified = JSON.parse(exportedJson);
    modified.data.tasks[0].title = 'Imported replacement task';
    modified.data.preferences.weekStart = 'monday';
    await uploadText(JSON.stringify(modified));
    fireEvent.click(await screen.findByTestId('button-cancel-planner-import'));
    expect(JSON.parse(window.localStorage.getItem(plannerKey('student-a', 'tasks'))!)[0].title).toBe('Original student task');

    // Valid import confirmed replaces all data and preferences
    await uploadText(JSON.stringify(modified));
    fireEvent.click(await screen.findByTestId('button-confirm-planner-import'));
    expect(await screen.findByTestId('text-import-success')).not.toBeNull();
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(plannerKey('student-a', 'tasks'))!)[0].title).toBe('Imported replacement task');
      expect(JSON.parse(window.localStorage.getItem(plannerKey('student-a', 'week-start'))!)).toBe('monday');
      expect(JSON.parse(window.localStorage.getItem(plannerKey('student-a', 'dense-layout'))!)).toBe(true);
    });
  });

  it('warns when rollback itself fails after an interrupted save', async () => {
    saveTasks('student-a', [studentTask('rb-task', 'Original task')]);
    renderAt('/tasks');

    const originalSetItem = Storage.prototype.setItem;
    let taskWrites = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === plannerKey('student-a', 'tasks')) {
        taskWrites += 1;
        // First write succeeds (forward write), second write fails (rollback write)
        if (taskWrites > 1) throw new DOMException('Storage locked', 'SecurityError');
      }
      if (key === plannerKey('student-a', 'projects')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    fireEvent.click(within(screen.getByTestId('row-task-rb-task')).getByRole('button', { name: 'Complete task' }));

    const warning = await screen.findByTestId('storage-save-warning');
    expect(warning.textContent).toContain('could not be restored to its previous state');
  });

  it('shows an error if removing the local planner fails', async () => {
    saveTasks('student-a', [studentTask('locked-task', 'Locked task')]);
    renderAt('/settings');

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });

    fireEvent.click(screen.getByTestId('button-remove-local-planner'));
    fireEvent.click(screen.getByTestId('button-confirm-remove-local-planner'));

    const errorEl = await screen.findByTestId('text-remove-local-error');
    expect(errorEl.textContent).toContain('could not be removed');
    expect(screen.queryByTestId('text-remove-local-success')).toBeNull();
  });

  it('round-trips a larger planner export and import (250 tasks)', async () => {
    const manyTasks = Array.from({ length: 250 }, (_, index) =>
      studentTask(`bulk-task-${index}`, `Bulk assignment ${index}`),
    );
    saveTasks('student-a', manyTasks);
    renderAt('/settings');

    let exportedJson = '';
    const originalBlob = globalThis.Blob;
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts?: BlobPart[], options?: BlobPropertyBag) {
      if (parts && typeof parts[0] === 'string') exportedJson = parts[0];
      return new originalBlob(parts, options);
    } as unknown as typeof Blob);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bulk-export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByTestId('button-download-planner'));
    const parsedExport = JSON.parse(exportedJson);
    expect(parsedExport.data.tasks).toHaveLength(250);

    // Clear tasks locally and re-import the 250-task export
    const file = new originalBlob([exportedJson], { type: 'application/json' }) as File;
    Object.defineProperty(file, 'name', { value: 'bulk-planner.json' });
    Object.defineProperty(file, 'text', { value: async () => exportedJson });
    fireEvent.change(screen.getByTestId('input-import-planner'), { target: { files: [file] } });
    fireEvent.click(await screen.findByTestId('button-confirm-planner-import'));

    expect(await screen.findByTestId('text-import-success')).not.toBeNull();
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(plannerKey('student-a', 'tasks'))!);
      expect(stored).toHaveLength(250);
      expect(stored[249].title).toBe('Bulk assignment 249');
    });
  });
});
