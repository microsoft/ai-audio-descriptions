import { writeFile } from "node:fs/promises";

const variableNames = [
    "FOUNDRY_RESOURCE",
    "FOUNDRY_RESOURCE_ID",
    "GPT_DEPLOYMENT",
    "STORAGE_ACCOUNT",
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
