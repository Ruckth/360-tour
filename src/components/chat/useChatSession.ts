"use client";
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useOptionalConvex } from '@/lib/react/convex';
import { captureForBooking } from '@/lib/marketing/capture';
import { api } from 'convex/_generated/api';
import { useChatPageContext } from './ChatContext';
import type { ContactForm } from './ChatComposer';
import type { ChatMessage as Message, ChatSuggestion } from './chat-types';
import { closeChatSession, identifyChatVisitor, listLiveProperties, markChatSuggestionClicked } from '@/lib/react/convex-api';
import { getChatActionCard, resolveChatActionHint } from '@/lib/chat/action-card';
import { localizeHref, stripLocalePrefix } from '@/i18n/routing';
import { extractChatBookingContext, getBookingPromptKey, type ChatVillaRef } from '@/lib/chat/booking-intent';
import { buildChatHref, CHAT_RETURN_TO_PARAM, getPathWithSearch, getSafeChatReturnTo } from '@/lib/chat/navigation';
import { CHAT_HANDOFF_PARAM, stripChatHandoffParam } from '@/lib/chat/external-browser';
import { useGuestSession } from './session/useGuestSession';
import { latestExchangeFromMessages, previousUserMessageFor, useChatTranscript } from './session/useChatTranscript';
import { useChatViewport } from './session/useChatViewport';
import { useChatHandoff } from './session/useChatHandoff';
import { useChatSuggestions } from './session/useChatSuggestions';

export type ChatExperienceProps = {
  mode: 'page' | 'overlay'; propertySlug?: string; propertyName?: string; contactEmail: string; whatsappNumber: string;
  lineId?: string; lineUrl?: string; lineQrImage?: string; initialOpen?: boolean; initialDraft?: string;
};
/** Only an unsent/retriable command is stored. Acknowledged transcripts always come from Convex. */
type Draft = { text: string; clientMessageId?: string; sessionId?: string };
const DRAFT_KEY = 'sv_chat_draft:v2';
function readDraft(): Draft | null {
  try { const draft: unknown = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
    if (draft && typeof draft === 'object' && 'text' in draft && typeof draft.text === 'string') return draft as Draft;
  } catch { /* Storage can be disabled. */ }
  return null;
}
function persistDraft(draft: Draft | null) {
  try { if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); else sessionStorage.removeItem(DRAFT_KEY); } catch { /* Chat still works without storage. */ }
}
export function useChatSession(props: ChatExperienceProps) {
  const { mode, propertySlug, propertyName, initialOpen = false, initialDraft = '' } = props;
  const t = useTranslations('Chat'), locale = useLocale(), router = useRouter(), pathname = usePathname(), searchParams = useSearchParams();
  const convex = useOptionalConvex();
  const pageContext = useChatPageContext();
  const activePropertySlug = propertySlug ?? pageContext?.context.propertySlug;
  const activePropertyName = propertyName ?? pageContext?.context.propertyName;
  const [open, setOpen] = useState(mode === 'page');
  const [mounted, setMounted] = useState(false), [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState(initialDraft), [sending, setSending] = useState(false);
  const [demoMessages, setDemoMessages] = useState<Message[]>([]);
  const [villas, setVillas] = useState<ChatVillaRef[]>();
  const [contactForm, setContactForm] = useState<ContactForm>({ email: '', preferredApp: 'whatsapp', contactHandle: '' });
  const [contactStatus, setContactStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const pending = useRef<Draft | null>(null);
  const activeSubmission = useRef<AbortController | null>(null);
  const currentPath = getPathWithSearch(pathname, searchParams.toString());
  const claimedHandoff = useCallback(() => router.replace(stripChatHandoffParam(currentPath)), [router, currentPath]);
  const guest = useGuestSession(activePropertySlug, open && hydrated, searchParams.get(CHAT_HANDOFF_PARAM), claimedHandoff);
  const transcript = useChatTranscript(convex ? guest.credentials : null);
  const messages = convex ? transcript.messages : demoMessages;
  const isTyping = sending || (convex ? transcript.isTyping : false);
  const latestExchange = useMemo(() => latestExchangeFromMessages(messages), [messages]);
  const { suggestions, visibleSuggestions } = useChatSuggestions(guest.credentials?.sessionId ?? null, activePropertySlug, latestExchange);
  const handoff = useChatHandoff(mode, hydrated, guest.ensureSession);
  const viewport = useChatViewport(mode, open, mounted);
  const { inputRef, isTranscriptNearEnd, scrollTranscriptToEnd } = viewport;
  const sessionKey = guest.credentials?.sessionId;
  const activeSession = useRef(sessionKey);
  useEffect(() => { activeSession.current = sessionKey; }, [sessionKey]);
  useEffect(() => () => { activeSubmission.current?.abort(); }, []);
  useEffect(() => {
    setHydrated(true);
    const draft = readDraft(); pending.current = draft;
    if (!initialDraft && draft) setInput(draft.text);
  }, [initialDraft]);
  useEffect(() => { if (hydrated) persistDraft(input ? { ...pending.current, text: input } : pending.current); }, [hydrated, input]);
  useEffect(() => {
    if (!convex || !open || villas) return;
    let active = true;
    void listLiveProperties(convex).then(rows => { if (active) setVillas(rows.map(({ slug, name }) => ({ slug, name }))); }).catch(() => undefined);
    return () => { active = false; };
  }, [convex, open, villas]);
  const latestAssistantIndex = messages.findLastIndex(message => message.role === 'assistant');
  const messageActionCards = useMemo(() => messages.map((message, index) => message.role !== 'assistant' ? { type: 'none' as const } : getChatActionCard({
    latestUserMessage: previousUserMessageFor(messages, index), guestMessages: messages.slice(0, index).filter(item => item.role === 'user').map(item => item.content),
    latestAssistantMessage: message.content, activePropertySlug, villas, actionHint: message.action,
  })), [messages, activePropertySlug, villas]);
  const latestActionCard = messageActionCards[latestAssistantIndex];
  const chatInputDisabled = !hydrated || isTyping || (!!convex && (!guest.ready || !guest.credentials || transcript.loading));
  const chatReturnHref = getSafeChatReturnTo(searchParams.get(CHAT_RETURN_TO_PARAM)) ?? localizeHref('/', locale);
  const openChat = useCallback(() => { setMounted(true); setOpen(true); }, []);
  const closeChat = useCallback(() => {
    setOpen(false);
    if (convex && guest.credentials) void closeChatSession(convex, { sessionId: guest.credentials.sessionId }).catch(() => undefined);
    if (mode === 'page') router.replace(chatReturnHref);
  }, [convex, guest.credentials, mode, router, chatReturnHref]);
  const restartSession = guest.restartSession;
  const restartChat = useCallback(async () => {
    activeSubmission.current?.abort(); activeSubmission.current = null;
    pending.current = null; persistDraft(null); setInput(''); setDemoMessages([]); setSending(false); setContactStatus('idle'); setOpen(true);
    await restartSession().catch(() => setContactStatus('error'));
  }, [restartSession]);
  useEffect(() => { if (initialOpen && hydrated) openChat(); }, [initialOpen, hydrated, openChat]);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const timer = window.setTimeout(() => setMounted(false), 220); return () => clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!open || mode === 'page') return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 260); return () => clearTimeout(timer);
  }, [open, mode, inputRef]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && window.matchMedia('(min-width: 768px)').matches) closeChat(); };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, closeChat]);
  const lastLength = useRef(0);
  useEffect(() => {
    if (messages.length === lastLength.current) return;
    const shouldScroll = lastLength.current === 0 || isTranscriptNearEnd(); lastLength.current = messages.length;
    if (shouldScroll) scrollTranscriptToEnd();
  }, [messages, isTranscriptNearEnd, scrollTranscriptToEnd]);
  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactForm.email.trim() && !contactForm.contactHandle.trim()) return;
    if (!convex) { setContactStatus('error'); return; }
    setContactStatus('saving');
    try {
      const credentials = await guest.ensureSession(); if (!credentials) throw new Error('No session');
      await identifyChatVisitor(convex, { sessionId: credentials.sessionId, email: contactForm.email || undefined,
        phone: contactForm.preferredApp === 'whatsapp' ? contactForm.contactHandle || undefined : undefined, contactApp: contactForm.preferredApp, contactHandle: contactForm.contactHandle || undefined });
      if (activeSession.current === credentials.sessionId) setContactStatus('saved');
    } catch { setContactStatus('error'); }
  }
  async function sendMessage(value: string | ChatSuggestion) {
    const clean = (typeof value === 'string' ? value : value.text).trim();
    if (!clean || chatInputDisabled || !!activeSubmission.current) return;
    const preset = transcript.aiPaused ? undefined : suggestions.find(item => item.text === clean);
    const actionHint = resolveChatActionHint({ latestUserMessage: clean, activePropertySlug, villas, clickedSuggestionId: preset?.id }) ?? "none";
    if (!convex) {
      const booking = extractChatBookingContext({ latestUserMessage: clean, guestMessages: messages.filter(item => item.role === 'user').map(item => item.content), latestAssistantMessage: '', activePropertySlug });
      const reply = booking.hasBookingIntent || actionHint === 'booking' ? t(getBookingPromptKey(booking)) : t('noConvex');
      setDemoMessages(items => [...items, { role: 'user', content: clean }, { role: 'assistant', content: reply, action: actionHint }]);
      setInput(''); pending.current = null; persistDraft(null); return;
    }
    const submission = new AbortController(); activeSubmission.current = submission; setSending(true);
    let sentSession: string | undefined;
    try {
      const credentials = await guest.ensureSession();
      if (submission.signal.aborted) return;
      if (!credentials) throw new Error('No session');
      sentSession = credentials.sessionId;
      const draft = pending.current;
      const clientMessageId = draft?.text === clean && draft.sessionId === sentSession && draft.clientMessageId ? draft.clientMessageId : crypto.randomUUID();
      pending.current = { text: clean, clientMessageId, sessionId: sentSession }; persistDraft(pending.current);
      await convex.mutation(api.chat.sendMessage, { ...credentials, clientMessageId, content: clean, propertySlug: activePropertySlug, locale, actionHint, marketing: captureForBooking() ?? {} });
      if (submission.signal.aborted || activeSession.current !== sentSession) return;
      pending.current = null; persistDraft(null); setInput('');
      if (preset) void markChatSuggestionClicked(convex, { sessionId: sentSession, suggestion: { source: 'static', suggestionId: preset.id } }).catch(() => undefined);
    } catch (error) {
      if (!submission.signal.aborted && (!sentSession || activeSession.current === sentSession)) { setInput(clean); await guest.recoverInvalidSession(error).catch(() => undefined); }
    } finally { if (activeSubmission.current === submission) { activeSubmission.current = null; setSending(false); } }
  }
  return { ...props, ...viewport, ...handoff, mode, open, hydrated, mounted, title: activePropertyName ? t('propertyTitle', { propertyName: activePropertyName }) : t('defaultTitle'),
    chatHref: buildChatHref({ locale, pathname, propertySlug: activePropertySlug, search: searchParams.toString() }),
    hideFloatingTriggerOnMobileRoom: stripLocalePrefix(pathname).startsWith('/rooms/'), openChat, closeChat, restartChat,
    messages, messageActionCards, latestAssistantIndex, canShowMessageSuggestions: !isTyping && latestAssistantIndex >= 0 && latestAssistantIndex === messages.length - 1,
    visibleSuggestions, sendMessage, chatInputDisabled, isTyping, hasLatestActionCard: !!latestActionCard && latestActionCard.type !== 'none',
    contactForm, setContactForm, contactStatus, saveContact, input, setInput,
  };
}
