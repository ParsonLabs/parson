import { getCookie, deleteCookie } from "cookies-next";
import { jwtDecode, JwtPayload } from "jwt-decode";
import { validateJWT } from "@music/sdk";

export type ExtendedJWTPayload = JwtPayload & {
  bitrate: number,
  username: string,
  role: string
};

export default async function getSession(): Promise<ExtendedJWTPayload | null> {
  try {
    const jwt = getCookie("plm_accessToken");

    if (!jwt) {
      return null;
    }

    const validationResult = await validateJWT();

    if (validationResult === "error" || validationResult === "invalid") {
      if (validationResult === "invalid") {
        deleteCookie("plm_accessToken");
      }
      return null;
    }

    const user = jwtDecode<ExtendedJWTPayload>(jwt.toString());
    return user;
  } catch (error) {
    return null;
  }
}