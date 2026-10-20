/**
 * Shared UI helpers for the strengthmaxxing dashboard — pure, no DB.
 * Formatting, small color/scale mappers for readiness, and tiny inline-SVG geometry helpers.
 */

/** Compact number w/ thousands separator (volume, kcal). */
export function num(n: number | null | undefined): string {
	if (n == null) return '—';
	return Math.round(n).toLocaleString('en-US');
}

/** seconds → m:ss */
export function mmss(sec: number): string {
	const s = Math.max(0, Math.round(sec));
	const m = Math.floor(s / 60);
	return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

/** ms duration → "42m" / "1h 05m" */
export function dur(ms: number | null | undefined): string {
	if (ms == null) return '—';
	const min = Math.round(ms / 60000);
	if (min < 60) return `${min}m`;
	return `${Math.floor(min / 60)}h ${(min % 60).toString().padStart(2, '0')}m`;
}

/** ISO date / Date → "Mon, Jul 7" */
export function shortDate(d: Date | string | number | null | undefined): string {
	if (d == null) return '—';
	const date = d instanceof Date ? d : new Date(d);
	return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** ISO date / Date → "Jul 7, 9:14 AM" */
export function dateTime(d: Date | string | number | null | undefined): string {
	if (d == null) return '—';
	const date = d instanceof Date ? d : new Date(d);
	return (
		date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) +
		', ' +
		date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
	);
}

/** YYYY-MM-DD for a date (defaults today), local. */
export function isoDay(d: Date = new Date()): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Readiness band → label + the two accent tokens for gradient/fill. */
export function readinessBand(score: number | null | undefined): {
	label: string;
	color: string;
	tone: 'go' | 'ok' | 'hold';
} {
	if (score == null) return { label: 'No data', color: 'var(--color-line)', tone: 'hold' };
	if (score >= 80) return { label: 'Primed', color: 'var(--color-accent2)', tone: 'go' };
	if (score >= 65) return { label: 'Ready', color: 'var(--color-accent2)', tone: 'go' };
	if (score >= 50) return { label: 'Moderate', color: '#f5c518', tone: 'ok' };
	if (score >= 35) return { label: 'Fatigued', color: 'var(--color-accent)', tone: 'hold' };
	return { label: 'Depleted', color: '#ff3b3b', tone: 'hold' };
}

/** Consistent per-muscle hue so charts stay legible across pages. */
const MUSCLE_HUES: Record<string, number> = {
	chest: 18,
	back: 200,
	quads: 145,
	hamstrings: 165,
	glutes: 285,
	shoulders: 40,
	biceps: 260,
	triceps: 310,
	calves: 100,
	core: 220
};
export function muscleColor(muscle: string): string {
	const h = MUSCLE_HUES[muscle.toLowerCase()] ?? (hashStr(muscle) % 360);
	return `oklch(0.72 0.15 ${h})`;
}
function hashStr(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h);
}

/** Build an SVG polyline points string from values mapped into a w×h box. */
export function sparkPoints(values: number[], w: number, h: number, pad = 2): string {
	if (values.length === 0) return '';
	const max = Math.max(...values, 1);
	const min = Math.min(...values, 0);
	const span = max - min || 1;
	const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
	return values
		.map((v, i) => {
			const x = pad + i * step;
			const y = h - pad - ((v - min) / span) * (h - pad * 2);
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(' ');
}

/** Superset group index (0,1,2..) → letter label A/B/C. */
export function supersetLabel(g: number | null | undefined): string | null {
	if (g == null) return null;
	return String.fromCharCode(65 + (g % 26));
}
