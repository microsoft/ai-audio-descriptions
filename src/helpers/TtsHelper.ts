import * as SpeechSdk from "microsoft-cognitiveservices-speech-sdk";
import { blobUri, blobSasToken, STORAGE_CONTAINER_NAME, aiServicesRegion, aiServicesKey } from "../keys";
import { Segment } from "../Models";
import { uploadToBlob } from "./BlobHelper";

// Azure Speech Dragon HD Omni voice. Released in 2026, this voice family
// (700+ voices, expressive style library, paralinguistic tags) replaces the
// previous JennyNeural narration. HD Omni voices auto-detect tone/emotion
// per utterance, so we synthesize at natural rate with no SSML prosody hack
// (v0 used `<prosody rate="+50%">` to fit descriptions into silent gaps;
// budget-fitted writing in Step 2 now sizes descriptions to fit naturally).
const TTS_VOICE = "en-US-Ava:DragonHDOmniLatestNeural";

export const generateAudioFiles = async (scenes: Segment[], directory: string, setNumberOfAudioFilesGenerated: any) => {
    const speechConfig: SpeechSdk.SpeechConfig = SpeechSdk.SpeechConfig.fromSubscription(aiServicesKey, aiServicesRegion);
    speechConfig.speechSynthesisVoiceName = TTS_VOICE;
    for (let i = 0; i < scenes.length; i++) {
        const fileName = `${directory}_${i}.wav`;
        const speechSynthesizer = new SpeechSdk.SpeechSynthesizer(speechConfig, null!);
        await new Promise<void>((resolve) => {
            speechSynthesizer.speakTextAsync(scenes[i].description, async (result: SpeechSdk.SpeechSynthesisResult) => {
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