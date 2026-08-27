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

The app needs:

- A Microsoft Foundry resource for Content Understanding, GPT, and Speech, with a GPT 5 deployment.
- An Azure Storage account with an `audio-description` blob container and CORS enabled for local development.
- A `.env` file containing the resource configuration and credentials used by the web app.

You can create and configure these manually, or use the included Azure Developer CLI configuration to automate the complete setup.

#### Prerequisites

- Azure subscription ([get a free one here](https://azure.microsoft.com/free))
- [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)

#### Provision

1. Sign in to Azure:

   ```shell
   azd auth login
   ```

2. Provision the resources:

   ```shell
   azd provision
   ```

The first provision prompts for an environment name, subscription, and location. It then creates and configures the Foundry and Storage resources and writes the required `.env` file.

**Cost Warning:** ⚠️ The created resources will incur Azure costs. Monitor your usage in the Azure Portal to avoid unexpected charges.

### Run the App

* In the project directory, run `npm install` to install required packages.
* Run `npm run dev` to run the project locally.
* The URL, such as [http://localhost:5173], will be displayed in the terminal. Visit that URL in your browser to view the app.

### Cleanup Azure Resources

To remove the resources in the active Azure Developer CLI environment, run:

```shell
azd down
```

⚠️ **Warning**: This will permanently delete all resources and data!

## Contributions Welcome

This is just the beginning. We have several ideas for improvements, and the AI keeps improving. If you have ideas, or code contributions, we'd love to hear from you.

## See Also

This project is brought to you by the team behind [Seeing AI - a visual assistant for the blind community](https://SeeingAi.com/).
