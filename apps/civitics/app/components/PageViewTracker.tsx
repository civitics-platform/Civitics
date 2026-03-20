"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

interface Props {
  entityType?: string;
  entityId?: string;
}

/**
 * Fire-and-forget page view tracker.
 * No cookies. No fingerprinting. Session ID lives in sessionStorage only
 * (cleared when the browser tab/window closes — never persisted).
 * Returns null — no visual output.
 */
export function PageViewTracker({ entityType, entityId }: Props) {
  const pathname = usePathname();

  useEffect(() => {
    // Session ID: random UUID scoped to this browser session.
    // sessionStorage clears when the tab closes — not linked to any user account.
    let sessionId = sessionStorage.getItem("cv_session");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem("cv_session", sessionId);
    }

    fetch("/api/track-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: pathname,
        entity_type: entityType,
        entity_id: entityId,
        session_id: sessionId,
      }),
    }).catch(() => {});
    // Silently ignore — tracking must never affect user experience
  }, [pathname, entityType, entityId]);

  return null;
}
