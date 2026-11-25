/** A bookable service duration and its price in satang. */
export type ServiceOption = { durationMin: number; price: number };

type Service = ServiceOption & { options?: readonly ServiceOption[] };

/** Return options in duration order, falling back to the stored default terms. */
export function serviceOptions(service: Service): ServiceOption[] {
	return service.options?.length
		? [...service.options].sort((a, b) => a.durationMin - b.durationMin)
		: [{ durationMin: service.durationMin, price: service.price }];
}
