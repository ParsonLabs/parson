import isElectron from "./isElectron";
import isPWA from "./isPWA";
import isTauri from "./isTauri";

export default function isDesktopApp(): boolean {
  return isElectron() || isPWA() || isTauri();
}