export function PhaseDivider({ phaseName }: { phaseName: string }) {
  return (
    <div className="mb-4 mt-10 flex items-center gap-3 first:mt-0">
      <span className="whitespace-nowrap font-serif text-sm text-text-tertiary">{phaseName}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
