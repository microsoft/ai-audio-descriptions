/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_STORAGE_ACCOUNT: string;
    readonly VITE_BLOB_SAS_TOKEN: string;
    readonly VITE_AI_SERVICES_RESOURCE: string;
    readonly VITE_AI_SERVICES_KEY: string;
    readonly VITE_AI_SERVICES_REGION: string;
    readonly VITE_GPT_DEPLOYMENT: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}