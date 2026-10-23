import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Records an in-app notification. Never notifies people about their own actions. */
export async function notify(
  ctx: MutationCtx,
  to: Id<"members">,
  from: Doc<"members">,
  kind: Doc<"notifications">["kind"],
  text: string,
  refs: { entryId?: Id<"entries">; reportId?: Id<"reports"> } = {},
) {
  if (to === from._id) return;
  await ctx.db.insert("notifications", {
    recipientId: to,
    actorId: from._id,
    kind,
    text: text.slice(0, 280),
    ...refs,
    createdAt: Date.now(),
  });
}
