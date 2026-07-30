import api from "../core/http";

export interface SignedImageResponse {
  expiresAt: number;
  signature: string;
}

export async function signImagePath(
  path: string,
): Promise<SignedImageResponse> {
  return (
    await api.post<SignedImageResponse>("/media/images/sign", {
      path,
    })
  ).data;
}
