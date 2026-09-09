import { issueAttachmentUrl, MAX_ATTACHMENT_BYTES } from '../state/issue-attachments-api';
import type { IssueAttachment, ToolExecutionResult, ToolImageAttachment } from '../types';

/** Only attachments on returned issues are read; Markdown cannot make us fetch arbitrary URLs. */
export async function withIssueToolImages(content: string): Promise<ToolExecutionResult> {
  const result: ToolExecutionResult = { content };
  let payload: { issues?: Array<{ attachments?: IssueAttachment[] }> };
  try { payload = JSON.parse(content); } catch { return result; }
  const seen = new Set<string>();
  const attachments: ToolImageAttachment[] = [];
  let total = 0;
  let omitted = 0;
  for (const issue of payload?.issues ?? []) {
    for (const attachment of issue.attachments ?? []) {
      const mime = attachment.mime || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[attachment.name?.split('.').pop()?.toLowerCase() ?? ''];
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) continue;
      const url = issueAttachmentUrl(attachment);
      if (seen.has(url)) continue;
      seen.add(url);
      if (attachments.length >= 8 || (attachment.bytes ?? 0) > MAX_ATTACHMENT_BYTES) { omitted++; continue; }
      try {
        const response = await fetch(url);
        if (!response.ok) { omitted++; continue; }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > MAX_ATTACHMENT_BYTES || total + bytes.length > 24 * 1024 * 1024) { omitted++; continue; }
        total += bytes.length;
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        attachments.push({ type: 'image', url, mime: mime as ToolImageAttachment['mime'], alt: attachment.name, dataUrl: `data:${mime};base64,${btoa(binary)}` });
      } catch { omitted++; }
    }
  }
  if (attachments.length) result.attachments = attachments;
  if (omitted) result.content += `\n\n${omitted} issue image(s) could not be included (unavailable or image size/count limit). Narrow issue_search to a specific issue and request attachments to inspect its images.`;
  return result;
}
