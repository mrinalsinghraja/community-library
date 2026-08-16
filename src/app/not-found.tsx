import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-center px-5 py-14 sm:px-8">
      <div className="w-full">
        <EmptyState
          illustration="🔍"
          title="We looked on every shelf"
          action={
            <ButtonLink href="/" size="lg" icon="🏠">
              Back to the library
            </ButtonLink>
          }
        >
          That page is not here. It might have been put away somewhere else.
        </EmptyState>
      </div>
    </div>
  );
}
