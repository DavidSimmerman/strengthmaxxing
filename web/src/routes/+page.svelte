<script lang="ts">
	import { Medal, Dumbbell } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import Ring from '$lib/components/Ring.svelte';
	import { num, dur, readinessBand, shortDate } from '$lib/ui';
	import { wt } from '$lib/units.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const band = $derived(readinessBand(data.readiness?.score ?? null));
	let showReadiness = $state(false);

	const greeting = (() => {
		const h = new Date().getHours();
		if (h < 12) return 'Morning';
		if (h < 18) return 'Afternoon';
		return 'Evening';
	})();
</script>

<header class="mb-6 flex items-end justify-between">
	<div>
		<p class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">{greeting}</p>
		<h1 class="text-3xl font-black tracking-tight">Today</h1>
	</div>
	<span class="text-sm tabular-nums text-zinc-500">{shortDate(new Date())}</span>
</header>

<!-- RESUME / READINESS band -->
{#if data.active}
	<a
		href="/session/{data.active.id}"
		class="group mb-4 flex items-center gap-4 overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-r from-accent/15 to-transparent p-4 transition hover:border-accent"
	>
		<div
			class="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-2xl text-ink"
		>
			▶
		</div>
		<div class="min-w-0 flex-1">
			<p class="text-[11px] font-bold uppercase tracking-widest text-accent">Session live</p>
			<p class="truncate text-lg font-bold">{data.active.name}</p>
			<p class="text-sm text-zinc-400">
				{data.active.setCount} sets · started {dur(Date.now() - new Date(data.active.startedAt).getTime())} ago
			</p>
		</div>
		<span class="text-2xl text-accent transition group-hover:translate-x-1">→</span>
	</a>
{/if}

<section class="mb-4 grid gap-4 sm:grid-cols-[auto_1fr]">
	<!-- readiness gauge -->
	<div class="flex flex-col items-center rounded-2xl border border-line bg-panel p-5">
		<Ring value={data.readiness?.score ?? null} label={band.label} />
		<button
			class="mt-3 text-xs font-medium text-zinc-500 underline decoration-dotted underline-offset-4 hover:text-zinc-300"
			onclick={() => (showReadiness = !showReadiness)}
		>
			{data.readiness ? 'Update recovery' : 'Log recovery'}
		</button>
	</div>

	<!-- start a session -->
	<div class="flex flex-col rounded-2xl border border-line bg-panel p-5">
		<h2 class="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-400">Start training</h2>
		{#if data.workouts.length}
			<div class="mb-3 flex flex-col gap-2">
				{#each data.workouts as w (w.id)}
					<a
						href="/start/{w.id}"
						class="flex w-full items-center justify-between rounded-xl border border-line bg-ink px-4 py-3 text-left transition hover:border-accent hover:bg-accent/5"
					>
						<span class="font-semibold">{w.name}</span>
						<span class="text-xs tabular-nums text-zinc-500">{w.exerciseCount} exercises →</span>
					</a>
				{/each}
			</div>
		{:else}
			<p class="mb-3 text-sm text-zinc-500">
				No templates yet. <a href="/workouts/new" class="text-accent underline underline-offset-2"
					>Build one</a
				> or lift ad-hoc.
			</p>
		{/if}
		<form method="POST" action="?/start" use:enhance class="mt-auto">
			<button
				class="w-full rounded-xl bg-accent py-3 text-center font-bold text-ink transition active:scale-[0.98]"
			>
				+ Empty ad-hoc session
			</button>
		</form>
	</div>
</section>

<!-- readiness quick-log -->
{#if showReadiness}
	<form
		method="POST"
		action="?/readiness"
		use:enhance={() => {
			return async ({ update }) => {
				await update();
				showReadiness = false;
			};
		}}
		class="mb-4 grid grid-cols-3 gap-3 rounded-2xl border border-accent2/30 bg-panel p-4"
	>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Sleep (h)
			<input
				name="sleepHours"
				type="number"
				step="0.5"
				value={data.readiness?.sleepHours ?? ''}
				class="rounded-lg border border-line bg-ink px-3 py-2 text-base tabular-nums text-zinc-100 outline-none focus:border-accent2"
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Soreness 0–3
			<input
				name="sorenessLevel"
				type="number"
				min="0"
				max="3"
				class="rounded-lg border border-line bg-ink px-3 py-2 text-base tabular-nums text-zinc-100 outline-none focus:border-accent2"
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Kcal balance
			<input
				name="kcalBalance"
				type="number"
				step="50"
				value={data.readiness?.kcalBalance ?? ''}
				class="rounded-lg border border-line bg-ink px-3 py-2 text-base tabular-nums text-zinc-100 outline-none focus:border-accent2"
			/>
		</label>
		<button class="col-span-3 rounded-lg bg-accent2 py-2 font-bold text-ink active:scale-[0.98]"
			>Save recovery</button
		>
	</form>
{/if}

<!-- RECENT PRs -->
<section>
	<div class="mb-3 flex items-baseline justify-between">
		<h2 class="text-sm font-bold uppercase tracking-wider text-zinc-400">Recent bests</h2>
		<span class="text-xs text-zinc-600">est. 1RM</span>
	</div>
	{#if data.prs.length}
		<ul class="grid gap-2 sm:grid-cols-2">
			{#each data.prs as pr, i (pr.exercise)}
				<li
					class="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3"
					style="animation: slideup 0.4s {i * 0.05}s both ease-out"
				>
					{#if i === 0}<Medal class="h-5 w-5 shrink-0 text-accent" />{:else}<Dumbbell class="h-5 w-5 shrink-0 text-zinc-500" />{/if}
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-semibold">{pr.exercise}</p>
						<p class="text-xs text-zinc-500">{pr.reps}×{wt(pr.weightKg)} · {shortDate(pr.when)}</p>
					</div>
					<span class="text-lg font-black tabular-nums text-accent">{wt(pr.e1rm)}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-zinc-500">
			No lifts logged yet. Start a session and your bests will show up here.
		</p>
	{/if}
</section>

<style>
	@keyframes slideup {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
