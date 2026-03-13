export { scanLocalMediaLibrary } from './mediaLibraryScan';
export { getEmbeddedTags, getLibraryAlbumLookupIndex } from './mediaLibraryIndex';

import { clearMediaLibraryIndexCache } from './mediaLibraryIndex';
import { clearMediaLibrarySnapshotCache } from './mediaLibraryScan';

export function clearMediaLibraryScanCache(): void {
	clearMediaLibrarySnapshotCache();
	clearMediaLibraryIndexCache();
}
