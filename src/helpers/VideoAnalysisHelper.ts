import axios from "axios";
import { gptUrl, gptKey, computerVisionVideoDescriptionUrl, computerVisionKey } from "../keys";
import { GenerateId, convertSecondsToTimeString, delay, timeToSeconds } from "./Helper";
import { Segment, VideoAnalysisResult } from "../Models";

export const createVideoAnalysisTask = async (blobUrl: string, title: string, metadata: string, narrationStyle: string) : Promise<VideoAnalysisResult> => {
    var user_prompt_instruction = "**Title:**" + title + "\n**Metadata:**" + metadata + "\n**Writing style:** " + narrationStyle;
    user_prompt_instruction += "\n**Instruction:** Generate audio description for the video segment. Write in short sentences. Make sure to include all the important details. Be more specific in your description for the things that you are confident about.\nFor example, use `man`, `woman`, `child`, etc. instead of person. Use `dog`, `cat`, etc. instead of animal. For characters in movies or animations, use their names if you know them. Check the title and metadata for character names and additional information.";
    user_prompt_instruction += "\n\n**Additional Instructions:** Write in short sentences. Avoid the term \" we see\". Avoid information present in the transcript. Only describe what is changed from the previous scene.";

    const id = GenerateId();
    const url = computerVisionVideoDescriptionUrl.replace("{0}", id);
    const data = {
        input: {
          kind: "file",
          url: blobUrl  
        },
        resource: {
          completion: {
            kind: "gptv",
            endpoint: gptUrl,
            authentication: {
              kind: "key",
              key: gptKey
            }
          }
        },
        preset: "default",
        properties: {
          includePreviousSceneDescription: true,
          includeTranscript: true,
          samplingMethod: "uniform_fixed_count",
          keyframeCount: 1,
          videoSegmentMethod: "transnet",
          description: {
            kind: "describe",
            description: user_prompt_instruction,
            examples: [
                "A busy street with people walking and cars driving."
            ]
          }
        }
      };
    let config = {
        headers: {
            "ocp-apim-subscription-key": computerVisionKey,
            "cogsvc-videoanalysis-config-passthrough-enable": true,
            "cogsvc-videoanalysis-face-identification-enable": true,
        }
      }
    var result = await axios.put(url, data, config);
    return result.data;    
}

export const getVideoAnalysisTask = async (id: string) : Promise<VideoAnalysisResult> => {
    const url = computerVisionVideoDescriptionUrl.replace("{0}", id);
    let config = {
        headers: {
            "ocp-apim-subscription-key": computerVisionKey,
        }
      }
    var result = await axios.get(url, config);
    return result.data;
}

export const getAudioDescriptionsFromVideoAnalysisResult = async (result: any, title: string, metadata: string, narrationStyle: string) : Promise<Segment[]> => {
    const scenes: Segment[] = result.videoSegments.map((segment: any) => {
        const times = iso8601DurationToDate(segment.offset, segment.duration);
        return {
            startTime: times.startTime,
            endTime: times.endTime,
            description: (segment as any).properties!.description
        };
    });
    const transcripts: Segment[] = result.speechSegments.map((segment: any) => {
        const times = iso8601DurationToDate(segment.offset, segment.duration);
        return {
            startTime: times.startTime,
            endTime: times.endTime,
            description: segment.nBest[0].display
        };
    });
    let silentIntervals: Segment[] = getSilentIntervals(scenes, transcripts);
    silentIntervals = silentIntervals.filter((interval: Segment) => timeToSeconds(interval.endTime) - timeToSeconds(interval.startTime) > 1);
    
    // for each scene description, find the silent interval that is closest to the scene, 
    // and add the scene description to the silent interval description
    scenes.forEach((scene: Segment) => {
        let closestSilentInterval = silentIntervals.reduce((prev: Segment, current: Segment) => {
            return Math.abs(timeToSeconds(current.startTime) - timeToSeconds(scene.startTime)) < Math.abs(timeToSeconds(prev.startTime) - timeToSeconds(scene.startTime)) ? current : prev;
        });
        closestSilentInterval.description = closestSilentInterval.description + " " + scene.description;
    });

    const wordCountPerSecond = 3;
    const systemMessage = "You are an expert at generating AudioDescription.";
    let previousDescription = "";
    for (let segment of silentIntervals) {
        const duration = timeToSeconds(segment.endTime) - timeToSeconds(segment.startTime);
        const wordCount = duration * wordCountPerSecond;
       
        var userMessage: string = "**Title:** " + title;
        if (metadata && metadata !== "") {
            userMessage += "\n**Metadata:** " + metadata;
        }
        if (narrationStyle && narrationStyle !== "") {
            userMessage += "\n**Writing style:** " + narrationStyle;
        }
        userMessage += "\n**All scene descriptions:**";
        scenes.forEach((scene: Segment) => {
            userMessage += "\n - " + scene.startTime + " -> " + scene.endTime + ": " + scene.description;
        });
        userMessage += "\n**Instructions:** You are given several descriptions with timestamps, title and metadata about a video. You should use that as context. Remember that information in metadata is more reliable. So, in case of any conflict, use the metadata information.";
        userMessage += " Now, you are given a collection of descriptions. Your task is to describe it in a way that it fits in the silent part of the video. To do this you are also given the number of words you can use. You must not use more than that.";
        userMessage += " The goal is to convey the story. You must not mention unnecessary details. You must not mention that faces are blurred."
        userMessage += " You will find character names and more information in the title and metadata.";
        userMessage += "\n**Note:** You must not go over the specified word limit. You must use the title and metadata to provide missing information and to bring clarity.";
        if (previousDescription !== "") {
            userMessage += "You must not repeat this information - " + previousDescription;
        }
        userMessage += "\n**Task**: Describe the following in " + wordCount + " words:  " + segment.description;
        const rewriteResult = await getGptOutput(systemMessage, userMessage);
        segment.description = rewriteResult;
        previousDescription = rewriteResult;
    }
    return silentIntervals
}

const getSilentIntervals = (scenes: Segment[], transcripts: Segment[]): Segment[] => {
    let start = 0;
    let end = 1;
    if (transcripts.length > 0) {
        end = Math.max(timeToSeconds(scenes[scenes.length - 1].endTime), timeToSeconds(transcripts[transcripts.length - 1].endTime));
    }
    else {
        end = timeToSeconds(scenes[scenes.length - 1].endTime);
    }
    let unoccupiedIntervals = [];
    for (let i = 0; i < transcripts.length; i++) {
        let [occupiedStart, occupiedEnd] = [timeToSeconds(transcripts[i].startTime), timeToSeconds(transcripts[i].endTime)];
        if (start < occupiedStart) {
            unoccupiedIntervals.push([start, occupiedStart]);
        }
            start = Math.max(start, occupiedEnd);
    }
    if (start < end) {
        unoccupiedIntervals.push([start, end]);
    }
    return unoccupiedIntervals.map((interval: number[]) => {
        return {
            startTime: convertSecondsToTimeString(interval[0]),
            endTime: convertSecondsToTimeString(interval[1]),
            description: ""
        };
    });
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

    const url = gptUrl;
    let config = {
        headers: {
            "Content-Type": "application/json",
            "api-key": gptKey
        }
    }
    try {
        var result = await axios.post(url, data, config);
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

const iso8601DurationToDate = (offset: string, duration: string) => {
    const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/;
    
    var matches = offset.match(regex)!;
    var hours = parseInt(matches[1]) || 0;
    var minutes = parseInt(matches[2]) || 0;
    var seconds = parseFloat(matches[3]) || 0;
    const  offsetSeconds = hours * 3600 + minutes * 60 + seconds;

    matches = duration.match(regex)!;
    hours = parseInt(matches[1]) || 0;
    minutes = parseInt(matches[2]) || 0;
    seconds = parseFloat(matches[3]) || 0;
    const durationSeconds = hours * 3600 + minutes * 60 + seconds;

    return {
        startTime: convertSecondsToTimeString(Math.round(offsetSeconds)),
        endTime: convertSecondsToTimeString(Math.round(offsetSeconds + durationSeconds))
    };
}