<script lang="ts">
	import { Check } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	let { data, form } = $props();

	const muscles = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];
	const categories = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell'];
	const field =
		'rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent';
</script>

<header class="mb-6">
	<p class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">App</p>
	<h1 class="text-3xl font-black tracking-tight">Settings</h1>
</header>

<form method="POST" action="?/save" use:enhance class="mb-6 flex flex-col gap-4 rounded-2xl border border-line bg-panel p-5">
	<p class="text-xs text-zinc-500">These apply to the dashboard, iPhone and Watch.</p>
	<div class="flex items-center justify-between gap-3">
		<span class="font-semibold">Weight units</span>
		<div class="flex overflow-hidden rounded-xl border border-line">
			{#each ['lb', 'kg'] as u (u)}
				<label class="cursor-pointer px-4 py-2 text-sm font-bold has-[:checked]:bg-accent has-[:checked]:text-ink">
					<input type="radio" name="units" value={u} checked={data.settings.units === u} class="sr-only" />{u}
				</label>
			{/each}
		</div>
	</div>
	<label class="flex items-center justify-between gap-3">
		<span>
			<span class="block font-semibold">Speak rep count on the Watch</span>
			<span class="text-xs text-zinc-500">Says each rep number out loud once a set is detected.</span>
		</span>
		<input type="checkbox" name="voiceCount" checked={data.settings.voiceCount} class="h-5 w-5 accent-[var(--color-accent)]" />
	</label>
	<label class="flex items-center justify-between gap-3">
		<span>
			<span class="block font-semibold">Rest alarm snooze</span>
			<span class="text-xs text-zinc-500">After you dismiss the alarm, buzz again if no set has started.</span>
		</span>
		<span class="flex items-center gap-2">
			<input type="number" name="restAlarmSnoozeSec" min="10" max="600" value={data.settings.restAlarmSnoozeSec} class="{field} w-20 text-right" />
			<span class="text-sm text-zinc-500">sec</span>
		</span>
	</label>
	{#if form?.error}<p class="text-sm text-accent">{form.error}</p>{/if}
	<button class="rounded-xl bg-accent py-3 font-bold text-ink">{#if form?.saved}<Check class="mr-1 inline h-4 w-4" />Saved{:else}Save{/if}</button>
</form>

<section class="mb-6 rounded-2xl border border-line bg-panel p-5">
	<h2 class="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-400">Custom exercises</h2>
	{#if data.custom.length}
		<ul class="mb-4 flex flex-col gap-1 text-sm">
			{#each data.custom as e (e.id)}
				<li class="flex justify-between rounded-lg bg-ink px-3 py-2">
					<a href="/exercises/{e.id}" class="font-semibold hover:text-accent">{e.name}</a>
					<span class="text-zinc-500">{e.muscle} · {e.category}</span>
				</li>
			{/each}
		</ul>
	{/if}
	<form method="POST" action="?/addExercise" use:enhance class="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
		<input name="name" placeholder="Exercise name" class={field} />
		<select name="muscle" class={field}>
			{#each muscles as m (m)}<option value={m}>{m}</option>{/each}
		</select>
		<select name="category" class={field}>
			{#each categories as c (c)}<option value={c}>{c}</option>{/each}
		</select>
		<button class="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">Add</button>
	</form>
	{#if form?.exError}<p class="mt-2 text-sm text-accent">{form.exError}</p>{/if}
	{#if form?.added}<p class="mt-2 text-sm text-accent2">Added {form.added}.</p>{/if}
	<a href="/exercises" class="mt-4 block text-sm text-zinc-400 hover:text-zinc-100">Browse all exercises & PRs →</a>
</section>

{#if data.authEnabled}
	<form method="POST" action="/logout">
		<button class="w-full rounded-xl border border-line py-3 text-sm font-semibold text-zinc-400">Sign out</button>
	</form>
{/if}
