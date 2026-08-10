import type jsPDF from "jspdf";
import robotoRegularUrl from "@/assets/fonts/Roboto-Regular.ttf?url";
import robotoBoldUrl from "@/assets/fonts/Roboto-Bold.ttf?url";

/**
 * jsPDF's built-in helvetica is WinAnsi-only, so Cyrillic (Macedonian) and
 * Albanian diacritics render as garbage. Roboto covers Latin-Ext + Cyrillic
 * and is embedded lazily (only when a PDF is actually produced) so it never
 * inflates the main bundle.
 */
export const PDF_FONT = "Roboto";

let fontsPromise: Promise<{ regular: string; bold: string }> | null = null;

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font load failed: ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function loadFonts() {
  fontsPromise ??= Promise.all([
    fetchAsBase64(robotoRegularUrl),
    fetchAsBase64(robotoBoldUrl),
  ]).then(([regular, bold]) => ({ regular, bold }));
  return fontsPromise;
}

/** Registers Roboto on the document and makes it the active font. */
export async function ensureUnicodeFont(doc: jsPDF): Promise<string> {
  try {
    const { regular, bold } = await loadFonts();
    doc.addFileToVFS("Roboto-Regular.ttf", regular);
    doc.addFont("Roboto-Regular.ttf", PDF_FONT, "normal");
    doc.addFileToVFS("Roboto-Bold.ttf", bold);
    doc.addFont("Roboto-Bold.ttf", PDF_FONT, "bold");
    doc.setFont(PDF_FONT, "normal");
    return PDF_FONT;
  } catch {
    // Fail open: a Latin-only PDF is better than no PDF at all.
    return "helvetica";
  }
}