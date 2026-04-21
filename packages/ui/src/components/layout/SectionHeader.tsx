import * as React from "react";

interface SectionHeaderProps {
  title: string;
  description?: React.ReactNode;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  /** Pass a string emoji (legacy) or a React node (e.g. a Lucide icon) */
  icon?: string | React.ReactNode;
  status?: "ok" | "warning" | "error";
}

const statusDot: Record<NonNullable<SectionHeaderProps["status"]>, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-rose-500",
};

export function SectionHeader({
  title,
  description,
  action,
  icon,
  status,
}: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && (
            typeof icon === "string"
              ? <span className="text-base">{icon}</span>
              : <span className="text-gray-500 flex-shrink-0">{icon}</span>
          )}
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {status && (
            <span
              className={`inline-block h-2 w-2 rounded-full ${statusDot[status]}`}
              aria-label={status}
            />
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
        )}
      </div>
      {action && (
        <div className="shrink-0">
          {action.href ? (
            <a
              href={action.href}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors duration-150"
            >
              {action.label} →
            </a>
          ) : (
            <button
              onClick={action.onClick}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors duration-150"
            >
              {action.label} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
