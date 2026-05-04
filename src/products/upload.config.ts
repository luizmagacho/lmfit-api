import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { Request } from 'express';
import { diskStorage } from 'multer';
import type { Options } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

export const productImageUploadOptions: Options = (() => {
  // Configuração Cloudinary se a URL existir
  if (process.env.CLOUDINARY_URL) {
    // A URL já configura o SDK do cloudinary automaticamente (v2.config)
    const storage = new CloudinaryStorage({
      cloudinary,
      params: {
        folder: 'lmfit-products',
        allowed_formats: ['jpg', 'jpeg', 'png'],
        public_id: (_req: Express.Request, file: Express.Multer.File) => {
          const name = file.originalname.split('.')[0];
          return `${randomUUID()}-${name}`.substring(0, 100);
        },
      } as any, // Type as any due to multer-storage-cloudinary missing precise params typings
    });

    return {
      storage,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    };
  }

  // Fallback para disco local
  const UPLOAD_DIR = join(process.cwd(), 'uploads', 'products');
  mkdirSync(UPLOAD_DIR, { recursive: true });

  return {
    storage: diskStorage({
      destination: UPLOAD_DIR,
      filename: (
        _req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, filename: string) => void,
      ) => {
        const ext = extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
        cb(null, true);
      } else {
        cb(
          new UnsupportedMediaTypeException('Apenas JPEG e PNG são aceitos.'),
          false,
        );
      }
    },
  };
})();
