import { Response } from 'express';

/**
 * Standart API Yanıt Formatlayıcı
 * Tüm controller'larda tutarlı { success, message, ...data } formatını garanti eder.
 */
export class ApiResponse {
  /**
   * Başarılı yanıt döner.
   * @param res Express Response nesnesi
   * @param data Yanıt gövdesine eklenen veri nesnesi
   * @param message Kullanıcıya gösterilecek başarı mesajı
   * @param statusCode HTTP durum kodu (varsayılan: 200)
   */
  public static success(
    res: Response,
    data: Record<string, unknown> = {},
    message: string = 'İşlem başarılı.',
    statusCode: number = 200
  ): Response {
    return res.status(statusCode).json({
      success: true,
      message,
      ...data,
    });
  }

  /**
   * Hata yanıtı döner.
   * @param res Express Response nesnesi
   * @param message Kullanıcıya gösterilecek hata mesajı
   * @param statusCode HTTP durum kodu (varsayılan: 400)
   * @param errors Detaylı hata bilgileri (opsiyonel)
   */
  public static error(
    res: Response,
    message: string = 'Bir hata oluştu.',
    statusCode: number = 400,
    errors: unknown = null
  ): Response {
    return res.status(statusCode).json({
      success: false,
      message,
      ...(errors ? { errors } : {}),
    });
  }
}
