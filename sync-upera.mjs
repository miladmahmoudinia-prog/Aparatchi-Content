#!/usr/bin/env node

// Compatibility entrypoint. The maintained synchronizer lives in scripts/ so
// manual runs and GitHub Actions can never drift onto different implementations.
await import('./scripts/sync-upera.mjs');
