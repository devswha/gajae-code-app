import { BRAND_NAME, GAJAE_APP_WORDMARK_FONT_FAMILY } from '../../../constants/branding';

const loadingDotOffsets = ['0s', '0.15s', '0.3s'];

function LoadingDots() {
  return (
    <div aria-hidden className="flex items-center justify-center gap-2">
      {loadingDotOffsets.map((offset) => (
        <div
          key={offset}
          className="h-2 w-2 animate-bounce rounded-full bg-primary"
          style={{ animationDelay: offset }}
        />
      ))}
    </div>
  );
}

function BrandMark() {
  return (
    <div className="mb-5 flex justify-center">
      <div className="flex h-20 w-20 items-center justify-center">
        <img src="/mark.svg" alt={BRAND_NAME} className="h-20 w-20 object-contain drop-shadow-lg" />
      </div>
    </div>
  );
}

export default function AuthLoadingScreen() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-144 w-xl -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>
      <div className="relative text-center" role="status" aria-live="polite">
        <BrandMark />
        <h1
          className="mb-4 text-2xl font-bold tracking-tight text-foreground"
          style={{ fontFamily: GAJAE_APP_WORDMARK_FONT_FAMILY }}
        >
          {BRAND_NAME}
        </h1>
        <p className="sr-only">Loading authentication state…</p>
        <LoadingDots />
      </div>
    </div>
  );
}
