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
      return Promise.resolve(null);
    }

    const user = jwtDecode<ExtendedJWTPayload>(jwt.toString());
    
    const isValidToken = await validateJWT();
    if (!isValidToken) {
      deleteCookie("plm_accessToken");
      return Promise.resolve(null);
    }

    return Promise.resolve(user);
  } catch (error) {
    console.error("Error getting session:", error);
    return Promise.resolve(null);
  }
}