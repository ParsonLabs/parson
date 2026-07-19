import api from "../core/http";

interface Directory {
  name: string;
  path: string;
}

export async function listDirectory(path: string): Promise<Directory[]> {
  const response = await api.get<Directory[]>("/filesystem", {
    params: { path },
  });
  return response.data;
}

export async function listSetupDirectory(path: string): Promise<Directory[]> {
  const response = await api.get<Directory[]>("/setup/filesystem", {
    params: { path },
  });
  return response.data;
}
