import api from "../core/http";

export interface BackupSummary {
  filename: string;
  created_at: string;
  size_bytes: number;
  tier?: "daily" | "weekly" | "monthly" | null;
}

export interface DataStatus {
  database_bytes: number;
  user_file_bytes: number;
  cache_bytes: number;
  listen_history_items: number;
  favorite_items: number;
  playlist_items: number;
  backups: BackupSummary[];
  automatic_backup_interval_hours: number;
  daily_backup_count: number;
  weekly_backup_count: number;
  monthly_backup_count: number;
  restore_pending: boolean;
  reset_pending: boolean;
}

export interface RestoreResult {
  restart_required: boolean;
  message: string;
}

export async function getDataStatus(): Promise<DataStatus> {
  return (await api.get<DataStatus>("/data/admin/status")).data;
}

export async function createPrivateBackup(): Promise<BackupSummary> {
  return (
    await api.post<BackupSummary>("/data/admin/backups", undefined, {
      timeout: 30 * 60 * 1000,
    })
  ).data;
}

export async function downloadPrivateBackup(filename: string): Promise<Blob> {
  return (
    await api.get<Blob>(`/data/admin/backups/${encodeURIComponent(filename)}`, {
      responseType: "blob",
      timeout: 30 * 60 * 1000,
    })
  ).data;
}

export async function deletePrivateBackup(filename: string): Promise<void> {
  await api.delete(`/data/admin/backups/${encodeURIComponent(filename)}`);
}

export async function restorePrivateBackup(file: File): Promise<RestoreResult> {
  const data = new FormData();
  data.append("backup", file, file.name);
  return (
    await api.post<RestoreResult>("/data/admin/restore", data, {
      timeout: 30 * 60 * 1000,
    })
  ).data;
}

export async function exportPublicLibraryIndex(): Promise<Blob> {
  return (
    await api.get<Blob>("/data/admin/public-index", {
      responseType: "blob",
      timeout: 30 * 60 * 1000,
    })
  ).data;
}

export async function exportPersonalData(): Promise<Blob> {
  return (
    await api.get<Blob>("/data/me/export", {
      responseType: "blob",
      timeout: 30 * 60 * 1000,
    })
  ).data;
}

export async function clearPersonalHistory(): Promise<{ deleted: number }> {
  return (await api.delete<{ deleted: number }>("/data/me/history")).data;
}

export async function clearParsonCache(): Promise<{ cleared_bytes: number }> {
  return (
    await api.delete<{ cleared_bytes: number }>("/data/admin/cache", {
      timeout: 30 * 60 * 1000,
    })
  ).data;
}

export async function resetParson(
  confirmation: string,
): Promise<RestoreResult> {
  return (
    await api.post<RestoreResult>("/data/admin/reset", {
      confirmation,
    })
  ).data;
}
