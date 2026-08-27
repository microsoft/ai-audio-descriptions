const requiredValues = {
  foundryResource: process.env.FOUNDRY_RESOURCE,
  foundryResourceId: process.env.FOUNDRY_RESOURCE_ID,
  gptDeployment: process.env.GPT_DEPLOYMENT,
  storageAccount: process.env.STORAGE_ACCOUNT,
};

const missingValues = Object.entries(requiredValues)
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingValues.length > 0) {
  throw new Error(`Missing server configuration: ${missingValues.join(", ")}`);
}

export const config = {
  foundryResource: requiredValues.foundryResource!,
  foundryResourceId: requiredValues.foundryResourceId!,
  gptDeployment: requiredValues.gptDeployment!,
  storageAccount: requiredValues.storageAccount!,
  containerName: "audio-description",
  port: Number(process.env.PORT ?? 3001),
} as const;

export const foundryEndpoint = `https://${config.foundryResource}.cognitiveservices.azure.com`;
export const openAiEndpoint = `https://${config.foundryResource}.openai.azure.com`;
