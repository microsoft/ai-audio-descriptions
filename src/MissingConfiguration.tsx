import { MessageBar } from "@fluentui/react-components";
import { missingConfiguration } from "./config";

export const MissingConfiguration = () => missingConfiguration.length > 0
    ? <MessageBar intent="error" layout="multiline">
        Missing configuration: {missingConfiguration.join(", ")}
    </MessageBar>
    : null;