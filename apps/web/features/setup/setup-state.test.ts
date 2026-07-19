import { expect, test } from "bun:test";
import type { SetupStatus } from "@parson/music-sdk";
import {
  createExclusiveOperations,
  parentDirectory,
  setupScreenFor,
} from "./setup-state";

const readyForFirstAccount: SetupStatus = {
  server_ready: true,
  setup_required: true,
  account_setup_required: true,
  library_setup_required: true,
  library_state: "no_library_indexed",
  message: null,
  authenticated_admin: false,
  suggested_library_path: "/music",
};

test("a ready new server shows first-account setup", () => {
  expect(setupScreenFor(readyForFirstAccount, false)).toBe("account");
});

test("setup moves through sign-in, library, indexing, and completion", () => {
  expect(
    setupScreenFor(
      {
        ...readyForFirstAccount,
        account_setup_required: false,
      },
      false,
    ),
  ).toBe("sign-in");
  expect(
    setupScreenFor(
      {
        ...readyForFirstAccount,
        account_setup_required: false,
        authenticated_admin: true,
      },
      true,
    ),
  ).toBe("library");
  expect(
    setupScreenFor(
      {
        ...readyForFirstAccount,
        account_setup_required: false,
        library_state: "indexing",
      },
      true,
    ),
  ).toBe("indexing");
  expect(
    setupScreenFor(
      {
        ...readyForFirstAccount,
        setup_required: false,
        account_setup_required: false,
        library_setup_required: false,
        library_state: "ready",
      },
      true,
    ),
  ).toBe("done");
});

test("parent navigation preserves filesystem roots", () => {
  expect(parentDirectory("/Users/music")).toBe("/Users");
  expect(parentDirectory("/Users")).toBe("/");
  expect(parentDirectory("C:\\Users")).toBe("C:\\");
  expect(parentDirectory("C:\\")).toBe("C:\\");
  expect(parentDirectory("\\\\server\\share\\music")).toBe("\\\\server\\share");
  expect(parentDirectory("\\\\server\\share")).toBe("\\\\server\\share");
  expect(parentDirectory("/Users/music///")).toBe("/Users");
  expect(parentDirectory("C:/Users/music/")).toBe("C:\\Users");
  expect(parentDirectory("relative\\music")).toBe("relative");
  expect(parentDirectory("")).toBe("/");
});

test("setup mutations are synchronously exclusive", async () => {
  const operations = createExclusiveOperations();
  let release!: () => void;
  const first = operations.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  expect(first).not.toBeNull();
  expect(operations.run(() => Promise.resolve())).toBeNull();
  release();
  await first;
  expect(await operations.run(() => Promise.resolve(7))).toBe(7);
});

test("failed setup operations release the exclusive lease", async () => {
  const operations = createExclusiveOperations();
  await expect(
    operations.run(() => Promise.reject(new Error("failed")))!,
  ).rejects.toThrow("failed");
  expect(await operations.run(() => Promise.resolve("retry"))).toBe("retry");
});
