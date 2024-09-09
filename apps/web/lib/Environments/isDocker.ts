import fs from "fs";

export default function isDocker() {
  let isDockerCached;

  if (isDockerCached === undefined) {
    try {
      fs.statSync('/.dockerenv');
      isDockerCached = true;
    } catch {
      try {
        isDockerCached = fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker');
      } catch {
        isDockerCached = false;
      }
    }
  }

  return isDockerCached;
}