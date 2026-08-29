# AI Audio Descriptions

AI Audio Descriptions generates an editable audio-description draft for an MP4,
then renders the reviewed draft into a new audio-described video.

The project has three parts:

- `engine/` contains the reusable Python generation and rendering logic.
- `cli/` provides command-line GenerateAD and RenderAD tools.
- `studio/` provides a browser-based editor backed by the same engine.

## How it works

GenerateAD converts an MP4 into a WebVTT draft. Each cue covers an available
narration window and contains a proposed description.

RenderAD converts the source MP4 and reviewed WebVTT into an audio-described MP4.
It synthesizes each cue, fits it within its narration window, ducks the source
audio, and mixes the final track.

Studio adds upload, progress, editing, synchronized cue previews, and final
download. Videos and drafts are stored locally under `data/`.

## Prerequisites

- Python
- Node.js 20.19 or later
- FFmpeg and FFprobe on `PATH`
- Azure Developer CLI for automated Azure provisioning
- A Microsoft Foundry resource with Speech and a GPT deployment

## Provision Azure resources

Sign in and provision the Foundry resource:

```shell
azd auth login
azd provision
```

Provisioning writes these non-secret values to `.env`:

```text
FOUNDRY_RESOURCE
FOUNDRY_RESOURCE_ID
GPT_DEPLOYMENT
```

The application uses `DefaultAzureCredential`. For local development, ensure
your signed-in identity can use the provisioned Foundry resource.

Azure resources incur usage charges. Run `azd down` when you no longer need the
provisioned environment.

## Install

Create and activate a Python virtual environment, then install the shared
dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Install the Studio frontend:

```powershell
Set-Location studio\web
npm install
```

## Run Studio for development

From `studio\web`:

```shell
npm run dev
```

This starts:

- the Python API at `http://127.0.0.1:3001`;
- Vite at the URL printed in the terminal, normally
  `http://localhost:5173`.

Vite proxies `/api` requests to the Python server.

## Run the built Studio

Build the frontend:

```powershell
Set-Location studio\web
npm run build
Set-Location ..\..
```

Run the Python server:

```shell
python -m studio.server
```

Open `http://127.0.0.1:3001`.

## Command-line tools

Generate a draft:

```shell
python -m cli.generate_ad input.mp4 output.vtt
```

Render a reviewed draft:

```shell
python -m cli.render_ad input.mp4 output.vtt output.mp4
```

The CLI reads the same Foundry configuration from the environment.

## Local data

Studio stores each uploaded video, draft, preview audio, processing state, and
rendered outputs beneath `data/`. Deleting a video in Studio deletes its local
directory.

Preview audio is cached by text and voice within each video. Saving unchanged
descriptions therefore avoids repeated Speech synthesis. Final rendered videos
are reused until the VTT changes.

This version intentionally runs as one local server process using local files.
It does not provide authentication, multi-server coordination, or shared cloud
storage. Bind it to localhost unless you add the security and deployment controls
appropriate for your environment.

## Contributing

The project is intended to support audio-description research and practical
experimentation. Contributions that improve description quality, editing, media
handling, evaluation, and accessibility are welcome.

## See also

This project is from the team behind
[Seeing AI](https://www.seeingai.com/), a visual assistant for people who are
blind or have low vision.
