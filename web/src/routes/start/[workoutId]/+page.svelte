<script lang="ts">
	import { Info, Play, X } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { dateTime } from '$lib/ui';
	let { data } = $props();

	const ENERGY = ['Drained', 'Low', 'OK', 'Good', 'Great'];
	const LEVELS = ['Fresh', 'A bit', 'Very'];
	let energy = $state(3);
	// svelte-ignore state_referenced_locally
	let sore = $state<Record<string, number>>(
		Object.fromEntries(data.areas.map((a) => [a, data.estimate[a].level]))
	);
	let starting = $state(false);
	const levelClass = (li: number, on: boolean) =>
		!on
			? 'text-zinc-500 hover:text-zinc-300'
			: li === 0
				? 'bg-panel2 text-zinc-100'
				: li === 1
					? 'bg-[#f5c518]/20 text-[#f5c518]'
					: 'bg-accent/20 text-accent';
</script>

<div class="mx-auto max-w-md">
	<header class="mb-5 flex items-start justify-between">
		<div>
			<p class="text-[11px] font-bold uppercase tracking-widest text-accent">Starting</p>
			<h1 class="text-2xl font-black tracking-tight">{data.workout.name}</h1>
		</div>
		<a href="/" aria-label="Cancel" class="text-zinc-500 hover:text-zinc-300"><X class="h-5 w-5" /></a>
	</header>

	{#each data.open as o (o.id)}
		<div class="mb-4 rounded-2xl border border-[#f5c518]/40 bg-[#f5c518]/[0.06] p-4 text-sm">
			<p class="font-semibold text-[#f5c518]">{o.name} is still open</p>
			<p class="mb-3 text-zinc-400">
				Started {dateTime(o.startedAt)}. Finish or discard it so its time isn't counted.
			</p>
			<div class="flex gap-2">
				<a href="/session/{o.id}" class="flex-1 rounded-xl border border-line py-2 text-center font-semibold">Open it</a>
				<form method="POST" action="?/discardOpen" use:enhance class="flex-1">
					<input type="hidden" name="id" value={o.id} />
					<button class="w-full rounded-xl border border-line py-2 font-semibold text-red-400">Discard it</button>
				</form>
			</div>
		</div>
	{/each}

	<form method="POST" action="?/start" onsubmit={() => (starting = true)}>
		<input type="hidden" name="energy" value={energy} />
		{#each data.areas as a (a)}<input type="hidden" name="sore_{a}" value={sore[a]} />{/each}

		<p class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Energy</p>
		<div class="mb-6 grid grid-cols-5 gap-1.5">
			{#each ENERGY as e, i (e)}
				{@const on = energy === i + 1}
				<button
					type="button"
					onclick={() => (energy = i + 1)}
					class="flex flex-col items-center gap-1.5 rounded-xl border py-2.5 text-[11px] font-semibold transition
						{on ? 'border-accent2 bg-accent2/10 text-accent2' : 'border-line text-zinc-400 hover:border-zinc-500'}"
				>
					<span class="flex h-4 items-end gap-[2px]">
						{#each { length: 5 } as _, b (b)}
							<span
								class="w-[3px] rounded-sm {b <= i ? (on ? 'bg-accent2' : 'bg-zinc-400') : 'bg-line'}"
								style="height:{4 + b * 3}px"
							></span>
						{/each}
					</span>
					{e}
				</button>
			{/each}
		</div>

		<p class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Anything sore?</p>
		<div class="flex flex-col gap-1.5">
			{#each data.areas as a (a)}
				<div class="rounded-xl bg-panel px-3 py-2">
					<div class="flex items-center justify-between gap-2">
						<span class="text-sm font-semibold">{a}</span>
						<div class="flex overflow-hidden rounded-lg border border-line text-[11px]">
							{#each LEVELS as l, li (l)}
								<button
									type="button"
									onclick={() => (sore[a] = li)}
									class="px-2.5 py-1 font-semibold transition {levelClass(li, sore[a] === li)}">{l}</button
								>
							{/each}
						</div>
					</div>
					{#if data.estimate[a].reason}
						<p class="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500">
							<Info class="h-3 w-3 shrink-0" />{data.estimate[a].reason}
						</p>
					{/if}
				</div>
			{/each}
		</div>

		<button
			disabled={starting}
			class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-bold text-ink transition active:scale-[0.98] disabled:opacity-60"
		>
			<Play class="h-4 w-4" />{starting ? 'Starting…' : 'Start workout'}
		</button>
		<button
			name="skip"
			value="1"
			disabled={starting}
			class="mt-2 w-full py-2 text-center text-xs text-zinc-500 hover:text-zinc-300">Skip check-in</button
		>
	</form>
</div>
