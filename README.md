# B.O.A.T for Nuvio

Nuvio-compatible B.O.A.T provider distribution. Only B.O.A.T is registered in the manifest.

## Add to Nuvio

Paste this URL into the plugin repository field:

```text
https://raw.githubusercontent.com/wGodfather/BOAT/main/manifest.json
```

## Repository layout

- `providers/boat.js`: the JavaScript provider loaded directly by Nuvio.
- `manifest.json`: provider registration and shared TMDB catalog entries.
- `config.json`: BOAT settings and metadata service configuration.
- `catalog/` and `meta/`: shared catalog and metadata files used by BOAT.
- `assets/` and `logos/`: BOAT artwork.
- `desktop/`: shared optional Desktop HLS/catalog helpers, with a BOAT-only catalog inventory.
- `THIRD_PARTY_NOTICES.md` and `licenses/`: upstream attribution and license texts.

## Development

Private development repository: https://github.com/wGodfather/BOAT-Source

The JavaScript provider originates from https://github.com/dr-octagon/Nuvio. Original author attribution and bundled license information are retained. This copy contains the upstream bundled JavaScript; the unbundled `src/boat/index.js` referenced in its header was not present in the upstream repository.

Development and public distribution repositories are updated separately; automatic publishing is not configured.
