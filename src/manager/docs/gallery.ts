/**
 * The screenshots of one docs page, so a click on any of them opens the
 * page's Lightbox there and ← / → step through the others in page order.
 * DocPage provides it; each DocImage with a real image registers itself.
 */
import type { InjectionKey } from "vue";
import type { LightboxImage } from "@/kit/Lightbox.vue";

export interface DocShot { image: LightboxImage; el: () => Element | null }

export interface DocGallery {
  /** Returns the matching unregister. */
  add(shot: DocShot): () => void;
  open(shot: DocShot): void;
}

export const DOC_GALLERY: InjectionKey<DocGallery> = Symbol("wp-doc-gallery");

/** Shots in the order they sit on the page (one not in the DOM goes last). */
export function inPageOrder(shots: readonly DocShot[]): DocShot[] {
  return [...shots].sort((a, b) => {
    const ea = a.el();
    const eb = b.el();
    if (!ea || !eb) return ea ? -1 : eb ? 1 : 0;
    if (ea === eb) return 0;
    return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}
