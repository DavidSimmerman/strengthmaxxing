<script lang="ts">
	import { num, dur, dateTime, kg } from '$lib/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// group by month for a light timeline feel
	function monthKey(d: string | number | Date) {
		return new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
	}
	const grouped = $derived.by(() => {
		const out: { month: string; items: PageData['sessions'] }[] = [];
		for (const s of data.sessions) {
			const m = monthKey(s.startedAt);
			let g = out.find((x) => x.month === m);
			if (!g) {
				g = { month: m, items: [] };
				out.push(g);
			}
			g.items.push(s);
		}
		return out;
	});
</script>

<header class="mb-6">
	<p class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Log</p>
	<h1 class="text-3xl font-black tracking-tight">History</h1>
</header>

{#if data.sessions.length}
	{#each grouped as g (g.month)}
		<h2 class="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-zinc-500">{g.month}</h2>
		<div class="flex flex-col gap-2">
			{#each g.items as s (s.id)}
				<a
					href="/history/{s.id}"
					class="group flex items-center gap-4 rounded-2xl border border-line bg-panel p-4 transition hover:border-zinc-600"
				>
					<div class="min-w-0 flex-1">
						<p class="truncate font-bold">{s.name}</p>
						<p class="text-xs text-zinc-500">{dateTime(s.startedAt)}</p>
					</div>
					<div class="flex shrink-0 gap-4 text-right tabular-nums">
						<div>
							<div class="text-sm font-bold text-accent">{num(s.totalVolumeKg)}</div>
							<div class="text-[10px] uppercase tracking-wide text-zinc-600">kg</div>
						</div>
						<div>
							<div class="text-sm font-bold">{num(s.estimatedKcal)}</div>
							<div class="text-[10px] uppercase tracking-wide text-zinc-600">kcal</div>
						</div>
						<div>
							<div class="text-sm font-bold text-zinc-300">{dur(s.durationMs)}</div>
							<div class="text-[10px] uppercase tracking-wide text-zinc-600">time</div>
						</div>
					</div>
					<span class="text-zinc-600 transition group-hover:translate-x-0.5">→</span>
				</a>
			{/each}
		</div>
	{/each}
{:else}
	<div class="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
		<p class="text-lg font-semibold text-zinc-300">Nothing logged yet</p>
		<p class="mt-1 text-sm text-zinc-500">Finished sessions land here with volume, kcal & duration.</p>
		<a href="/" class="mt-5 inline-block rounded-xl bg-accent px-6 py-3 font-bold text-ink"
			>Start a session</a
		>
	</div>
{/if}
