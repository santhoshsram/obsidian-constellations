/**
 * Trailing-edge debounce: coalesce bursts of calls (e.g. file-save
 * events) into a single invocation after `waitMs` of quiet.
 */
export interface DebouncedFn<A extends unknown[]> {
	(...args: A): void;
	cancel(): void;
}

export function debounce<A extends unknown[]>(
	fn: (...args: A) => void,
	waitMs: number,
): DebouncedFn<A> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const debounced = (...args: A) => {
		if (timer !== null) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, waitMs);
	};
	debounced.cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};
	return debounced;
}
