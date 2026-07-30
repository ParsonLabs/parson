import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { failureCopy, type FailureKind } from "@/lib/failure-state";

export default function FailureState({
  action,
  className = "",
  detail,
  href,
  kind,
  onAction,
}: {
  action?: string;
  className?: string;
  detail?: string | null;
  href?: string;
  kind: FailureKind;
  onAction?: () => void;
}) {
  const copy = failureCopy[kind];
  return (
    <section
      aria-live="polite"
      className={`mx-auto w-full max-w-xl rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-6 text-left ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-300/10 text-amber-200">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-white">{copy.title}</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{copy.body}</p>
          {detail ? (
            <details className="mt-3 text-xs leading-5 text-zinc-500">
              <summary className="cursor-pointer text-zinc-400">
                Technical details
              </summary>
              <p className="mt-2 break-words font-mono">{detail}</p>
            </details>
          ) : null}
          <div className="mt-5">
            {href ? (
              <Button asChild>
                <Link href={href}>{action ?? copy.action}</Link>
              </Button>
            ) : (
              <Button onClick={onAction} type="button">
                {action ?? copy.action}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
