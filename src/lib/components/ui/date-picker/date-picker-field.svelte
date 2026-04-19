<script lang="ts">
	import { DatePicker } from 'bits-ui';
	import { CalendarDate, today, getLocalTimeZone, type DateValue } from '@internationalized/date';

	let {
		label,
		value = $bindable<DateValue | undefined>(undefined),
		minValue,
		variant = 'light',
		isDateUnavailable
	}: {
		label: string;
		value?: DateValue;
		minValue?: DateValue;
		variant?: 'light' | 'dark';
		isDateUnavailable?: (date: DateValue) => boolean;
	} = $props();

	const isDark = $derived(variant === 'dark');
</script>

<div>
	<DatePicker.Root bind:value {minValue} {isDateUnavailable} weekStartsOn={1}>
		<DatePicker.Label class="mb-1 block text-xs font-medium uppercase tracking-wider {isDark ? 'text-white/50' : 'text-muted-foreground'}">
			{label}
		</DatePicker.Label>
		<div class="relative">
			<DatePicker.Input
				class="flex w-full items-center rounded-xl border px-3 py-2.5 text-sm transition focus-within:ring-2
					{isDark
						? 'border-white/20 bg-white/10 text-white backdrop-blur-sm focus-within:border-gold/50 focus-within:ring-gold/30'
						: 'border-border bg-background text-foreground focus-within:border-primary focus-within:ring-primary/20'}"
			>
				{#snippet children({ segments })}
					{#each segments as seg, i (i)}
						{#if seg.part === 'literal'}
							<span class="{isDark ? 'text-white/40' : 'text-muted-foreground'}">{seg.value}</span>
						{:else}
							<DatePicker.Segment
								part={seg.part}
								class="rounded px-0.5 tabular-nums outline-none focus:bg-primary/20 focus:text-primary
									{isDark ? 'text-white placeholder:text-white/30' : 'text-foreground placeholder:text-muted-foreground/50'}
									data-[placeholder]:italic"
							/>
						{/if}
					{/each}
				{/snippet}
			</DatePicker.Input>
			<DatePicker.Trigger
				class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 transition hover:bg-black/10
					{isDark ? 'text-white/60 hover:text-white' : 'text-muted-foreground hover:text-foreground'}"
				aria-label="Open calendar"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
				</svg>
			</DatePicker.Trigger>
		</div>
		<DatePicker.Portal>
			<DatePicker.Content
				class="z-[70] rounded-xl border border-border bg-card p-3 shadow-xl"
				sideOffset={8}
			>
				<DatePicker.Calendar>
					{#snippet children({ months, weekdays })}
						<DatePicker.Header class="flex items-center justify-between pb-2">
							<DatePicker.PrevButton class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
							</DatePicker.PrevButton>
							<DatePicker.Heading class="text-sm font-semibold text-foreground" />
							<DatePicker.NextButton class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
							</DatePicker.NextButton>
						</DatePicker.Header>
						{#each months as month (month.value.toString())}
							<DatePicker.Grid class="w-full border-collapse">
								<DatePicker.GridHead>
									<DatePicker.GridRow class="flex w-full">
										{#each weekdays as day}
											<DatePicker.HeadCell class="w-11 text-center text-[11px] font-medium text-muted-foreground">
												{day.slice(0, 2)}
											</DatePicker.HeadCell>
										{/each}
									</DatePicker.GridRow>
								</DatePicker.GridHead>
								<DatePicker.GridBody>
									{#each month.weeks as week, weekIdx (weekIdx)}
										<DatePicker.GridRow class="flex w-full">
											{#each week as day}
												<DatePicker.Cell date={day} month={month.value} class="p-0">
													<DatePicker.Day
														class="flex h-11 w-11 items-center justify-center rounded-lg text-sm transition
															data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground/30
															data-[unavailable]:pointer-events-none data-[unavailable]:text-muted-foreground/30 data-[unavailable]:line-through
															data-[outside-month]:pointer-events-none data-[outside-month]:text-muted-foreground/20
															data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:font-semibold
															data-[today]:font-bold data-[today]:text-primary
															hover:bg-muted text-foreground"
													/>
												</DatePicker.Cell>
											{/each}
										</DatePicker.GridRow>
									{/each}
								</DatePicker.GridBody>
							</DatePicker.Grid>
						{/each}
					{/snippet}
				</DatePicker.Calendar>
			</DatePicker.Content>
		</DatePicker.Portal>
	</DatePicker.Root>
</div>
