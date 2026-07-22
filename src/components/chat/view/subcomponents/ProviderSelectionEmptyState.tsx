import type { ProjectSession } from "../../../../types/app";

type ProviderSelectionEmptyStateProps = {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
};

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
}: ProviderSelectionEmptyStateProps) {
  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-[34.25rem] text-center">
          <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            Gajae Code
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Ready to help with your project.
          </p>
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-[34.25rem] px-6 text-center">
          <p className="mb-1.5 text-lg font-semibold text-foreground">
            Gajae Code
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This session has no messages yet.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
