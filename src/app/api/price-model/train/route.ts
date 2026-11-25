import { fromThisApp } from "@/server/http";
import { TrainingBusyError, TrainingError, trainPriceModel } from "@/server/priceModelTraining";

/**
 * POST /api/price-model/train: trains the price model on the prices seen on SNCF Connect (tools/price-model/train.py) and writes the
 * model and its report, which the app reads from then on. It takes a few seconds. 409 when a training is already under way.
 */
export async function POST(request: Request) {
  if (!fromThisApp(request)) return Response.json({ ok: false, error: "Requête refusée" }, { status: 403 });
  try {
    return Response.json({ ok: true, ...(await trainPriceModel()) });
  } catch (error) {
    if (error instanceof TrainingBusyError) return Response.json({ ok: false, error: error.message }, { status: 409 });
    if (error instanceof TrainingError) return Response.json({ ok: false, error: error.message }, { status: 500 });
    throw error;
  }
}
