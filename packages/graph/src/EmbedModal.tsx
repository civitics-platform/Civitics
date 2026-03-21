"use client";

import React, { useState } from "react";

export interface EmbedModalProps {
  shareCode: string | null;
  onClose: () => void;
}

type SizePreset = "small" | "medium" | "large" | "custom";

const SIZE_PRESETS: Record<Exclude<SizePreset, "custom">, { width: number; height: number; label: string }> = {
  small:  { width: 400, height: 300, label: "Small (400×300)" },
  medium: { width: 600, height: 450, label: "Medium (600×450)" },
  large:  { width: 800, height: 600, label: "Large (800×600)" },
};

export function EmbedModal({ shareCode, onClose }: EmbedModalProps) {
  const [preset, setPreset] = useState<SizePreset>("large");
  const [customWidth, setCustomWidth] = useState(800);
  const [customHeight, setCustomHeight] = useState(600);
  const [copied, setCopied] = useState(false);

  const width = preset === "custom" ? customWidth : SIZE_PRESETS[preset].width;
  const height = preset === "custom" ? customHeight : SIZE_PRESETS[preset].height;

  const embedUrl = shareCode
    ? `https://civitics.com/graph/embed/${shareCode}`
    : null;

  const iframeCode = embedUrl
    ? `<iframe\n  src="${embedUrl}"\n  width="${width}"\n  height="${height}"\n  frameborder="0"\n  title="Civitics Connection Graph"\n  allowfullscreen>\n</iframe>`
    : null;

  async function handleCopy() {
    if (!iframeCode) return;
    try {
      await navigator.clipboard.writeText(iframeCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-gray-400">&lt;/&gt;</span>
            <span className="text-sm font-semibold text-gray-200">Embed this graph</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {!shareCode ? (
            <div className="text-center py-6">
              <p className="text-gray-400 text-sm">Save a share link first before embedding.</p>
              <p className="text-gray-600 text-xs mt-2">
                Use the "Share / Get link" button to generate a share code, then come back to embed.
              </p>
            </div>
          ) : (
            <>
              {/* Preview dimensions */}
              <div>
                <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Dimensions preview</p>
                <div
                  className="border border-gray-700 rounded bg-gray-950 flex items-center justify-center text-xs text-gray-600"
                  style={{
                    width: "100%",
                    height: "80px",
                  }}
                >
                  {width} × {height} px
                </div>
              </div>

              {/* Size presets */}
              <div>
                <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Size</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.entries(SIZE_PRESETS) as [Exclude<SizePreset, "custom">, typeof SIZE_PRESETS[Exclude<SizePreset, "custom">]][]).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => setPreset(key)}
                      className={`py-1.5 text-[11px] rounded border transition-colors ${
                        preset === key
                          ? "bg-indigo-700 border-indigo-600 text-white"
                          : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
                      }`}
                    >
                      {val.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setPreset("custom")}
                    className={`py-1.5 text-[11px] rounded border transition-colors ${
                      preset === "custom"
                        ? "bg-indigo-700 border-indigo-600 text-white"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {preset === "custom" && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-600 mb-0.5 block">Width</label>
                      <input
                        type="number"
                        value={customWidth}
                        onChange={(e) => setCustomWidth(Math.max(100, parseInt(e.target.value) || 400))}
                        className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <span className="text-gray-600 text-xs mt-4">×</span>
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-600 mb-0.5 block">Height</label>
                      <input
                        type="number"
                        value={customHeight}
                        onChange={(e) => setCustomHeight(Math.max(100, parseInt(e.target.value) || 300))}
                        className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Iframe code */}
              <div>
                <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Embed code</p>
                <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-[10px] text-green-400 font-mono overflow-x-auto whitespace-pre">
                  {iframeCode}
                </pre>
              </div>

              {/* Copy button */}
              <button
                onClick={handleCopy}
                className={`w-full py-2 text-xs font-medium rounded transition-colors ${
                  copied
                    ? "bg-green-800 text-green-200"
                    : "bg-indigo-700 hover:bg-indigo-600 text-white"
                }`}
              >
                {copied ? "Copied ✓" : "Copy embed code"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
