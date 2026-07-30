function isAllowedNavigation(url, applicationOrigin, allowedLocalPages = []) {
  try {
    const candidate = new URL(url);
    if (candidate.origin === applicationOrigin) return true;
    if (candidate.protocol !== "file:") return false;
    candidate.search = "";
    candidate.hash = "";
    return allowedLocalPages.includes(candidate.href);
  } catch {
    return false;
  }
}

module.exports = { isAllowedNavigation };
