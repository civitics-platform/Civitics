import * as React from "react";
import { cn } from "../../lib/cn";

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: Array<{
    label: string;
    href?: string;
  }>;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
    variant?: "primary" | "secondary";
  };
  badge?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  action,
  badge,
}: PageHeaderProps) {
  return (
    <div className="mb-6">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-gray-500">
          <ol className="flex items-center gap-1 list-none p-0 m-0">
            {breadcrumb.map((item, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true" className="text-gray-400">/</span>}
                {item.href ? (
                  <a
                    href={item.href}
                    className="hover:text-gray-700 transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span aria-current="page" className="text-gray-700 font-medium">{item.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{title}</h1>
            {badge && (
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          )}
        </div>
        {action && (
          <div className="shrink-0 mt-0.5">
            {action.href ? (
              <a
                href={action.href}
                className={cn(
                  "inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1",
                  action.variant === "secondary"
                    ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                )}
              >
                {action.label}
              </a>
            ) : (
              <button
                type="button"
                onClick={action.onClick}
                className={cn(
                  "inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1",
                  action.variant === "secondary"
                    ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                )}
              >
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
