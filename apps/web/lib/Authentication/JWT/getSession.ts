import { getCookie, deleteCookie } from "cookies-next";
import { jwtDecode, JwtPayload } from "jwt-decode";
import { isValid, validateJWT } from "@music/sdk";

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
    const isValidResult = await isValid();

    if (validationResult === "error" || validationResult === "invalid" || !isValidResult.status) {
      deleteCookie("plm_accessToken");
      return null;
    }

    const user = jwtDecode<ExtendedJWTPayload>(jwt.toString());
    return user;
  } catch (error) {
    return null;
  }
}