/**
 * Diff the vault's current file hashes against the persisted index state
 * to decide what needs (re-)indexing. Pure and sync so it's trivially
 * testable; hashing/IO happens in the caller.
 */

export interface VaultDiff {
	/** Files that are new or whose content hash changed. */
	toIndex: string[];
	/** Files present in the index but gone from the vault. */
	toRemove: string[];
}

export function diffVaultFiles(
	current: Record<string, string>,
	previous: Record<string, string>,
): VaultDiff {
	const toIndex = Object.keys(current).filter(
		(path) => previous[path] !== current[path],
	);
	const toRemove = Object.keys(previous).filter(
		(path) => !(path in current),
	);
	return { toIndex, toRemove };
}
