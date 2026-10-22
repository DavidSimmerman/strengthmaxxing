<script lang="ts">
	import { ArrowRight, Check, Dumbbell, Minus, Plus } from '@lucide/svelte';
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { wt } from '$lib/units.svelte';
	import type { PageData } from './$types';
	import type { ChatMessage, CoachProfile } from '$lib/server/coach';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let messages = $state<ChatMessage[]>(data.messages);
	let text = $state('');
	let pending = $state<string | null>(null); // what the coach is working on
	let listEl: HTMLDivElement;

	async function scrollDown() {
		await tick();
		listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });
	}
	$effect(() => {
		scrollDown();
	});

	// Replies are filled in on the server in the background — poll until none are pending.
	const waiting = $derived(messages.some((m) => m.pending));
	$effect(() => {
		if (!waiting) return;
		const t = setInterval(async () => {
			const res = await fetch('/api/coach/chat').catch(() => null);
			if (!res?.ok) return;
			const out = await res.json();
			messages = out.messages;
			if (!out.messages.some((m: ChatMessage) => m.pending)) {
				pending = null;
				scrollDown();
				invalidateAll();
			}
		}, 2500);
		return () => clearInterval(t);
	});

	async function post(body: object, label: string, optimistic?: string) {
		if (pending || waiting) return;
		pending = label;
		const tmpId = 'tmp';
		if (optimistic) messages.push({ id: tmpId, role: 'user', text: optimistic, at: new Date().toISOString() });
		scrollDown();
		try {
			const res = await fetch('/api/coach/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out.message || `Coach unavailable (${res.status})`);
			messages = [...messages.filter((m) => m.id !== tmpId), ...out.messages];
			return; // the reply arrives via polling; `pending` clears there
		} catch (e) {
			messages = messages.filter((m) => m.id !== tmpId);
			messages.push({
				id: crypto.randomUUID(),
				role: 'coach',
				text: e instanceof Error ? e.message : 'Something went wrong',
				error: true,
				at: new Date().toISOString()
			});
		}
		pending = null;
		scrollDown();
	}

	function send(e?: SubmitEvent) {
		e?.preventDefault();
		const t = text.trim();
		if (!t) return;
		text = '';
		post({ text: t }, 'Researching and writing — this can take a few minutes.', t);
	}

	// ---- plan card actions ----
	let busy = $state<string | null>(null);
	let openPlan = $state<Record<string, boolean>>({});
	async function savePlan(m: ChatMessage) {
		busy = m.id;
		const res = await fetch('/api/coach/program', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ plan: m.plan, messageId: m.id })
		});
		busy = null;
		if (res.ok) {
			m.saved = true;
			invalidateAll();
		}
	}

	// ---- single-workout edit card ----
	type EditEx = { name: string; sets: number; reps: number; restSec: number; weightKg: number | null };
	const fmtEx = (x: EditEx) => `${x.sets}×${x.reps}${x.weightKg ? ` · ${wt(x.weightKg)}` : ''}`;
	const minutes = (xs: EditEx[]) => Math.round(5 + xs.reduce((m, x) => m + x.sets * (60 + x.restSec), 0) / 60);
	function editRows(ed: { before: EditEx[]; after: EditEx[] }) {
		const before = new Map(ed.before.map((x) => [x.name, x]));
		const rows: { name: string; status: 'same' | 'changed' | 'added' | 'removed'; was: string; now: string }[] = [];
		for (const x of ed.after) {
			const b = before.get(x.name);
			const now = fmtEx(x);
			if (!b) rows.push({ name: x.name, status: 'added', was: '', now });
			else rows.push({ name: x.name, status: fmtEx(b) === now ? 'same' : 'changed', was: fmtEx(b), now });
		}
		// show a removed exercise where it used to be, so a swap reads as "this → that"
		const kept = new Set(ed.after.map((x) => x.name));
		ed.before.forEach((b, i) => {
			if (!kept.has(b.name))
				rows.splice(Math.min(i, rows.length), 0, { name: b.name, status: 'removed', was: '', now: fmtEx(b) });
		});
		return rows;
	}
	async function saveEdit(m: ChatMessage) {
		busy = m.id;
		const res = await fetch('/api/coach/workout-edit', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messageId: m.id })
		});
		busy = null;
		if (res.ok) {
			m.editSaved = true;
			invalidateAll();
		}
	}

	// ---- progress card: every suggestion checked by default ----
	let unchecked = $state<Record<string, boolean>>({});
	const key = (m: ChatMessage, name: string) => `${m.id}:${name}`;
	async function apply(m: ChatMessage) {
		const chosen = m.progress!.adjustments.filter((a) => !unchecked[key(m, a.name)]);
		if (!chosen.length) return;
		busy = m.id;
		const res = await fetch('/api/coach/progress/apply', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ workoutId: m.progress!.workoutId, messageId: m.id, adjustments: chosen })
		});
		busy = null;
		if (res.ok) m.applied = chosen.map((a) => a.name);
	}

	// ---- profile ----
	let showProfile = $state(false);
	// svelte-ignore state_referenced_locally
	let p = $state<CoachProfile & { equipmentText: string }>({
		goal: 'strength',
		daysPerWeek: 4,
		sessionMin: 60,
		experience: 'intermediate',
		...data.profile,
		equipmentText: (data.profile.equipment ?? []).join(', ')
	});
	let savingProfile = $state(false);
	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		savingProfile = true;
		const { equipmentText, ...rest } = p;
		await fetch('/api/coach/profile', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				...rest,
				equipment: equipmentText.split(',').map((s) => s.trim()).filter(Boolean)
			})
		});
		savingProfile = false;
		showProfile = false;
		invalidateAll();
	}
	const summary = $derived(
		[
			data.profile.goal,
			data.profile.daysPerWeek && `${data.profile.daysPerWeek}×${data.profile.sessionMin ?? 60} min`,
			data.profile.experience,
			data.profile.avoid
		]
			.filter(Boolean)
			.join(' · ')
	);

	async function clearChat() {
		if (!confirm('Clear the conversation? Your program and profile stay.')) return;
		await fetch('/api/coach/chat', { method: 'DELETE' });
		messages = [];
	}

	const examples = [
		'Build me a 4-day program for a bigger bench and squat',
		'Swap squats for leg press this week, my knee is cranky',
		'Make Friday shorter, I only have 40 minutes'
	];
	const field =
		'rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-accent';
</script>

<div class="-my-6 flex h-[calc(100dvh-6rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col md:-my-10 md:h-dvh">
	<!-- header -->
	<header class="shrink-0 border-b border-line pt-6 pb-3 md:pt-10">
		<div class="flex items-center justify-between gap-3">
			<h1 class="text-3xl font-black tracking-tight">Coach</h1>
			<div class="flex gap-2">
				{#if messages.length}
					<button onclick={clearChat} class="rounded-full px-3 py-1 text-xs text-zinc-500 hover:text-zinc-300"
						>Clear</button
					>
				{/if}
				<button
					onclick={() => (showProfile = !showProfile)}
					class="rounded-full bg-panel2 px-3 py-1 text-xs text-zinc-300">Profile {showProfile ? '▴' : '▾'}</button
				>
			</div>
		</div>
		<p class="mt-1 text-xs text-zinc-500">
			{summary || 'Set your goal, schedule and equipment in Profile.'}
			{#if data.program}
				· <span class="text-accent2"
					>{data.program.name}{data.program.weeks ? `, week ${data.program.week} of ${data.program.weeks}` : ''}</span
				>
			{/if}
		</p>

		{#if showProfile}
			<form onsubmit={saveProfile} class="mt-3 grid gap-2 rounded-2xl border border-line bg-panel p-4 sm:grid-cols-2">
				<label class="flex flex-col gap-1 text-xs text-zinc-400">
					Goal
					<select bind:value={p.goal} class={field}>
						<option value="strength">Strength</option>
						<option value="hypertrophy">Size (hypertrophy)</option>
						<option value="powerbuilding">Powerbuilding</option>
						<option value="fat loss">Fat loss / conditioning</option>
						<option value="general">General fitness</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-xs text-zinc-400">
					Experience
					<select bind:value={p.experience} class={field}>
						<option value="beginner">Beginner</option>
						<option value="intermediate">Intermediate</option>
						<option value="advanced">Advanced</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-xs text-zinc-400">
					Days per week
					<select bind:value={p.daysPerWeek} class={field}>
						{#each [2, 3, 4, 5, 6] as d (d)}<option value={d}>{d} days</option>{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1 text-xs text-zinc-400">
					Session length
					<select bind:value={p.sessionMin} class={field}>
						{#each [30, 45, 60, 75, 90] as m (m)}<option value={m}>{m} min</option>{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1 text-xs text-zinc-400 sm:col-span-2">
					Equipment (comma-separated)
					<input bind:value={p.equipmentText} placeholder="barbell + rack, dumbbells to 80 lb, cable stack" class={field} />
				</label>
				<label class="flex flex-col gap-1 text-xs text-zinc-400 sm:col-span-2">
					Injuries / things to avoid
					<input bind:value={p.avoid} placeholder="e.g. left shoulder: no behind-the-neck pressing" class={field} />
				</label>
				<button disabled={savingProfile} class="rounded-xl bg-accent py-2.5 font-bold text-ink disabled:opacity-60 sm:col-span-2"
					>{savingProfile ? 'Saving…' : 'Save profile'}</button
				>
			</form>
		{/if}
	</header>

	<!-- conversation -->
	<div bind:this={listEl} class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4 text-sm">
		{#if !messages.length}
			<div class="mr-8 rounded-2xl rounded-bl-md bg-panel px-3.5 py-2.5 text-zinc-200">
				Tell me what you want in your own words. I'll build a multi-week program from your history,
				and you can change it any time by just asking.
			</div>
			<div class="flex flex-wrap gap-2">
				{#each examples as ex (ex)}
					<button onclick={() => (text = ex)} class="rounded-full border border-line px-3 py-1.5 text-left text-xs text-zinc-300 hover:border-accent"
						>{ex}</button
					>
				{/each}
			</div>
		{/if}

		{#each messages as m (m.id)}
			{#if m.pending}
				<!-- shown by the spinner below -->
			{:else if m.role === 'user'}
				<div class="ml-10 self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 whitespace-pre-wrap text-ink">
					{m.text}
				</div>
			{:else}
				<div
					class="mr-6 self-start rounded-2xl rounded-bl-md px-3.5 py-2.5 whitespace-pre-wrap
						{m.error ? 'border border-accent/40 bg-accent/[0.06] text-zinc-300' : 'bg-panel text-zinc-200'}"
				>
					{m.text}
				</div>

				{#if m.sources?.length}
					<details class="mr-6 self-start text-xs text-zinc-500">
						<summary class="cursor-pointer select-none hover:text-zinc-300">
							Based on {m.sources.length} source{m.sources.length === 1 ? '' : 's'}
						</summary>
						<ul class="mt-1 flex flex-col gap-0.5 pl-3">
							{#each m.sources as src (src.url)}
								<li>
									<a href={src.url} target="_blank" rel="noopener noreferrer" class="underline decoration-zinc-700 hover:text-zinc-300"
										>{src.title}</a
									>
								</li>
							{/each}
						</ul>
					</details>
				{/if}

				{#if m.plan}
					{@const plan = m.plan}
					<div class="mr-6 rounded-2xl border border-line bg-panel p-3">
						<p class="font-black">{plan.name}</p>
						{#if plan.weeks}
							<div class="my-2 flex gap-1">
								{#each { length: plan.weeks } as _, i (i)}
									<div class="h-1.5 flex-1 rounded-full {plan.deloadWeek === i + 1 ? 'bg-zinc-600' : 'bg-line'}"></div>
								{/each}
							</div>
						{/if}
						<p class="mb-2 mt-1 text-xs text-zinc-500">
							{plan.weeks
								? `${plan.weeks} weeks${plan.deloadWeek ? `, week ${plan.deloadWeek} is a deload` : ''}.`
								: `${plan.days.length}-day cycle, repeat in order.`}
							{plan.progression}
						</p>
						{#each plan.days as d, di (di)}
							<button
								onclick={() => (openPlan[`${m.id}:${di}`] = !openPlan[`${m.id}:${di}`])}
								class="flex w-full justify-between border-t border-line py-1.5 text-left text-[13px]"
							>
								<span class="font-semibold">{d.dayOfWeek ? `${d.dayOfWeek} · ` : ''}{d.name}</span>
								<span class="shrink-0 text-zinc-500"
									>{d.exercises.length} lifts · ~{d.estMinutes ?? '?'} min {openPlan[`${m.id}:${di}`] ? '▴' : '▾'}</span
								>
							</button>
							{#if openPlan[`${m.id}:${di}`]}
								<ul class="mb-2 flex flex-col gap-0.5 pl-1 text-[13px]">
									{#each d.exercises as x, xi (xi)}
										<li class="flex justify-between gap-2">
											<span class={x.exerciseId ? 'text-zinc-300' : 'text-zinc-600 line-through'} title={x.exerciseId ? '' : 'Not in your exercise library — will be skipped'}
												>{x.name}</span
											>
											<span class="shrink-0 tabular-nums text-zinc-500"
												>{x.sets}×{x.reps}{#if x.weightKg} · <span class="text-zinc-200">{wt(x.weightKg)}</span>{/if}</span
											>
										</li>
									{/each}
								</ul>
							{/if}
						{/each}
						{#if m.saved}
							<p class="mt-2 rounded-xl bg-accent2/15 py-2 text-center text-sm font-bold text-accent2">
								<Check class="mr-1 inline h-4 w-4" />Saved
							</p>
						{:else}
							<button
								onclick={() => savePlan(m)}
								disabled={busy === m.id}
								class="mt-2 w-full rounded-xl bg-accent2 py-2 text-sm font-bold text-ink disabled:opacity-60"
								>{busy === m.id ? 'Saving…' : data.program?.name === plan.name ? 'Save changes' : `Save as ${plan.days.length} workouts`}</button
							>
						{/if}
					</div>
				{/if}

				{#if m.workoutEdit}
					{@const ed = m.workoutEdit}
					{@const rows = editRows(ed)}
					<div class="mr-6 rounded-2xl border border-line bg-panel p-3">
						<p class="mb-1 font-black">{ed.workoutName}</p>
						<p class="mb-2 text-xs text-zinc-500">~{minutes(ed.before)} min → ~{minutes(ed.after)} min</p>
						<ul class="flex flex-col text-[13px]">
							{#each rows as r, ri (ri)}
								<li class="flex items-baseline justify-between gap-2 border-t border-line py-1.5 first:border-0">
									<span class="flex items-baseline gap-1.5">
										{#if r.status === 'added'}<Plus class="h-3 w-3 shrink-0 text-accent2" />{:else if r.status === 'removed'}<Minus
												class="h-3 w-3 shrink-0 text-accent"
											/>{:else if r.status === 'changed'}<ArrowRight class="h-3 w-3 shrink-0 text-[#f5c518]" />{:else}<span class="w-3"></span>{/if}
										<span class={r.status === 'removed' ? 'text-zinc-600 line-through' : 'text-zinc-200'}>{r.name}</span>
									</span>
									<span class="shrink-0 tabular-nums text-zinc-500">
										{#if r.status === 'changed'}<span class="text-zinc-600 line-through">{r.was}</span> {/if}<span
											class={r.status === 'removed' ? 'text-zinc-600 line-through' : r.status === 'same' ? '' : 'text-zinc-200'}>{r.now}</span
										>
									</span>
								</li>
							{/each}
						</ul>
						{#if m.editSaved}
							<p class="mt-2 rounded-xl bg-accent2/15 py-2 text-center text-sm font-bold text-accent2">
								<Check class="mr-1 inline h-4 w-4" />Saved to {ed.workoutName}
							</p>
						{:else}
							<button
								onclick={() => saveEdit(m)}
								disabled={busy === m.id}
								class="mt-2 w-full rounded-xl bg-accent2 py-2 text-sm font-bold text-ink disabled:opacity-60"
								>{busy === m.id ? 'Saving…' : `Save changes to ${ed.workoutName}`}</button
							>
						{/if}
					</div>
				{/if}

				{#if m.progress}
					{@const pr = m.progress}
					<div class="mr-6 rounded-2xl border border-line bg-panel p-3">
						<p class="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-400">
							{pr.workoutName}{pr.readiness != null ? ` · readiness ${pr.readiness}` : ''}
						</p>
						{#each pr.adjustments as a (a.name)}
							<label class="flex items-start gap-3 border-t border-line py-2 first-of-type:border-0">
								<input
									type="checkbox"
									disabled={!!m.applied}
									checked={m.applied ? m.applied.includes(a.name) : !unchecked[key(m, a.name)]}
									onchange={(e) => (unchecked[key(m, a.name)] = !e.currentTarget.checked)}
									class="mt-1 h-4 w-4 accent-[var(--color-accent2)]"
								/>
								<span class="min-w-0 flex-1">
									<span class="flex justify-between gap-2 text-[13px]">
										<span class="font-semibold">{a.name}</span>
										<span class="shrink-0 tabular-nums"
											><b>{wt(a.suggestedWeightKg)}</b> × {a.suggestedReps}
											<span class="text-zinc-500">{a.deltaPct > 0 ? '+' : ''}{a.deltaPct}%</span></span
										>
									</span>
									<span class="block text-[11px] text-zinc-500">{a.reason}</span>
								</span>
							</label>
						{/each}
						{#if m.applied}
							<p class="mt-2 rounded-xl bg-accent2/15 py-2 text-center text-sm font-bold text-accent2">
								<Check class="mr-1 inline h-4 w-4" />Applied to {pr.workoutName}
							</p>
						{:else if pr.adjustments.length}
							{@const n = pr.adjustments.filter((a) => !unchecked[key(m, a.name)]).length}
							<button
								onclick={() => apply(m)}
								disabled={busy === m.id || n === 0}
								class="mt-2 w-full rounded-xl bg-accent py-2 text-sm font-bold text-ink disabled:opacity-60"
								>{busy === m.id ? 'Applying…' : `Apply ${n} change${n === 1 ? '' : 's'}`}</button
							>
						{/if}
					</div>
				{/if}
			{/if}
		{/each}

		{#if pending || waiting}
			<div class="mr-6 flex items-center gap-3 self-start rounded-2xl rounded-bl-md bg-panel px-3.5 py-2.5 text-zinc-400">
				<span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>
				{pending ?? 'The coach is researching and writing — this can take a few minutes.'}
			</div>
		{/if}
	</div>

	<!-- composer -->
	<div class="shrink-0 border-t border-line pt-3 pb-4">
		{#if data.nextWorkout}
			<button
				onclick={() => post({ action: 'weights' }, `Working out today's weights for ${data.nextWorkout}…`)}
				disabled={!!pending || waiting}
				class="mb-2 rounded-full border border-line px-3 py-1.5 text-xs text-zinc-300 hover:border-accent disabled:opacity-50"
				><Dumbbell class="mr-1 inline h-3.5 w-3.5" />Today's weights for {data.nextWorkout}</button
			>
		{/if}
		<form onsubmit={send} class="flex items-end gap-2 rounded-3xl border border-line bg-panel py-1.5 pr-1.5 pl-4 focus-within:border-accent">
			<textarea
				bind:value={text}
				rows="1"
				placeholder="Tell the coach what you want…"
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						send();
					}
				}}
				class="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent py-1.5 text-sm outline-none field-sizing-content"
			></textarea>
			<button
				disabled={!text.trim() || !!pending || waiting}
				aria-label="Send"
				class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent font-bold text-ink disabled:opacity-40">↑</button
			>
		</form>
	</div>
</div>
