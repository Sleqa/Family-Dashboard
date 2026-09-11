# Weldon Hub

A lightweight home display for Burns Beach, Western Australia. Published from
the root of main on GitHub Pages. No package installation or build is required.

## Data

- Google iCal calendars retain their existing parser and offline source cache.
- Open-Meteo: Burns Beach current weather, four-day forecast, rain probability,
  UV, sunrise/sunset; Marine API supplies offshore model wave/sea conditions.
- FuelWatch WA: Premium 95 (Product 2). All metro stations are fetched before a
  haversine 30 km filter around -31.7206, 115.7205. This is a radius, not a
  driving route. Restricted/membership prices are excluded from the displayed
  ranking. Prices and dates come directly from FuelWatch; nothing is estimated.
- ESPN: AFL and NBA scores/upcoming games. Empty or expired cards are hidden.
- Jolpica: next F1 race, weekend sessions and championship leader.
- OpenF1: driver portraits matched by driver code and circuit images matched
  by race dates. Missing imagery hides gracefully. Commons fallbacks are keyed
  to the exact circuit/driver and credited in the card.
- Nager.Date: Australian national and AU-WA public holidays.

## Fuel refresh

The FuelWatch feed has no browser CORS support. The workflow
`.github/workflows/fuel-prices.yml` fetches only public fuel prices and writes
`data/fuel.json`. It runs at approximately 06:17, 14:47 and 16:17 AWST, and can
be run manually from Actions. GitHub may delay scheduled runs.

The page reads the raw main-branch snapshot, with a same-origin/cache fallback:
bot pushes do not trigger GitHub Pages rebuilds. This keeps prices updating
without rebuilding the page or exposing private calendar events in Git.
Dates are checked on every render; yesterday's prices are never labelled today.
GitHub may disable scheduled workflows on public repositories after 60 days
without repository activity; re-enable the workflow in Actions if needed.

Tomorrow's data is published by FuelWatch after 14:30 AWST and appears after
the afternoon snapshot. The card includes a FuelWatch link for checking prices
if a scheduled refresh is delayed.

## Checks

`node scripts/check-dashboard.mjs` checks startup and important empty/stale
states. Add `--live` to check calendar/fuel rendering and current F1 imagery
against the real services. `python scripts/test_fuel.py` checks fuel parsing,
distance/date filtering and restrictions. `python scripts/refresh_fuel.py`
refreshes the public fuel snapshot.

On the display, open the page and use the full-screen button if supported.
The refresh button retries data updates. Existing cached calendars remain
available if the connection fails.
