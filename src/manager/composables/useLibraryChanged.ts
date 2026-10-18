/**
 * A counter bumped whenever the chat applies or undoes a card. Views that
 * fetch the library themselves instead of reading the stores (All items)
 * watch it and fetch again, so a chat delete or retag shows at once.
 */
import { ref } from "vue";

export const libraryVersion = ref(0);

export function markLibraryChanged(): void {
  libraryVersion.value += 1;
}
