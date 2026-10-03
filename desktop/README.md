# B.O.A.T Desktop helpers

These optional shared helpers support BOAT catalogs and HLS playback in Nuvio Desktop. The catalog inventory contains only BOAT.

Start the helper from this directory:

```powershell
.\start_desktop_hls.ps1
```

Or run `node desktop_hls_bridge.js`. The helper listens on `http://127.0.0.1:18765`; the local catalog addon manifest is available at `http://127.0.0.1:18765/addon/manifest.json`. Shared transport modules and bundled parser/crypto dependencies are retained so the helper can start without additional dependencies.

Plugin settings are read for the public repository URL:

`https://raw.githubusercontent.com/wGodfather/BOAT/main/manifest.json`
