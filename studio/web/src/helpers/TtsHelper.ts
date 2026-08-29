export const loadAudioFilesIntoMemory = async (audioUrls: string[], setAudioObjects: any) => {
    const audioObjects: HTMLAudioElement[] = [];
    const preloadAudio = (url:string) => {
        return new Promise((resolve, reject) => {
            const audio = new Audio();
            audio.src = url;
            audio.preload = 'auto';
            audio.oncanplaythrough = () => resolve(audio);
            audio.onerror = () => reject(`Failed to load audio from: ${url}`);
        });
    }
    const promises = audioUrls.map(url => preloadAudio(url));
    try {
        const loadedAudios = await Promise.all(promises);
        loadedAudios.forEach(audio => audioObjects.push(audio as HTMLAudioElement));
        setAudioObjects(audioObjects);
      } catch (error) {
        console.error(error);
      }
}