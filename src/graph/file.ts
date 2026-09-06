import { parseDocument, serializeDocument, type GraphDocument } from './serialize.ts';

/** Turns a project name into something safe to put on a filesystem. */
function fileNameFor(projectName: string): string {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'factory-graph'}.json`;
}

/** Saves the document as a download. */
export function exportDocument(doc: GraphDocument): void {
  const blob = new Blob([serializeDocument(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileNameFor(doc.projectName);
  anchor.click();
  // Freed on the next tick; revoking immediately can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Opens a file picker and resolves with the parsed document, or null when the
 * user cancels. Throws `GraphParseError` if the file is not one of ours.
 */
export function importDocument(): Promise<GraphDocument | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((text) => resolve(parseDocument(text)))
        .catch(reject);
    });
    // A cancelled picker fires nothing in some browsers, so the promise simply
    // never settles — which is fine, since nothing is waiting on it.
    input.click();
  });
}
