import type { ReactNode } from 'react';

/**
 * Shiftstone (Bryan, 2026-11-17): the admin's dark banner with the brand's two stones (workshop:
 * src/components/admin/stone-banner.tsx), so Sign's pages open like the other admin areas.
 */
export const ShiftstoneBanner = ({
  title,
  children,
  stats,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  stats?: [ReactNode, number][];
  action?: ReactNode;
}) => (
  <section className="relative mt-8 mb-8 overflow-hidden rounded-3xl bg-[#111111] p-6 text-white sm:p-8">
    <span
      aria-hidden
      className="absolute -right-6 top-5 hidden h-12 w-40 rounded-full bg-primary/90 shadow-[inset_0_2px_0_rgba(255,255,255,.4)] md:block"
    />
    <span
      aria-hidden
      className="absolute right-14 top-20 hidden h-12 w-40 rounded-full bg-[#111111] shadow-[inset_0_2px_0_rgba(255,255,255,.3),inset_0_0_0_1.5px_rgba(255,255,255,.28)] md:block"
    />
    <div className="relative flex flex-col gap-4 md:max-w-[calc(100%-13rem)]">
      <h1 className="font-bold text-4xl text-white tracking-tight">{title}</h1>
      {children && <p className="max-w-2xl text-sm text-white/75">{children}</p>}
      {(!!stats?.length || action) && (
        <div className="flex flex-wrap items-center gap-2">
          {stats?.map(([label, n], i) => (
            <span key={i} className="rounded-full bg-white/10 px-3 py-1 text-sm text-white/85">
              <span className="font-bold text-primary tabular-nums" style={{ fontFamily: 'var(--font-display)' }}>
                {n}
              </span>{' '}
              {label}
            </span>
          ))}
          {action}
        </div>
      )}
    </div>
  </section>
);
