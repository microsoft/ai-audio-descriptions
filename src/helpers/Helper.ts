export const timeToSeconds = (time: string): number => {
    if (time.indexOf(':') === -1) {
        return +time;
    }
    const parts = time.split(':').map(parseFloat);
    return +(parts[0] * 3600 + parts[1] * 60 + parts[2]).toFixed(1);
}

export const msToTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds - hours * 3600) / 60);
    const secs = seconds - hours * 3600 - minutes * 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const timeToMs = (time: string): number => {
    const parts = time.split(':').map(parseFloat);
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
}

export const getVideoName = (video: string) => {
    const parts = video.split('?')[0].split('/');
    const filename = parts[parts.length - 1];
    return filename;
}

export const getVideoNameWithoutExtension = (url: string) => {
    const parts = url.split('?')[0].split('/');
    const filename = parts[parts.length - 1];
    return filename.split('.')[0];
}

export const GenerateId = () => {
    return crypto.randomUUID().replace(/-/g, '');
}

export const convertSecondsToTimeString = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds - hours * 3600) / 60);
    const secs = Math.round(seconds - hours * 3600 - minutes * 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
