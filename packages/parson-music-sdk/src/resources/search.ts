import api from "../core/http";
import type { CombinedItem } from "../domain/types";

export async function searchLibrary(query: string): Promise<CombinedItem[]> {
  const response = await api.get<CombinedItem[]>("/search", {
    params: { q: query },
  });
  return response.data;
}
