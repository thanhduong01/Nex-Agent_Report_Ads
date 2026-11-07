import {
  BlobError, BlobPreconditionFailedError, BlobAccessError, BlobClientTokenExpiredError,
  BlobStoreNotFoundError, BlobStoreSuspendedError,
  BlobServiceRateLimited,
} from "@vercel/blob";

// Blob SDK subclasses inherit Error.name === "Error". Match the actual classes,
// rather than names, and never pass upstream messages (which may contain secrets).
export function isBlobConflict(error:unknown) {
  return error instanceof BlobPreconditionFailedError ||
    (error instanceof BlobError && /\balready exists\b/i.test(error.message));
}
export function blobWriteFailure(error:unknown) {
  if(error instanceof BlobAccessError || error instanceof BlobClientTokenExpiredError ||
    (error instanceof BlobError && error.message.startsWith("Vercel Blob: OIDC is enabled for this project, but not for")))
    return {code:"access_denied",message:"Kho cấu hình từ chối quyền ghi. Kiểm tra quyền truy cập kho lưu trên Vercel rồi lưu lại."};
  if(error instanceof BlobStoreNotFoundError)
    return {code:"store_not_found",message:"Không tìm thấy kho cấu hình. Kiểm tra kết nối Storage của project trên Vercel."};
  if(error instanceof BlobStoreSuspendedError)
    return {code:"store_suspended",message:"Kho cấu hình đang bị tạm ngưng. Kiểm tra trạng thái Storage trên Vercel trước khi lưu lại."};
  if(error instanceof BlobServiceRateLimited)
    return {code:"rate_limited",message:"Kho cấu hình đang giới hạn lượt ghi. Chờ một lát rồi thử lưu lại."};
  return {code:"write_unconfirmed",message:"Chưa xác nhận lưu được cấu hình. Giữ nội dung đang chỉnh và tải lại danh sách để kiểm tra trước khi thử lại."};
}
