/**
 * EPUB file loader.
 *
 * Parses EPUB files via epubjs, extracts plain text per chapter,
 * and provides a chapter-based reading interface.
 */

import ePub, { type Book, type NavItem } from 'epubjs';

export interface BookChapter {
  index: number;
  title: string;
  href: string;
  text: string;
}

export interface LoadedBook {
  title: string;
  author: string;
  chapters: BookChapter[];
}

/**
 * Load an EPUB file from an ArrayBuffer and extract chapter text.
 */
export async function loadEpub(data: ArrayBuffer): Promise<LoadedBook> {
  const book: Book = ePub(data as any);
  await book.opened;

  const metadata = book.packaging?.metadata;
  const title = metadata?.title ?? 'Untitled';
  const author = metadata?.creator ?? 'Unknown';

  // Build a title lookup from the TOC
  const tocTitles = new Map<string, string>();
  if (book.navigation?.toc) {
    flattenToc(book.navigation.toc, tocTitles);
  }

  // Extract text from each spine item (ordered chapter sequence)
  const chapters: BookChapter[] = [];
  const spineItems = (book.spine as any)?.spineItems ?? (book.spine as any)?.items ?? [];

  for (let i = 0; i < spineItems.length; i++) {
    const section = book.spine.get(i);
    if (!section) continue;

    try {
      await section.load((book as any).load.bind(book));

      // Extract text from the loaded document
      let text = '';
      if (section.contents) {
        text = extractText(section.contents as unknown as Document);
      } else if ((section as any).document) {
        text = extractText((section as any).document);
      }

      text = text.trim();
      if (!text) continue;

      // Match to TOC title by href
      const href = section.href ?? '';
      const baseHref = href.split('#')[0];
      const tocTitle = tocTitles.get(baseHref) ?? tocTitles.get(href);
      const chapterTitle = tocTitle ?? `Chapter ${chapters.length + 1}`;

      chapters.push({
        index: chapters.length,
        title: chapterTitle,
        href,
        text,
      });
    } catch {
      // Skip chapters that fail to load
    }
  }

  book.destroy();

  return { title, author, chapters };
}

/**
 * Flatten nested TOC into a href -> label map.
 */
function flattenToc(items: NavItem[], map: Map<string, string>): void {
  for (const item of items) {
    if (item.href) {
      const baseHref = item.href.split('#')[0];
      map.set(item.href, item.label?.trim() ?? '');
      map.set(baseHref, item.label?.trim() ?? '');
    }
    if (item.subitems?.length) {
      flattenToc(item.subitems, map);
    }
  }
}

/**
 * Extract readable text from a chapter's HTML document.
 * Pulls text from paragraphs and headings, preserving paragraph breaks.
 */
function extractText(doc: Document): string {
  // Try structured extraction first (paragraphs + headings)
  const blocks = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt');

  if (blocks.length > 0) {
    const parts: string[] = [];
    for (const el of blocks) {
      const text = (el.textContent ?? '').trim();
      if (text) parts.push(text);
    }
    return parts.join('\n\n');
  }

  // Fallback: body text content
  const body = doc.querySelector('body');
  return body?.textContent ?? doc.documentElement?.textContent ?? '';
}
