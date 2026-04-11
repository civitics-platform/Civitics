"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Side = "for" | "against";

type ArgumentRow = {
  id: string;
  parent_id: string | null;
  side: Side;
  body: string;
  author_id: string | null;
  is_deleted: boolean;
  flag_count: number;
  vote_count: number;
  created_at: string;
  replies: ArgumentRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── ArgumentVoteButton ───────────────────────────────────────────────────────

function ArgumentVoteButton({
  initiativeId,
  argId,
  initialCount,
  isDeleted,
}: {
  initiativeId: string;
  argId: string;
  initialCount: number;
  isDeleted: boolean;
}) {
  const [count, setCount]   = useState(initialCount);
  const [voted, setVoted]   = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/initiatives/${initiativeId}/arguments/${argId}/vote`)
      .then((r) => r.json())
      .then((d) => setVoted(d.voted ?? false))
      .catch(() => {/* ignore */});
  }, [initiativeId, argId]);

  async function toggle() {
    if (loading || isDeleted) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/initiatives/${initiativeId}/arguments/${argId}/vote`, {
        method: "POST",
      });
      if (res.status === 401) {
        window.location.href = `/auth/sign-in?next=/initiatives/${initiativeId}`;
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setVoted(data.voted);
        setCount(data.vote_count);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading || isDeleted}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-40 ${
        voted
          ? "bg-indigo-100 text-indigo-700"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      }`}
      title={voted ? "Remove vote" : "Vote for this argument"}
    >
      <svg className="h-3 w-3" fill={voted ? "currentColor" : "none"} viewBox="0 0 20 20"
        stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l5-5 5 5M5 9l5-5 5 5" />
      </svg>
      <span>{count}</span>
    </button>
  );
}

// ─── FlagButton ───────────────────────────────────────────────────────────────

function FlagButton({
  initiativeId,
  argId,
  authorId,
  currentUserId,
}: {
  initiativeId: string;
  argId: string;
  authorId: string | null;
  currentUserId: string | null;
}) {
  const [flagged, setFlagged] = useState(false);
  const [open, setOpen]       = useState(false);

  const isOwnArg = currentUserId && authorId === currentUserId;
  if (isOwnArg) return null;

  async function submitFlag(flagType: string) {
    setOpen(false);
    try {
      const res = await fetch(`/api/initiatives/${initiativeId}/arguments/${argId}/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag_type: flagType }),
      });
      if (res.ok) setFlagged(true);
    } catch {/* ignore */}
  }

  if (flagged) {
    return <span className="text-xs text-gray-400">Flagged</span>;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-gray-300 hover:text-gray-500 transition-colors"
        title="Flag this argument"
      >
        ⚑
      </button>
      {open && (
        <div className="absolute right-0 top-5 z-10 w-44 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
          {[
            { value: "off_topic",  label: "Off topic" },
            { value: "misleading", label: "Misleading" },
            { value: "duplicate",  label: "Duplicate" },
            { value: "other",      label: "Other" },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => submitFlag(value)}
              className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setOpen(false)}
            className="block w-full border-t border-gray-100 px-3 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-50 mt-1"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── ReplyForm ────────────────────────────────────────────────────────────────

function ReplyForm({
  initiativeId,
  parentId,
  side,
  onSubmitted,
  onCancel,
}: {
  initiativeId: string;
  parentId: string;
  side: Side;
  onSubmitted: (newArg: ArgumentRow) => void;
  onCancel: () => void;
}) {
  const [body, setBody]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (body.trim().length < 10) { setError("At least 10 characters required."); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/initiatives/${initiativeId}/arguments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side, body: body.trim(), parent_id: parentId }),
      });
      if (res.status === 401) {
        window.location.href = `/auth/sign-in?next=/initiatives/${initiativeId}`;
        return;
      }
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to post reply."); return; }
      onSubmitted({ ...data.argument, replies: [], is_deleted: false, flag_count: 0, vote_count: 0, author_id: null });
      setBody("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 pl-6 border-l-2 border-gray-100">
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
        placeholder="Write a reply… (10–1000 characters)"
        className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
        autoFocus
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={saving || body.trim().length < 10}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "Posting…" : "Post reply"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── ArgumentCard ─────────────────────────────────────────────────────────────

function ArgumentCard({
  arg,
  initiativeId,
  currentUserId,
  onReplySubmitted,
}: {
  arg: ArgumentRow;
  initiativeId: string;
  currentUserId: string | null;
  onReplySubmitted: (parentId: string, newReply: ArgumentRow) => void;
}) {
  const [showReply, setShowReply] = useState(false);
  const isFor = arg.side === "for";

  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm ${
      isFor
        ? "border-emerald-100 hover:border-emerald-200"
        : "border-red-100 hover:border-red-200"
    }`}>
      {/* Body */}
      <p className={`text-sm leading-relaxed ${arg.is_deleted ? "italic text-gray-400" : "text-gray-800"}`}>
        {arg.body}
      </p>

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ArgumentVoteButton
            initiativeId={initiativeId}
            argId={arg.id}
            initialCount={arg.vote_count}
            isDeleted={arg.is_deleted}
          />
          {!arg.is_deleted && (
            <button
              onClick={() => setShowReply((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Reply
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-300">{formatRelTime(arg.created_at)}</span>
          {!arg.is_deleted && (
            <FlagButton
              initiativeId={initiativeId}
              argId={arg.id}
              authorId={arg.author_id}
              currentUserId={currentUserId}
            />
          )}
        </div>
      </div>

      {/* Reply form */}
      {showReply && (
        <ReplyForm
          initiativeId={initiativeId}
          parentId={arg.id}
          side={arg.side}
          onSubmitted={(newReply) => {
            onReplySubmitted(arg.id, newReply);
            setShowReply(false);
          }}
          onCancel={() => setShowReply(false)}
        />
      )}

      {/* Replies */}
      {arg.replies.length > 0 && (
        <div className="mt-3 space-y-2 border-l-2 border-gray-100 pl-3">
          {arg.replies.map((reply) => (
            <div key={reply.id} className="rounded-md bg-gray-50 p-2">
              <p className={`text-xs leading-relaxed ${reply.is_deleted ? "italic text-gray-400" : "text-gray-700"}`}>
                {reply.body}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <ArgumentVoteButton
                  initiativeId={initiativeId}
                  argId={reply.id}
                  initialCount={reply.vote_count}
                  isDeleted={reply.is_deleted}
                />
                <span className="text-xs text-gray-300">{formatRelTime(reply.created_at)}</span>
                {!reply.is_deleted && (
                  <FlagButton
                    initiativeId={initiativeId}
                    argId={reply.id}
                    authorId={reply.author_id}
                    currentUserId={currentUserId}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SubmitArgumentForm ───────────────────────────────────────────────────────

function SubmitArgumentForm({
  initiativeId,
  defaultSide,
  onSubmitted,
}: {
  initiativeId: string;
  defaultSide: Side;
  onSubmitted: (arg: ArgumentRow) => void;
}) {
  const [side, setSide]     = useState<Side>(defaultSide);
  const [body, setBody]     = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (body.trim().length < 10) { setError("At least 10 characters required."); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/initiatives/${initiativeId}/arguments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side, body: body.trim() }),
      });
      if (res.status === 401) {
        window.location.href = `/auth/sign-in?next=/initiatives/${initiativeId}`;
        return;
      }
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to post argument."); return; }
      onSubmitted({ ...data.argument, replies: [], is_deleted: false, flag_count: 0, vote_count: 0, author_id: null });
      setBody("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Add your argument</p>

      {/* Side toggle */}
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setSide("for")}
          className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${
            side === "for"
              ? "border-emerald-400 bg-emerald-50 text-emerald-700"
              : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
          }`}
        >
          ✓ For
        </button>
        <button
          type="button"
          onClick={() => setSide("against")}
          className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${
            side === "against"
              ? "border-red-400 bg-red-50 text-red-700"
              : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
          }`}
        >
          ✕ Against
        </button>
      </div>

      <textarea
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
        placeholder={
          side === "for"
            ? "Make the case for this initiative…"
            : "Explain your objection or concern…"
        }
        className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className={`text-xs tabular-nums ${body.length > 950 ? "text-red-400" : "text-gray-400"}`}>
          {body.length}/1000
        </span>
      </div>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={saving || body.trim().length < 10}
        className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? "Posting…" : `Post ${side === "for" ? "supporting" : "opposing"} argument`}
      </button>
    </form>
  );
}

// ─── ArgumentColumn ───────────────────────────────────────────────────────────

function ArgumentColumn({
  side,
  args,
  initiativeId,
  currentUserId,
  onReplySubmitted,
}: {
  side: Side;
  args: ArgumentRow[];
  initiativeId: string;
  currentUserId: string | null;
  onReplySubmitted: (parentId: string, newReply: ArgumentRow) => void;
}) {
  const isFor = side === "for";
  const label = isFor ? "For" : "Against";
  const accent = isFor ? "text-emerald-700" : "text-red-600";
  const countBg = isFor
    ? "bg-emerald-100 text-emerald-800"
    : "bg-red-100 text-red-800";

  return (
    <div className="flex flex-col gap-3">
      {/* Column header */}
      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold ${accent}`}>
          {isFor ? "✓" : "✕"} {label}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${countBg}`}>
          {args.length}
        </span>
      </div>

      {args.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center">
          <p className="text-xs text-gray-400">
            No {label.toLowerCase()} arguments yet.{" "}
            <span className="text-gray-500">Be the first.</span>
          </p>
        </div>
      ) : (
        args.map((arg) => (
          <ArgumentCard
            key={arg.id}
            arg={arg}
            initiativeId={initiativeId}
            currentUserId={currentUserId}
            onReplySubmitted={onReplySubmitted}
          />
        ))
      )}
    </div>
  );
}

// ─── ArgumentBoard ────────────────────────────────────────────────────────────

interface ArgumentBoardProps {
  initiativeId: string;
  stage: string;
  currentUserId: string | null;
}

export function ArgumentBoard({ initiativeId, stage, currentUserId }: ArgumentBoardProps) {
  const [forArgs, setForArgs]       = useState<ArgumentRow[]>([]);
  const [againstArgs, setAgainstArgs] = useState<ArgumentRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const canSubmit = stage === "deliberate" || stage === "mobilise";

  const fetchArguments = useCallback(async () => {
    try {
      const res = await fetch(`/api/initiatives/${initiativeId}/arguments`);
      const data = await res.json();
      if (res.ok) {
        setForArgs(data.for ?? []);
        setAgainstArgs(data.against ?? []);
      } else {
        setError(data.error ?? "Failed to load arguments.");
      }
    } catch {
      setError("Failed to load arguments.");
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    fetchArguments();
  }, [fetchArguments]);

  function handleNewArg(newArg: ArgumentRow) {
    if (newArg.side === "for") {
      setForArgs((prev) => [newArg, ...prev]);
    } else {
      setAgainstArgs((prev) => [newArg, ...prev]);
    }
  }

  function handleReplySubmitted(parentId: string, newReply: ArgumentRow) {
    function addReply(args: ArgumentRow[]): ArgumentRow[] {
      return args.map((a) =>
        a.id === parentId
          ? { ...a, replies: [...a.replies, newReply] }
          : a
      );
    }
    if (newReply.side === "for") {
      setForArgs((prev) => addReply(prev));
    } else {
      setAgainstArgs((prev) => addReply(prev));
    }
  }

  return (
    <div className="mt-10">
      {/* Section header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900">Argument board</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Best-supported arguments rise. Vote for reasoning you find most compelling.
          </p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-0.5 text-xs font-semibold text-gray-600">
          {forArgs.length + againstArgs.length} arguments
        </span>
      </div>

      {/* Not open for argument yet */}
      {!canSubmit && stage !== "resolved" && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Arguments open once this initiative is in deliberation.
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-sm text-gray-400">Loading arguments…</div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ArgumentColumn
            side="for"
            args={forArgs}
            initiativeId={initiativeId}
            currentUserId={currentUserId}
            onReplySubmitted={handleReplySubmitted}
          />
          <ArgumentColumn
            side="against"
            args={againstArgs}
            initiativeId={initiativeId}
            currentUserId={currentUserId}
            onReplySubmitted={handleReplySubmitted}
          />
        </div>
      )}

      {/* Submit form */}
      {canSubmit && (
        <div className="mt-8">
          <SubmitArgumentForm
            initiativeId={initiativeId}
            defaultSide="for"
            onSubmitted={handleNewArg}
          />
        </div>
      )}
    </div>
  );
}
