import { api } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { assertCapacity, assertStayDates } from '../../lib/bookingWrites';
import { calculateDirectQuote, maxSavings } from '../../lib/pricing';
import { humanToolResult } from './presentation';
import { ToolArgs } from './types';

function findProperty(properties: Doc<'properties'>[], slug: unknown): Doc<'properties'> | null {
  if (typeof slug !== 'string') return null;
  return properties.find((p) => p.slug === slug) ?? null;
}

async function ownerOtaQuotes(ctx: ActionCtx, slug: string, nights: number) {
  const comparison = await ctx.runQuery(api.catalog.properties.getOtaComparison, { slug });
  return (comparison?.rates ?? []).map(({ platform, nightlyRate }) => ({
    platform,
    nightlyRate,
    total: nightlyRate * nights
  }));
}

export async function checkAvailability(ctx: ActionCtx, fnArgs: ToolArgs, properties: Doc<'properties'>[]): Promise<string> {
  const property = findProperty(properties, fnArgs.propertySlug);
  if (!property) return humanToolResult({ error: 'Property not found' });

  const checkIn = String(fnArgs.checkIn);
  const checkOut = String(fnArgs.checkOut);

  const nights = assertStayDates(checkIn, checkOut);
  const available = await ctx.runQuery(api.bookings.calendar.availability.isAvailable, {
    propertyId: property._id,
    checkIn,
    checkOut
  });

  const quote = calculateDirectQuote(property, nights);
  const ota = await ownerOtaQuotes(ctx, property.slug, nights);

  return humanToolResult({
    property: property.name,
    checkIn,
    checkOut,
    nights,
    available,
    pricePerNight: property.pricePerNight,
    directPrice: Math.round(quote.directTotal / Math.max(nights, 1)),
    totalDirect: quote.directTotal,
    ...(ota.length > 0 ? { totalOTA: Math.max(...ota.map((o) => o.total)) } : {}),
    currency: property.currency
  });
}

export async function calculatePrice(ctx: ActionCtx, fnArgs: ToolArgs, properties: Doc<'properties'>[]): Promise<string> {
  const property = findProperty(properties, fnArgs.propertySlug);
  if (!property) return humanToolResult({ error: 'Property not found' });

  const nights = Number(fnArgs.nights);
  if (fnArgs.guests !== undefined) assertCapacity(property, Number(fnArgs.guests));
  const quote = calculateDirectQuote(property, nights);
  const otaComparison = await ownerOtaQuotes(ctx, property.slug, nights);

  return humanToolResult({
    property: property.name,
    nights,
    guests: fnArgs.guests ?? 'any',
    maxGuests: property.maxGuests,
    pricePerNight: property.pricePerNight,
    listedTotal: quote.subtotal,
    discountPercent: quote.discountPercent,
    discountAmount: quote.discountAmount,
    directTotal: quote.directTotal,
    ...(otaComparison.length > 0
      ? { otaComparison, maxSavings: maxSavings(quote.directTotal, otaComparison.map((o) => o.total)) }
      : {}),
    currency: property.currency
  });
}

export async function getPropertyDetails(fnArgs: ToolArgs, properties: Doc<'properties'>[]): Promise<string> {
  const property = findProperty(properties, fnArgs.propertySlug);
  if (!property) return humanToolResult({ error: 'Property not found' });

  const oneNightQuote = calculateDirectQuote(property, 1);

  return humanToolResult({
    name: property.name,
    imageUrl: property.images[0],
    slug: property.slug,
    tagline: property.tagline,
    description: property.description,
    pricePerNight: property.pricePerNight,
    directPrice: oneNightQuote.directTotal,
    currency: property.currency,
    maxGuests: property.maxGuests,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    area: property.area,
    amenities: property.amenities,
    has360Tour: true
  });
}

export async function listProperties(properties: Doc<'properties'>[]): Promise<string> {
  const list = properties.map((p) => {
    const oneNightQuote = calculateDirectQuote(p, 1);
    return {
      name: p.name,
      imageUrl: p.images[0],
      currency: p.currency,
      slug: p.slug,
      tagline: p.tagline,
      pricePerNight: p.pricePerNight,
      directPrice: oneNightQuote.directTotal,
      maxGuests: p.maxGuests,
      bedrooms: p.bedrooms
    };
  });
  return humanToolResult({ properties: list, currency: properties[0]?.currency ?? 'THB' });
}
