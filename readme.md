# AI Audio Descriptions

## Introduction

Audio description explains what is happening in a video for audience members who
are blind or have low vision. It generally takes the form of a second audio track
available on television, streaming services, and in movie theaters. The narration
is timed to fit between dialogue, without pausing or extending the program.

This project uses artificial intelligence to assist with creating an audio
description track. It analyzes an MP4, identifies narration windows, and generates
an editable draft. A human audio-description editor can review and revise the
script before rendering a new video with the descriptions inserted using
text-to-speech.

We hope that making audio-description authoring faster and less expensive will
help make more content accessible.

We'd love to hear what you think, especially if you deploy this solution within
your organization. Email [aiad@microsoft.com](mailto:aiad@microsoft.com).

## Examples

https://github.com/user-attachments/assets/c880afc3-1b5a-403b-9610-0503bccbd21c

https://github.com/user-attachments/assets/e724070a-bca9-417a-8f08-85c5e30779f7

## Try it yourself

This open-source project provides an end-to-end workflow for generating, editing,
and rendering audio descriptions. You can use the browser-based Studio or the
command-line tools.

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

SeparateAD recovers an approximate narration-only WAV from matching main and
audio-described soundtracks. It is intended for broadcaster mixes derived from
the same synchronized program master.

Studio adds upload, progress, editing, synchronized cue previews, and final
download. Videos and drafts are stored locally under `data/`.

## Prerequisites

- Python
- Node.js 20.19 or later
- FFmpeg and FFprobe on `PATH`
- An Azure subscription ([get a free one here](https://azure.microsoft.com/free))
- Azure Developer CLI for automated Azure provisioning
- A Microsoft Foundry resource with Speech and a GPT deployment

## Set up and run

First-time setup, from the repository root:

```shell
azd auth login
azd provision

python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt

cd studio\web
npm ci
cd ..\..
```

Start the Studio from the repository root:

```shell
cd studio\web
npm run dev
```

Open the URL printed in the terminal, normally `http://localhost:5173`.
`npm run dev` starts both the Python server and the Studio website.

Provisioning creates a `.env` file with the required Azure configuration. The
application uses your Azure sign-in through `DefaultAzureCredential`.

**Cost warning:** The provisioned Azure resources incur charges. Run `azd down`
when you no longer need them.

## Command-line tools

Generate a draft:

```shell
python -m cli.generate_ad input.mp4 output.vtt
```

Render a reviewed draft:

```shell
python -m cli.render_ad input.mp4 output.vtt output.mp4
```

Recover the narration stem from an existing AD mix:

```shell
python -m cli.separate_ad input.mp4 input.ad.mp4 output.ad-only.wav
```

The CLI automatically loads the same Foundry configuration from the repository
`.env` file. Values already set in the environment take precedence.

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
