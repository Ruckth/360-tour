<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { useClerkContext } from 'svelte-clerk';
	import { api } from 'convex/_generated/api';

	const client = useConvexClient();
	const ctx = useClerkContext();

	$effect(() => {
		const session = ctx.session;
		if (session) {
			client.setAuth(
				async ({ forceRefreshToken }) => {
					const token = await session.getToken({
						template: 'convex',
						...(forceRefreshToken ? { skipCache: true } : {}),
					});
					return token;
				},
				async (isAuthenticated) => {
					if (isAuthenticated) {
						await client.mutation(api.users.store);
					}
				}
			);
		} else {
			client.clearAuth();
		}
	});
</script>
