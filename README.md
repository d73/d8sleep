# d8sleep

A small, local-network web app for controlling an Eight Sleep Pod's heating level from a computer or phone. Uses the unofficial Eight Sleep API; compatibility can change without notice.

## Run

Requires Python 3.10 or newer. Create a `.env` file in this folder containing:

```text
EIGHT_EMAIL=your-account-email
EIGHT_PASSWORD=your-account-password
```

On Windows, run `start.bat` from this folder to start the app in the background; run `stop.bat` to stop that instance, or `restart.bat` to restart it. All three return to the command prompt. Alternatively run `python server.py` in a terminal and stop it with Ctrl+C. Open http://localhost:8787 on the host computer. On a phone on the same trusted home network, open `http://<computer-LAN-IP>:8787`. Allow Python through the Windows firewall for private networks if needed. The host must remain running. Set `PORT` to change the port. Optional `EIGHT_CLIENT_ID` and `EIGHT_CLIENT_SECRET` override the public client values used by the community client.

Settings → Stop when idle defaults to Never. You can select a timeout or enter 5–1440 minutes; the server stops after that long without an active browser page or request. Open pages send periodic heartbeats, including in background tabs, though browsers or devices that suspend a tab may stop sending them. Change the setting from the host computer. Restart the service after it stops.

Account credentials and tokens remain on the server and are never sent to phone browsers. The app uses HTTP and permits anyone on the trusted home network who can reach it to control the Pod; do not expose its port to the internet or use it on an untrusted network. `.env` is ignored by Git. Credentials in `.env` remain on disk.

The web control and CLI use the app-style -10 to +10 scale; each step maps to 10 units on the unofficial API scale (-100 to +100). Non-integer readings are displayed without rounding away the reported value. The API reports device and target **levels**, not a verified thermometer reading. The degree estimate uses a community mapping and may not match the actual bed temperature. The app does not change alarm, base, or sleep-stage settings. Dual-side control depends on which user IDs the account can access.

## Sleep session archive

When the app fetches sleep sessions for a side, it saves each identifiable interval returned by Eight Sleep as a separate JSON file in `data/sessions/`, including intervals older than the 14 shown in the dashboard. Select each side in the app to fetch and archive that side. File names include the side, original start time in UTC and a unique suffix; if Eight Sleep later corrects the start time, the contents update but the original file name stays. Each file contains `side`, the original `interval` object (including fields the dashboard does not currently display), and the daily `score` when available for a displayed main session. Sessions beyond the 14 most recent are archived without a score unless one was saved previously. A repeated fetch updates the same file; a temporary score-fetch failure does not erase a previously saved score. The archive grows as the app fetches sessions; it is not a complete historical backfill beyond what the upstream intervals endpoint returns. An archive write failure is logged and does not stop live data from loading.

These files contain sensitive sleep data and may include identifiers present in the upstream response. They remain on this computer, are not served as raw archive files by the app, and `data/` is ignored by Git. Protect or back up this folder as you would other health records.

## Command line

From a Windows command prompt in this folder (or use the full path to `pod.bat`), for example:

```bat
pod.bat left on
pod.bat left -5
pod.bat left off
```

Use `right` or `solo` for the corresponding side. The side is the first argument and may be omitted only when the account has one assigned side. Grammar: `pod [left|right|solo] on | off | LEVEL`. A level is a whole number from -10 to +10 (for example `pod.bat left -5`) and changes the target level only; use `on` separately to turn on an off side. The CLI connects directly using the same `.env` credentials, works without the web app, and returns a nonzero exit code on failure. For other systems, use `python pod.py` with the same arguments.

## Test

`python -m unittest discover -s tests -v`

API behavior informed by https://github.com/lukas-clarke/pyEight and https://github.com/lukas-clarke/eight_sleep. Verify against your own device before relying on the app: no live hardware is used by the automated tests.
