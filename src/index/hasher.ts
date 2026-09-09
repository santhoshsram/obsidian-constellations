/**
 * Content hashing for chunk identity.
 *
 * SHA-1 via WebCrypto (available in both Obsidian's Electron renderer and
 * Node 18+, so tests run without mocks). Used for content-addressed chunk
 * IDs — not for security, so SHA-1's collision weaknesses don't apply.
 */
export async function sha1Hex(text: string): Promise<string> {
	const data = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest('SHA-1', data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
