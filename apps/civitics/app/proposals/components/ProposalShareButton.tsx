"use client";

import { useState, type MouseEvent } from "react";

interface ProposalShareButtonProps {
  title: string;
  id: string;
  /** Stop click from bubbling to parent Link when used inside a card */
  stopPropagation?: boolean;
}

// QWEN-ADDED: Share button for proposal pages and cards — copy URL or native share
export function ProposalShareButton({ title, id, stopPropagation = false }: ProposalShareButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleShare(e: MouseEvent<HTMLButtonElement>) {
    if (stopPropagation) e.stopPropagation();
    const fullUrl = window.location.origin + `/proposals/${id}`;

    if (navigator.share) {
      await navigator.share({
        title: `${title} | Civitics`,
        text: "Read about this proposal on Civitics",
        url: fullUrl,
      });
    } else {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleShare}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
    >
      {copied ? "✓ Copied" : "↗ Share"}
    </button>
  );
}
