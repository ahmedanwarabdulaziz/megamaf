"use client";

import { useEffect } from "react";

export function GlobalFocus() {
  useEffect(() => {
    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement) {
        const allowedTypes = ['text', 'number', 'password', 'search', 'tel', 'url', 'email'];
        if (allowedTypes.includes(target.type) || !target.type) {
          target.select();
        }
      }
    };

    document.addEventListener("focusin", handleFocus);

    // Chrome changes a focused number input's value when the mouse wheel
    // scrolls over it — block that so scrolling the page never mutates a
    // quantity/price field by accident.
    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement &&
        target.type === "number" &&
        document.activeElement === target
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      document.removeEventListener("focusin", handleFocus);
      document.removeEventListener("wheel", handleWheel);
    };
  }, []);

  return null;
}
