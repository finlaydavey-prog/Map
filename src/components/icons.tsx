interface IconProps {
  className?: string;
}

export const CarIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M5 11l1.3-3.9A2 2 0 0 1 8.2 5.7h7.6a2 2 0 0 1 1.9 1.4L19 11" />
    <path d="M4 11h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1.2M4 11a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1.2" />
    <circle cx="7.5" cy="17" r="1.8" />
    <circle cx="16.5" cy="17" r="1.8" />
    <path d="M9.3 17h5.4" />
  </svg>
);

export const TransitIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="5" y="3.5" width="14" height="13.5" rx="3" />
    <path d="M5 10h14" />
    <circle cx="9" cy="13.8" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="13.8" r="1" fill="currentColor" stroke="none" />
    <path d="M8.5 20.5L7 17m8.5 3.5L17 17" />
  </svg>
);

export const WalkIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="13" cy="4.5" r="1.9" />
    <path d="M12.7 8.5l-2.9 1.8-1 3.2" />
    <path d="M12.7 8.5l1.2 4-2.6 4-1.3 4" />
    <path d="M13.9 12.5l2.3 2 1.5 5.5" />
    <path d="M13.9 12.5l1.6-1.2 2.5.4" />
  </svg>
);

export const BikeIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="6" cy="16.5" r="3.4" />
    <circle cx="18" cy="16.5" r="3.4" />
    <path d="M6 16.5l3.4-6h6.2" />
    <path d="M12.5 16.5l3-6.5" />
    <path d="M14.2 7h2.2l1.6 3" />
    <path d="M8.2 10.5L7 8h2.4" />
  </svg>
);

export const SearchIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.4-4.4" />
  </svg>
);

export const LinkIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4.4l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4L11.4 6.6" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4-.4l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4" />
  </svg>
);

export const PlusIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const XIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
