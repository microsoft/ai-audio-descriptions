const blobUri: string = import.meta.env.VITE_BLOB_URI;
const blobSasToken: string = import.meta.env.VITE_BLOB_SAS_TOKEN;

const computerVisionVideoDescriptionUrl: string = import.meta.env.VITE_COMPUTER_VISION_VIDEO_DESCRIPTION_URL;
const computerVisionKey: string = import.meta.env.VITE_COMPUTER_VISION_KEY;

const speechSubscriptionKey: string = import.meta.env.VITE_SPEECH_KEY;
const speechRegion: string = import.meta.env.VITE_SPEECH_REGION;

const gptUrl: string = import.meta.env.VITE_GPT_URL;
const gptKey: string = import.meta.env.VITE_GPT_KEY;

export { blobUri, blobSasToken, computerVisionVideoDescriptionUrl, computerVisionKey, speechSubscriptionKey, speechRegion, gptUrl, gptKey };