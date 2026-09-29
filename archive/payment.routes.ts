import { Router, Request, Response } from 'express';

const router = Router();

// FAZ 0: Sitede online ödeme bulunmamaktadır. Tüm ödeme uçları kapatılmıştır.
router.all('*', (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Ödeme uç noktaları kalıcı olarak kapatılmıştır. Siparişler talep ve WhatsApp/mağaza üzerinden yürütülmektedir.',
  });
});

export default router;

