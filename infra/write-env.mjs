import { writeFile } from "node:fs/promises";

const variableNames = [
    "VITE_FOUNDRY_RESOURCE",
    "VITE_FOUNDRY_KEY",
    "VITE_FOUNDRY_SPEECH_ENDPOINT",
    "VITE_GPT_DEPLOYMENT",
    "VITE_STORAGE_ACCOUNT",
    "VITE_BLOB_SAS_TOKEN",
];

const missingVariables = variableNames.filter((name) => !process.env[name]);
if (missingVariables.length > 0) {
    throw new Error(`Missing azd environment values: ${missingVariables.join(", ")}`);
}

const contents = variableNames
    .map((name) => `${name}=${process.env[name]}`)
    .join("\n");

await writeFile(new URL("../.env", import.meta.url), `${contents}\n`);
console.log("Created .env from the active azd environment.");
