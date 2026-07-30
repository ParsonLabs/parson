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
  return current.origin === destination.origin;
}
