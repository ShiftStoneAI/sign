import type { SVGAttributes } from 'react';

export type LogoProps = SVGAttributes<SVGSVGElement>;

// Shiftstone: the Shiftstone lockup (black stone lower-left, teal stone upper-right, wordmark).
export const BrandingLogo = ({ ...props }: LogoProps) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 196 36" {...props}>
      <rect x="2" y="20" width="20" height="12" rx="6" fill="currentColor" />
      <rect x="10" y="6" width="20" height="12" rx="6" fill="#0fa89b" />
      <text
        x="40"
        y="27"
        fontFamily="Gabarito, 'Arial Rounded MT Bold', 'Helvetica Neue', Arial, sans-serif"
        fontSize="22"
        fontWeight="700"
        letterSpacing="-0.4"
        fill="currentColor"
      >
        Shiftstone
      </text>
    </svg>
  );
};
