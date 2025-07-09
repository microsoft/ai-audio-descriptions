import { MessageBar } from "@fluentui/react-components"
import { blobSasToken, aiServicesResource, aiServicesKey, aiServicesRegion, openAiResource, openAiKey, blobUri, gptDeployment } from "./keys";
import React from "react";

export const MissingKeys = () => {
    const allKeysMap = {
        blobUri: "VITE_STORAGE_ACCOUNT",
        blobSasToken: "VITE_BLOB_SAS_TOKEN",
        aiServicesResource: "VITE_AI_SERVICES_RESOURCE",
        aiServicesKey: "VITE_AI_SERVICES_KEY",
        aiServicesRegion: "VITE_AI_SERVICES_REGION",
        openAiResource: "VITE_OPENAI_RESOURCE",
        openAiKey: "VITE_OPENAI_KEY",
        gptDeployment: "VITE_GPT_DEPLOYMENT"
    };
    const [isKeyMissing, setIsKeyMissing] = React.useState(false);
    const [keyMissingMessage, setKeyMissingMessage] = React.useState("");

    React.useEffect(() => {
        const errorKeysList = [];
        if (!blobUri || blobUri === "") {
            errorKeysList.push(allKeysMap.blobUri);
        }
        if (!blobSasToken || blobSasToken === "") {
            errorKeysList.push(allKeysMap.blobSasToken);
        }
        if (!aiServicesRegion || aiServicesRegion === "") {
            errorKeysList.push(allKeysMap.aiServicesRegion);
        }
        if (!aiServicesResource || aiServicesResource === "") {
            errorKeysList.push(allKeysMap.aiServicesResource);
        }
        if (!aiServicesKey || aiServicesKey === "") {
            errorKeysList.push(allKeysMap.aiServicesKey);
        }
        if (!openAiResource || openAiResource === "") {
            errorKeysList.push(allKeysMap.openAiResource);
        }
        if (!openAiKey || openAiKey === "") {
            errorKeysList.push(allKeysMap.openAiKey);
        }
        if (!gptDeployment || gptDeployment === "") {
            errorKeysList.push(allKeysMap.gptDeployment);
        }

        if(errorKeysList.length > 0) {
            const message = `The following keys are missing: ${errorKeysList.join(", ")}`;
            setKeyMissingMessage(message);
            setIsKeyMissing(true);
        }
    }, []);

    return isKeyMissing 
        ? <MessageBar intent="error" layout="multiline">{keyMissingMessage}</MessageBar> 
        : <></>;
}