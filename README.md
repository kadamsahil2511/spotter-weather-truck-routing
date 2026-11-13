# Weather-aware truck routing

Planning document for the Spotter AI full-stack assessment. No application code yet.

Read [PLAN.md](./PLAN.md). Routing recommendation: OpenRouteService `driving-hgv`, behind a provider adapter, with a via-point fallback so hauls longer than 100 km still return three options.
