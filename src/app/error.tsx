"use client";

import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/**
 * What a reader sees when something breaks.
 *
 * No status code, no stack trace, no error id that means nothing to a child.
 * The technical detail is logged on the server, where a librarian's helper can
 * actually act on it.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Next.js already reports this server-side; the digest is the link between
    // what the reader saw and the server log entry.
    console.error("Unhandled error in route:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-center px-5 py-14 sm:px-8">
      <div className="w-full">
        <ErrorState
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={reset} size="lg" icon="🔄">
                Try again
              </Button>
              <ButtonLink href="/" variant="quiet" size="lg">
                Back to the library
              </ButtonLink>
            </div>
          }
        >
          Something went wrong on our side — it is not anything you did. Try again, and if it keeps
          happening please tell your librarian.
        </ErrorState>
      </div>
    </div>
  );
}
