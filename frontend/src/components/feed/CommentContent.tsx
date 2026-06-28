'use client';

import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { EntityLinkMap, EntityLink } from '../../types';

// Renders a comment body, linkifying inline #CODE references the server resolved
// (Phase E.2). Output is built from React elements + plain text — never
// dangerouslySetInnerHTML — so it is XSS-safe (matches DEF-1 guidance).
const ROUTE: Record<EntityLink['type'], string> = {
  TASK: '/dashboard/tasks',
  WP: '/dashboard/work-packages',
  FINDING: '/dashboard/findings',
};

export default function CommentContent({
  content,
  entityLinks,
}: {
  content: string;
  entityLinks?: EntityLinkMap;
}) {
  // No resolved links → plain text (the common case).
  if (!entityLinks || Object.keys(entityLinks).length === 0) return <>{content}</>;

  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  // Fresh regex per call (matchAll needs the global flag; a literal here avoids any
  // shared lastIndex state). Mirrors the backend ENTITY_REF_REGEX.
  for (const m of content.matchAll(/#([A-Za-z0-9][A-Za-z0-9_-]*)/g)) {
    const code = m[1];
    // hasOwnProperty guard: entityLinks is a plain object, so a token like
    // "#toString"/"#__proto__" would otherwise resolve to an inherited prototype
    // member and render a broken link. Only own keys are real entity links.
    const link = code && Object.prototype.hasOwnProperty.call(entityLinks, code) ? entityLinks[code] : undefined;
    if (!link) continue; // unknown code → leave as plain text (handled by the tail slice)
    const idx = m.index ?? 0;
    if (idx > last) parts.push(<Fragment key={`t${i}`}>{content.slice(last, idx)}</Fragment>);
    parts.push(
      <Link
        key={`l${i}`}
        href={`${ROUTE[link.type]}/${link.id}`}
        // Inherit the bubble's text colour (white on the self/blue bubble, dark on
        // others) so the link is always legible; the underline marks it as a link.
        className="underline underline-offset-2 font-medium hover:opacity-80"
      >
        #{code}
      </Link>
    );
    last = idx + m[0].length;
    i++;
  }
  if (last < content.length) parts.push(<Fragment key="tail">{content.slice(last)}</Fragment>);
  return <>{parts}</>;
}
