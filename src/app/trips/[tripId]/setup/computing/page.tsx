import { Suspense } from "react";
import { ComputingScreen } from "@/components/ComputingScreen";

export default function ComputingStep() {
  // useParams reads the trip id at request time, which needs a Suspense boundary under cacheComponents
  return (
    <Suspense fallback={null}>
      <ComputingScreen />
    </Suspense>
  );
}
