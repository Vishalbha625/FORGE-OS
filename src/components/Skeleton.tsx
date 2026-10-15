// Loading placeholders in the shape of what's coming, instead of "Loading..." text.
// Decorative: the container that uses them carries role="status" and a label.

const BASE = 'animate-pulse motion-reduce:animate-none bg-stone-200 dark:bg-stone-700';

export function SkeletonCard({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`${BASE} h-[120px] rounded-xl ${className}`} />;
}

/** One line of text; pass a Tailwind width class such as "w-1/2". */
export function SkeletonLine({ width = 'w-full', className = '' }: { width?: string; className?: string }) {
  return <div aria-hidden className={`${BASE} h-3 rounded ${width} ${className}`} />;
}

const AVATAR = { sm: 'h-6 w-6', md: 'h-9 w-9', lg: 'h-16 w-16' } as const;

export function SkeletonAvatar({ size = 'md' }: { size?: keyof typeof AVATAR }) {
  return <div aria-hidden className={`${BASE} shrink-0 rounded-full ${AVATAR[size]}`} />;
}

export function SkeletonChart({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`${BASE} h-[200px] rounded-xl ${className}`} />;
}

/** A post-shaped placeholder: avatar, name, two lines of text. */
export function SkeletonPost() {
  return (
    <div aria-hidden className="card space-y-3 p-4">
      <div className="flex items-center gap-3">
        <SkeletonAvatar />
        <div className="flex-1 space-y-2">
          <SkeletonLine width="w-1/3" />
          <SkeletonLine width="w-1/4" />
        </div>
      </div>
      <SkeletonLine width="w-5/6" />
      <SkeletonLine width="w-2/3" />
    </div>
  );
}
