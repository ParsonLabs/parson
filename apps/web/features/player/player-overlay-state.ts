export function playerRouteIdentity(pathname: string, query: string) {
  return query ? `${pathname}?${query}` : pathname;
}

export function shouldDismissPlayerOverlay(
  previousRoute: string,
  currentRoute: string,
) {
  return previousRoute !== currentRoute;
}

export function shouldDismissPlayerOverlayForLink(
  currentHref: string,
  destinationHref: string,
) {
  const current = new URL(currentHref);
  const destination = new URL(destinationHref, current);
  if (current.origin !== destination.origin) return false;
  return shouldDismissPlayerOverlay(
    playerRouteIdentity(current.pathname, current.search.slice(1)),
    playerRouteIdentity(destination.pathname, destination.search.slice(1)),
  );
}
