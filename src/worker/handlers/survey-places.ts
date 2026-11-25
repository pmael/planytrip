import { ScrapeError } from "@/scrapers/errors";
import { overpassFetcher, type PlacesFetcher } from "@/scrapers/places/overpass";
import { localTransit as transitousLocal, type LocalTransit } from "@/scrapers/places/local-transit";
import { surveyAccess, surveyPlaces } from "@/server/services/surveys";
import { parsePayload, SurveyPlacesPayloadSchema } from "../payloads";
import { PermanentJobError } from "../queue";
import type { JobHandler } from "../types";

/**
 * survey_places: what is around each place to stay of one destination, from OpenStreetMap (task.md T8.3), and how it
 * is reached from the airports and stations and back from a night out, from Transitous (T8.6). A server
 * that turns us away fails the job for good at once, like a search (search.ts); a slow answer is tried again.
 */
export const createSurveyPlacesHandler =
  (fetchPlaces: PlacesFetcher = overpassFetcher, transit: LocalTransit = transitousLocal): JobHandler =>
  async (job, { db }) => {
    const payload = parsePayload(SurveyPlacesPayloadSchema, job.payload);
    try {
      await surveyPlaces(db, payload, fetchPlaces);
      // Then how each stay is reached (T8.6): Transitous at the hours that matter; a refusal leaves taxis, not a failure
      await surveyAccess(db, payload.destinationId, transit);
    } catch (error) {
      if (error instanceof ScrapeError && !error.retryable) throw new PermanentJobError(error.message);
      throw error;
    }
  };
