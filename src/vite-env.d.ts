/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_BLOB_URI: string;  
    readonly VITE_BLOB_SAS_TOKEN: string;
    readonly VITE_COMPUTER_VISION_VIDEO_DESCRIPTION_URL: string;
    readonly VITE_COMPUTER_VISION_KEY: string;
    readonly VITE_SPEECH_KEY: string;
    readonly VITE_SPEECH_REGION: string;
    readonly VITE_GPT_URL: string;
    readonly VITE_GPT_KEY: string;
}
  
interface ImportMeta {
    readonly env: ImportMetaEnv;
}