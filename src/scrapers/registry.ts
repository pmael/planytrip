// Which adapters search for each kind of option (config.adapters). The worker never names an
// adapter: it asks the registry, so switching between the test dataset and the real sites is a
// config change, and the tests keep using the dataset by handing the worker their own adapters.
import { adapters as config } from "@/config";
import type { TransportMode } from "@/core/types";
import { airbnbAdapter } from "./stays/airbnb";
import { googleHotelsAdapter } from "./stays/google-hotels";
import { fixtureStaysAdapter } from "./stays/fixture-stays";
import { carAdapter } from "./transport/car";
import { fixtureFlightsAdapter } from "./transport/fixture-flights";
import { flixbusAdapter } from "./transport/flixbus";
import { createRegiojet } from "./transport/regiojet";
import { createRealTrainsAdapter } from "./transport/trains";
import { readAppSettings } from "@/server/appSettings";
import { modelPredictor } from "@/server/priceModel";
import { createHttp, userAgentFor } from "./http";
import { trains as trainsConfig } from "@/config";
import { googleFlightsAdapter } from "./transport/google-flights";
import type { StayAdapter, TransportAdapter } from "./types";

export type AdapterSet = {
  /** The sources that look for options of a mode. Empty when nothing can (yet): no train or bus search exists. */
  transportAdaptersFor(mode: TransportMode): TransportAdapter[];
  stayAdapters(): StayAdapter[];
};

/**
 * What each source is, as config.adapters says it: "fixture" is the test dataset, "airbnb", "google-flights"
 * and "flixbus" the real sites. `ground` (FlixBus's buses and trains), `trains` (the trains of all Europe and
 * RegioJet) and `hotels` may be left out: nothing is then searched for them.
 */
export type AdapterSettings = { flights: string; stays: string; ground?: string; hotels?: string; trains?: string };

// The trains' prices are estimated by the model of the prices seen on SNCF Connect once it has proved itself (task.md T7.9).
// SNCF Connect's own prices are read through Chrome only while Settings say so: the file is read on each search.
const trainsAdapter = createRealTrainsAdapter({ predictor: modelPredictor, sncfConnectOn: () => readAppSettings().sncfConnect });

const regiojetAdapter = createRegiojet({
  http: createHttp({ source: "RegioJet", userAgent: userAgentFor(null), pauseMs: trainsConfig.regiojet.pauseMs, timeoutMs: trainsConfig.regiojet.timeoutMs }),
});

export function createAdapterRegistry(settings: AdapterSettings): AdapterSet {
  return {
    transportAdaptersFor(mode) {
      switch (mode) {
        case "car":
          return [carAdapter];
        case "plane":
          switch (settings.flights) {
            case "google-flights":
              return [googleFlightsAdapter];
            case "fixture":
              return [fixtureFlightsAdapter];
            default:
              return [];
          }
        case "bus":
        case "train": {
          // FlixBus lists buses and the trains it sells; the timetables of Europe's trains, with their prices where a
          // source has them, and RegioJet's own journeys, are the other sources
          const found: TransportAdapter[] = [];
          if (settings.trains === "transitous") found.push(...(mode === "train" ? [trainsAdapter] : []), regiojetAdapter);
          if (settings.ground === "flixbus") found.push(flixbusAdapter);
          return found;
        }
        default:
          return [];
      }
    },
    stayAdapters() {
      switch (settings.stays) {
        case "airbnb":
          // Rentals from Airbnb, and the hotels Airbnb does not have from Google Hotels
          return settings.hotels === "google-hotels" ? [airbnbAdapter, googleHotelsAdapter] : [airbnbAdapter];
        case "fixture":
          return [fixtureStaysAdapter];
        default:
          return [];
      }
    },
  };
}

export const adapterRegistry: AdapterSet = createAdapterRegistry(config);
