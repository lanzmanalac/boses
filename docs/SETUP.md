# Set up Boses

Boses is a web page. There is no install step and no account. You need the
repository, a browser, and a small local web server. Speech recognition runs
in the browser. The first live lesson downloads the model from the network.
After that, the lesson stays on the device.

## What you need

- Git
- Python 3, which is already on macOS and most Linux machines
- Node.js 18 or newer, only if you want to run the tests
- Chrome, Edge, or another current browser
- A microphone, only for a live lesson

## Run it on your machine

From the folder where you want the project:

```sh
git clone https://github.com/lanzmanalac/boses.git
cd boses
python3 -m http.server 8000
```

Leave that terminal open. In the browser, open:

- Recorded lesson: http://localhost:8000/web/index.html?fixture=1
- Live microphone: http://localhost:8000/web/index.html

Do not open `index.html` by double-clicking it. The browser will block the
page. `?fixture=noisy` and `?fixture=taglish` play the other recorded lessons.
The recorded lesson does not use the microphone and does not measure accuracy.

On the live page, allow the microphone. Stay quiet for the first second so the
page can hear the room. The setup screen downloads the model before Start
turns on. A computer fetches about 146 MB. A phone fetches about 41 MB. That
download needs a network the first time. It comes from jsDelivr and Hugging
Face, not from this repository.

## Checks

From the repository folder, with Node installed:

```sh
node --test
```

## Deploy on Vercel

The site must include both `web/` and `lessons/`. The pages live in `web/` and
request `../lessons/`. If the Vercel root is only `web/`, the recorded lesson
and the word list do not load.

Push the repository to GitHub before you deploy. Vercel builds from that
push. Do not upload `node_modules/`.

### 1. Add the build file

Create `scripts/build-static.mjs`:

```js
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('public', { recursive: true, force: true });
await mkdir('public', { recursive: true });
await cp('web', 'public/web', { recursive: true });
await cp('lessons', 'public/lessons', { recursive: true });
```

### 2. Add the Vercel config

Create `vercel.json` in the repository root:

```json
{
  "buildCommand": "node scripts/build-static.mjs",
  "outputDirectory": "public",
  "redirects": [
    {
      "source": "/",
      "destination": "/web/index.html",
      "permanent": false
    }
  ],
  "headers": [
    {
      "source": "/web/sw.js",
      "headers": [
        { "key": "Service-Worker-Allowed", "value": "/" }
      ]
    }
  ]
}
```

The header lets the service worker cover the lesson files. The offline reload
needs that. Commit both files and push.

### 3. Import the project

1. Sign in at https://vercel.com and choose **Add New… → Project**.
2. Import `lanzmanalac/boses`. If it is not listed, choose **Adjust GitHub App Permissions** and grant this repository.
3. Leave **Root Directory** as the repository root. Do not set it to `web`.
4. Set **Framework Preset** to **Other**.
5. Confirm the build settings match `vercel.json`:
   - Build Command: `node scripts/build-static.mjs`
   - Output Directory: `public`
   - Install Command: can stay empty. This page has nothing to install.
6. Choose **Deploy**. Wait until the deployment is **Ready**.
7. Open the deployment URL. It should land on the caption page. For a recorded lesson with no microphone, add `?fixture=1` to that URL.

Each later push to the connected branch deploys again. The **Visit** button on the project page is the URL to send.

### Deploy from the terminal instead

Install the Vercel CLI once, then from the repository folder, after the two files above are committed:

```sh
npm install -g vercel
vercel login
vercel
```

Answer the prompts with the current folder, and say yes when it asks to link or create a project. When that preview looks right:

```sh
vercel --prod
```

### After it is online

Open the live URL once on the demo phone and the demo laptop, and wait until the model step says it is ready. Then turn the network off and reload that same URL. The first visit is what stores the page and the model. A recorded-lesson rehearsal does not download the model.
