import {
	type ConciergeMessage,
	triggers,
	createMessageId,
	matchCannedResponse
} from '$lib/data/concierge';
import { getPropertyById } from '$lib/data/properties';

class ConciergeState {
	isOpen = $state(false);
	isMinimized = $state(false);
	unreadCount = $state(0);
	messages = $state<ConciergeMessage[]>([]);
	isTyping = $state(false);
	currentPropertyId = $state<string | null>(null);
	tourActive = $state(false);
	roomsVisited = $state<Set<string>>(new Set());
	tourStartTime = $state<number | null>(null);
	lastInteractionTime = $state(Date.now());
	firedTriggers = $state<Set<string>>(new Set());

	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private tourTimer: ReturnType<typeof setInterval> | null = null;
	private typingQueue: Array<() => void> = [];
	private isProcessingQueue = false;

	get currentPropertyName(): string {
		if (!this.currentPropertyId) return 'this property';
		const prop = getPropertyById(this.currentPropertyId);
		return prop?.name ?? 'this property';
	}

	open() {
		this.isOpen = true;
		this.isMinimized = false;
		this.unreadCount = 0;
		this.resetIdleTimer();
	}

	close() {
		this.isOpen = false;
		this.isMinimized = false;
	}

	minimize() {
		this.isMinimized = true;
	}

	toggle() {
		if (this.isOpen) {
			this.close();
		} else {
			this.open();
		}
	}

	addUserMessage(text: string) {
		const message: ConciergeMessage = {
			id: createMessageId(),
			type: 'text',
			sender: 'user',
			content: text,
			timestamp: Date.now()
		};
		this.messages.push(message);
		this.lastInteractionTime = Date.now();
		this.resetIdleTimer();

		const response = matchCannedResponse(text);
		if (response) {
			this.queueConciergeMessages([this.templateMessage(response)]);
		} else {
			this.queueConciergeMessages([
				{
					type: 'quick-replies',
					sender: 'concierge',
					content: "I'd love to help with that! Here are some things I can assist you with:",
					quickReplies: ['Show me properties', 'Check availability', 'Tell me about Koh Tao']
				}
			]);
		}
	}

	queueConciergeMessages(messages: Omit<ConciergeMessage, 'id' | 'timestamp'>[]) {
		for (const msg of messages) {
			this.typingQueue.push(() => {
				const fullMessage: ConciergeMessage = {
					...msg,
					id: createMessageId(),
					timestamp: Date.now()
				};
				this.messages.push(fullMessage);
				if (!this.isOpen) {
					this.unreadCount++;
				}
			});
		}
		this.processQueue();
	}

	private async processQueue() {
		if (this.isProcessingQueue) return;
		this.isProcessingQueue = true;

		while (this.typingQueue.length > 0) {
			const deliver = this.typingQueue.shift()!;
			this.isTyping = true;
			const delay = Math.min(800 + 10 * 50, 2000);
			await new Promise((resolve) => setTimeout(resolve, delay));
			this.isTyping = false;
			deliver();
			if (this.typingQueue.length > 0) {
				await new Promise((resolve) => setTimeout(resolve, 300));
			}
		}

		this.isProcessingQueue = false;
	}

	fireTrigger(triggerId: string) {
		if (this.firedTriggers.has(triggerId)) return;
		const trigger = triggers.find((t) => t.id === triggerId);
		if (!trigger) return;
		this.firedTriggers.add(triggerId);
		const templatedMessages = trigger.messages.map((msg) => this.templateMessage(msg));
		if (trigger.delay && trigger.delay > 0) {
			setTimeout(() => {
				this.queueConciergeMessages(templatedMessages);
			}, trigger.delay);
		} else {
			this.queueConciergeMessages(templatedMessages);
		}
	}

	private templateMessage(
		msg: Omit<ConciergeMessage, 'id' | 'timestamp'>
	): Omit<ConciergeMessage, 'id' | 'timestamp'> {
		let content = msg.content;
		content = content.replace(/{propertyName}/g, this.currentPropertyName);
		content = content.replace(/{count}/g, String(this.roomsVisited.size));
		return { ...msg, content };
	}

	setProperty(propertyId: string) {
		this.currentPropertyId = propertyId;
	}

	onRoomVisit(roomId: string) {
		if (this.roomsVisited.has(roomId)) return;
		const newSet = new Set(this.roomsVisited);
		newSet.add(roomId);
		this.roomsVisited = newSet;
		this.resetIdleTimer();
		const trigger = triggers.find((t) => t.id === 'rooms_visited');
		if (trigger && trigger.threshold && this.roomsVisited.size >= trigger.threshold) {
			this.fireTrigger('rooms_visited');
		}
	}

	onTourOpen() {
		this.tourActive = true;
		this.tourStartTime = Date.now();
		this.fireTrigger('tour_open');
		this.startIdleTimer();
		this.startTourTimer();
	}

	onTourClose() {
		this.tourActive = false;
		this.stopTourTimer();
		this.fireTrigger('tour_close');
	}

	private startTourTimer() {
		this.stopTourTimer();
		this.tourTimer = setInterval(() => {
			if (!this.tourStartTime) return;
			const elapsed = (Date.now() - this.tourStartTime) / 1000;
			const trigger = triggers.find((t) => t.id === 'time_in_tour');
			if (trigger && trigger.threshold && elapsed >= trigger.threshold) {
				this.fireTrigger('time_in_tour');
				this.stopTourTimer();
			}
		}, 1000);
	}

	private stopTourTimer() {
		if (this.tourTimer) {
			clearInterval(this.tourTimer);
			this.tourTimer = null;
		}
	}

	startIdleTimer() {
		this.clearIdleTimer();
		this.idleTimer = setTimeout(() => {
			this.fireTrigger('idle');
		}, 30000);
	}

	resetIdleTimer() {
		this.lastInteractionTime = Date.now();
		if (this.tourActive) {
			this.startIdleTimer();
		}
	}

	private clearIdleTimer() {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}
}

export const conciergeState = new ConciergeState();
