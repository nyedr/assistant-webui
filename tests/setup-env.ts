/**
 * Test environment setup file
 *
 * This file is executed before running tests and sets up the necessary environment.
 */

import { beforeAll, afterAll, vi } from "vitest";

// Mock browser globals
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

global.window = global.window || {
  navigator: {},
  location: {},
  localStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
};

global.navigator = global.navigator || {};
global.localStorage = global.localStorage || {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

// Mock fetch API
global.fetch = vi.fn();
global.Request = vi.fn();
global.Headers = vi.fn();

// Mock session storage
Object.defineProperty(global, "sessionStorage", {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
});

// Mock requestAnimationFrame
global.requestAnimationFrame = (callback: FrameRequestCallback) => {
  setTimeout(callback, 0);
  return 0;
};

// Mock cancelAnimationFrame
global.cancelAnimationFrame = vi.fn();

// Mock Web Crypto API
Object.defineProperty(global, "crypto", {
  value: {
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    },
    subtle: {},
  },
});

// Setup function that runs before all tests
beforeAll(() => {
  console.log("Setting up test environment...");
});

// Cleanup function that runs after all tests
afterAll(() => {
  console.log("Cleaning up test environment...");
});
