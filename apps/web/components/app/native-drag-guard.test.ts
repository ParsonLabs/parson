import { describe, expect, it } from "bun:test";
import {
  allowsNativeDrop,
  allowsNativeDrag,
  NATIVE_DRAG_OPT_IN_SELECTOR,
} from "./native-drag-guard";

describe("native drag guard", () => {
  it("blocks document surfaces and non-elements", () => {
    expect(allowsNativeDrag(null)).toBeFalse();
    expect(allowsNativeDrag({} as EventTarget)).toBeFalse();
  });

  it("blocks ordinary links, artwork, text, and controls", () => {
    const target = {
      closest: (selector: string) => {
        expect(selector).toBe(NATIVE_DRAG_OPT_IN_SELECTOR);
        return null;
      },
    };
    expect(allowsNativeDrag(target as unknown as EventTarget)).toBeFalse();
  });

  it("allows only an explicit intentional drag surface", () => {
    const dragSurface = {};
    const target = {
      closest: () => dragSurface,
    };
    expect(allowsNativeDrag(target as unknown as EventTarget)).toBeTrue();
  });

  it("allows drops only during an intentional drag and on its opt-in surface", () => {
    const optedIn = {
      closest: () => ({}),
    } as unknown as EventTarget;
    const ordinary = {
      closest: () => null,
    } as unknown as EventTarget;

    expect(allowsNativeDrop(false, optedIn)).toBeFalse();
    expect(allowsNativeDrop(true, ordinary)).toBeFalse();
    expect(allowsNativeDrop(true, optedIn)).toBeTrue();
  });
});
