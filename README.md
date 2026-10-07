# Language ID

**Speak for a few seconds, and find recordings in your own language.**

Global Recordings Network (GRN) has audio Bible stories and teaching in over
6,800 languages and dialects, many of them small languages that are mostly
spoken, not written. The hard part is often the first step: someone who speaks a minority
language can't always name it, or spell it, in a language the helper knows.

Language ID solves that by listening. A person speaks into the phone or
laptop in the language they know best. Meta's open speech model guesses the
language, and the app matches its guesses to GRN's catalog. The person then
hears short GRN samples of the best matches and picks the one that sounds
like them. That opens GRN's recordings in their language, with a QR code to
take them home on their own phone.

### What it does

- **Records and identifies speech** with Meta's MMS language-ID model
  (`facebook/mms-lid-4017`), which knows 4,017 languages. It runs on your own
  computer: recordings aren't sent to any outside AI service.
- **Matches the guesses to GRN's catalog** of 6,816 languages and dialects,
  with names shown in each language's own script where known (Русский, አማርኛ).
- **Lets the person decide by ear.** It plays GRN's sample of each guess, one
  at a time or as a ranked list, including the dialects under each language.
- **"Near me"** marks the languages spoken in the country the device is in.
- **Asks permission** before keeping a recording, to help the model learn
  languages it knows little about. Results never depend on the answer. Kept
  recordings, and each session's results, are stored on the computer running
  the server (`server/storage/`), not sent anywhere else.
- **Learns what it's missing.** If none of the guesses is right, the person
  can name their language or dialect, so it can be added later.
- **Gives them their language's resources:** GRN's recordings on 5fish and
  the Bible on YouVersion, each with a QR code. Optionally, Gloo AI adds a
  short note in their language and answers questions.

### How it's built

- **Page:** plain HTML, CSS and JavaScript, with no build step (`index.html`, `css/`, `js/`).
- **Server:** Python with FastAPI (`server/`). It runs the model and serves the page, all from one command.
- **Model:** Meta MMS-LID, run with PyTorch and Hugging Face Transformers, on the CPU or an Apple-silicon GPU.
- **Data:** GRN's language catalog (`data/languages.json`) and country borders for "Near me", both included.

---

## What you need

| | |
| --- | --- |
| **Computer** | Windows 10 or 11, or a Mac with **Apple silicon** (M1 or later). See below for Intel Macs |
| **Python** | **3.11, 3.12 or 3.13**, from [python.org](https://www.python.org/downloads/) |
| **Memory** | 8 GB of RAM |
| **Disk** | About 6 GB free: 3.6 GB for Meta's model, the rest for PyTorch |
| **Internet** | For setup (about 4–5 GB to download). While running: for the language samples, Bible links and AI note |
| **Browser** | Chrome, Edge or Firefox, and a microphone |

**Intel Macs:** current PyTorch no longer supports them, so Meta's model
can't run there. You can still try the whole app with sample answers: see
[Try it without the model](#try-it-without-the-model).

---

## Install and run on Windows

Open **PowerShell** in the project folder (the one with this README), then
run these one at a time.

**1. Go into the server folder.**

```powershell
cd server
```

**2. Create a Python environment for the project.**

```powershell
python -m venv .venv
```

If Windows opens the Microsoft Store instead, Python isn't installed: get it
from python.org, and tick **"Add python.exe to PATH"** in the installer.

**3. Install the requirements.** This includes PyTorch and takes a few minutes.

```powershell
.venv\Scripts\python -m pip install -r requirements.txt
```

**4. Download Meta's model** (3.6 GB, one time only).

```powershell
.venv\Scripts\python -c "from transformers import AutoFeatureExtractor, Wav2Vec2ForSequenceClassification as Model; AutoFeatureExtractor.from_pretrained('facebook/mms-lid-4017'); Model.from_pretrained('facebook/mms-lid-4017')"
```

**5. Start the app.**

```powershell
.venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8080
```

Wait for `Application startup complete` (10–30 seconds while the model
loads), then open **<http://localhost:8080>** in your browser. Press
**Ctrl+C** in PowerShell to stop it.

**Next time:** just steps 1 and 5.

---

## Install and run on a Mac

Open **Terminal** in the project folder (the one with this README), then run
these one at a time.

**1. Go into the server folder.**

```bash
cd server
```

**2. Create a Python environment for the project.**

```bash
python3 -m venv .venv
```

**3. Install the requirements.** This includes PyTorch and takes a few minutes.

```bash
.venv/bin/python -m pip install -r requirements.txt
```

**4. Download Meta's model** (3.6 GB, one time only).

```bash
.venv/bin/python -c "from transformers import AutoFeatureExtractor, Wav2Vec2ForSequenceClassification as Model; AutoFeatureExtractor.from_pretrained('facebook/mms-lid-4017'); Model.from_pretrained('facebook/mms-lid-4017')"
```

**5. Start the app.**

```bash
.venv/bin/python -m uvicorn app.main:create_app --factory --port 8080
```

Wait for `Application startup complete` (10–30 seconds while the model
loads), then open **<http://localhost:8080>** in your browser. Press
**Ctrl+C** in Terminal to stop it.

**Next time:** just steps 1 and 5.

---

## Using it

1. **Tap the microphone** and speak for 5–20 seconds in any language. Any
   sentences will do; a quiet room helps. Tap again to stop.
2. **A banner asks** whether we may keep the recording. Answer whenever you
   like, or not at all: the results don't wait for it.
3. **Listen to the best match,** or tap **Show all rankings** for the full list.
   Each guess plays a GRN sample. Tap **Next** to hear the next one.
4. **Tap "This is my language"** (or the arrow next to a dialect) to see its
   recordings, its Bible, and QR codes to open them on another phone.

Identifying a recording takes about 3 seconds on a typical laptop CPU. The
browser asks for microphone permission the first time; allow it. "Near me"
asks for location permission.

---

## Optional: the AI note and chat (Gloo AI)

On the last screen, Gloo AI can add a short note in the person's language and
answer their questions. It needs a **Gloo API key**, which isn't in the code
because each use costs money. Without it, everything else works and those two
parts are simply hidden.

To turn it on, in the `server` folder, save the key in a file named `.env`,
using your key in place of `sk_...`:

**Windows (PowerShell):**

```powershell
"GLOO_API_KEY=sk_..." | Out-File -Encoding ascii .env
```

**Mac (Terminal):**

```bash
echo "GLOO_API_KEY=sk_..." > .env
```

Then start the app with `--env-file .env` added:

**Windows:**

```powershell
.venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8080 --env-file .env
```

**Mac:**

```bash
.venv/bin/python -m uvicorn app.main:create_app --factory --port 8080 --env-file .env
```

Spending is capped at $1 a day by default.

---

## Try it without the model

To look around the app without downloading Meta's model, for example on an
Intel Mac, run it in **stub mode**. It returns a fixed set of sample answers
instantly, whatever you say. Everything else (samples, choosing, resources)
works as normal.

**On an Intel Mac,** step 3 fails because PyTorch isn't available. Do steps
1 and 2, then install everything except the model's libraries:

```bash
.venv/bin/python -m pip install fastapi "uvicorn[standard]" python-multipart numpy httpx
```

Then start it in stub mode, from the `server` folder:

**Windows (PowerShell):**

```powershell
$env:LID_IDENTIFIER = "stub"
```

```powershell
.venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8080
```

Stub mode stays on in that PowerShell window; open a new one to use the real
model again.

**Mac (Terminal):**

```bash
LID_IDENTIFIER=stub .venv/bin/python -m uvicorn app.main:create_app --factory --port 8080
```

---

## If something goes wrong

| Problem | Fix |
| --- | --- |
| **The microphone doesn't work** | Open the page at `http://localhost:8080`, not your computer's network address: browsers only allow the microphone on `localhost` or HTTPS. Check that the site has microphone permission (the icon in the address bar). |
| **"Could not reach the server"** | The server isn't running. Start it again (step 5) and wait for `Application startup complete`. |
| **Port 8080 is already in use** | Use another port, for example `--port 8090`, and open `http://localhost:8090`. |
| **Step 3 fails installing `torch`** | Check your Python version (`python --version`): it needs 3.11–3.13. On an Intel Mac, PyTorch isn't available: use stub mode. |
| **The model download stops partway** | Run step 4 again; it continues where it left off. |
| **No language samples play** | They download from GRN's servers on first play, so they need internet. |
| **On a Mac, an error mentions "MPS"** | Start with `PYTORCH_ENABLE_MPS_FALLBACK=1` in front of the command in step 5. |

---

## Running the tests (optional)

Server tests (Python), from the `server` folder:

```bash
python -m pip install -r requirements-dev.txt
```

```bash
python -m pytest
```

Use `.venv\Scripts\python` on Windows or `.venv/bin/python` on a Mac in
place of `python`.

Page tests need [Node.js](https://nodejs.org) 20 or later. From the project
folder:

```bash
npm test
```

---

## For developers

How the page and the server work in detail, including the model's output,
the screens, the data and the server's endpoints and settings:
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
