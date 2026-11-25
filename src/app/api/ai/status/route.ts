import { checkClaude } from "@/ai/claude";
import { claude } from "@/config";

/**
 * GET /api/ai/status: whether the `claude` CLI is installed and logged in, and whether it runs on this
 * machine or in a Docker container. Free: it never calls the model.
 */
export async function GET() {
  return Response.json({ ...(await checkClaude()), mode: claude.mode });
}
