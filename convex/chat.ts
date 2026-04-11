import { action, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { api } from './_generated/api';

// --- Chat session persistence ---

export const createSession = mutation({
	args: {
		propertyId: v.optional(v.id('properties')),
		channel: v.union(v.literal('web'), v.literal('whatsapp'), v.literal('line'))
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert('chatSessions', {
			propertyId: args.propertyId as any,
			channel: args.channel,
			messages: [],
			createdAt: Date.now()
		});
	}
});

export const addMessage = mutation({
	args: {
		sessionId: v.id('chatSessions'),
		role: v.union(v.literal('user'), v.literal('assistant')),
		content: v.string()
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const messages = [
			...session.messages,
			{ role: args.role, content: args.content, timestamp: Date.now() }
		];

		await ctx.db.patch(args.sessionId, { messages });
	}
});

export const getSession = query({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.sessionId);
	}
});

// --- AI Chat Action ---

const TOOLS = [
	{
		type: 'function' as const,
		function: {
			name: 'check_availability',
			description:
				'Check if a property is available for specific dates. Returns available or blocked dates.',
			parameters: {
				type: 'object',
				properties: {
					propertySlug: {
						type: 'string',
						description: 'The property slug (pool-villa, garden-suite, or penthouse)'
					},
					checkIn: {
						type: 'string',
						description: 'Check-in date in YYYY-MM-DD format'
					},
					checkOut: {
						type: 'string',
						description: 'Check-out date in YYYY-MM-DD format'
					}
				},
				required: ['propertySlug', 'checkIn', 'checkOut']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'calculate_price',
			description:
				'Calculate the total price for a stay including direct booking discount. Also shows OTA comparison prices.',
			parameters: {
				type: 'object',
				properties: {
					propertySlug: {
						type: 'string',
						description: 'The property slug (pool-villa, garden-suite, or penthouse)'
					},
					nights: {
						type: 'number',
						description: 'Number of nights'
					},
					guests: {
						type: 'number',
						description: 'Number of guests'
					}
				},
				required: ['propertySlug', 'nights']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'get_property_details',
			description:
				'Get full details about a property including amenities, capacity, description, and images.',
			parameters: {
				type: 'object',
				properties: {
					propertySlug: {
						type: 'string',
						description: 'The property slug (pool-villa, garden-suite, or penthouse)'
					}
				},
				required: ['propertySlug']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'list_properties',
			description: 'List all available properties with basic info and pricing.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	}
];

// Classify question complexity for model routing
function classifyComplexity(message: string): 'simple' | 'complex' {
	const lower = message.toLowerCase();

	// Complex: multi-step reasoning, comparisons, date calculations
	const complexPatterns = [
		/compar/i,
		/which.*(better|best|recommend)/i,
		/differ.*between/i,
		/should i/i,
		/help me (choose|decide|pick)/i,
		/multiple.*dates/i,
		/if.*then/i,
		/budget.*plan/i
	];

	if (complexPatterns.some((p) => p.test(lower))) return 'complex';
	return 'simple';
}

export const respond = action({
	args: {
		sessionId: v.id('chatSessions'),
		userMessage: v.string(),
		propertySlug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Get session for message history
		const session = await ctx.runQuery(api.chat.getSession, {
			sessionId: args.sessionId
		});
		if (!session) throw new Error('Session not found');

		// Save user message
		await ctx.runMutation(api.chat.addMessage, {
			sessionId: args.sessionId,
			role: 'user',
			content: args.userMessage
		});

		// Get all properties for context
		const properties = await ctx.runQuery(api.properties.list, {});

		// Build property context
		const propertyContext = properties
			.map(
				(p) =>
					`- ${p.name} (slug: ${p.slug}): ${p.tagline}. ฿${p.pricePerNight}/night, ${p.maxGuests} guests max, ${p.bedrooms} bed, ${p.bathrooms} bath, ${p.area}m². Amenities: ${p.amenities.join(', ')}`
			)
			.join('\n');

		const currentProperty = args.propertySlug
			? properties.find((p) => p.slug === args.propertySlug)
			: null;

		const systemPrompt = `You are a helpful, friendly AI concierge for Spin & Stay, a luxury villa rental in Koh Tao, Thailand. You help guests find the perfect property and answer questions about pricing and availability.

PROPERTIES:
${propertyContext}

${currentProperty ? `The guest is currently viewing: ${currentProperty.name} (${currentProperty.slug})` : 'The guest is browsing all properties.'}

PRICING:
- All prices are in Thai Baht (฿ / THB)
- Direct booking gives 15% discount off the listed price
- No service fees, no cleaning fees for direct bookings
- Free cancellation up to 48 hours before check-in

STYLE:
- Be warm, concise, and helpful
- Use ฿ symbol for prices
- Suggest the 360° virtual tour when relevant
- If the guest seems ready to book, encourage them to use the booking form on the website
- If a question is beyond your knowledge, offer to connect them with the host via WhatsApp
- Keep responses under 150 words unless detailed info is requested`;

		// Build messages for API call
		const apiMessages: Array<{ role: string; content: string }> = [
			{ role: 'system', content: systemPrompt }
		];

		// Add conversation history (last 10 messages)
		const recentHistory = session.messages.slice(-10);
		for (const msg of recentHistory) {
			apiMessages.push({ role: msg.role, content: msg.content });
		}

		// Add current user message
		apiMessages.push({ role: 'user', content: args.userMessage });

		// Determine model based on complexity
		const complexity = classifyComplexity(args.userMessage);

		const apiKey = process.env.AI_API_KEY;
		const apiBase = process.env.AI_API_BASE_URL || 'https://api.openai.com/v1';
		const simpleModel = process.env.AI_SIMPLE_MODEL || 'gpt-4o-mini';
		const complexModel = process.env.AI_COMPLEX_MODEL || 'gpt-4o';

		if (!apiKey) {
			// Fallback: return a helpful static response
			const fallbackResponse = getFallbackResponse(args.userMessage, currentProperty);
			await ctx.runMutation(api.chat.addMessage, {
				sessionId: args.sessionId,
				role: 'assistant',
				content: fallbackResponse
			});
			return { response: fallbackResponse, model: 'fallback' };
		}

		const selectedModel = complexity === 'simple' ? simpleModel : complexModel;

		// Call AI API with tool support
		let response = await callAI(apiBase, apiKey, selectedModel, apiMessages, TOOLS);

		// Handle tool calls
		let maxToolRounds = 3;
		while (response.tool_calls && response.tool_calls.length > 0 && maxToolRounds > 0) {
			maxToolRounds--;

			// Add assistant message with tool calls
			apiMessages.push({
				role: 'assistant',
				content: response.content || '',
				...({ tool_calls: response.tool_calls } as any)
			});

			// Execute each tool call
			for (const toolCall of response.tool_calls) {
				const fnName = toolCall.function.name;
				const fnArgs = JSON.parse(toolCall.function.arguments);
				let toolResult: string;

				try {
					toolResult = await executeTool(ctx, fnName, fnArgs, properties);
				} catch (e) {
					toolResult = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
				}

				apiMessages.push({
					role: 'tool',
					content: toolResult,
					...({ tool_call_id: toolCall.id } as any)
				});
			}

			// Call AI again with tool results
			response = await callAI(apiBase, apiKey, selectedModel, apiMessages, TOOLS);
		}

		const assistantMessage = response.content || "I'm sorry, I couldn't process that. Please try again.";

		// Save assistant message
		await ctx.runMutation(api.chat.addMessage, {
			sessionId: args.sessionId,
			role: 'assistant',
			content: assistantMessage
		});

		return { response: assistantMessage, model: selectedModel };
	}
});

// --- Helper functions ---

async function callAI(
	apiBase: string,
	apiKey: string,
	model: string,
	messages: any[],
	tools: any[]
): Promise<{ content: string | null; tool_calls?: any[] }> {
	const res = await fetch(`${apiBase}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model,
			messages,
			tools,
			tool_choice: 'auto',
			temperature: 0.7,
			max_tokens: 500
		})
	});

	if (!res.ok) {
		const error = await res.text();
		throw new Error(`AI API error (${res.status}): ${error}`);
	}

	const data = await res.json();
	const choice = data.choices?.[0]?.message;

	return {
		content: choice?.content ?? null,
		tool_calls: choice?.tool_calls
	};
}

async function executeTool(
	ctx: any,
	fnName: string,
	fnArgs: any,
	properties: any[]
): Promise<string> {
	switch (fnName) {
		case 'check_availability': {
			const property = properties.find((p) => p.slug === fnArgs.propertySlug);
			if (!property) return JSON.stringify({ error: 'Property not found' });

			const available = await ctx.runQuery(api.availability.isAvailable, {
				propertyId: property._id,
				checkIn: fnArgs.checkIn,
				checkOut: fnArgs.checkOut
			});

			const startDate = new Date(fnArgs.checkIn);
			const endDate = new Date(fnArgs.checkOut);
			const nights = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

			return JSON.stringify({
				property: property.name,
				checkIn: fnArgs.checkIn,
				checkOut: fnArgs.checkOut,
				nights,
				available,
				pricePerNight: property.pricePerNight,
				directPrice: Math.round(property.pricePerNight * 0.85),
				totalDirect: Math.round(property.pricePerNight * 0.85 * nights),
				totalOTA: Math.round(property.pricePerNight * 1.2 * nights),
				currency: 'THB'
			});
		}

		case 'calculate_price': {
			const property = properties.find((p) => p.slug === fnArgs.propertySlug);
			if (!property) return JSON.stringify({ error: 'Property not found' });

			const nights = fnArgs.nights || 1;
			const listedTotal = property.pricePerNight * nights;
			const discountAmount = Math.round(listedTotal * 0.15);
			const directTotal = listedTotal - discountAmount;

			// Approximate OTA pricing
			const otaComparison = [
				{
					platform: 'Booking.com',
					nightlyRate: Math.round(property.pricePerNight * 1.2),
					serviceFee: Math.round(property.pricePerNight * 1.2 * nights * 0.14),
					total: Math.round(property.pricePerNight * 1.2 * nights * 1.14 + 800)
				},
				{
					platform: 'Airbnb',
					nightlyRate: Math.round(property.pricePerNight * 1.15),
					serviceFee: Math.round(property.pricePerNight * 1.15 * nights * 0.14),
					total: Math.round(property.pricePerNight * 1.15 * nights * 1.14 + 600)
				}
			];

			const maxSavings = Math.max(...otaComparison.map((o) => o.total)) - directTotal;

			return JSON.stringify({
				property: property.name,
				nights,
				guests: fnArgs.guests || 'any',
				maxGuests: property.maxGuests,
				pricePerNight: property.pricePerNight,
				listedTotal,
				discountPercent: 15,
				discountAmount,
				directTotal,
				otaComparison,
				maxSavings,
				currency: 'THB'
			});
		}

		case 'get_property_details': {
			const property = properties.find((p) => p.slug === fnArgs.propertySlug);
			if (!property) return JSON.stringify({ error: 'Property not found' });

			return JSON.stringify({
				name: property.name,
				slug: property.slug,
				tagline: property.tagline,
				description: property.description,
				pricePerNight: property.pricePerNight,
				directPrice: Math.round(property.pricePerNight * 0.85),
				currency: 'THB',
				maxGuests: property.maxGuests,
				bedrooms: property.bedrooms,
				bathrooms: property.bathrooms,
				area: property.area,
				amenities: property.amenities,
				has360Tour: true
			});
		}

		case 'list_properties': {
			const list = properties.map((p) => ({
				name: p.name,
				slug: p.slug,
				tagline: p.tagline,
				pricePerNight: p.pricePerNight,
				directPrice: Math.round(p.pricePerNight * 0.85),
				maxGuests: p.maxGuests,
				bedrooms: p.bedrooms
			}));
			return JSON.stringify({ properties: list, currency: 'THB' });
		}

		default:
			return JSON.stringify({ error: `Unknown function: ${fnName}` });
	}
}

function getFallbackResponse(message: string, property: any): string {
	const lower = message.toLowerCase();

	if (lower.includes('price') || lower.includes('cost') || lower.includes('how much')) {
		if (property) {
			const direct = Math.round(property.pricePerNight * 0.85);
			return `${property.name} is ฿${property.pricePerNight.toLocaleString()}/night, but with our **15% direct booking discount**, you pay just **฿${direct.toLocaleString()}/night**! That's a significant saving compared to OTA platforms. Use the booking form above to check total pricing for your dates.`;
		}
		return `We have 3 luxury properties:\n- **Pool Villa**: ฿8,500/night (฿7,225 direct)\n- **Garden Suite**: ฿4,500/night (฿3,825 direct)\n- **Penthouse**: ฿12,000/night (฿10,200 direct)\n\nAll prices include a **15% direct booking discount**. Which property interests you?`;
	}

	if (lower.includes('available') || lower.includes('book') || lower.includes('dates')) {
		return `You can check availability and book directly using the date picker on the property page. Direct booking gives you **15% off** plus free airport pickup, welcome basket, and late checkout! If you need help with specific dates, feel free to message us on WhatsApp.`;
	}

	if (lower.includes('amenit') || lower.includes('feature') || lower.includes('what')) {
		if (property) {
			return `**${property.name}** includes: ${property.amenities.join(', ')}. It's ${property.area}m² with ${property.bedrooms} bedroom(s) and ${property.bathrooms} bathroom(s), perfect for up to ${property.maxGuests} guests. Take the **360° virtual tour** to explore every room!`;
		}
	}

	return `Welcome to Spin & Stay! I can help you with:\n- **Pricing** for our luxury villas\n- **Availability** for your travel dates\n- **Property details** and amenities\n\nWhich property are you interested in? We have the Pool Villa, Garden Suite, and Penthouse — all on beautiful Koh Tao, Thailand.`;
}
