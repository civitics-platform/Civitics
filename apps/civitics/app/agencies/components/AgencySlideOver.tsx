"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { AgencyRow } from "../page";
import { AGENCY_TYPE_LABELS, AGENCY_TYPE_COLORS, inferSectorTags } from "./AgencyCard";

export function AgencySlideOver({
  agency,
  onClose,
}: {
  agency: AgencyRow | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!agency) return;
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [agency, onClose]);

  if (!agency) return null;

  const typeColor   = AGENCY_TYPE_COLORS[agency.agency_type] ?? AGENCY_TYPE_COLORS["other"]!;
  const typeLabel   = AGENCY_TYPE_LABELS[agency.agency_type] ?? agency.agency_type;
  const sectorTags  = inferSectorTags(agency.name, agency.acronym);
  const displayAcronym = agency.acronym ?? agency.short_name ?? agency.name.slice(0, 5).toUpperCase();

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={agency.name}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-white shadow-xl"
      >
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-gray-200 px-5 py-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 font-mono text-xs font-bold text-gray-700">
            {displayAcronym.slice(0, 5)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1 mb-0.5">
              <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${typeColor}`}>
                {typeLabel}
              </span>
              {sectorTags.map((tag) => (
                <span
                  key={tag.label}
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${tag.color}`}
                >
                  {tag.label}
                </span>
              ))}
            </div>
            <p className="text-sm font-semibold leading-tight text-gray-900 line-clamp-2">
              {agency.name}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-100 bg-gray-100">
            <div className="bg-white px-4 py-3 text-center">
              <p className="text-xl font-bold text-gray-900">
                {agency.totalProposals > 0 ? agency.totalProposals.toLocaleString() : "—"}
              </p>
              <p className="text-[11px] text-gray-400">Total rules</p>
            </div>
            <div className="bg-white px-4 py-3 text-center">
              <p className={`text-xl font-bold ${agency.openProposals > 0 ? "text-emerald-600" : "text-gray-400"}`}>
                {agency.openProposals > 0 ? agency.openProposals.toLocaleString() : "—"}
              </p>
              <p className="text-[11px] text-gray-400">Open now</p>
            </div>
          </div>

          {/* Description */}
          {agency.description && (
            <p className="text-sm leading-relaxed text-gray-600">{agency.description}</p>
          )}

          {/* Quick links */}
          <div className="flex flex-col gap-2">
            <Link
              href={`/graph?entity=${agency.id}`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
            >
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="5" cy="12" r="2" />
                <circle cx="19" cy="5" r="2" />
                <circle cx="19" cy="19" r="2" />
                <line x1="7" y1="11" x2="17" y2="6" strokeLinecap="round" />
                <line x1="7" y1="13" x2="17" y2="18" strokeLinecap="round" />
              </svg>
              Explore in connection graph
            </Link>

            {agency.website_url && (
              <a
                href={agency.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
              >
                <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Official website
              </a>
            )}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="border-t border-gray-200 px-5 py-4">
          <Link
            href={`/agencies/${agency.id}`}
            className="block w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            View full agency profile →
          </Link>
        </div>
      </div>
    </>
  );
}
