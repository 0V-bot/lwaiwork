'use client';

/**
 * Inline SVG glyphs rendered by contentType. Kept module-local so we don't
 * pull in a 200 KB icon library for five glyphs.
 *
 * The shapes match the icons used in the rest of the app (16x16 viewBox,
 * 1.5 stroke, currentColor). Coloured background pill is set by the caller
 * (`<FileCard>`) — this component just renders the glyph.
 */

interface FileTypeIconProps {
  contentType: string;
  className?: string;
}

/** One of the small categorical buckets we render with a dedicated glyph.
 *  Anything not in this set falls back to a generic file glyph. */
type Bucket =
  | 'pdf'
  | 'image'
  | 'json'
  | 'markdown'
  | 'csv'
  | 'plain'
  | 'zip';

function bucketOf(contentType: string): Bucket | null {
  const ct = contentType.toLowerCase();
  if (ct === 'application/pdf') return 'pdf';
  if (ct === 'application/json') return 'json';
  if (ct === 'application/zip') return 'zip';
  if (ct === 'text/markdown') return 'markdown';
  if (ct === 'text/csv') return 'csv';
  if (ct === 'text/plain') return 'plain';
  if (ct.startsWith('image/')) return 'image';
  return null;
}

export function FileTypeIcon({ contentType, className }: FileTypeIconProps) {
  const bucket = bucketOf(contentType);
  const cls = ['h-5 w-5 shrink-0', className ?? ''].join(' ');

  switch (bucket) {
    case 'pdf':
      return <PdfGlyph className={cls} />;
    case 'image':
      return <ImageGlyph className={cls} />;
    case 'json':
      return <JsonGlyph className={cls} />;
    case 'markdown':
      return <MarkdownGlyph className={cls} />;
    case 'csv':
      return <CsvGlyph className={cls} />;
    case 'plain':
      return <PlainGlyph className={cls} />;
    case 'zip':
      return <ZipGlyph className={cls} />;
    default:
      return <GenericGlyph className={cls} />;
  }
}

// ---------------------------------------------------------------------------
// Glyphs. All 16x16 viewBox so they're swappable in <FileCard> / detail /
// search contexts without re-scaling.
// ---------------------------------------------------------------------------

function Glyph({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function PdfGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <path d="M3.5 1.75h6L12.5 4.75v9.5h-9z" />
      <path d="M9.5 1.75v3h3" />
      <text x="8" y="11.5" fontSize="4.4" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">
        PDF
      </text>
    </Glyph>
  );
}

function ImageGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <path d="M2.5 11.5 5.5 9l2.5 2 3-3 3 3" />
    </Glyph>
  );
}

function JsonGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <path d="M3.5 1.75h6L12.5 4.75v9.5h-9z" />
      <path d="M9.5 1.75v3h3" />
      <path d="M5.5 7c-.55 0-1 .45-1 1v1c0 .28-.22.5-.5.5" />
      <path d="M10.5 7c.55 0 1 .45 1 1v1c0 .28.22.5.5.5" />
    </Glyph>
  );
}

function MarkdownGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <rect x="1.75" y="4.75" width="12.5" height="6.5" rx="1.2" />
      <path d="M4 9V7l1.5 1.5L7 7v2M8.5 7v2M8.5 8l1.5-1M10 7v2" />
    </Glyph>
  );
}

function CsvGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <path d="M3.5 1.75h6L12.5 4.75v9.5h-9z" />
      <path d="M9.5 1.75v3h3" />
      <path d="M5 8.5h6M5 10.5h6M5 11.75h4" />
    </Glyph>
  );
}

function PlainGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <path d="M3.5 1.75h6L12.5 4.75v9.5h-9z" />
      <path d="M9.5 1.75v3h3" />
      <path d="M5.5 7.75h5M5.5 9.75h5M5.5 11.75h3" />
    </Glyph>
  );
}

function ZipGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <path d="M3.5 1.75h6L12.5 4.75v9.5h-9z" />
      <path d="M9.5 1.75v3h3" />
      <path d="M7 6h2v1H7M7 8h2v1H7M7 10h2v1H7M5.5 6h1M5.5 8h1M5.5 10h1M5.5 12h1" />
    </Glyph>
  );
}

function GenericGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <path d="M3.5 1.75h6L12.5 4.75v9.5h-9z" />
      <path d="M9.5 1.75v3h3" />
    </Glyph>
  );
}
