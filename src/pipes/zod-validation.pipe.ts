import { PipeTransform, BadRequestException } from '@nestjs/common';
import { z } from 'zod';

// research how to avoid duplication of types
export const MinValidEventSchema = z.looseObject({
  eventId: z.string(),
  source: z.enum(['facebook', 'tiktok']),
  funnelStage: z.enum(['top', 'bottom']),
  eventType: z.string().min(1),
});

export const EventsBatchSchema = z.array(MinValidEventSchema);

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: z.ZodSchema) {}

  transform(value: unknown) {
    try {
      const parsedValue = this.schema.parse(value);
      return parsedValue;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException('Validation failed', {
          cause: z.treeifyError(error),
        });
      }
      throw new BadRequestException('Invalid payload');
    }
  }
}
