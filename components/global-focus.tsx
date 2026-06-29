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
    return () => document.removeEventListener("focusin", handleFocus);
  }, []);

  return null;
}
