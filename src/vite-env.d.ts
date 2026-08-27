/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_STORAGE_ACCOUNT: string;
    readonly VITE_BLOB_SAS_TOKEN: string;
    readonly VITE_FOUNDRY_RESOURCE: string;
    readonly VITE_FOUNDRY_KEY: string;
    readonly VITE_FOUNDRY_SPEECH_ENDPOINT: string;
    readonly VITE_GPT_DEPLOYMENT: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}