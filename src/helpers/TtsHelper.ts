import * as SpeechSdk from "microsoft-cognitiveservices-speech-sdk";
import { blobUri, blobSasToken, STORAGE_CONTAINER_NAME, aiServicesRegion, aiServicesKey } from "../keys";
import { Segment } from "../Models";
import { uploadToBlob } from "./BlobHelper";

export const generateAudioFiles = async (scenes: Segment[], directory: string, setNumberOfAudioFilesGenerated: any) => {
    const speechConfig: SpeechSdk.SpeechConfig = SpeechSdk.SpeechConfig.fromSubscription(aiServicesKey, aiServicesRegion);
    speechConfig.speechRecognitionLanguage = "en-US";
    speechConfig.speechSynthesisVoiceName = "en-US-JennyNeural";
    for (let i = 0; i < scenes.length; i++) {
        const ssml = `
            <speak version='1.0' xml:lang='en-US' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts'>
                <voice name='en-US-JennyNeural'>
                    <prosody rate="+50.00%">
                        ${scenes[i].description}
                    </prosody>
                </voice>
            </speak>`;
        const fileName = `${directory}_${i}.wav`;
        const speechSynthesizer = new SpeechSdk.SpeechSynthesizer(speechConfig, null!);
        await new Promise<void>((resolve) => {
            speechSynthesizer.speakSsmlAsync(ssml, async (result: SpeechSdk.SpeechSynthesisResult) => {
                await uploadToBlob(result.audioData, directory, fileName, null);
                resolve();
            });
        });
        if (setNumberOfAudioFilesGenerated) {
            setNumberOfAudioFilesGenerated(i + 1);
        }
    }
}

export const loadAudioFilesIntoMemory = async (title: string, audioDescriptions: Segment[], setAudioObjects: any) => {
    const audioObjects: HTMLAudioElement[] = [];
    // Function to preload a single .wav file
    const preloadAudio = (url:string) => {
        return new Promise((resolve, reject) => {
            const audio = new Audio();
            audio.src = url;
            audio.preload = 'auto';
            audio.oncanplaythrough = () => resolve(audio);
            audio.onerror = () => reject(`Failed to load audio from: ${url}`);
        });
    }
    const urls = audioDescriptions.map((_, i) => {
        return `${blobUri}/${STORAGE_CONTAINER_NAME}/${title}/${title}_${i}.wav?${blobSasToken}`;
    });
    const promises = urls.map(url => preloadAudio(url));
    try {
        const loadedAudios = await Promise.all(promises);
        loadedAudios.forEach(audio => audioObjects.push(audio as HTMLAudioElement));
        console.log('All audio files preloaded');
        setAudioObjects(audioObjects);
      } catch (error) {
        console.error(error);
      }
}