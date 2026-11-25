import Link from "next/link";
import { ACCURACY_METHODS, type AccuracyMethod } from "@/core/priceAccuracy";
import { methodLabel } from "@/core/priceObservations";
import type { Metrics } from "@/core/price-model";
import { tripPath } from "@/lib/trip";
import { cn } from "@/lib/utils";
import type { AccuracyView } from "@/server/services/priceAccuracy";
import { PageTitle } from "./PageTitle";
import { RetrainButton } from "./RetrainButton";
import { ScatterPlot } from "./ScatterPlot";
import { Section } from "./Section";

// The page is in French, as price-model.md words it.
const decimal = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",");
const eur = (value: number | null) => (value === null ? "—" : `${decimal(value)} €`);
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${decimal(Math.abs(value))} €`;
const percent = (value: number) => `${Math.round(value * 100)} %`;
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const COLORS: Record<AccuracyMethod, string> = { current: "#ffffff", per_km: "#f5c46b", range_mid: "#7cc4ff", range_max: "#ff8a9b", model: "#4ee0a8" };

const th = "px-3 py-2 text-left text-base font-normal text-white/60";
const td = "px-3 py-2.5 text-lg";
const table = "w-full min-w-[560px] border-separate border-spacing-0 text-white";

/** What a table cell says of a method's error: right-aligned, and the best of the row in green */
function Cell({ children, best }: { children: React.ReactNode; best?: boolean }) {
  return <td className={cn(td, "text-right tabular-nums", best && "text-emerald-200")}>{children}</td>;
}

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="-mx-2 overflow-x-auto px-2">{children}</div>;
}

export function PriceAccuracyPage({ view, tripId }: { view: AccuracyView; tripId: string }) {
  const { perKm, model } = view;
  const methods = ACCURACY_METHODS.map((id) => ({
    id,
    title: id === "model" ? "Modèle" : id === "current" ? "Estimation actuelle" : id === "range_mid" ? "Milieu de la fourchette SNCF" : id === "range_max" ? "Haut de la fourchette SNCF" : `${decimal(perKm.eurPerKm, 2)} € du kilomètre`,
    code: id === "current" ? "ce que fait l'application" : methodLabel(id === "per_km" ? "per_km" : (id as "range_mid" | "range_max"), perKm),
  }));
  const hasModelRows = view.all.model !== null;

  return (
    <div className="mx-auto flex max-w-[1580px] flex-col gap-10">
      <div className="flex flex-col gap-3 lg:w-[82%]">
        <Link href={tripPath(tripId, "/settings")} className="w-fit px-2 text-xl text-white/70 underline-offset-4 hover:text-white hover:underline">
          ← Réglages
        </Link>
        <PageTitle>Fiabilité des prix</PageTitle>
      </div>

      {view.observations === 0 ? (
        <Section index={0} title="Aucun prix vu pour l’instant" hint="Les trains sans prix réel sont estimés. Ici, on mesure à quel point.">
          <ol className="flex list-decimal flex-col gap-2 pl-6 text-xl text-white/85">
            <li>
              Dans Chrome, installez l’extension du dossier <code className="rounded bg-white/10 px-2 py-0.5 text-lg">extension/sncf-import</code> (chrome://extensions → Mode développeur → Charger l’extension non empaquetée).
            </li>
            <li>Cherchez un trajet sur sncf-connect.com, eurostar.com ou iryo.eu et faites défiler pour afficher les trains.</li>
            <li>Cliquez sur « → Trip Manager », vérifiez l’aperçu, puis sur « Envoyer ».</li>
          </ol>
          <p className="text-lg text-white/60">Rien n’est envoyé à SNCF, Eurostar ni Iryo : l’extension lit ce que votre onglet affiche déjà, quand vous cliquez.</p>
        </Section>
      ) : (
        <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-2">
          <Section index={0} title="Ce qui a été vu" hint="Les prix que vous avez vous-même affichés sur SNCF Connect, Eurostar ou Iryo.">
            <dl className="grid grid-cols-2 gap-4 text-xl sm:grid-cols-4">
              {(
                [
                  ["Prix", view.observations],
                  ["Recherches", view.sessions],
                  ["Rattachés à un voyage", view.matched],
                  ["Comparables entre méthodes", view.commonRows],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-[20px] bg-white/[0.08] p-4 text-center">
                  <dd className="text-3xl">{value}</dd>
                  <dt className="mt-1 text-base text-white/60">{label}</dt>
                </div>
              ))}
            </dl>
            {view.firstCapturedAt && view.lastCapturedAt && (
              <p className="text-lg text-white/65">
                Vus du {day(view.firstCapturedAt)} au {day(view.lastCapturedAt)}. Une « recherche » est une page lue : tous ses trains comptent pour une.
              </p>
            )}
          </Section>

          <Section index={1} title="Le modèle" hint="Il n’est utilisé que lorsqu’il a assez de données et qu’il bat l’estimation actuelle sur des prix qu’il n’a pas vus.">
            <p
              className={cn("rounded-[20px] px-5 py-3 text-xl", model.state === "active" ? "bg-emerald-300/15 text-emerald-50" : "bg-white/[0.08] text-white/85")}
              role="status"
            >
              {model.message.charAt(0).toUpperCase() + model.message.slice(1)}
              {model.state === "not-enough-data" || model.state === "missing" ? "" : "."}
            </p>
            {model.trainedAt && (
              <p className="text-lg text-white/65">
                Entraîné le {day(model.trainedAt)} sur {model.observations} prix de {model.sessions} recherches.
                {model.stale && <span className="ml-2 rounded-full bg-amber-300/20 px-3 py-0.5 text-amber-100">ancien : les tarifs évoluent, réentraînez-le</span>}
              </p>
            )}
            <ul className="flex flex-col gap-2 text-lg text-white/80">
              {(
                [
                  ["TGV directs (fourchette SNCF)", model.range],
                  ["Autres trains (prix au kilomètre)", model.perKm],
                ] as const
              ).map(([label, sub]) => (
                <li key={label}>
                  <span className={sub.usable ? "text-emerald-200" : "text-white/70"}>{sub.usable ? "● " : "○ "}</span>
                  {label} : {sub.reason}
                  {sub.mae !== null && sub.baselineMae !== null && (
                    <span className="text-white/55">
                      {" "}
                      (hors entraînement : {eur(sub.mae)} d’erreur moyenne, contre {eur(sub.baselineMae)} pour {sub.baseline})
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <RetrainButton />
          </Section>

          <Section index={2} title="Quelle méthode se trompe le moins ?" hint="Erreur = estimation − prix réel, en euros. Les prix réels sont les plus bas encore en vente au moment de la capture." className="xl:col-span-2">
            <Scroll>
              <table className={table}>
                <thead>
                  <tr className="border-b border-white/10">
                    <th className={th}>Méthode</th>
                    <th className={cn(th, "text-right")}>Trains</th>
                    <th className={cn(th, "text-right")}>Erreur moyenne</th>
                    <th className={cn(th, "text-right")}>Erreur médiane</th>
                    <th className={cn(th, "text-right")}>À ±10 €</th>
                    <th className={cn(th, "text-right")}>Biais</th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map((method) => {
                    const m = view.all[method.id];
                    return (
                      <tr key={method.id} className="border-t border-white/10">
                        <td className={td}>
                          <span aria-hidden className="mr-2 inline-block size-3 rounded-full align-baseline" style={{ backgroundColor: COLORS[method.id] }} />
                          {method.title}
                          <span className="ml-2 text-base text-white/50">{method.code}</span>
                          {method.id === "model" && <span className="ml-2 rounded-full bg-emerald-300/20 px-2.5 py-0.5 text-base text-emerald-100">hors entraînement</span>}
                        </td>
                        {m ? <MetricsCells m={m} /> : <td className={cn(td, "text-right text-white/45")} colSpan={5}>{method.id === "model" ? "pas encore de modèle" : "pas assez d'informations"}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Scroll>

            {view.commonRows > 0 && (
              <>
                <h3 className="text-2xl font-normal">Sur les mêmes trains</h3>
                <p className="-mt-3 text-base text-white/60">
                  Les {view.commonRows} trains que {hasModelRows ? "toutes les méthodes, le modèle compris," : "toutes les méthodes"} peuvent estimer : c’est la comparaison équitable.
                </p>
                <Scroll>
                  <table className={table}>
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className={th}>Méthode</th>
                        <th className={cn(th, "text-right")}>Erreur moyenne</th>
                        <th className={cn(th, "text-right")}>Erreur médiane</th>
                        <th className={cn(th, "text-right")}>À ±10 €</th>
                        <th className={cn(th, "text-right")}>Biais</th>
                      </tr>
                    </thead>
                    <tbody>
                      {methods
                        .filter((method) => method.id !== "current" && view.common[method.id] !== null)
                        .map((method) => {
                          const m = view.common[method.id]!;
                          const best = Math.min(...methods.flatMap((x) => (x.id !== "current" && view.common[x.id] ? [view.common[x.id]!.mae] : [])));
                          return (
                            <tr key={method.id} className="border-t border-white/10">
                              <td className={td}>
                                <span aria-hidden className="mr-2 inline-block size-3 rounded-full" style={{ backgroundColor: COLORS[method.id] }} />
                                {method.title}
                              </td>
                              <Cell best={m.mae === best}>{eur(m.mae)}</Cell>
                              <Cell>{eur(m.median)}</Cell>
                              <Cell>{percent(m.within10)}</Cell>
                              <Cell>{signed(m.bias)}</Cell>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </Scroll>
              </>
            )}
            <p className="text-base text-white/55">Biais positif : la méthode surestime en moyenne ; négatif : elle sous-estime.</p>
          </Section>

          <Section index={3} title="Estimation et prix réel" hint="Chaque point est un train. Sur la diagonale, l’estimation est exacte." className="xl:col-span-2">
            <ScatterPlot
              series={(["per_km", "range_mid", "range_max", "model"] as const)
                .filter((id) => view.scatter[id].length > 0)
                .map((id) => ({ id, label: methods.find((m) => m.id === id)!.title, color: COLORS[id], points: view.scatter[id] }))}
            />
          </Section>

          <Section index={4} title="Selon le type de train" hint="Erreur moyenne de chaque méthode, sur les trains qu’elle sait estimer.">
            <Breakdown rows={view.byTrainType} />
          </Section>

          <Section index={5} title="Selon le délai avant le départ" hint="Les prix montent à mesure que le départ approche.">
            <Breakdown rows={view.byDaysBefore} />
          </Section>

          <Section index={6} title="Les 20 plus grosses erreurs" hint="Là où l’estimation actuelle s’est le plus trompée." className="xl:col-span-2">
            <Scroll>
              <table className={table}>
                <thead>
                  <tr className="border-b border-white/10">
                    <th className={th}>Trajet</th>
                    <th className={th}>Départ</th>
                    <th className={th}>Train</th>
                    <th className={cn(th, "text-right")}>Délai</th>
                    <th className={cn(th, "text-right")}>Prix réel</th>
                    <th className={cn(th, "text-right")}>Estimé</th>
                    <th className={cn(th, "text-right")}>Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {view.worst.map((miss) => (
                    <tr key={miss.id} className="border-t border-white/10">
                      <td className={td}>{miss.route}</td>
                      <td className={cn(td, "whitespace-nowrap")}>
                        {new Date(`${miss.travelDate}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · {miss.departTime}
                      </td>
                      <td className={td}>{miss.trainType ?? "—"}</td>
                      <Cell>{miss.daysBefore} j</Cell>
                      <Cell>{eur(miss.real)}</Cell>
                      <Cell>{eur(miss.estimate)}</Cell>
                      <Cell>{signed(miss.error)}</Cell>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          </Section>

          <Section index={7} title="À savoir" className="xl:col-span-2">
            <ul className="flex list-disc flex-col gap-2 pl-6 text-lg text-white/75">
              <li>Les données viennent uniquement de vos propres recherches : elles couvrent vos trajets et vos habitudes de réservation, pas la France en général.</li>
              <li>« Dès » est le prix le plus bas encore en vente au moment de la capture, ce dont le budget du voyage a besoin.</li>
              <li>Le modèle est jugé par validation croisée par recherche : tous les trains d’une même page sont mis de côté ensemble, pour qu’il ne triche pas.</li>
              <li>Le modèle n’apprend que des prix vus sur SNCF Connect, et ne chiffre que des trains SNCF. Les prix vus sur Eurostar et Iryo servent ici à mesurer l’estimation au kilomètre, et à remplacer l’estimation sur la fiche pendant 24 h.</li>
            </ul>
          </Section>
        </div>
      )}
    </div>
  );
}

function MetricsCells({ m }: { m: Metrics }) {
  return (
    <>
      <Cell>{m.n}</Cell>
      <Cell>{eur(m.mae)}</Cell>
      <Cell>{eur(m.median)}</Cell>
      <Cell>{percent(m.within10)}</Cell>
      <Cell>{signed(m.bias)}</Cell>
    </>
  );
}

function Breakdown({ rows }: { rows: AccuracyView["byTrainType"] }) {
  const shown = ["current", "per_km", "range_mid", "model"] as const;
  const names: Record<(typeof shown)[number], string> = { current: "Actuelle", per_km: "Au km", range_mid: "Milieu", model: "Modèle" };
  return (
    <Scroll>
      <table className={cn(table, "min-w-[420px]")}>
        <thead>
          <tr className="border-b border-white/10">
            <th className={th}> </th>
            <th className={cn(th, "text-right")}>Trains</th>
            {shown.map((id) => (
              <th key={id} className={cn(th, "text-right")}>{names[id]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const best = Math.min(...shown.flatMap((id) => (row.mae[id] === null ? [] : [row.mae[id]!])));
            return (
              <tr key={row.key} className="border-t border-white/10">
                <td className={td}>{row.label}</td>
                <Cell>{row.n}</Cell>
                {shown.map((id) => (
                  <Cell key={id} best={row.mae[id] !== null && row.mae[id] === best}>
                    {eur(row.mae[id])}
                  </Cell>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Scroll>
  );
}
