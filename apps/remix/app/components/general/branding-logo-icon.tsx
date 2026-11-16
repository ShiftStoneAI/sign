import type { SVGAttributes } from 'react';

export type LogoProps = SVGAttributes<SVGSVGElement>;

// Shiftstone: the two-stone mark.
export const BrandingLogoIcon = ({ ...props }: LogoProps) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
      <rect x="2" y="18" width="20" height="12" rx="6" fill="currentColor" />
      <rect x="10" y="4" width="20" height="12" rx="6" fill="#0fa89b" />
    </svg>
  );
};
