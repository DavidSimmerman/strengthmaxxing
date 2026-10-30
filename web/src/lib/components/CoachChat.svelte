<script lang="ts">
	/**
	 * Talk to the coach: "shoulder hurts", "swap this", "no curls today". The coach answers in a line
	 * or two and can change the workout (swaps, removals, weight, sets, dislikes, pain notes); what
	 * it changed is listed under its reply. A header button opens it as a bottom sheet. Used on the
	 * workout preview (before Start) and during the workout; `send` does the request for each.
	 */
	import { MessageCircle, Send, X, RefreshCw } from '@lucide/svelte';
	type Msg = { role: 'user' | 'coach'; text: string; at: string; applied?: string[] };
	let {
		chat,
		send: post,
		intro = 'Tell the coach anything: a weight feels off, something hurts, you want a different exercise.',
		quick = ['Too heavy', 'Too easy', 'Swap this exercise', 'Something hurts', 'Cut it short today']
	}: {
		chat: Msg[];
		/** Sends the message; resolves once `chat` includes the reply, throws on failure. */
		send: (message: string) => Promise<void>;
		intro?: string;
		quick?: string[];
	} = $props();

	let open = $state(false);
	let text = $state('');
	let sending = $state(false);
	let error = $state('');
	let pendingUser = $state<string | null>(null);
	let list: HTMLElement | undefined = $state();

	$effect(() => {
		void chat.length;
		void pendingUser;
		if (open && list) queueMicrotask(() => list!.scrollTo({ top: list!.scrollHeight }));
	});

	async function send(msg: string) {
		msg = msg.trim();
		if (!msg || sending) return;
		sending = true;
		error = '';
		pendingUser = msg;
		text = '';
		try {
			await post(msg);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Coach unavailable';
			text = msg;
		} finally {
			pendingUser = null;
			sending = false;
		}
	}
</script>

<button
	type="button"
	onclick={() => (open = true)}
	aria-label="Talk to the coach"
	class="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-ink active:scale-[0.97]"
>
	<MessageCircle class="h-4 w-4" />Coach
</button>
{#if open}
	<div class="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[75vh] max-w-xl flex-col rounded-t-3xl border border-line bg-panel shadow-2xl">
		<div class="flex items-center justify-between border-b border-line px-4 py-3">
			<p class="font-bold">Coach</p>
			<button type="button" onclick={() => (open = false)} aria-label="Close" class="text-zinc-500 hover:text-zinc-300"><X class="h-5 w-5" /></button>
		</div>
		<div bind:this={list} class="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3 text-sm">
			{#if !chat.length && !pendingUser}
				<p class="text-zinc-500">{intro}</p>
			{/if}
			{#each chat as m, i (i)}
				{#if m.role === 'user'}
					<div class="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3 py-2 font-medium text-ink">{m.text}</div>
				{:else}
					<div class="max-w-[88%] rounded-2xl rounded-bl-md bg-panel2 px-3 py-2 text-zinc-200">
						{m.text}
						{#if m.applied?.length}
							<div class="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-[11px] text-zinc-400">
								{#each m.applied as a (a)}<span class="flex items-center gap-1.5"><RefreshCw class="h-3 w-3 shrink-0 text-accent2" />{a}</span>{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/each}
			{#if pendingUser}
				<div class="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3 py-2 font-medium text-ink">{pendingUser}</div>
				<div class="flex items-center gap-2 text-xs text-zinc-500">
					<span class="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>Coach is thinking…
				</div>
			{/if}
			{#if error}<p class="text-xs text-accent">{error}</p>{/if}
		</div>
		<div class="safe-bottom border-t border-line px-3 pb-3 pt-2">
			<div class="mb-2 flex flex-wrap gap-1.5">
				{#each quick as q (q)}
					<button
						type="button"
						disabled={sending}
						onclick={() => (text = q === 'Something hurts' ? 'My … hurts on this one' : q)}
						class="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-zinc-300 disabled:opacity-50">{q}</button
					>
				{/each}
			</div>
			<form
				class="flex items-center gap-2 rounded-xl border border-line bg-ink px-3 py-2"
				onsubmit={(e) => {
					e.preventDefault();
					void send(text);
				}}
			>
				<input
					bind:value={text}
					placeholder="Tell the coach…"
					class="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
				/>
				<button disabled={sending || !text.trim()} aria-label="Send" class="text-accent disabled:opacity-40"><Send class="h-4 w-4" /></button>
			</form>
		</div>
	</div>
{/if}
