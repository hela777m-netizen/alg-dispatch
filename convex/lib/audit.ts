import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Writes one audit row in the same transaction as the change it describes,
 * so a row exists only if the change happened. Never pass update or report text.
 */
export async function audit(
  ctx: MutationCtx,
  actor: Doc<"members"> | null,
  action: string,
  target?: { id?: string; name?: string },
  detail?: string,
) {
  await ctx.db.insert("auditLog", {
    at: Date.now(),
    actorId: actor?._id,
    actorName: actor?.name ?? "System",
    action,
    targetId: target?.id,
    targetName: target?.name,
    detail: detail?.slice(0, 500),
  });
}
