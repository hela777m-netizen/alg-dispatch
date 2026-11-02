import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Uploads are read once and deleted; this catches any that were abandoned.
crons.interval("delete abandoned uploads", { hours: 1 }, internal.files.cleanup, {});

export default crons;
