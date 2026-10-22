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

/** Items deleted in this session, so a chat answer written before the
 *  delete can say they are gone instead of pointing at them. */
export const deletedIds = ref<ReadonlySet<string>>(new Set());

export function markDeleted(ids: Iterable<string>): void {
  deletedIds.value = new Set([...deletedIds.value, ...ids]);
}
