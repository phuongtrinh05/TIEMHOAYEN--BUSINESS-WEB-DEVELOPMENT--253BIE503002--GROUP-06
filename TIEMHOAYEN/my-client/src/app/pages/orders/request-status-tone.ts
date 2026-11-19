import { requestStage } from './request-stage';

/** Màu nhãn trạng thái yêu cầu — lấy từ bảng bước chung (request-stage.ts). */
export function requestStatusTone(value: string) {
  return requestStage(value).tone;
}
