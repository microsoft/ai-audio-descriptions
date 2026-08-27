const foundryResource = import.meta.env.VITE_FOUNDRY_RESOURCE;
const storageAccount = import.meta.env.VITE_STORAGE_ACCOUNT;

export const config = {
    foundry: {
        resource: foundryResource,
        key: import.meta.env.VITE_FOUNDRY_KEY,
        contentUnderstandingEndpoint: `https://${foundryResource}.cognitiveservices.azure.com/contentunderstanding`,
        openAiEndpoint: `https://${foundryResource}.openai.azure.com`,
        speechEndpoint: import.meta.env.VITE_FOUNDRY_SPEECH_ENDPOINT,
        gptDeployment: import.meta.env.VITE_GPT_DEPLOYMENT,
    },
    storage: {
        account: storageAccount,
        blobUri: `https://${storageAccount}.blob.core.windows.net`,
        sasToken: import.meta.env.VITE_BLOB_SAS_TOKEN,
        container: "audio-description",
    },
} as const;

const requiredConfiguration = {
    VITE_FOUNDRY_RESOURCE: config.foundry.resource,
    VITE_FOUNDRY_KEY: config.foundry.key,
    VITE_FOUNDRY_SPEECH_ENDPOINT: config.foundry.speechEndpoint,
    VITE_GPT_DEPLOYMENT: config.foundry.gptDeployment,
    VITE_STORAGE_ACCOUNT: config.storage.account,
    VITE_BLOB_SAS_TOKEN: config.storage.sasToken,
};

export const missingConfiguration = Object.entries(requiredConfiguration)
    .filter(([, value]) => !value)
    .map(([name]) => name);
