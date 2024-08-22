import axios from "axios";
import { aiServicesResource, aiServicesKey, gptDeployment } from "../keys";
import { delay, GenerateId, msToTime, timeToMs } from "./Helper";
import { Segment } from "../Models";
import { Content, ContentUnderstandingResults } from "../ContentUnderstandingModels";

export const createContentUnderstandingAnalyzer = async (title: string, metadata: string, narrationStyle: string) => {
    const description_prompt = "Write an audio description track describing what happened across the frames in this scene. Do not repeat information from the previous description. Do not repeat information in the transcript. Do not explain what things mean.\n\n"
    + "Use the below information about the video to enhance the descriptions:\n\n"
    + (title ?? "") || `* Title: ${title}\n`
    + (metadata ?? "") || `* Context: ${metadata}\n`
    + (narrationStyle ?? "") || `Writing Style: ${narrationStyle}\n`;

    const id = GenerateId();
    const url = getContentUnderstandingBaseUrl(id);

    const data = {
        description: "Audio Description video analyzer",
        scenario: "videoShot",
        config: {
          returnDetails: true
        },
        fieldSchema: {
          fields: {
            Description: {
              type: "string",
              description: description_prompt
            }
          }
        }
      };

    const config = {
        headers: {
            "ocp-apim-subscription-key": aiServicesKey,
            "x-ms-useragent": "ai-audio-descriptions/1.0"
        }
    }
    const result = await axios.put(url, data, config);
    
    const statusUrl = result.headers["operation-location"].toString();
    let statusResult = await axios.get(statusUrl, config);

    while(statusResult.data.status?.toLowerCase() !== "succeeded") {
        await new Promise(r => setTimeout(r, 1000));
        statusResult = await axios.get(statusUrl, config);
    }
    return result.data;    
};

export const createAnalyzeFileTask = async (analyzerId: string, videoUrl: string) => {
    const url = getContentUnderstandingBaseUrl(analyzerId, ":analyze");
    const data = {
        url: videoUrl
    };
    const config = {
        headers: {
            "ocp-apim-subscription-key": aiServicesKey,
            "x-ms-useragent": "ai-audio-descriptions/1.0"
        }
      }
    const result = await axios.post(url, data, config);
    return result.data;    
};

export const getAnalyzeTaskInProgress = async (analyzerId: string, taskId: string): Promise<ContentUnderstandingResults> => {
    const url = getContentUnderstandingBaseUrl(analyzerId, `/results/${taskId}`);
    const config = {
        headers: {
            "ocp-apim-subscription-key": aiServicesKey,
            "x-ms-useragent": "ai-audio-descriptions/1.0"
        }
      }
    const result = await axios.get(url, config);
    return result.data;
}

export const getAudioDescriptionsFromAnalyzeResult = async (result: Content[], title: string, metadata: string, narrationStyle: string) : Promise<Segment[]> => {
    // Get all segments in the video from the Content Understanding service
    // and extract which ones are silent
    const allSegmentsInTheVideo = result.map((segment: Content) => {
        return {
            startTime: segment.startTimeMs,
            endTime: segment.endTimeMs,
            description: segment.fields.description.valueString,
            isSilent: segment.transcriptPhrases.length === 0
        };
    });

    // Group all silent segments together to create a list of silent intervals
    // and concatenate the descriptions of the silent segments
    const silentIntervals: Segment[] = [];
    let silentInterval: Segment | null = null;
    for (const segment of allSegmentsInTheVideo) {
        if (segment.isSilent) {
            if (!silentInterval) {
                silentInterval = {
                    startTime: msToTime(segment.startTime),
                    endTime: msToTime(segment.endTime),
                    description: segment.description
                };
            } else {
                silentInterval.endTime = msToTime(segment.endTime);
                silentInterval.description += " " + segment.description;
            }
        } else {
            if (silentInterval) {
                silentIntervals.push(silentInterval);
                silentInterval = null;
            }
        }
    }
    if(silentInterval) {
        silentIntervals.push(silentInterval);
    }

    const wordCountPerSecond = 3;
    const systemMessage = "Rewrite each *description* in no more than *maxWords*. Prefer clarity over length. Do not explain what things mean. Use *metadata* to improve the *description*. Do not repeat information in *previousDescription*. Output only the rewritten *description*.";
    let previousDescription = "";
    for (const segment of silentIntervals) {
        const duration = timeToMs(segment.endTime) - timeToMs(segment.startTime);
        const durationInSeconds = duration / 1000;
        const wordCount = durationInSeconds * wordCountPerSecond;
       
        const userMessage: string = JSON.stringify({
            metadata: {
                title: title,
                context: metadata,
            writingStyle: narrationStyle
            },
            description: segment.description,
            previousDescription: previousDescription,
            maxWords: wordCount
            });

        const rewriteResult = await getGptOutput(systemMessage, userMessage);
        segment.description = rewriteResult;
        previousDescription = rewriteResult;
    }
    return silentIntervals
}

const getGptOutput = async (systemMessage: string, userMessage: string): Promise<string> => {
    const data = {
        "messages": [
            {"role": "system", "content": systemMessage},
            {"role": "user", "content": userMessage}
        ],
        "temperature": 0,
        "max_tokens": 4096
    }

    const url = `https://${aiServicesResource}.openai.azure.com/openai/deployments/${gptDeployment}/chat/completions?api-version=2024-10-21`;
    const config = {
        headers: {
            "Content-Type": "application/json",
            "api-key": aiServicesKey
        }
    }
    try {
        const result = await axios.post(url, data, config);
        return result.data.choices[0].message.content;
    }
    catch (error: any) {
        if (error.response.status === 429) {
            console.log(error);
            await delay(20000);
            return await getGptOutput(systemMessage, userMessage);
        }
        else {
            return "";
        }
    }
}

const getContentUnderstandingBaseUrl = (analyzerId: string, operation?: string) => {
    return `https://${aiServicesResource}.cognitiveservices.azure.com/contentunderstanding/analyzers/${analyzerId}${operation ? operation : ""}?api-version=2024-12-01-preview`
}