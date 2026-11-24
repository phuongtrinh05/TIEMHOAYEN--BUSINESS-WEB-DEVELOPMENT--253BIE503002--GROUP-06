/** Dùng chung cho các popup nhập mã OTP (đăng nhập/quên mật khẩu, đăng ký). */
export const OFFLINE_MESSAGE = 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.';

export function isOffline(err: any): boolean {
  return err?.status === 0 || err?.name === 'TimeoutError';
}

/** Thông báo sai mã OTP kèm số lần thử còn lại (nếu server chưa ghi trong message). */
export function otpErrorText(body: any): string {
  const remaining = body?.remainingAttempts;
  const hasCount = typeof remaining === 'number';
  if (body?.message) {
    return hasCount && !/\d/.test(body.message) ? `${body.message} Bạn còn ${remaining} lần thử.` : body.message;
  }
  return hasCount ? `Mã chưa đúng. Bạn còn ${remaining} lần thử.` : 'Mã không hợp lệ.';
}

/** Đồng hồ đếm ngược cho mã OTP: thời hạn mã và thời gian chờ gửi lại. */
export class OtpTimers {
  expiresSeconds = 0;
  resendSeconds = 0;
  private expiresAt = 0;
  private resendAt = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private onTick: () => void) {}

  start(expiresIn: number, resendAfter: number): void {
    const now = Date.now();
    this.expiresAt = now + Math.max(0, expiresIn) * 1000;
    this.resendAt = now + Math.max(0, resendAfter) * 1000;
    this.run();
  }

  /** 429 khi gửi lại quá sớm: chỉ cập nhật thời gian chờ, giữ nguyên hạn mã hiện tại. */
  delayResend(seconds: number): void {
    this.resendAt = Date.now() + Math.max(0, seconds) * 1000;
    this.run();
  }

  expireNow(): void { this.expiresAt = Date.now(); this.run(); }

  stop(): void {
    clearInterval(this.timer);
    this.expiresSeconds = 0;
    this.resendSeconds = 0;
  }

  private run(): void {
    clearInterval(this.timer);
    const tick = () => {
      const t = Date.now();
      this.expiresSeconds = Math.max(0, Math.ceil((this.expiresAt - t) / 1000));
      this.resendSeconds = Math.max(0, Math.ceil((this.resendAt - t) / 1000));
      if (!this.expiresSeconds && !this.resendSeconds) clearInterval(this.timer);
      this.onTick();
    };
    tick();
    this.timer = setInterval(tick, 250);
  }
}
