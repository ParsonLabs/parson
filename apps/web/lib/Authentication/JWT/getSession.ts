import { getCookie, deleteCookie } from "cookies-next";
import { jwtDecode, JwtPayload } from "jwt-decode";
import { validateJWT } from "@music/sdk";

export type ExtendedJWTPayload = JwtPayload & {
  bitrate: number,
  username: string,
  role: string
};

export default function getSession(): ExtendedJWTPayload | null {
  const jwt = getCookie("plm_accessToken");
  if (!jwt) return null

  validateJWT().then(validationResult => {
    if (validationResult === "error") {
      return null;
    }

    if (validationResult === "invalid") {
      deleteCookie("plm_accessToken");
      return null;
    }
  });

  const user: ExtendedJWTPayload = jwtDecode(jwt as string);
  return user;
}