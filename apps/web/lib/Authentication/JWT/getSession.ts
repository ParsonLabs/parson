import { getCookie } from "cookies-next";
import { JwtPayload, jwtDecode } from "jwt-decode";

export type ExtendedJWTPayload = JwtPayload & {
  bitrate: number,
  username: string,
  role: string
}


export default function getSession(): ExtendedJWTPayload | null {
  const jwt = getCookie("plm_accessToken");
  if (!jwt) return null

  const user: ExtendedJWTPayload = jwtDecode(jwt);
  return user
}