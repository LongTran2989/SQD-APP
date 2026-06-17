import { apiClient, API_BASE_URL } from './client';
import { Attachment, AttachmentEntityType, FileUploadConfig } from '../types';

// Returns the active (Admin-configurable) upload policy. The policy is a single
// process-wide value, so the in-flight/resolved Promise is cached at module
// scope: a task form with N file_upload fields then triggers ONE request, not N.
let configPromise: Promise<FileUploadConfig> | null = null;
export const getUploadConfig = (): Promise<FileUploadConfig> => {
  if (!configPromise) {
    configPromise = apiClient
      .get('/attachments/config')
      .then((r) => r.data as FileUploadConfig)
      .catch((err) => {
        configPromise = null; // allow a retry on the next mount after a failure
        throw err;
      });
  }
  return configPromise;
};

// Lists non-deleted attachments for an entity, optionally scoped to one form field.
export const listAttachments = (
  entityType: AttachmentEntityType,
  entityId: string | number,
  fieldId?: string
): Promise<Attachment[]> =>
  apiClient
    .get('/attachments', { params: { entityType, entityId: String(entityId), ...(fieldId ? { fieldId } : {}) } })
    .then((r) => r.data);

export interface UploadTarget {
  entityType: AttachmentEntityType;
  entityId: string | number;
  fieldId?: string;
}

// Uploads a single file as multipart/form-data. Lets axios set the multipart
// boundary by passing a FormData body (overrides the client's JSON default).
export const uploadAttachment = (
  file: File,
  target: UploadTarget,
  onProgress?: (percent: number) => void
): Promise<Attachment> => {
  const form = new FormData();
  form.append('entityType', target.entityType);
  form.append('entityId', String(target.entityId));
  if (target.fieldId) form.append('fieldId', target.fieldId);
  form.append('file', file);

  return apiClient
    .post('/attachments', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    })
    .then((r) => r.data);
};

export const deleteAttachment = (id: number): Promise<{ message: string }> =>
  apiClient.delete(`/attachments/${id}`).then((r) => r.data);

// Fetches the file as a blob (sends the auth cookie + acting-user header) and
// triggers a browser download. Streamed via the backend — storage stays private.
export const downloadAttachment = async (id: number, fileName: string): Promise<void> => {
  const res = await apiClient.get(`/attachments/${id}/download`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

// Direct URL (e.g. for opening in a new tab). Relies on the auth cookie.
export const attachmentDownloadUrl = (id: number): string =>
  `${API_BASE_URL}/attachments/${id}/download`;
