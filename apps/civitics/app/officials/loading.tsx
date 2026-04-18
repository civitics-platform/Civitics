import { NavBar } from "../components/NavBar";

export default function OfficialsLoading() {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <NavBar />
      {/* Slim sub-header skeleton */}
      <div className="shrink-0 border-b border-gray-100 bg-white px-5 py-2.5 flex items-center gap-2">
        <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-12 animate-pulse rounded-full bg-gray-100" />
      </div>
      {/* Two-panel body skeleton */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="flex w-full flex-col border-r border-gray-200 bg-white lg:w-2/5">
          <div className="shrink-0 border-b border-gray-100 px-4 py-3 space-y-2">
            <div className="h-9 w-full animate-pulse rounded-md bg-gray-100" />
            <div className="flex gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 w-24 animate-pulse rounded border bg-gray-100" />
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-32 animate-pulse rounded bg-gray-200" />
                  <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="h-5 w-5 animate-pulse rounded bg-gray-100" />
              </div>
            ))}
          </div>
        </div>
        {/* Right panel (detail) — desktop only */}
        <div className="hidden flex-col lg:flex lg:w-3/5">
          <div className="flex-1 flex items-center justify-center">
            <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
          </div>
        </div>
      </div>
    </div>
  );
}
