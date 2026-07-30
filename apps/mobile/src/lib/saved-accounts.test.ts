import { describe, expect, test } from "bun:test";

import {
  accountKey,
  parseStoredAccounts,
  renameStoredAccount,
  upsertStoredAccount,
  type StoredAccount,
} from "./saved-accounts";

const account = (sub: string, username = sub): StoredAccount => ({
  accessToken: `access-${sub}`,
  instanceId: "library-a",
  origin: "https://music.example.test",
  refreshToken: `refresh-${sub}`,
  sub,
  username,
});

describe("saved mobile accounts", () => {
  test("keeps the newest session for each library account", () => {
    const updated = upsertStoredAccount(
      [account("1", "old"), account("2")],
      account("1", "new"),
    );
    expect(updated.map((item) => item.username)).toEqual(["new", "2"]);
    expect(accountKey(updated[0]!)).toBe("library-a:1");
  });

  test("rejects malformed or unsafe stored records", () => {
    expect(parseStoredAccounts("not-json")).toEqual([]);
    expect(
      parseStoredAccounts(
        JSON.stringify([
          account("1"),
          { ...account("2"), origin: "file:///private" },
          { ...account("3"), refreshToken: 42 },
        ]),
      ),
    ).toEqual([account("1")]);
  });

  test("renaming an account preserves tokens and unrelated accounts", () => {
    const accounts = [account("1", "old-handle"), account("2", "other-handle")];
    const renamed = renameStoredAccount(
      accounts,
      accounts[0]!.instanceId,
      "1",
      "new-handle",
    );

    expect(renamed[0]).toEqual({ ...accounts[0], username: "new-handle" });
    expect(renamed[1]).toEqual(accounts[1]);
  });
});
