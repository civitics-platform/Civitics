"use client";

import { useState } from "react";
import { GlobalSearch } from "./GlobalSearch";
import { AuthButton } from "./AuthButton";

const NAV_ITEMS = [
  { label: "Officials",   href: "/officials" },
  { label: "Proposals",   href: "/proposals" },
  { label: "Initiatives", href: "/initiatives" },
  { label: "Agencies",    href: "/agencies" },
  { label: "Graph",       href: "/graph" },
  { label: "Dashboard",   href: "/dashboard" },
];

export function NavBar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <a href="/" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-indigo-600">
              <span className="text-xs font-bold text-white">CV</span>
            </div>
            <span className="text-lg font-semibold tracking-tight text-gray-900">Civitics</span>
          </a>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-4">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Desktop search */}
          <div className="hidden lg:block">
            <GlobalSearch variant="nav" />
          </div>

          {/* Right side: auth + hamburger */}
          <div className="flex items-center gap-2">
            <AuthButton />
            {/* Hamburger — mobile only */}
            <button
              type="button"
              className="md:hidden inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((o) => !o)}
            >
              {mobileOpen ? (
                // X icon
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                // Hamburger icon
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu — slides in below header */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 py-3">
          {/* Mobile search */}
          <div className="mb-3">
            <GlobalSearch variant="nav" />
          </div>
          {/* Nav links */}
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
