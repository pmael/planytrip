import { askClaude, type AskFn } from "@/ai/claude";
import { osrmRoute, type RouteFn } from "@/geo/osrm";
import { localTransit, type LocalTransit } from "@/scrapers/places/local-transit";
import { overpassFetcher, type PlacesFetcher } from "@/scrapers/places/overpass";
import { adapterRegistry, type AdapterSet } from "@/scrapers/registry";
import type { Handlers } from "../types";
import { createAdviseExtrasHandler } from "./advise-extras";
import { createAnalyzeStayHandler } from "./analyze-stay";
import { createComputeTripHandler } from "./compute-trip";
import { createRateOptionsHandler } from "./rate-options";
import { createSearchStaysHandler, createSearchTransportHandler } from "./search";
import { createPriceDestinationHandler, priceDestinationDeps, type PriceDestinationDeps } from "./price-destination";
import { createSurveyPlacesHandler } from "./survey-places";
import { createSynthesizeHandler } from "./synthesize";

/** What the worker runs for each type of job. The routing service, the adapters, OpenStreetMap and the AI can be swapped, for tests. */
export function createHandlers({
  route = osrmRoute,
  adapters = adapterRegistry,
  places = overpassFetcher,
  transit = localTransit,
  ask = askClaude,
  prices,
  adviceAsk,
  waitMs,
}: { route?: RouteFn; adapters?: AdapterSet; places?: PlacesFetcher; transit?: LocalTransit; ask?: AskFn; prices?: PriceDestinationDeps; adviceAsk?: AskFn; waitMs?: number } = {}): Handlers {
  return {
    compute_trip: createComputeTripHandler({ route, adapters, waitMs }),
    search_transport: createSearchTransportHandler(adapters),
    search_stays: createSearchStaysHandler(adapters),
    survey_places: createSurveyPlacesHandler(places, transit),
    price_destination: createPriceDestinationHandler(prices ?? priceDestinationDeps(ask)),
    rate_stays: createRateOptionsHandler("stays", ask),
    rate_transport: createRateOptionsHandler("transport", ask),
    advise_extras: createAdviseExtrasHandler(adviceAsk ?? ask),
    analyze_stay: createAnalyzeStayHandler(ask),
    synthesize_destinations: createSynthesizeHandler(ask),
  };
}

export const handlers: Handlers = createHandlers();
