// Client-side diagnostics capture for feedback submissions (Phase 3).
//
// Everything here is best-effort and must never throw into product code: a
// failure to read `navigator` or patch `fetch` simply yields empty diagnostics
// and never blocks a submission. The console/API error buffers are small ring
// buffers installed once per page load via `installDiagnosticsCollectors()`.

import type { SupportRequestDiagnostics } from "@/lib/support/requests";

const MAX_BUFFER = 10;
const MAX_LINE = 300;

const consoleErrorBuffer: string[] = [];
const apiFailureBuffer: string[] = [];
let installed = false;

function pushBuffer(buffer: string[], line: string) {
  buffer.push(line.slice(0, MAX_LINE));
  while (buffer.length > MAX_BUFFER) {
    buffer.shift();
  }
}

function timeLabel() {
  try {
    return new Date().toISOString().slice(11, 19);
  } catch {
    return "";
  }
}

// Patches console.error and window.fetch to record recent failures. Idempotent
// and safe to call from any client entry point.
export function installDiagnosticsCollectors() {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  try {
    const originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      try {
        const text = args
          .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
          .join(" ");
        pushBuffer(consoleErrorBuffer, `[${timeLabel()}] ${text}`);
      } catch {
        // ignore — diagnostics must never break logging
      }
      originalConsoleError(...(args as []));
    };
  } catch {
    // ignore
  }

  try {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      try {
        const response = await originalFetch(...args);
        if (!response.ok) {
          const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url ?? "";
          pushBuffer(apiFailureBuffer, `[${timeLabel()}] ${response.status} ${url}`);
        }
        return response;
      } catch (error) {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url ?? "";
        const message = error instanceof Error ? error.message : "network error";
        pushBuffer(apiFailureBuffer, `[${timeLabel()}] FAILED ${url} (${message})`);
        throw error;
      }
    };
  } catch {
    // ignore
  }
}

function detectBrowser(ua: string) {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return "Opera";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/chrome\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua)) return "Safari";
  return "";
}

function detectOs(ua: string) {
  if (/windows nt/i.test(ua)) return "Windows";
  if (/mac os x/i.test(ua)) return "macOS";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/linux/i.test(ua)) return "Linux";
  return "";
}

// Builds the diagnostics payload at submission time. `includeBugDetails`
// controls whether the (potentially noisy) console/API buffers are attached —
// they are only useful for bug reports.
export function collectDiagnostics(includeBugDetails: boolean): SupportRequestDiagnostics {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      browser: "",
      operatingSystem: "",
      screenResolution: "",
      language: "",
      appVersion: "",
      recentConsoleErrors: "",
      recentApiFailures: "",
    };
  }

  const ua = navigator.userAgent ?? "";
  let screenResolution = "";
  try {
    if (window.screen?.width && window.screen?.height) {
      screenResolution = `${window.screen.width}x${window.screen.height}`;
    }
  } catch {
    // ignore
  }

  return {
    browser: detectBrowser(ua),
    operatingSystem: detectOs(ua),
    screenResolution,
    language: navigator.language ?? "",
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION?.trim() ?? "",
    recentConsoleErrors: includeBugDetails ? consoleErrorBuffer.join("\n") : "",
    recentApiFailures: includeBugDetails ? apiFailureBuffer.join("\n") : "",
  };
}
