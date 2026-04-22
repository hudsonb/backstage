---
'@backstage/plugin-techdocs': patch
---

The TechDocs home page docs table and card grid now render entity names
through the catalog presentation API, giving consistent display behavior
with the rest of Backstage (for example, falling back to a user's
`spec.profile.displayName` and qualifying entities with a namespace
prefix when the namespace is not the default). Custom
`EntityPresentationApi` registrations are now honored in these views.
