/**
 * Trailing-edge debounce: coalesce bursts of calls (e.g. file-save
 * events) into a single invocation after `waitMs` of quiet.
 */
export function debounce<A extends unknown[]>(
	fn: (...args: A) => void,
	waitMs: number,
): (...args: A) => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...args: A) => {
		if (timer !== null) {
			globalThis.clearTimeout(timer);
		}
		timer = globalThis.setTimeout(() => {
			timer = null;
			fn(...args);
		}, waitMs);
	};
}
