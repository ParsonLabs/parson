export type StoredAccount = {
  accessToken: string;
  instanceId: string;
  origin: string;
  refreshToken: string | null;
  sub: string;
  username: string;
};

const MAX_ACCOUNTS = 12;

function validAccount(value: unknown): value is StoredAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<StoredAccount>;
  return (
    typeof account.accessToken === "string" &&
    account.accessToken.length > 0 &&
    account.accessToken.length <= 16_384 &&
    typeof account.instanceId === "string" &&
    account.instanceId.length > 0 &&
    account.instanceId.length <= 256 &&
    typeof account.origin === "string" &&
    /^https?:\/\//i.test(account.origin) &&
    (account.refreshToken === null ||
      (typeof account.refreshToken === "string" &&
        account.refreshToken.length > 0 &&
        account.refreshToken.length <= 16_384)) &&
    typeof account.sub === "string" &&
    account.sub.length > 0 &&
    account.sub.length <= 256 &&
    typeof account.username === "string" &&
    account.username.trim().length > 0 &&
    account.username.length <= 256
  );
}

export function parseStoredAccounts(serialized: string | null) {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validAccount).slice(0, MAX_ACCOUNTS);
  } catch {
    return [];
  }
}

export function upsertStoredAccount(
  accounts: StoredAccount[],
  account: StoredAccount,
) {
  return [
    account,
    ...accounts.filter(
      (item) =>
        !(item.instanceId === account.instanceId && item.sub === account.sub),
    ),
  ].slice(0, MAX_ACCOUNTS);
}

export function accountKey(account: Pick<StoredAccount, "instanceId" | "sub">) {
  return `${account.instanceId}:${account.sub}`;
}

export function renameStoredAccount(
  accounts: StoredAccount[],
  instanceId: string,
  sub: string,
  username: string,
) {
  return accounts.map((account) =>
    account.instanceId === instanceId && account.sub === sub
      ? { ...account, username }
      : account,
  );
}
