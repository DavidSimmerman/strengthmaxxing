<script lang="ts">
	import { X, Trophy } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { isApp, native } from '$lib/native';
	import { Zap } from '@lucide/svelte';
	import ExerciseLogger, { type DropNotice } from '$lib/components/ExerciseLogger.svelte';
	import { ArrowDown } from '@lucide/svelte';
	import RestTimer from '$lib/components/RestTimer.svelte';
	import { dur, supersetLabel } from '$lib/ui';
	import { vol, wt, units } from '$lib/units.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// rest timer trigger — bump the key + set restSec whenever a set is logged
	let restKey = $state(0);
	let restSec = $state(120);
	// The coach's weights are worked out in the background after start — refresh until ready.
	$effect(() => {
		if (data.suggestions?.status !== 'pending') return;
		const t = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(t);
	});
	const ENERGY = ['Drained', 'Low', 'OK', 'Good', 'Great'];
	const checkinText = $derived.by(() => {
		const c = data.session.checkin;
		if (!c) return '';
		const parts = c.energy ? [`Energy ${ENERGY[c.energy - 1].toLowerCase()}`] : [];
		for (const [area, lvl] of Object.entries(c.soreness))
			if (lvl) parts.push(`${area} ${lvl === 2 ? 'very sore' : 'a bit sore'}`);
		return parts.join(' · ');
	});

	let prFlash = $state<string | null>(null);
	function onLogged(sec: number, pr: number | null) {
		restSec = sec;
		restKey += 1;
		if (pr) {
			prFlash = `New PR! Estimated 1-rep max ${wt(pr)}`;
			setTimeout(() => (prFlash = null), 5000);
		}
	}

	// Lowered next-set weights whose exercise is scrolled off screen: shown under the rest timer.
	let notices = $state<Record<number, DropNotice>>({});
	function onNotice(exerciseId: number, n: DropNotice | null) {
		if (n) notices[exerciseId] = n;
		else if (notices[exerciseId]) delete notices[exerciseId];
	}

	let picker = $state('');
	const displayExercises = $derived(data.exercises);

	// group by superset: null groups render standalone, shared numbers cluster
	type Ex = (typeof displayExercises)[number];
	const groups = $derived.by(() => {
		const out: { key: string; superset: number | null; items: Ex[] }[] = [];
		const byGroup = new Map<number, Ex[]>();
		for (const ex of displayExercises) {
			if (ex.supersetGroup == null) {
				out.push({ key: 'solo-' + ex.exerciseId, superset: null, items: [ex] });
			} else {
				const arr = byGroup.get(ex.supersetGroup) ?? [];
				arr.push(ex);
				byGroup.set(ex.supersetGroup, arr);
			}
		}
		for (const [g, items] of byGroup) out.push({ key: 'ss-' + g, superset: g, items });
		// keep source order roughly by first item's position
		const pos = (e: Ex) => displayExercises.indexOf(e);
		out.sort((a, b) => pos(a.items[0]) - pos(b.items[0]));
		return out;
	});

	let confirmFinish = $state(false);

	// Inside the iPhone app: add heart-rate calories from Apple Health to the finish, then
	// save the workout to Apple Health. In a browser this does nothing extra.
	const finishInApp: SubmitFunction = async ({ formData }) => {
		const start = new Date(data.session.startedAt).getTime();
		const end = Date.now();
		if (isApp()) {
			const hr = await native<{ kcal: number | null; avgHr?: number; weightKg: number | null }>(
				'heartRateCalories',
				{ start, end }
			);
			if (hr?.kcal != null) {
				formData.set('activeKcal', String(Math.round(hr.kcal)));
				if (hr.avgHr) formData.set('avgHr', String(Math.round(hr.avgHr)));
			}
			if (hr?.weightKg) formData.set('bodyweightKg', String(hr.weightKg));
		}
		return async ({ result, update }) => {
			if (isApp() && result.type === 'redirect') {
				const s = await fetch(`/api/sessions/${data.session.id}`)
					.then((r) => (r.ok ? r.json() : null))
					.catch(() => null);
				await native('saveWorkout', {
					start,
					end,
					kcal: s?.estimatedKcal ?? null,
					name: data.session.name,
					sessionId: data.session.id,
					volumeKg: s?.totalVolumeKg ?? null
				});
			}
			await update();
		};
	};
</script>

<header class="mb-4 flex items-center justify-between gap-3">
	<div class="min-w-0">
		<p class="text-[11px] font-bold uppercase tracking-widest text-accent">Live session</p>
		<h1 class="truncate text-2xl font-black tracking-tight">{data.session.name}</h1>
	</div>
	<a href="/history" class="text-sm text-zinc-500 hover:text-zinc-300" aria-label="close"><X class="h-5 w-5" /></a>
</header>

<!-- live stats bar -->
<div class="mb-4 grid grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-panel">
	<div class="px-4 py-3 text-center">
		<div class="text-lg font-black tabular-nums">{data.totalSets}</div>
		<div class="text-[10px] uppercase tracking-wider text-zinc-500">sets</div>
	</div>
	<div class="px-4 py-3 text-center">
		<div class="text-lg font-black tabular-nums text-accent">{vol(data.totalVolume).split(' ')[0]}</div>
		<div class="text-[10px] uppercase tracking-wider text-zinc-500">{units()} volume</div>
	</div>
	<div class="px-4 py-3 text-center">
		<div class="text-lg font-black tabular-nums">
			{dur(Date.now() - new Date(data.session.startedAt).getTime())}
		</div>
		<div class="text-[10px] uppercase tracking-wider text-zinc-500">elapsed</div>
	</div>
</div>

{#if checkinText || data.suggestions?.status === 'error'}
	<div class="mb-3 flex items-center gap-2 rounded-xl bg-panel px-3 py-2 text-xs text-zinc-400">
		<Zap class="h-3.5 w-3.5 shrink-0 text-accent2" />
		<span>{checkinText}{#if data.suggestions?.status === 'error'}{checkinText ? ' · ' : ''}Coach couldn't suggest weights: using last time's.{/if}</span>
	</div>
{/if}

{#if prFlash}
	<div class="mb-3 flex items-center justify-center gap-2 rounded-2xl bg-accent2 px-4 py-3 font-black text-ink"><Trophy class="h-5 w-5" />{prFlash}</div>
{/if}

<!-- sticky rest timer -->
<div class="sticky-safe sticky z-10 mb-4 flex flex-col gap-2">
	<RestTimer {restSec} runKey={restKey} />
	{#each Object.values(notices) as n (n.exerciseId)}
		<button
			type="button"
			onclick={() => document.getElementById(`ex-${n.exerciseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
			class="flex items-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-left font-black text-ink shadow-lg"
		>
			<ArrowDown class="h-5 w-5 shrink-0" />
			<span class="min-w-0 flex-1 truncate">{n.name}: next set {n.to} {n.unit}</span>
			<span class="shrink-0 text-sm font-semibold">({n.to - n.from > 0 ? '+' : '−'}{Math.abs(Math.round((n.to - n.from) * 10) / 10)})</span>
		</button>
	{/each}
</div>

<!-- exercises -->
<div class="flex flex-col gap-4">
	{#each groups as grp (grp.key)}
		{#if grp.superset != null}
			<div class="rounded-2xl border border-accent2/30 bg-accent2/[0.04] p-2">
				<div class="mb-1 flex items-center gap-2 px-2 pt-1">
					<span
						class="grid h-6 w-6 place-items-center rounded-full bg-accent2 text-xs font-black text-ink"
						>{supersetLabel(grp.superset)}</span
					>
					<span class="text-xs font-bold uppercase tracking-wider text-accent2">Superset</span>
					<span class="text-xs text-zinc-500">no rest between</span>
				</div>
				<div class="flex flex-col gap-2">
					{#each grp.items as ex (ex.exerciseId)}
						<div id="ex-{ex.exerciseId}"><ExerciseLogger exercise={ex} {onLogged} {onNotice} suggesting={data.suggestions?.status === 'pending'} /></div>
					{/each}
				</div>
			</div>
		{:else}
			{#each grp.items as ex (ex.exerciseId)}
				<div id="ex-{ex.exerciseId}"><ExerciseLogger exercise={ex} {onLogged} {onNotice} suggesting={data.suggestions?.status === 'pending'} /></div>
			{/each}
		{/if}
	{/each}
</div>

<!-- add exercise (saved on the session, so it survives reloads) -->
<form
	method="POST"
	action="?/addExercise"
	class="mt-4 flex gap-2"
	use:enhance={() =>
		async ({ update }) => {
			picker = '';
			await update({ reset: false });
		}}
>
	<select
		name="exerciseId"
		bind:value={picker}
		class="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 py-3 text-sm text-zinc-200 outline-none focus:border-accent"
	>
		<option value="">+ Add an exercise…</option>
		{#each data.library as l (l.id)}
			<option value={l.id}>{l.name} · {l.muscle}</option>
		{/each}
	</select>
	<button
		disabled={!picker}
		class="rounded-xl border border-line bg-panel px-5 py-3 font-semibold text-zinc-200 disabled:opacity-40"
		>Add</button
	>
</form>

<!-- finish -->
<div class="mt-6 mb-2">
	{#if !confirmFinish}
		<button
			onclick={() => (confirmFinish = true)}
			class="w-full rounded-2xl border border-line bg-panel py-4 text-center font-bold text-zinc-200 transition hover:border-accent"
			disabled={data.totalSets === 0}
			class:opacity-50={data.totalSets === 0}
		>
			Finish workout
		</button>
		{#if data.totalSets === 0}
			<p class="mt-2 text-center text-xs text-zinc-600">Log at least one set to finish.</p>
		{/if}
		<form method="POST" action="?/discard" class="mt-3 text-center">
			<button
				onclick={(e) => {
					if (!confirm('Discard this workout? Everything logged in it is deleted.')) e.preventDefault();
				}}
				class="text-xs text-zinc-500 hover:text-red-400">Discard workout</button
			>
		</form>
	{:else}
		<form method="POST" action="?/finish" use:enhance={finishInApp} class="rounded-2xl border border-accent bg-panel p-4">
			<p class="mb-3 text-sm font-semibold">Wrap it up? Volume & kcal will be computed.</p>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={() => (confirmFinish = false)}
					class="flex-1 rounded-xl border border-line py-3 font-semibold text-zinc-300"
					>Keep going</button
				>
				<button class="flex-1 rounded-xl bg-accent py-3 font-bold text-ink active:scale-[0.98]"
					>Finish & save</button
				>
			</div>
		</form>
	{/if}
</div>
