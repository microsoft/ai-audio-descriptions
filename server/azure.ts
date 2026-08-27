import { DefaultAzureCredential } from "@azure/identity";

const cognitiveServicesScope = "https://cognitiveservices.azure.com/.default";

export const credential = new DefaultAzureCredential();

export const getCognitiveServicesToken = async (): Promise<string> => {
  const accessToken = await credential.getToken(cognitiveServicesScope);
  if (!accessToken) {
    throw new Error("Azure did not return a Cognitive Services access token.");
  }
  return accessToken.token;
};
