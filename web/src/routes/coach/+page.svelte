<script lang="ts">
	import { wt } from '$lib/units.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// ---- plan generator ----
	type PlanExercise = { name: string; sets: number; reps: number; restSec: number; notes?: string };
	type Plan = { name: string; days: { name: string; exercises: PlanExercise[] }[] };

	let goal = $state('hypertrophy');
	let daysPerWeek = $state(4);
	let experience = $state('intermediate');
	let equipment = $state('full gym');
	let constraints = $state('');

	let planLoading = $state(false);
	let planError = $state('');
	let plan = $state<Plan | null>(null);
	let rationale = $state('');

	async function generatePlan(e: SubmitEvent) {
		e.preventDefault();
		planLoading = true;
		planError = '';
		plan = null;
		rationale = '';
		try {
			const res = await fetch('/api/coach/plan', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					profile: { goal, daysPerWeek, experience, equipment: [equipment], avoid: constraints || undefined }
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.error || `Coach unavailable (${res.status})`);
			plan = body.plan ?? null;
			rationale = body.rationale ?? '';
			if (!plan) throw new Error('Coach returned no plan');
		} catch (err) {
			planError = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			planLoading = false;
		}
	}

	// ---- progression ----
	type Adjustment = {
		name: string;
		suggestedWeightKg: number;
		suggestedReps: number;
		deltaPct: number;
		reason: string;
	};
	let progressingId = $state<number | null>(null);
	let progressError = $state('');
	let progress = $state<{ workoutId: number; adjustments: Adjustment[]; summary: string } | null>(
		null
	);

	async function progressWorkout(workoutId: number) {
		progressingId = workoutId;
		progressError = '';
		progress = null;
		try {
			const res = await fetch('/api/coach/progress', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ workoutId })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.error || `Coach unavailable (${res.status})`);
			progress = {
				workoutId,
				adjustments: body.adjustments ?? [],
				summary: body.summary ?? ''
			};
		} catch (err) {
			progressError = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			progressingId = null;
		}
	}
</script>

<header class="mb-6">
	<p class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">AI</p>
	<h1 class="text-3xl font-black tracking-tight">Coach</h1>
</header>

<!-- PLAN GENERATOR -->
<section class="mb-6 rounded-2xl border border-line bg-panel p-5">
	<h2 class="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-400">Design a program</h2>
	<form onsubmit={generatePlan} class="grid gap-3 sm:grid-cols-2">
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Goal
			<select
				bind:value={goal}
				class="rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent"
			>
				<option value="hypertrophy">Hypertrophy (size)</option>
				<option value="strength">Strength</option>
				<option value="powerbuilding">Powerbuilding</option>
				<option value="fat loss">Fat loss / conditioning</option>
				<option value="general">General fitness</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Days / week
			<select
				bind:value={daysPerWeek}
				class="rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent"
			>
				{#each [2, 3, 4, 5, 6] as d (d)}<option value={d}>{d} days</option>{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Experience
			<select
				bind:value={experience}
				class="rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent"
			>
				<option value="beginner">Beginner</option>
				<option value="intermediate">Intermediate</option>
				<option value="advanced">Advanced</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Equipment
			<input
				bind:value={equipment}
				placeholder="full gym / dumbbells only / home"
				class="rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent"
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400 sm:col-span-2">
			Constraints (optional)
			<input
				bind:value={constraints}
				placeholder="e.g. bad shoulder, 45 min sessions"
				class="rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent"
			/>
		</label>
		<button
			disabled={planLoading}
			class="rounded-xl bg-accent py-3 font-bold text-ink transition active:scale-[0.98] disabled:opacity-60 sm:col-span-2"
		>
			{planLoading ? 'Consulting coach…' : 'Generate plan'}
		</button>
	</form>

	{#if planLoading}
		<div class="mt-4 flex items-center gap-3 text-sm text-zinc-400">
			<span class="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent"
			></span>
			Building your program — this can take a few seconds.
		</div>
	{/if}
	{#if planError}
		<div class="mt-4 rounded-xl border border-accent/40 bg-accent/[0.06] px-4 py-3 text-sm">
			<p class="font-semibold text-accent">Coach is unavailable</p>
			<p class="text-zinc-400">{planError}. Try again in a moment.</p>
		</div>
	{/if}

	{#if plan}
		<div class="mt-5">
			<h3 class="text-lg font-black">{plan.name}</h3>
			{#if rationale}<p class="mb-3 text-sm text-zinc-400">{rationale}</p>{/if}
			<div class="grid gap-3 sm:grid-cols-2">
				{#each plan.days as day, i (i)}
					<div class="rounded-xl border border-line bg-ink p-4">
						<div class="mb-2 flex items-center gap-2">
							<span
								class="grid h-6 w-6 place-items-center rounded-full bg-accent/20 text-xs font-black text-accent"
								>{i + 1}</span
							>
							<h4 class="font-bold">{day.name}</h4>
						</div>
						<ul class="flex flex-col gap-1 text-sm">
							{#each day.exercises as ex (ex.name)}
								<li class="flex items-baseline justify-between gap-2">
									<span class="text-zinc-200">{ex.name}</span>
									<span class="shrink-0 tabular-nums text-zinc-500"
										>{ex.sets}×{ex.reps}</span
									>
								</li>
								{#if ex.notes}
									<li class="pl-1 text-[11px] text-zinc-600">{ex.notes}</li>
								{/if}
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</section>

<!-- PROGRESSION -->
<section>
	<h2 class="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-400">
		Auto-progress a template
	</h2>
	{#if data.workouts.length}
		<div class="flex flex-col gap-2">
			{#each data.workouts as w (w.id)}
				<div class="rounded-2xl border border-line bg-panel p-4">
					<div class="flex items-center gap-3">
						<div class="min-w-0 flex-1">
							<p class="font-bold">{w.name}</p>
							<p class="text-xs text-zinc-500">{w.exerciseCount} exercises</p>
						</div>
						<button
							onclick={() => progressWorkout(w.id)}
							disabled={progressingId === w.id}
							class="shrink-0 rounded-xl bg-accent2 px-4 py-2.5 text-sm font-bold text-ink transition active:scale-95 disabled:opacity-60"
						>
							{progressingId === w.id ? 'Thinking…' : 'Progress →'}
						</button>
					</div>

					{#if progress && progress.workoutId === w.id}
						<div class="mt-4 border-t border-line pt-3">
							{#if progress.summary}
								<p class="mb-3 text-sm text-zinc-300">{progress.summary}</p>
							{/if}
							<div class="flex flex-col gap-2">
								{#each progress.adjustments as adj (adj.name)}
									<div class="rounded-xl bg-ink p-3">
										<div class="flex items-center justify-between gap-2">
											<span class="font-semibold">{adj.name}</span>
											<span class="flex items-center gap-2 tabular-nums">
												<span class="font-bold text-accent2">{wt(adj.suggestedWeightKg)}</span>
												<span class="text-zinc-500">× {adj.suggestedReps}</span>
												<span
													class="rounded px-1.5 py-0.5 text-xs font-bold"
													class:bg-accent2={adj.deltaPct >= 0}
													class:text-ink={adj.deltaPct !== 0}
													class:bg-accent={adj.deltaPct < 0}
													>{adj.deltaPct >= 0 ? '+' : ''}{adj.deltaPct}%</span
												>
											</span>
										</div>
										{#if adj.reason}
											<p class="mt-1 text-xs text-zinc-500">{adj.reason}</p>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-zinc-500">
			Build a workout template first — then the coach can auto-progress its loads based on your last
			session and today's readiness.
		</p>
	{/if}

	{#if progressError}
		<div class="mt-3 rounded-xl border border-accent/40 bg-accent/[0.06] px-4 py-3 text-sm">
			<p class="font-semibold text-accent">Couldn't get suggestions</p>
			<p class="text-zinc-400">{progressError}.</p>
		</div>
	{/if}
</section>
