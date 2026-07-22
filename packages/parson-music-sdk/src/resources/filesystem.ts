import api from "../core/http";

interface Directory {
  name: string;
  path: string;
}

export async function listDirectory(
  path: string,
  showHidden = false,
): Promise<Directory[]> {
  const response = await api.get<Directory[]>("/filesystem", {
    params: { path, show_hidden: showHidden },
  });
  return response.data;
}

export async function listSetupDirectory(
  path: string,
  showHidden = false,
): Promise<Directory[]> {
  const response = await api.get<Directory[]>("/setup/filesystem", {
    params: { path, show_hidden: showHidden },
  });
  return response.data;
}
