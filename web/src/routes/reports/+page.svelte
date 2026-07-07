<script lang="ts">
	import LineChart from '$lib/components/LineChart.svelte';
	import BarChart from '$lib/components/BarChart.svelte';
	import Scatter from '$lib/components/Scatter.svelte';
	import { num, kg, shortDate, muscleColor } from '$lib/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const volumeSeries = $derived(
		data.sessions.map((s) => ({ value: s.totalVolumeKg, label: shortDate(s.startedAt) }))
	);
	const kcalSeries = $derived(
		data.sessions.map((s) => ({ value: s.estimatedKcal, label: shortDate(s.startedAt) }))
	);
	const readinessSeries = $derived(
		data.readinessTrend.map((r) => ({ value: r.score ?? 0, label: r.day.slice(5) }))
	);
	const muscleBars = $derived(
		Object.entries(data.muscleTotals)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.map(([m, v]) => ({ label: m, value: v, color: muscleColor(m) }))
	);
	const offDays = $derived(data.sessions.filter((s) => s.offDay));
</script>

<header class="mb-6">
	<p class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Analysis</p>
	<h1 class="text-3xl font-black tracking-tight">Reports</h1>
</header>

{#if data.sessions.length < 2}
	<div class="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
		<p class="text-lg font-semibold text-zinc-300">Not enough data yet</p>
		<p class="mt-1 text-sm text-zinc-500">
			Log a few sessions — trends, muscle balance and your off-day detector unlock once there's a
			history to analyse.
		</p>
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<!-- volume trend -->
		<section class="rounded-2xl border border-line bg-panel p-4">
			<div class="mb-2 flex items-baseline justify-between">
				<h2 class="text-sm font-bold uppercase tracking-wider text-zinc-400">Tonnage per session</h2>
				<span class="text-xs tabular-nums text-zinc-500"
					>{num(data.sessions.reduce((a, b) => a + b.totalVolumeKg, 0))} kg total</span
				>
			</div>
			<LineChart series={volumeSeries} color="var(--color-accent)" />
		</section>

		<div class="grid gap-4 md:grid-cols-2">
			<!-- kcal trend -->
			<section class="rounded-2xl border border-line bg-panel p-4">
				<h2 class="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-400">
					Estimated kcal
				</h2>
				<LineChart series={kcalSeries} color="#f5c518" height={120} />
			</section>

			<!-- readiness trend -->
			<section class="rounded-2xl border border-line bg-panel p-4">
				<h2 class="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-400">Readiness</h2>
				{#if readinessSeries.length > 1}
					<LineChart series={readinessSeries} color="var(--color-accent2)" height={120} yMax={100} />
				{:else}
					<p class="grid h-[120px] place-items-center text-center text-xs text-zinc-600">
						Readiness needs recovery data logged on training days.
					</p>
				{/if}
			</section>
		</div>

		<!-- volume by muscle -->
		<section class="rounded-2xl border border-line bg-panel p-4">
			<h2 class="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-400">
				Volume by muscle · all sessions
			</h2>
			<BarChart data={muscleBars} unit=" kg" />
		</section>

		<!-- strength vs readiness scatter -->
		<section class="rounded-2xl border border-line bg-panel p-4">
			<div class="mb-2 flex items-baseline justify-between">
				<h2 class="text-sm font-bold uppercase tracking-wider text-zinc-400">
					Strength vs readiness
				</h2>
				<span class="text-[10px] text-zinc-500"
					><span class="text-accent">●</span> off-day</span
				>
			</div>
			{#if data.strengthVsReadiness.length > 1}
				<Scatter
					points={data.strengthVsReadiness}
					xLabel="readiness →"
					yLabel="best e1RM (kg) →"
				/>
			{:else}
				<p class="grid h-[180px] place-items-center text-center text-xs text-zinc-600">
					Need sessions started with a readiness score to plot this.
				</p>
			{/if}
		</section>

		<!-- off-day detector -->
		<section class="rounded-2xl border border-line bg-panel p-4">
			<h2 class="mb-1 text-sm font-bold uppercase tracking-wider text-zinc-400">
				Off-day detector
			</h2>
			<p class="mb-3 text-xs text-zinc-500">
				Sessions where volume dropped hard vs your rolling average, or rep-speed decayed sharply.
			</p>
			{#if offDays.length}
				<div class="flex flex-col gap-2">
					{#each offDays as s (s.id)}
						<a
							href="/history/{s.id}"
							class="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.05] px-3 py-2"
						>
							<span class="text-lg">⚠️</span>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold">{s.name}</p>
								<p class="text-xs text-zinc-500">{shortDate(s.startedAt)}</p>
							</div>
							<div class="shrink-0 text-right text-xs tabular-nums">
								{#if s.volDropPct > 20}
									<span class="text-accent">−{s.volDropPct}% vol</span>
								{/if}
								{#if s.avgDecay > 25}
									<span class="block text-zinc-400">{s.avgDecay}% decay</span>
								{/if}
							</div>
						</a>
					{/each}
				</div>
			{:else}
				<p class="rounded-xl bg-accent2/[0.06] px-3 py-4 text-center text-sm text-accent2">
					No off-days flagged — you've been training consistently. 💪
				</p>
			{/if}
		</section>
	</div>
{/if}
