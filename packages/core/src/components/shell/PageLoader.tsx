/** Full-height, centered loading state for pages and lazily loaded app views. */
export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <div className="h-8 w-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
