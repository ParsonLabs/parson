export interface SingleFlight<T> {
  run(operation: () => Promise<T>): Promise<T>;
}

export function createSingleFlight<T>(): SingleFlight<T> {
  let pending: Promise<T> | null = null;
  return {
    run(operation) {
      pending ??= operation().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
