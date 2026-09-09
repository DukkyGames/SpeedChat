/**
 * Client half of issue attachments.
 *
 * Bytes go over `/api/issues/attachments` and never through the issues state
 * file; only the record of where they landed is persisted. That split is
 * deliberate — the state blob is written on a debounce, and putting base64
 * images in it is the shape that made MIN-354 v1 dangerous.
 *
 * Phase 2 of `documentation/plans/issues-app-v2.md`.
 */

import { stripSessionFromUrl, withSessionToken } from '../api/session-token';
import { getLocalServerAvailable } from '../tools/client';
import type { IssueAttachment } from '../types';

const ISSUE_ATTACHMENT_ROUTE = '/api/issues/attachments';

/** What the server hands back after storing bytes. */
export interface StoredAttachment {
  /** `<issueId>/<name>` — the only handle the client uses to address the file. */
  key: string;
  name: string;
  /** Absolute on-disk path, so an agent can be told where to read it. */
  path: string;
  bytes: number;
  mime: string;
}

/** Largest file the route accepts. Mirrored here so the UI can refuse early. */
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Upload one file and return its stored record, or null with a reason toasted. */
export async function uploadIssueAttachment(
  issueId: string,
  file: File | Blob,
  fileName?: string,
): Promise<StoredAttachment | null> {
  if (!getLocalServerAvailable()) return null;
  const name =
    fileName?.trim() ||
    (typeof (file as File).name === 'string' ? (file as File).name : '') ||
    'attachment';
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachment exceeds 12 MB');
  }

  const data = toBase64(await file.arrayBuffer());
  const res = await fetch('/api/issues/attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issueId, name, mime: file.type || undefined, data }),
  });
  const payload = (await res.json().catch(() => null)) as
    | { ok?: boolean; attachment?: StoredAttachment; error?: string }
    | null;
  if (!res.ok || !payload?.attachment) {
    throw new Error(payload?.error ?? `Upload failed (HTTP ${res.status})`);
  }
  return payload.attachment;
}

/**
 * Fetchable URL for a stored attachment.
 *
 * Derived from the stored absolute path's last two segments rather than kept as
 * a separate field, so an attachment record written by an agent (which knows
 * the path, not the key) still renders.
 */
export function issueAttachmentUrl(attachment: Pick<IssueAttachment, 'path'>): string {
  const key = attachmentKey(attachment);
  // Parentheses are legal in filenames but delimit Markdown image destinations.
  return `${ISSUE_ATTACHMENT_ROUTE}?key=${encodeURIComponent(key).replace(/\(/g, '%28').replace(/\)/g, '%29')}`;
}

/** Browser-facing URL for `<img>` / `<a>` — includes the session token query param. */
export function issueAttachmentDisplayUrl(attachment: Pick<IssueAttachment, 'path'>): string {
  return withSessionToken(issueAttachmentUrl(attachment));
}

/** Add auth params when rendering stored attachment URLs in the DOM. */
export function displayIssueAttachmentSrc(src: string): string {
  if (!src.startsWith(ISSUE_ATTACHMENT_ROUTE)) return src;
  return withSessionToken(stripSessionFromUrl(src));
}

/** Canonical attachment URL for markdown persistence (no auth query params). */
export function canonicalIssueAttachmentSrc(src: string): string {
  if (!src.startsWith(ISSUE_ATTACHMENT_ROUTE)) return src;
  return stripSessionFromUrl(src);
}

/** `<issueId>/<name>` for an attachment record. */
export function attachmentKey(attachment: Pick<IssueAttachment, 'path'>): string {
  const parts = attachment.path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

/** Delete the stored bytes. The state record is removed separately. */
export async function deleteIssueAttachmentBytes(
  attachment: IssueAttachment,
): Promise<boolean> {
  if (!getLocalServerAvailable()) return false;
  const res = await fetch(
    `/api/issues/attachments?key=${encodeURIComponent(attachmentKey(attachment))}`,
    { method: 'DELETE' },
  );
  return res.ok;
}

/** True when an attachment should render as an inline image. */
export function isImageAttachment(attachment: IssueAttachment): boolean {
  if (attachment.mime?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(attachment.name);
}

/** Human-readable size for the chip ("284 kB"). */
export function formatAttachmentSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
