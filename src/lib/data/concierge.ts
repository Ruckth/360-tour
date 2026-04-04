export type MessageType = 'text' | 'quick-replies' | 'booking-widget' | 'property-card';

export interface ConciergeMessage {
	id: string;
	type: MessageType;
	sender: 'concierge' | 'user';
	content: string;
	quickReplies?: string[];
	propertyId?: string;
	timestamp: number;
}

export interface ConversationTrigger {
	id: string;
	event: 'page_visit' | 'tour_open' | 'time_in_tour' | 'rooms_visited' | 'idle' | 'tour_close';
	threshold?: number;
	messages: Omit<ConciergeMessage, 'id' | 'timestamp'>[];
	delay?: number;
}

export const triggers: ConversationTrigger[] = [
	{
		id: 'page_visit',
		event: 'page_visit',
		delay: 1500,
		messages: [
			{
				type: 'quick-replies',
				sender: 'concierge',
				content: "Welcome! I'm Noi, your virtual host. Looking for the perfect getaway in Koh Tao?",
				quickReplies: ['Show me properties', 'Tell me about Koh Tao', 'Best deals']
			}
		]
	},
	{
		id: 'tour_open',
		event: 'tour_open',
		delay: 2000,
		messages: [
			{
				type: 'text',
				sender: 'concierge',
				content: "Nice! You're exploring the {propertyName}. Drag to look around — I'll be here if you need anything!"
			}
		]
	},
	{
		id: 'time_in_tour',
		event: 'time_in_tour',
		threshold: 15,
		delay: 0,
		messages: [
			{
				type: 'quick-replies',
				sender: 'concierge',
				content: 'The {propertyName} is one of our most popular picks. Want me to check availability for your dates?',
				quickReplies: ['Check availability', 'See prices', 'Keep exploring']
			}
		]
	},
	{
		id: 'rooms_visited',
		event: 'rooms_visited',
		threshold: 2,
		delay: 1000,
		messages: [
			{
				type: 'quick-replies',
				sender: 'concierge',
				content: "You've explored {count} rooms! This place is even better in person. Ready to book your stay?",
				quickReplies: ['Book now', 'Compare properties', 'Not yet']
			}
		]
	},
	{
		id: 'idle',
		event: 'idle',
		threshold: 30,
		delay: 0,
		messages: [
			{
				type: 'quick-replies',
				sender: 'concierge',
				content: 'Still there? I can help you compare properties or find the best dates. Just ask!',
				quickReplies: ['Compare properties', 'Best dates to visit', "I'm just browsing"]
			}
		]
	},
	{
		id: 'tour_close',
		event: 'tour_close',
		delay: 500,
		messages: [
			{
				type: 'quick-replies',
				sender: 'concierge',
				content: 'Hope you enjoyed the tour! Want me to hold those dates for you?',
				quickReplies: ['Yes, book it!', 'Send me details', 'Maybe later']
			}
		]
	}
];

export interface CannedResponse {
	keywords: string[];
	response: Omit<ConciergeMessage, 'id' | 'timestamp'>;
}

export const cannedResponses: CannedResponse[] = [
	{
		keywords: ['wifi', 'wi-fi', 'internet'],
		response: { type: 'text', sender: 'concierge', content: 'Yes! All properties have high-speed WiFi (100+ Mbps) included. Perfect for remote work or streaming your favorite shows after a day at the beach.' }
	},
	{
		keywords: ['airport', 'transfer', 'pickup', 'pick up'],
		response: { type: 'text', sender: 'concierge', content: 'We offer free airport pickup from Chumphon Airport for direct bookings! We also arrange boat transfers from the mainland. Just let us know your arrival details.' }
	},
	{
		keywords: ['breakfast', 'food', 'meal'],
		response: { type: 'text', sender: 'concierge', content: 'A tropical breakfast basket is included with your stay — fresh fruits, pastries, Thai coffee, and juice delivered to your door each morning.' }
	},
	{
		keywords: ['cancel', 'cancellation', 'refund'],
		response: { type: 'text', sender: 'concierge', content: 'Free cancellation up to 48 hours before check-in for a full refund. We understand plans change — no worries at all!' }
	},
	{
		keywords: ['price', 'cost', 'how much', 'rate', 'check availability', 'see prices'],
		response: { type: 'booking-widget', sender: 'concierge', content: "Here's the booking details for your selected property:" }
	},
	{
		keywords: ['pool', 'swim', 'infinity'],
		response: { type: 'text', sender: 'concierge', content: 'The Pool Villa has a private heated infinity pool with stunning sunset views. Temperature controlled year-round — perfect for morning laps or evening relaxation.' }
	},
	{
		keywords: ['book', 'reserve', 'book now', 'yes, book it!'],
		response: { type: 'booking-widget', sender: 'concierge', content: "Let's get you booked! Here are the details:" }
	},
	{
		keywords: ['show me properties', 'compare properties', 'compare'],
		response: { type: 'property-card', sender: 'concierge', content: 'Here are our available properties in Koh Tao:' }
	},
	{
		keywords: ['tell me about koh tao', 'koh tao', 'island'],
		response: { type: 'text', sender: 'concierge', content: "Koh Tao is a tropical paradise in the Gulf of Thailand! Known for world-class diving, pristine beaches, and stunning sunsets. It's the perfect blend of adventure and relaxation. Our properties are located on the quieter west coast with easy access to the best snorkeling spots." }
	},
	{
		keywords: ['best deals', 'deal', 'discount', 'offer'],
		response: { type: 'text', sender: 'concierge', content: "Great timing! Book 5+ nights and get 15% off. We also have early bird rates for stays booked 30+ days in advance. The Garden Suite at ฿4,500/night is our best value — it's a hidden gem!" }
	},
	{
		keywords: ['best dates', 'when', 'season', 'weather'],
		response: { type: 'text', sender: 'concierge', content: 'The best time to visit Koh Tao is March to September — clear skies, calm seas, and perfect diving conditions. April and May are especially beautiful with fewer crowds. Shall I check availability for those months?' }
	},
	{
		keywords: ['send me details', 'email', 'details'],
		response: { type: 'text', sender: 'concierge', content: "I'd be happy to send you the details! In this demo, just imagine a beautiful email landing in your inbox with property photos, pricing, and a direct booking link." }
	},
	{
		keywords: ['not yet', 'maybe later', "i'm just browsing", 'just browsing', 'keep exploring'],
		response: { type: 'text', sender: 'concierge', content: "No rush at all! Take your time exploring. I'll be right here whenever you're ready. Feel free to ask me anything about the properties or Koh Tao!" }
	}
];

let messageCounter = 0;

export function createMessageId(): string {
	return 'msg-' + Date.now() + '-' + (++messageCounter);
}

export function matchCannedResponse(text: string): Omit<ConciergeMessage, 'id' | 'timestamp'> | null {
	const lower = text.toLowerCase().trim();
	for (const canned of cannedResponses) {
		for (const keyword of canned.keywords) {
			if (lower.includes(keyword)) {
				return canned.response;
			}
		}
	}
	return null;
}
