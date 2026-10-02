import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function renderMarkdown(src: string): string {
  const html = marked(src, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(html);
}
