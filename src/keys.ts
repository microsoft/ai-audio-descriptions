const storageAccount: string = import.meta.env.VITE_STORAGE_ACCOUNT;
const blobUri = `https://${storageAccount}.blob.core.windows.net`;
const blobSasToken: string = import.meta.env.VITE_BLOB_SAS_TOKEN;
const STORAGE_CONTAINER_NAME = "audio-descriptions";

const aiServicesResource = import.meta.env.VITE_AI_SERVICES_RESOURCE;
const aiServicesKey = import.meta.env.VITE_AI_SERVICES_KEY;
const aiServicesRegion: string = import.meta.env.VITE_AI_SERVICES_REGION;

const gptDeployment: string = import.meta.env.VITE_GPT_DEPLOYMENT;

export { blobUri, blobSasToken, STORAGE_CONTAINER_NAME, aiServicesResource, aiServicesKey, aiServicesRegion, gptDeployment };
