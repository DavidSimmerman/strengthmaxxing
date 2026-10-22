/**
 * Calls into the iPhone app shell (ios/StrengthMaxxing iOS/NativeBridge.swift) when the
 * dashboard runs inside it. In a normal browser `isApp()` is false and `native()` returns null,
 * so every caller has a plain-web fallback.
 */
type Bridge = { postMessage: (m: Record<string, unknown>) => Promise<unknown> };

export const isApp = () =>
	typeof navigator !== 'undefined' && navigator.userAgent.includes('StrengthMaxxingApp');

function bridge(): Bridge | null {
	const w = globalThis as unknown as { webkit?: { messageHandlers?: { smx?: Bridge } } };
	return w.webkit?.messageHandlers?.smx ?? null;
}

/** Ask the app; null outside the app or on any native failure. */
export async function native<T = Record<string, unknown>>(
	action: string,
	args: Record<string, unknown> = {}
): Promise<T | null> {
	const b = bridge();
	if (!b) return null;
	try {
		const r = (await b.postMessage({ action, ...args })) as Record<string, unknown> | null;
		if (!r || typeof r !== 'object' || 'error' in r) return null;
		return r as T;
	} catch {
		return null;
	}
}
