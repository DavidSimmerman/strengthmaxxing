<script lang="ts">
	let { form } = $props();
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-1 text-3xl font-black tracking-tight">
		strength<span class="text-accent">maxxing</span>
	</h1>
	<p class="mb-6 text-sm text-zinc-500">Enter your password to continue.</p>
	<form method="POST" class="flex flex-col gap-3">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="password"
			name="password"
			autocomplete="current-password"
			autofocus
			placeholder="Password"
			class="rounded-xl border border-line bg-panel px-4 py-3 outline-none focus:border-accent"
		/>
		{#if form?.error}<p class="text-sm text-accent">{form.error}</p>{/if}
		<button class="rounded-xl bg-accent py-3 font-bold text-ink">Sign in</button>
	</form>
</div>
