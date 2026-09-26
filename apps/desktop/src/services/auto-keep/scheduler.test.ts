import { createAutoKeepScheduler } from "./scheduler";

describe("createAutoKeepScheduler", () => {
  it("does not start a run while one is still going", async () => {
    let finish = () => {};
    const run = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const scheduler = createAutoKeepScheduler(run);

    const first = scheduler.runNow();
    await scheduler.runNow();
    expect(run).toHaveBeenCalledTimes(1);

    finish();
    await first;
    const next = scheduler.runNow();
    finish();
    await next;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("carries on after a run throws", async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const scheduler = createAutoKeepScheduler(run);

    await scheduler.runNow();
    await scheduler.runNow();

    expect(run).toHaveBeenCalledTimes(2);
  });
});
