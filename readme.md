# AI Audio Descriptions

## First Time Setup

* Clone the repo.
* In the project directory, run `npm install` to install required packages.
* Add a file call `.env` with required keys (see next section for details).
* Run `npm run dev` to run the project locally.
* Visit `http://localhost:5173` in your browser to launch the app.

## Azure Resources

Running this solution requires several Azure resources to be created. If you don't already have an Azure subscription, you can [get one here](https://azure.microsoft.com/en-us/free/)).

* [Azure OpenAI GPT-4 or GPT-4o resource](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/create-resource?pivots=web-portal)
* [Azure AI Services](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource?pivots=azportal)
* [Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/)

## Configuration

Create a file named `.env` in the project directory. It should contain lines in the format `key=value`.

The following keys are required:

* `VITE_BLOB_URI`
* `VITE_BLOB_SAS_TOKEN`
* `VITE_COMPUTER_VISION_VIDEO_DESCRIPTION_URL`
* `VITE_COMPUTER_VISION_VIDEO_DESCRIPTION_KEY`
* `VITE_SPEECH_KEY`
* `VITE_SPEECH_REGION`
* `VITE_GPT_URL`
* `VITE_GPT_KEY`

## See Also

This project is brought to you by the team behind [Seeing AI - a visual assistant for the blind community](https://SeeingAi.com/).
