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

Deploy steps are in [VERCEL.md](VERCEL.md).
