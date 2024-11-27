import { BlobServiceClient, BlockBlobParallelUploadOptions } from "@azure/storage-blob";
import { blobUri, STORAGE_CONTAINER_NAME } from "../keys";
import { SavedVideoResult } from "../Models";

const blobServiceClient = new BlobServiceClient(blobUri);

export const uploadToBlob = async (file: any, directory: string, filename: string, setUploadPercentage: any): Promise<string> => {
    const blobName = directory + "/" + filename;
    const containerClient = await blobServiceClient.getContainerClient(STORAGE_CONTAINER_NAME);
    const blobClient = await containerClient.getBlockBlobClient(blobName);
    const options: BlockBlobParallelUploadOptions = {
        blockSize: 4 * 1024 * 1024,
        maxSingleShotSize: 0,
        onProgress: (ev) => {
            if (setUploadPercentage) {
                setUploadPercentage(Math.round(ev.loadedBytes / file!.size * 100))
            }
        }
    };
    await blobClient.uploadData(file, options);
    return blobClient.url;
}

export const getUploadedVideos = async (listOptions?: any): Promise<SavedVideoResult[]> => {
    const containerClient = await blobServiceClient.getContainerClient(STORAGE_CONTAINER_NAME);
    const blobContainerUrl = blobUri + '/' + STORAGE_CONTAINER_NAME;
    const blobGroups: { [key: string]: SavedVideoResult } = {};
    for await (const blob of containerClient.listBlobsFlat(listOptions)) {
        const parts = blob.name.split('/');
        if (parts.length !== 2) {
            continue;
        }
        const key = parts[0];
        if (!blobGroups[key]) {
            blobGroups[key] = {
                prefix: key,
                videoUrl: '',
                audioDescriptionJsonUrl: '',
                detailsJsonUrl: '',
            };
        }
        if (blob.name.endsWith('.mp4')) {
            blobGroups[key].videoUrl = blobContainerUrl + '/' + parts[0] + '/' + parts[0] + '.mp4';
        }
        else if (blob.name.endsWith('details.json')) {
            blobGroups[key].detailsJsonUrl = blobContainerUrl + '/' + parts[0] + '/details.json';
        }
        else if (blob.name.endsWith('.json')) {
            blobGroups[key].audioDescriptionJsonUrl = blobContainerUrl + '/' + parts[0] + '/' + parts[0] + '.json';
        }
    }
    const allValues = Object.values(blobGroups);
    return allValues.filter((value) => value.videoUrl !== '');
}

export const deleteBlobWithPrefix = async (prefix: string) => {
    const containerClient = await blobServiceClient.getContainerClient(STORAGE_CONTAINER_NAME);
    for await (const blob of containerClient.listBlobsFlat()) {
        if (blob.name.startsWith(`${prefix}/`)) {
            await containerClient.deleteBlob(blob.name);
        }
    }
}