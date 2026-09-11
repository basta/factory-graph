/**
 * 16px single-weight line icons for UI-only actions. Anything with a game
 * equivalent uses its sprite instead — see DESIGN.md.
 */

interface GlyphProps {
  className?: string;
}

function svg(path: JSX.Element, { className }: GlyphProps): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {path}
    </svg>
  );
}

export const UndoIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <path d="M3 7h7a3.5 3.5 0 0 1 0 7H6.5" />
      <path d="M5.5 4.5 3 7l2.5 2.5" />
    </>,
    p,
  );

export const RedoIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <path d="M13 7H6a3.5 3.5 0 0 0 0 7h3.5" />
      <path d="M10.5 4.5 13 7l-2.5 2.5" />
    </>,
    p,
  );

export const LayoutIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <rect x="1.5" y="2.5" width="4" height="4" />
      <rect x="1.5" y="9.5" width="4" height="4" />
      <rect x="10.5" y="6" width="4" height="4" />
      <path d="M5.5 4.5h2.5V8h2.5M5.5 11.5h2.5V8" />
    </>,
    p,
  );

export const ShareIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <path d="M6.5 9.5 4.2 11.8a2.6 2.6 0 0 1-3.7-3.7l2.3-2.3" />
      <path d="M9.5 6.5l2.3-2.3a2.6 2.6 0 0 1 3.7 3.7l-2.3 2.3" />
      <path d="M6 10 10 6" />
    </>,
    p,
  );

export const ExportIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <path d="M8 2v8" />
      <path d="M5 7.5 8 10.5l3-3" />
      <path d="M2.5 12.5v1h11v-1" />
    </>,
    p,
  );

export const ImportIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <path d="M8 10.5v-8" />
      <path d="M5 5.5 8 2.5l3 3" />
      <path d="M2.5 12.5v1h11v-1" />
    </>,
    p,
  );

export const PowerIcon = (p: GlyphProps): JSX.Element =>
  svg(<path d="M9 1.5 3.5 9H7.5l-.5 5.5L12.5 7H8.5z" />, p);

export const PollutionIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <path d="M4 11.5h7.2a2.7 2.7 0 0 0 .3-5.4A3.6 3.6 0 0 0 4.6 5.2 2.9 2.9 0 0 0 4 11.5Z" />
      <path d="M2 14h12" />
    </>,
    p,
  );

export const HelpIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.3 6.2a1.8 1.8 0 1 1 2 2v1" />
      <path d="M8.3 11.6h.01" />
    </>,
    p,
  );

export const CloseIcon = (p: GlyphProps): JSX.Element =>
  svg(<path d="m4 4 8 8M12 4l-8 8" />, p);

export const PlusIcon = (p: GlyphProps): JSX.Element =>
  svg(<path d="M8 3.5v9M3.5 8h9" />, p);

export const MinusIcon = (p: GlyphProps): JSX.Element => svg(<path d="M3.5 8h9" />, p);

export const ChevronDownIcon = (p: GlyphProps): JSX.Element =>
  svg(<path d="m4 6.5 4 4 4-4" />, p);

export const FitIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <path d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3" />
    </>,
    p,
  );

export const TrashIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <path d="M2.5 4.5h11" />
      <path d="M6 4.5v-2h4v2" />
      <path d="M4 4.5 4.6 14h6.8L12 4.5" />
    </>,
    p,
  );

export const WarnIcon = (p: GlyphProps): JSX.Element =>
  svg(
    <>
      <path d="M8 2.2 14.6 13.4H1.4z" />
      <path d="M8 6.4v3.2" />
      <path d="M8 11.6h.01" />
    </>,
    p,
  );
