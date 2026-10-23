import { mutation } from "./_generated/server";
import { requireMember } from "./lib/access";

/** A one-time upload link for a report file. The file is deleted once it has been read. */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
