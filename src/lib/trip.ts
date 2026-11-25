/** URL of a page of a trip, e.g. tripPath(id, "/setup/guests"). */
export const tripPath = (tripId: string, path = "") => `/trips/${tripId}${path}`;
