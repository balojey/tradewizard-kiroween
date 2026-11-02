"use client";

import { useState } from "react";

/**
 * Client-side cursor history.
 *
 * The API only paginates forward, so "Previous" replays the stack we have walked
 * in this session. The current cursor lives in the URL; the stack does not, so a
 * full page reload starts a fresh walk (acceptable: the cursor still works).
 *
 * Reset is derived rather than done in an effect: if the filters changed, the
 * stored stack belongs to a different result set and is ignored. That avoids a
 * render cascade every time a filter changes.
 */
export function useCursorStack(resetKey: string) {
  const [state, setState] = useState<{ key: string; stack: string[] }>({
    key: resetKey,
    stack: [],
  });

  const stack = state.key === resetKey ? state.stack : [];
  const cursor = stack.length > 0 ? stack[stack.length - 1] : null;

  return {
    cursor,
    canPrev: stack.length > 0,
    next: (nextCursor: string) =>
      setState((current) => ({
        key: resetKey,
        stack: [...(current.key === resetKey ? current.stack : []), nextCursor],
      })),
    prev: () =>
      setState((current) => ({
        key: resetKey,
        stack: (current.key === resetKey ? current.stack : []).slice(0, -1),
      })),
  };
}
