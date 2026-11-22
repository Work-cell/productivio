---
name: Browser storage tests
description: A jsdom testing quirk for simulating localStorage failures.
---

In jsdom, spying on `window.localStorage` instance methods may not intercept calls made through the global `localStorage` object. Mock `Storage.prototype` methods when testing browser storage failures.

**Why:** Instance-level mocks did not trigger in Productivio's Vitest tests, while prototype mocks exercised the same storage operations used by the app.

**How to apply:** Use `vi.spyOn(Storage.prototype, 'setItem'|'getItem')` for tests that simulate quota, blocked storage, or recovery; restore mocks after each test.
