import { describe, expect, test } from "bun:test";
import {
  playerRouteIdentity,
  shouldDismissPlayerOverlay,
  shouldDismissPlayerOverlayForLink,
} from "./player-overlay-state";

describe("player overlay navigation state", () => {
  test("dismisses lyrics when navigating from Home to an artist or album", () => {
    const home = playerRouteIdentity("/", "");
    expect(
      shouldDismissPlayerOverlay(
        home,
        playerRouteIdentity("/artist", "id=artist-1"),
      ),
    ).toBe(true);
    expect(
      shouldDismissPlayerOverlay(
        home,
        playerRouteIdentity("/album", "id=album-1"),
      ),
    ).toBe(true);
  });

  test("dismisses lyrics when only the artist or album query changes", () => {
    expect(
      shouldDismissPlayerOverlay(
        playerRouteIdentity("/artist", "id=artist-1"),
        playerRouteIdentity("/artist", "id=artist-2"),
      ),
    ).toBe(true);
    expect(
      shouldDismissPlayerOverlay(
        playerRouteIdentity("/album", "id=album-1"),
        playerRouteIdentity("/album", "id=album-2"),
      ),
    ).toBe(true);
  });

  test("does not dismiss merely because the component rendered again", () => {
    const route = playerRouteIdentity("/artist", "id=artist-1");
    expect(shouldDismissPlayerOverlay(route, route)).toBe(false);
  });

  test("recognizes the actual same-origin player and Home link shapes", () => {
    expect(
      shouldDismissPlayerOverlayForLink(
        "http://127.0.0.1:1993/",
        "/album?id=album-1",
      ),
    ).toBe(true);
    expect(
      shouldDismissPlayerOverlayForLink(
        "http://127.0.0.1:1993/",
        "/artist?id=artist-1",
      ),
    ).toBe(true);
    expect(
      shouldDismissPlayerOverlayForLink(
        "http://127.0.0.1:1993/artist?id=artist-1",
        "/artist?id=artist-2",
      ),
    ).toBe(true);
  });

  test("ignores same-page and external links", () => {
    expect(
      shouldDismissPlayerOverlayForLink(
        "http://127.0.0.1:1993/album?id=album-1",
        "/album?id=album-1",
      ),
    ).toBe(false);
    expect(
      shouldDismissPlayerOverlayForLink(
        "http://127.0.0.1:1993/",
        "https://example.com/artist?id=artist-1",
      ),
    ).toBe(false);
  });
});
