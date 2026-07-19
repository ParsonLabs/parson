import { expect, test } from "bun:test";
import { createSingleFlight } from "./session-state";

test("concurrent session refreshes share one operation", async () => {
  const flight = createSingleFlight<number>();
  let calls = 0;
  let release!: (value: number) => void;
  const operation = () => {
    calls += 1;
    return new Promise<number>((resolve) => {
      release = resolve;
    });
  };

  const first = flight.run(operation);
  const second = flight.run(operation);
  expect(second).toBe(first);
  expect(calls).toBe(1);
  release(42);
  expect(await first).toBe(42);
});

test("a rejected refresh does not poison later attempts", async () => {
  const flight = createSingleFlight<number>();
  await expect(
    flight.run(() => Promise.reject(new Error("offline"))),
  ).rejects.toThrow("offline");
  expect(await flight.run(() => Promise.resolve(7))).toBe(7);
});
