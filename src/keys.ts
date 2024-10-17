const storageAccount: string = import.meta.env.VITE_STORAGE_ACCOUNT;
const blobSasToken: string = import.meta.env.VITE_BLOB_SAS_TOKEN;

const computerVisionResource: string = import.meta.env.VITE_COMPUTER_VISION_RESOURCE;
const computerVisionKey: string = import.meta.env.VITE_COMPUTER_VISION_KEY;

const speechKey: string = import.meta.env.VITE_SPEECH_KEY;
const speechRegion: string = import.meta.env.VITE_SPEECH_REGION;

const openaiResource: string = import.meta.env.VITE_OPENAI_RESOURCE;
const openaiKey: string = import.meta.env.VITE_OPENAI_KEY;
const gptDeployment: string = import.meta.env.VITE_GPT_DEPLOYMENT;

const blobUri = `https://${storageAccount}.blob.core.windows.net`;
const computerVisionVideoDescriptionUrl = `https://${computerVisionResource}.cognitiveservices.azure.com/computervision/videoanalysis/videodescriptions/{0}?api-version=2024-05-01-preview`;
const gptUrl = `https://${openaiResource}.openai.azure.com/openai/deployments/${gptDeployment}/chat/completions?api-version=2024-04-01-preview`;

export { blobUri, blobSasToken, computerVisionVideoDescriptionUrl, computerVisionKey, speechKey, speechRegion, gptUrl, openaiKey };
