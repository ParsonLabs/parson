import type { SetupStatus } from "@parson/music-sdk";

export type SetupScreen =
  "account" | "library" | "indexing" | "done" | "sign-in";

export function setupScreenFor(
  status: SetupStatus,
  hasAdminSession: boolean,
): SetupScreen {
  if (!status.setup_required) return "done";
  if (status.library_state === "indexing") return "indexing";
  if (status.account_setup_required) return "account";
  if (!hasAdminSession && !status.authenticated_admin) return "sign-in";
  return status.library_setup_required ? "library" : "done";
}

export function parentDirectory(path: string): string {
  if (!path || path === "/" || path === "\\") return path || "/";

  const drive = /^([a-zA-Z]:)[\\/]/.exec(path);
  if (drive) {
    const root = `${drive[1]}\\`;
    const remainder = path.slice(drive[0].length).replace(/[\\/]+$/, "");
    if (!remainder) return root;
    const segments = remainder.split(/[\\/]+/);
    segments.pop();
    return segments.length ? `${root}${segments.join("\\")}` : root;
  }

  if (path.startsWith("\\\\")) {
    const segments = path
      .slice(2)
      .split(/[\\/]+/)
      .filter(Boolean);
    if (segments.length <= 2) return `\\\\${segments.join("\\")}`;
    segments.pop();
    return `\\\\${segments.join("\\")}`;
  }

  const normalized = path.replace(/\/+$/, "");
  const separator = normalized.includes("\\") ? "\\" : "/";
  const segments = normalized.split(separator).filter(Boolean);
  segments.pop();
  return separator === "/"
    ? `/${segments.join("/")}` || "/"
    : segments.join("\\") || "\\";
}

export interface ExclusiveOperations {
  run<T>(operation: () => Promise<T>): Promise<T> | null;
}

export function createExclusiveOperations(): ExclusiveOperations {
  let busy = false;
  return {
    run(operation) {
      if (busy) return null;
      busy = true;
      return operation().finally(() => {
        busy = false;
      });
    },
  };
}
