# AI Audio Descriptions

## Introduction

Audio Description is a technique for describing what is happening during a video, to benefit audience members who are blind or have low vision. This generally takes the form of a second audio track, and is available on TV, streaming services, and at movie theaters. The narration is timed to fit within silent parts of the video, so it doesn't overlap the dialog, and does not increase the length of the program (as would be the case if the video was paused to provide a description).

This project leverages Artificial Intelligence to assist in the process of generating the Audio Description track. First, a description is generated for each scene, along with a transcript of the dialog. Silences are then identified, and the descriptions rewritten to fit in the gaps. This is presented to the human AD editor as a draft to review and update. Once the script is finalized, the video can be downloaded with Audio Descriptions inserted using Text-To-Speech.

We hope that making the AD authoring process faster, and thus less expensive, will result in more inclusive content being created. Providing content with AD tracks is a legal requirement in several countries, and this will also help media companies meet these requirements.

We'd love to hear what you think. Especially if you deploy this solution within your organization. Email [aiad@microsoft.com](mailto:aiad@microsoft.com).

## Examples

https://github.com/user-attachments/assets/c880afc3-1b5a-403b-9610-0503bccbd21c
 
https://github.com/user-attachments/assets/e724070a-bca9-417a-8f08-85c5e30779f7
 
## Try It Yourself

We are providing this solution as open source to enable content creators to incorporate it into their workflows. The web app allows uploading of MP4 videos, having the draft AD script generated, editing the script, and generating a new video file with the audio description inserted.

While we provide an end-to-end user experience, aspects such as hosting, authentication and authorization will differ customer-to-customer.

The below details will enable a developer to run the solution on their dev box.

### Setup Azure

* Azure Subscription: If you don't already have one, you can [get a free Azure subscription here](https://azure.microsoft.com/free).
* [Azure AI Services](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource?pivots=azportal): Provides access to Azure Content Understanding, Open AI, and speech APIs. When creating the resource, select either West US, Sweden Central, or Australia East as the region.
* [Azure Storage Account](https://learn.microsoft.com/en-us/azure/storage/common/storage-account-create?toc=%2Fazure%2Fstorage%2Fblobs%2Ftoc.json&tabs=azure-portal): Used to store the videos. After creating the account, [create a container named "audio-description"](https://learn.microsoft.com/en-us/azure/storage/blobs/quickstart-storage-explorer#create-a-container) and generate a Shared Access Signiture for the container. You will also need to enable CORS to allow the app to retrieve data from blob storage (select CORS from the storage account settings and create a new rule: set Allowed Origins to be the URL where the app is running, Allowed Methods to get/put/options/delete, Allowed Headers to *, and Max Age 9999).
* GPT model: Go into the AI Services resource created above, and [deploy a GPT-4O model](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/create-resource?pivots=web-portal#deploy-a-model).

### Configure the Solution

After cloning this repo, create a file called `.env`. Add lines in the format `key=value` with the following entries:

* `VITE_AI_SERVICES_RESOURCE`: The name of the resource (not the full domain name).
* `VITE_AI_SERVICES_KEY`: Can be copied from the portal.
* `VITE_AI_SERVICES_REGION`: All one word, such as `westus` or `swedencentral`.
* `VITE_STORAGE_ACCOUNT`: The name of the resource (not the full domain name).
* `VITE_BLOB_SAS_TOKEN`: The full URL of the Shared Access Signiture you created above.
* `VITE_GPT_DEPLOYMENT`: The name you chose when creating the deployment, such as `gpt-4o`.

### Run the App

* In the project directory, run `npm install` to install required packages.
* Make sure the `.env` file created above is in this directory too.
* Run `npm run dev` to run the project locally.
* The URL, such as [http://localhost:5173], will be displayed in the terminal. Visit that URL in your browser to view the app.

## Contributions Welcome

This is just the beginning. We have several ideas for improvements, and the AI keeps improving. If you have ideas, or code contributions, we'd love to hear from you.

## See Also

This project is brought to you by the team behind [Seeing AI - a visual assistant for the blind community](https://SeeingAi.com/).
