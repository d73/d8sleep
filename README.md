# d8sleep

A small, local-network web app for controlling an Eight Sleep Pod's heating level from a computer or phone. Uses the unofficial Eight Sleep API; compatibility can change without notice.

## Run

Requires Python 3.10 or newer. Create a `.env` file in this folder containing:

```text
EIGHT_EMAIL=your-account-email
EIGHT_PASSWORD=your-account-password
```

On Windows, run `start.bat` from this folder to start the app in the background; run `stop.bat` to stop that instance, or `restart.bat` to restart it. All three return to the command prompt. Alternatively run `python server.py` in a terminal and stop it with Ctrl+C. Open http://localhost:8787 on the host computer. On a phone on the same trusted home network, open `http://<computer-LAN-IP>:8787`. Allow Python through the Windows firewall for private networks if needed. The host must remain running. Set `PORT` to change the port. Optional `EIGHT_CLIENT_ID` and `EIGHT_CLIENT_SECRET` override the public client values used by the community client.

Account credentials and tokens remain on the server and are never sent to phone browsers. The app uses HTTP and permits anyone on the trusted home network who can reach it to control the Pod; do not expose its port to the internet or use it on an untrusted network. `.env` is ignored by Git. Credentials in `.env` remain on disk.

The API reports device and target **levels**, not a verified thermometer reading. The degree estimate uses a community mapping and may not match the actual bed temperature. The app does not change alarm, base, or sleep-stage settings. Dual-side control depends on which user IDs the account can access.

## Test

`python -m unittest discover -s tests -v`

API behavior informed by https://github.com/lukas-clarke/pyEight and https://github.com/lukas-clarke/eight_sleep. Verify against your own device before relying on the app: no live hardware is used by the automated tests.
