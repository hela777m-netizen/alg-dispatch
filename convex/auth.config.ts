// Tells Convex to trust sign-ins issued by your Clerk instance.
// CLERK_JWT_ISSUER_DOMAIN is set in the Convex dashboard (see SETUP.md).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
};
