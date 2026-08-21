import { afterEach, describe, expect, it, vi } from "vitest";

const mockAfter = vi.fn();

vi.mock("next/server", () => ({
  after: (callback: () => Promise<unknown>) => mockAfter(callback),
}));

async function importHelper() {
  return (await import("./after-response")).runAfterResponse;
}

afterEach(() => {
  mockAfter.mockReset();
  vi.restoreAllMocks();
});

describe("runAfterResponse", () => {
  it("defers work to after() when a request scope exists", async () => {
    const runAfterResponse = await importHelper();
    const work = vi.fn().mockResolvedValue(undefined);

    await runAfterResponse("test", work);

    // The work is handed to after(), not executed during the request.
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();

    // ...and it runs when the scheduled callback is invoked.
    await mockAfter.mock.calls[0][0]();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("runs work inline when after() has no request scope", async () => {
    const runAfterResponse = await importHelper();
    mockAfter.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
    const work = vi.fn().mockResolvedValue(undefined);

    await runAfterResponse("test", work);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it("swallows deferred work failures so callers are unaffected", async () => {
    const runAfterResponse = await importHelper();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const work = vi.fn().mockRejectedValue(new Error("boom"));

    await runAfterResponse("exploding-work", work);
    await expect(mockAfter.mock.calls[0][0]()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("exploding-work"),
      expect.any(Error),
    );
  });

  it("swallows failures on the inline fallback path too", async () => {
    const runAfterResponse = await importHelper();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockAfter.mockImplementation(() => {
      throw new Error("no request scope");
    });
    const work = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(runAfterResponse("test", work)).resolves.toBeUndefined();
    expect(work).toHaveBeenCalledTimes(1);
  });
});
